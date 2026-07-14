import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeCard,
  KnowledgeTopic,
  ModelConfig,
  TopicRelation,
} from '../../types';
import {
  runMasterNoteGeneration,
  type MasterNoteCompleter,
  type MasterNoteGenerationRequest,
} from '../master-note-generator';

function topic(id: string, name: string): KnowledgeTopic {
  return {
    id,
    courseId: 'course-1',
    name,
    aliases: [],
    summary: `${name}摘要`,
    learningObjective: `理解${name}`,
    sourceRanges: [],
    childTopicIds: [],
    importance: 'core',
    difficulty: 3,
    knowledgeGenre: 'concept',
    confidence: 0.9,
    status: 'generated',
  };
}

function card(id: string, topicId: string, detail: string): KnowledgeCard {
  return {
    id,
    courseId: 'course-1',
    topicId,
    topicName: topicId,
    teachingBlockId: `block-${id}`,
    teachingType: 'free-form',
    title: id,
    conciseSummary: `${id}摘要`,
    detailedNote: detail,
    sourceRanges: [],
    keywords: [],
    aliases: [],
    prerequisiteTopicIds: [],
    relatedTopicIds: [],
    confidence: 0.9,
    reviewStatus: 'generated',
    status: 'completed',
    sourceVersion: 1,
    cardVersion: 1,
  };
}

const config: ModelConfig = { endpoint: 'https://api.example.com/v1', model: 'test', apiKey: 'key' };

