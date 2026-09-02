import { describe, expect, it, vi } from 'vitest';
import type { ChapterNote, KnowledgeCard, KnowledgeTopic, ModelConfig } from '../../types';
import {
  buildMasterNotePrompt,
  runMasterNoteGeneration,
  type MasterNoteCompleter,
  type MasterNoteGenerationRequest,
} from '../master-note-generator';

function topic(id: string, name: string): KnowledgeTopic {
  return {
    id, courseId: 'course-1', name, aliases: [], summary: `${name}摘要`, learningObjective: `理解${name}`,
    sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3, knowledgeGenre: 'concept',
    confidence: 0.9, status: 'generated',
  };
}

function card(id: string, topicId: string, detail: string): KnowledgeCard {
  return {
    id, courseId: 'course-1', topicId, topicName: topicId, teachingBlockId: `block-${id}`,
    teachingType: 'free-form', title: id, conciseSummary: `${id}摘要`, detailedNote: detail,
    sourceRanges: [], keywords: [], aliases: [], prerequisiteTopicIds: [], relatedTopicIds: [],
    confidence: 0.9, reviewStatus: 'generated', status: 'completed', sourceVersion: 1, cardVersion: 1,
  };
}

const config: ModelConfig = { endpoint: 'https://api.example.com/v1', model: 'test', apiKey: 'key' };

function input(topicCount = 2) {
  const topics = Array.from({ length: topicCount }, (_, index) => topic(`topic-${index + 1}`, `知识${index + 1}`));
  return {
    courseId: 'course-1', title: '测试课程', topics, topicRelations: [],
    orderedTopicIds: topics.map(item => item.id),
    knowledgeCards: topics.map((item, index) => card(`card-${index + 1}`, item.id, `原始细节-${index + 1}`)),
    glossary: [], formulaIndex: [], terminology: { GLM: '广义线性模型' }, symbols: { theta: '模型参数' },
    structureVersion: 3,
  };
}

describe('master note generator', () => {
  it('uses deterministic synthesis and chapter planning so the model is called only for chapters', async () => {
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = vi.fn(async request => {
      requests.push(request);
      return { markdown: `## ${request.subjectId}\n\n完整章节正文` };
    });

    const result = await runMasterNoteGeneration(config, input(5), {}, completer);

    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.kind === 'chapter-note')).toBe(true);
    expect(result.topicSyntheses).toHaveLength(5);
    expect(result.topicSyntheses.every(item => item.status === 'completed')).toBe(true);
    expect(result.chapterPlan.flatMap(chapter => chapter.topicIds)).toEqual([
      'topic-1', 'topic-2', 'topic-3', 'topic-4', 'topic-5',
    ]);
    expect(result.masterNote.status).toBe('completed');
  });

  it('sends compact chapter material without duplicating synthesis markdown', async () => {
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = async request => {
      requests.push(request);
      return { markdown: '## 第一章\n\n正文' };
    };

    await runMasterNoteGeneration(config, input(1), {}, completer);

    expect(requests[0].user).toContain('原始细节-1');
    expect(requests[0].user).toContain('课程固定章节顺序');
    expect(requests[0].user).not.toContain('本章一级知识综合');
    expect(requests[0].user).not.toContain('sections');
    expect(requests[0].system).toContain('只返回 JSON：{ markdown }');
  });

  it('runs at most two chapter requests concurrently and returns chapters in plan order', async () => {
    let active = 0;
    let maxActive = 0;
    const completer: MasterNoteCompleter = async request => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, request.subjectId === 'chapter-1' ? 15 : 2));
      active -= 1;
      return { markdown: `## ${request.subjectId}\n\n正文` };
    };

    const result = await runMasterNoteGeneration(config, input(12), {}, completer);

    expect(maxActive).toBe(2);
    expect(result.chapterNotes.map(chapter => chapter.id)).toEqual(['chapter-1', 'chapter-2', 'chapter-3']);
  });

  it('reuses completed checkpoint chapters and calls the model only for unfinished chapters', async () => {
    const base = input(8);
    const checkpoint: ChapterNote = {
      id: 'chapter-1', title: '旧标题不影响复用', objective: '旧目标',
      topicIds: ['topic-1', 'topic-2', 'topic-3', 'topic-4'], framework: [],
      markdown: '## 已完成章节\n\n保留正文', sourceCardIds: ['card-1', 'card-2', 'card-3', 'card-4'],
      status: 'completed', retryCount: 0,
    };
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = async request => {
      requests.push(request);
      return { markdown: '## 新章节\n\n新正文' };
    };

    const result = await runMasterNoteGeneration(config, { ...base, resumeChapterNotes: [checkpoint] }, {}, completer);

    expect(requests.map(request => request.subjectId)).toEqual(['chapter-2']);
    expect(result.chapterNotes[0].markdown).toContain('保留正文');
    expect(result.chapterNotes[0].title).toBe(result.chapterPlan[0].title);
  });

  it('stops scheduling more chapters when the first concurrent batch completely fails', async () => {
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = async request => {
      requests.push(request);
      throw new Error('signal timed out');
    };

    const result = await runMasterNoteGeneration(config, input(12), {}, completer);

    expect(requests).toHaveLength(2);
    expect(result.chapterNotes).toHaveLength(3);
    expect(result.chapterNotes[2].error).toContain('已停止后续生成');
    expect(result.masterNote.status).toBe('failed');
  });

  it('configures Agent Plan chapter calls for minimal reasoning and one attempt', () => {
    const prompt = buildMasterNotePrompt({ kind: 'chapter-note', subjectId: 'chapter-1', system: 'system', user: 'user' });

    expect(prompt.reasoningEffort).toBe('minimal');
    expect(prompt.maxOutputTokens).toBe(8192);
    expect(prompt.maxStructuredAttempts).toBe(1);
    expect(prompt.maxTransportAttempts).toBe(1);
  });

  it('keeps completed chapters when another chapter returns empty markdown', async () => {
    const completer: MasterNoteCompleter = async request => request.subjectId === 'chapter-1'
      ? { markdown: '## 第一章\n\n第一章正文' }
      : { markdown: '   ' };

    const result = await runMasterNoteGeneration(config, input(8), {}, completer);

    expect(result.chapterNotes.map(chapter => chapter.status)).toEqual(['completed', 'failed']);
    expect(result.masterNote.status).toBe('partial');
    expect(result.masterNote.markdown).toContain('第一章正文');
    expect(result.masterNote.coverage.missingCardIds).toEqual(['card-5', 'card-6', 'card-7', 'card-8']);
  });

  it('orders cards by the second-layer narrative path in chapter material', async () => {
    const data = input(1);
    const cardA = card('card-a', 'topic-1', '公式细节');
    const cardB = card('card-b', 'topic-1', '知识族细节');
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = async request => {
      requests.push(request);
      return { markdown: '## 知识1\n\n完整正文' };
    };

    const result = await runMasterNoteGeneration(config, {
      ...data,
      knowledgeCards: [cardA, cardB],
      narrativePaths: {
        'topic-1': {
          topicId: 'topic-1', orderedTeachingBlockIds: [cardB.teachingBlockId, cardA.teachingBlockId],
          rationale: '先知识族后公式',
        },
      },
    }, {}, completer);

    expect(requests[0].user.indexOf('card-b')).toBeLessThan(requests[0].user.indexOf('card-a'));
    expect(result.topicSyntheses[0].orderedCardIds).toEqual(['card-b', 'card-a']);
  });
});
