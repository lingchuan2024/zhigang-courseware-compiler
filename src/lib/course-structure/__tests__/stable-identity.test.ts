import { describe, expect, it } from 'vitest';
import {
  evidenceStableKey,
  normalizeStableText,
  teachingUnitStableKey,
  topicStableKey,
} from '../stable-identity';

describe('stable course structure identity', () => {
  it('normalizes equivalent labels deterministically', () => {
    expect(normalizeStableText('  广义  线性模型（GLM） ')).toBe('广义 线性模型(glm)');
  });

  it('keeps keys stable across repeated compilation', () => {
    const evidence = evidenceStableKey('doc-1', 'hash-1', 0, 7, '最大化 对数似然');
    const topic = topicStableKey('course-1', '最大似然估计', ['MLE'], evidence);
    expect(topic).toBe(topicStableKey('course-1', ' 最大似然估计 ', ['mle'], evidence));
    expect(teachingUnitStableKey(topic, 'definition', evidence))
      .toBe(teachingUnitStableKey(topic, 'definition', evidence));
  });

  it('uses only the selected core evidence to disambiguate topic identity', () => {
    expect(topicStableKey('course-1', 'MLE', [], 'core-e1'))
      .not.toBe(topicStableKey('course-1', 'MLE', [], 'core-e2'));
  });
});
