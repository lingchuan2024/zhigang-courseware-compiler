import { describe, expect, it } from 'vitest';
import { normalizeCandidates } from '../candidate-normalizer';

describe('candidate normalization', () => {
  it('merges overlap duplicates and preserves the complete evidence union', () => {
    const result = normalizeCandidates('course', [
      { localId: 'b1:t1', name: '最大似然估计', aliases: ['MLE'], learningObjective: '解释 MLE', scope: '估计参数', genre: 'concept', difficulty: 2, importance: 'core', evidenceIds: ['e1', 'e2'], sectionIds: ['s1'], confidence: 0.8 },
      { localId: 'b2:t1', name: '最大似然估计', aliases: [], learningObjective: '解释最大似然估计', scope: '估计参数', genre: 'concept', difficulty: 2, importance: 'core', evidenceIds: ['e2', 'e3'], sectionIds: ['s1'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].evidenceIds).toEqual(['e1', 'e2', 'e3']);
    expect(result.localTopicToCanonicalId.get('b1:t1'))
      .toBe(result.localTopicToCanonicalId.get('b2:t1'));
  });

  it('keeps same-name candidates separate when objectives and evidence do not overlap', () => {
    const result = normalizeCandidates('course', [
      { localId: 'a', name: '模型', aliases: [], learningObjective: '解释统计模型', scope: '概率', genre: 'concept', difficulty: 1, importance: 'important', evidenceIds: ['e1'], sectionIds: ['prob'], confidence: 0.9 },
      { localId: 'b', name: '模型', aliases: [], learningObjective: '构建机械模型', scope: '力学', genre: 'mechanism', difficulty: 2, importance: 'important', evidenceIds: ['e2'], sectionIds: ['mechanics'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(2);
  });

  it('allows one evidence span to support two distinct learning topics', () => {
    const result = normalizeCandidates('course', [
      { localId: 'a', name: '似然函数', aliases: [], learningObjective: '解释似然函数', scope: '参数估计', genre: 'concept', difficulty: 1, importance: 'core', evidenceIds: ['shared-e1'], sectionIds: ['s1'], confidence: 0.9 },
      { localId: 'b', name: '最大似然估计', aliases: ['MLE'], learningObjective: '使用 MLE 估计参数', scope: '参数估计', genre: 'algorithm', difficulty: 2, importance: 'core', evidenceIds: ['shared-e1'], sectionIds: ['s1'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(2);
    expect(result.topics.every(topic => topic.evidenceIds.includes('shared-e1'))).toBe(true);
  });
});
