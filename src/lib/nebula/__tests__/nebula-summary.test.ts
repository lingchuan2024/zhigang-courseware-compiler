import { describe, expect, it } from 'vitest';
import { buildCourseNebulaSummary, normalizeKnowledgeKey } from '../nebula-summary';

describe('buildCourseNebulaSummary', () => {
  it('merges normalized topic occurrences across course documents', () => {
    const result = buildCourseNebulaSummary({
      course: { id: 'course-1', name: '机器学习', documentIds: ['a', 'b'], createdAt: 1, updatedAt: 4 },
      documents: [
        { id: 'a', courseId: 'course-1', title: 'A', fileName: 'a.pdf', fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2 },
        { id: 'b', courseId: 'course-1', title: 'B', fileName: 'b.pdf', fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 4 },
      ],
      snapshots: [
        { documentId: 'a', topics: [{ id: 't1', name: 'Softmax', aliases: [], importance: 'core', sourceRangeCount: 2 }], cards: [] },
        { documentId: 'b', topics: [{ id: 't2', name: ' softmax ', aliases: [], importance: 'important', sourceRangeCount: 1 }], cards: [{ topicId: 't2', status: 'complete' }] },
      ],
    });

    expect(result.knowledgeCount).toBe(1);
    expect(result.stars[0]).toMatchObject({
      name: 'Softmax',
      sourceDocumentCount: 2,
      evidenceCount: 3,
      importance: 'core',
      cardStatus: 'complete',
    });
    expect(result.completedCardCount).toBe(1);
  });

  it('uses no bright stars when snapshots contain no topics', () => {
    const result = buildCourseNebulaSummary({
      course: { id: 'empty', name: '空课程', documentIds: [], createdAt: 1, updatedAt: 1 },
      documents: [],
      snapshots: [],
    });

    expect(result.knowledgeCount).toBe(0);
    expect(result.stars).toEqual([]);
  });

  it('normalizes full-width text, whitespace, case, and punctuation', () => {
    expect(normalizeKnowledgeKey('Ｓｏｆｔ — Max')).toBe('softmax');
  });

  it('uses aliases to merge equivalent topics while preserving the first display name', () => {
    const result = buildCourseNebulaSummary({
      course: { id: 'course-2', name: '概率论', documentIds: ['a', 'b'], createdAt: 1, updatedAt: 3 },
      documents: [],
      snapshots: [
        { documentId: 'a', topics: [{ id: 'bayes-a', name: '贝叶斯定理', aliases: ['Bayes theorem'], importance: 'important', sourceRangeCount: 1 }], cards: [] },
        { documentId: 'b', topics: [{ id: 'bayes-b', name: 'Bayes theorem', aliases: ['贝叶斯定理'], importance: 'supplementary', sourceRangeCount: 2 }], cards: [] },
      ],
    });

    expect(result.stars).toHaveLength(1);
    expect(result.stars[0]).toMatchObject({ name: '贝叶斯定理', sourceDocumentCount: 2, evidenceCount: 3 });
  });
});