describe('master note generator', () => {
  it('scopes synthesis, planning, and chapter contexts to the minimum required data', async () => {
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = vi.fn(async request => {
      requests.push(request);
      if (request.kind === 'topic-synthesis') {
        return {
          framework: [`${request.subjectId}框架`],
          parallelGroups: [],
          comparisons: [],
          formulaChains: [],
          markdown: `## ${request.subjectId}综合\n\n${request.subjectId}综合摘要`,
        };
      }
      if (request.kind === 'chapter-plan') {
        return {
          chapters: [
            { id: 'chapter-1', title: '基础章', objective: '理解基础', topicIds: ['topic-a'], framework: ['共同框架', 'A'] },
            { id: 'chapter-2', title: '扩展章', objective: '理解扩展', topicIds: ['topic-b'], framework: ['B'] },
          ],
        };
      }
      return { markdown: `## ${request.subjectId}\n\n完整章节正文`, glossary: [], formulas: [] };
    });

    const result = await runMasterNoteGeneration(config, {
      courseId: 'course-1',
      title: '测试课程',
      topics: [topic('topic-a', 'A'), topic('topic-b', 'B')],
      topicRelations: [{ id: 'rel-1', sourceTopicId: 'topic-a', targetTopicId: 'topic-b', type: 'hard_prerequisite', reason: 'A 是 B 的基础', confidence: 0.9 } satisfies TopicRelation],
      orderedTopicIds: ['topic-a', 'topic-b'],
      knowledgeCards: [
        card('card-a', 'topic-a', '只属于A的原始细节-A-UNIQUE'),
        card('card-b', 'topic-b', '只属于B的原始细节-B-UNIQUE'),
      ],
      glossary: [],
      formulaIndex: [],
      terminology: { GLM: '广义线性模型' },
      symbols: { theta: '模型参数' },
      structureVersion: 3,
    }, {}, completer);

    const synthesisA = requests.find(request => request.kind === 'topic-synthesis' && request.subjectId === 'topic-a')!;
    expect(synthesisA.user).toContain('card-a');
    expect(synthesisA.user).toContain('A-UNIQUE');
    expect(synthesisA.user).not.toContain('card-b');
    expect(synthesisA.user).not.toContain('B-UNIQUE');

    const planning = requests.find(request => request.kind === 'chapter-plan')!;
    expect(planning.user).toContain('topic-a综合摘要');
    expect(planning.user).toContain('A 是 B 的基础');
    expect(planning.user).not.toContain('A-UNIQUE');
    expect(planning.user).not.toContain('B-UNIQUE');

    const chapterOne = requests.find(request => request.kind === 'chapter-note' && request.subjectId === 'chapter-1')!;
    expect(chapterOne.user).toContain('topic-a综合摘要');
    expect(chapterOne.user).not.toContain('topic-b综合摘要');
    expect(chapterOne.user).toContain('广义线性模型');
    expect(chapterOne.user).toContain('模型参数');
    expect(result.masterNote.status).toBe('completed');
  });

  it('keeps completed chapters when a later chapter returns empty markdown', async () => {
    const onChapter = vi.fn();
    const completer: MasterNoteCompleter = async request => {
      if (request.kind === 'topic-synthesis') {
        return { framework: [request.subjectId], parallelGroups: [], comparisons: [], formulaChains: [], markdown: `${request.subjectId}综合` };
      }
      if (request.kind === 'chapter-plan') {
        return { chapters: [
          { id: 'chapter-1', title: '第一章', objective: '基础', topicIds: ['topic-a'], framework: ['A'] },
          { id: 'chapter-2', title: '第二章', objective: '扩展', topicIds: ['topic-b'], framework: ['B'] },
        ] };
      }
      if (request.subjectId === 'chapter-1') return { markdown: '## 第一章\n\n第一章正文', glossary: [], formulas: [] };
      return { markdown: '   ', glossary: [], formulas: [] };
    };

    const result = await runMasterNoteGeneration(config, {
      courseId: 'course-1',
      title: '测试课程',
      topics: [topic('topic-a', 'A'), topic('topic-b', 'B')],
      topicRelations: [],
      orderedTopicIds: ['topic-a', 'topic-b'],
      knowledgeCards: [card('card-a', 'topic-a', 'A'), card('card-b', 'topic-b', 'B')],
      glossary: [],
      formulaIndex: [],
      terminology: {},
      symbols: {},
      structureVersion: 3,
    }, { onChapter }, completer);

    expect(result.chapterNotes.map(chapter => chapter.status)).toEqual(['completed', 'failed']);
    expect(result.chapterNotes[1].error).toContain('为空');
    expect(result.masterNote.status).toBe('partial');
    expect(result.masterNote.markdown).toContain('第一章正文');
    expect(result.masterNote.coverage.missingCardIds).toEqual(['card-b']);
    expect(onChapter).toHaveBeenCalledTimes(2);
  });

  it('synthesizes cards in the second-layer narrative order', async () => {
    const requests: MasterNoteGenerationRequest[] = [];
    const completer: MasterNoteCompleter = async request => {
      requests.push(request);
      if (request.kind === 'topic-synthesis') {
        return { framework: ['知识族', '公式'], sections: [], parallelGroups: [], comparisons: [], formulaChains: [], markdown: '按顺序综合' };
      }
      if (request.kind === 'chapter-plan') {
        return { chapters: [{ id: 'chapter-1', title: 'GLM', objective: '理解', topicIds: ['topic-a'], framework: ['GLM'] }] };
      }
      return { markdown: '## GLM\n\n完整正文' };
    };
    const cardA = card('card-a', 'topic-a', '公式细节');
    const cardB = card('card-b', 'topic-a', '知识族细节');

    const result = await runMasterNoteGeneration(config, {
      courseId: 'course-1', title: '测试课程', topics: [topic('topic-a', 'GLM')], topicRelations: [],
      orderedTopicIds: ['topic-a'], knowledgeCards: [cardA, cardB], glossary: [], formulaIndex: [],
      terminology: {}, symbols: {}, structureVersion: 1,
      narrativePaths: {
        'topic-a': {
          topicId: 'topic-a',
          orderedTeachingBlockIds: [cardB.teachingBlockId, cardA.teachingBlockId],
          rationale: '先知识族后公式',
        },
      },
      teachingRelations: [],
    }, {}, completer);

    const synthesisRequest = requests.find(request => request.kind === 'topic-synthesis')!;
    expect(synthesisRequest.user.indexOf('card-b')).toBeLessThan(synthesisRequest.user.indexOf('card-a'));
    expect(result.topicSyntheses[0].orderedCardIds).toEqual(['card-b', 'card-a']);
  });
});
