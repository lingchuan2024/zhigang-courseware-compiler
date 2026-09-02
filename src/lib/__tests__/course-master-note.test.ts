import { describe, expect, it } from 'vitest';
import type {
  ChapterNote,
  ChapterPlanItem,
  CourseMasterNote,
  KnowledgeCard,
  KnowledgeTopic,
} from '../../types';
import {
  assembleCourseMasterNote,
  isCompletedMasterNote,
  planFallbackChapters,
} from '../course-master-note';

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
    difficulty: 2,
    knowledgeGenre: 'concept',
    confidence: 0.9,
    status: 'generated',
  };
}

function card(id: string, topicId: string): KnowledgeCard {
  return {
    id,
    courseId: 'course-1',
    topicId,
    topicName: topicId,
    teachingBlockId: `block-${id}`,
    teachingType: 'concept-part',
    title: id,
    conciseSummary: `${id}摘要`,
    detailedNote: `${id}说明`,
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

function chapterPlan(id: string, title: string, topicIds: string[]): ChapterPlanItem {
  return { id, title, objective: `理解${title}`, topicIds, framework: [`认识${title}`, `掌握${title}`] };
}

function chapter(plan: ChapterPlanItem, markdown: string, sourceCardIds: string[], status: ChapterNote['status'] = 'completed'): ChapterNote {
  return { ...plan, markdown, sourceCardIds, status, retryCount: 0 };
}

describe('course master note', () => {
  it('rejects whitespace, partial, and stale master notes', () => {
    const base: CourseMasterNote = {
      id: 'master-1',
      title: '课程',
      outline: [],
      chapters: [],
      glossary: [],
      formulaIndex: [],
      markdown: '   ',
      coverage: { totalCardIds: [], coveredCardIds: [], missingCardIds: [] },
      status: 'completed',
      generatedFromStructureVersion: 3,
    };

    expect(isCompletedMasterNote(base, 3)).toBe(false);
    expect(isCompletedMasterNote({ ...base, markdown: '# 课程', status: 'partial' }, 3)).toBe(false);
    expect(isCompletedMasterNote({ ...base, markdown: '# 课程' }, 4)).toBe(false);
    expect(isCompletedMasterNote({ ...base, markdown: '# 课程' }, 3)).toBe(true);
  });

  it('plans every topic once in stable traversal order', () => {
    const topics = [topic('a', 'A'), topic('b', 'B'), topic('c', 'C'), topic('d', 'D'), topic('e', 'E')];

    const plan = planFallbackChapters(topics, ['c', 'a', 'e', 'b', 'd'], 2);

    expect(plan.flatMap(item => item.topicIds)).toEqual(['c', 'a', 'e', 'b', 'd']);
    expect(plan).toHaveLength(3);
    expect(plan[0].framework).toEqual(['C', 'A']);
  });

  it('uses a readable chapter title instead of joining unrelated first and last topics', () => {
    const topics = [topic('a', '参数模型'), topic('b', '非参数模型'), topic('c', '核方法'), topic('d', 'NW估计量')];

    const plan = planFallbackChapters(topics, topics.map(item => item.id), 4);

    expect(plan[0].title).toBe('参数模型、非参数模型等');
  });

  it('assembles completed chapters and reports uncovered cards', () => {
    const first = chapterPlan('chapter-1', '基础', ['a']);
    const second = chapterPlan('chapter-2', '扩展', ['b']);

    const result = assembleCourseMasterNote({
      courseId: 'course-1',
      title: '机器学习',
      outline: [first, second],
      chapterNotes: [
        chapter(first, '## 基础\n\n共同内容\n\n共同内容\n\n基础正文', ['card-a']),
        chapter(second, '## 扩展\n\n扩展正文', ['card-b']),
      ],
      knowledgeCards: [card('card-a', 'a'), card('card-b', 'b'), card('card-uncovered', 'b')],
      glossary: [],
      formulaIndex: [],
      structureVersion: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.markdown).toContain('# 机器学习');
    expect(result.markdown).toContain('## 课程概述');
    expect(result.markdown).toContain('## 课程框架');
    expect(result.markdown.match(/共同内容/g)).toHaveLength(1);
    expect(result.coverage.coveredCardIds).toEqual(['card-a', 'card-b']);
    expect(result.coverage.missingCardIds).toEqual(['card-uncovered']);
  });

  it('keeps the outline and completed content when one chapter fails', () => {
    const first = chapterPlan('chapter-1', '基础', ['a']);
    const second = chapterPlan('chapter-2', '扩展', ['b']);

    const result = assembleCourseMasterNote({
      courseId: 'course-1',
      title: '机器学习',
      outline: [first, second],
      chapterNotes: [
        chapter(first, '## 基础\n\n基础正文', ['card-a']),
        { ...chapter(second, '', [], 'failed'), error: '模型返回为空' },
      ],
      knowledgeCards: [card('card-a', 'a'), card('card-b', 'b')],
      glossary: [],
      formulaIndex: [],
      structureVersion: 3,
    });

    expect(result.status).toBe('partial');
    expect(result.outline.map(item => item.title)).toEqual(['基础', '扩展']);
    expect(result.markdown).toContain('基础正文');
    expect(result.markdown).toContain('## 扩展\n\n> 本章生成失败：模型返回为空');
    expect(result.coverage.missingCardIds).toEqual(['card-b']);
  });
});
