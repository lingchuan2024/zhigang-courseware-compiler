import { describe, it, expect } from 'vitest';
import {
  isGenericTitle,
  validateTopicExtraction,
  validateRawStructure,
} from '../topic-extraction-validation';
import type { TopicExtractionResult } from '../model-v2';
import { makeEvidence, makeTopic } from './helpers';

// ========== Helper to build a TopicExtractionResult ==========

function makeExtractionResult(
  overrides: Partial<TopicExtractionResult> & { topics?: ReturnType<typeof makeTopic>[] }
): TopicExtractionResult {
  return {
    topics: overrides.topics ?? [],
    usedModel: overrides.usedModel ?? true,
    unassignedEvidenceIds: overrides.unassignedEvidenceIds ?? [],
    granularityReason: overrides.granularityReason ?? '',
    warnings: overrides.warnings ?? [],
    raw: overrides.raw ?? null,
  };
}

// ========== Tests ==========

describe('topic extraction validation', () => {
  // ---------- isGenericTitle ----------

  describe('isGenericTitle', () => {
    it('should detect "课程内容"', () => {
      expect(isGenericTitle('课程内容')).toBe(true);
    });

    it('should detect "课件内容"', () => {
      expect(isGenericTitle('课件内容')).toBe(true);
    });

    it('should detect "本章内容"', () => {
      expect(isGenericTitle('本章内容')).toBe(true);
    });

    it('should detect "综合内容"', () => {
      expect(isGenericTitle('综合内容')).toBe(true);
    });

    it('should detect "主要内容"', () => {
      expect(isGenericTitle('主要内容')).toBe(true);
    });

    it('should detect "概述"', () => {
      expect(isGenericTitle('概述')).toBe(true);
    });

    it('should detect "总结"', () => {
      expect(isGenericTitle('总结')).toBe(true);
    });

    it('should detect "附录"', () => {
      expect(isGenericTitle('附录')).toBe(true);
    });

    it('should detect "参考资料"', () => {
      expect(isGenericTitle('参考资料')).toBe(true);
    });

    it('should detect "课程概述"', () => {
      expect(isGenericTitle('课程概述')).toBe(true);
    });

    it('should detect "补充内容"', () => {
      expect(isGenericTitle('补充内容')).toBe(true);
    });

    it('should detect "其他内容"', () => {
      expect(isGenericTitle('其他内容')).toBe(true);
    });

    it('should detect empty title', () => {
      expect(isGenericTitle('')).toBe(true);
    });

    it('should detect whitespace-only title', () => {
      expect(isGenericTitle('   ')).toBe(true);
      expect(isGenericTitle('\t\n')).toBe(true);
    });

    it('should detect generic title as substring', () => {
      expect(isGenericTitle('课程内容概述')).toBe(true);
      expect(isGenericTitle('本章内容总结')).toBe(true);
      expect(isGenericTitle('第一章课程内容')).toBe(true);
    });

    it('should not flag specific, meaningful titles', () => {
      expect(isGenericTitle('最大似然估计')).toBe(false);
      expect(isGenericTitle('贝叶斯定理')).toBe(false);
      expect(isGenericTitle('梯度下降算法')).toBe(false);
      expect(isGenericTitle('神经网络的反向传播')).toBe(false);
      expect(isGenericTitle('线性回归的损失函数')).toBe(false);
      expect(isGenericTitle('Support Vector Machine')).toBe(false);
    });

    it('should handle titles with leading/trailing whitespace', () => {
      expect(isGenericTitle('  课程内容  ')).toBe(true);
      expect(isGenericTitle('  最大似然估计  ')).toBe(false);
    });
  });

  // ---------- validateTopicExtraction ----------

  describe('validateTopicExtraction', () => {
    // -- Empty topics --

    it('should return error for empty topics', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({ topics: [] });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'EMPTY_TOPICS')).toBe(true);
    });

    it('should report 0 topics in stats for empty topics', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({ topics: [] });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.stats.topicCount).toBe(0);
    });

    // -- Generic titles --

    it('should return error for generic titles', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '课程内容', evidenceIds: ['ev1'] })],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'GENERIC_TITLE')).toBe(true);
      expect(validation.stats.genericTopicCount).toBe(1);
    });

    it('should detect multiple generic titles', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '课程内容', evidenceIds: ['ev1'] }),
          makeTopic({ id: 't2', title: '本章内容', evidenceIds: ['ev2'] }),
          makeTopic({ id: 't3', title: '总结', evidenceIds: ['ev3'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.stats.genericTopicCount).toBe(3);
      expect(validation.errors.filter(e => e.code === 'GENERIC_TITLE')).toHaveLength(3);
    });

    // -- Fabricated evidence IDs --

    it('should return error for fabricated evidence IDs', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '测试主题', evidenceIds: ['ev1', 'fake_ev_99'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'FABRICATED_ID')).toBe(true);
      expect(validation.stats.fabricatedIdCount).toBe(1);
    });

    it('should detect multiple fabricated IDs', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [
          makeTopic({
            id: 't1',
            title: '测试主题',
            evidenceIds: ['ev1', 'fake1', 'fake2', 'fake3'],
          }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.stats.fabricatedIdCount).toBe(3);
    });

    it('should return error when topic has no real evidence IDs', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '测试主题', evidenceIds: ['all_fake'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'NO_EVIDENCE')).toBe(true);
      expect(validation.errors.some(e => e.code === 'FABRICATED_ID')).toBe(true);
    });

    // -- Low coverage --

    it('should return error for low coverage (<50%)', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
        makeEvidence({ id: 'ev4' }),
      ];
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '测试主题', evidenceIds: ['ev1'] })],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.code === 'LOW_COVERAGE')).toBe(true);
      expect(validation.stats.coverageRate).toBe(0.25);
      expect(validation.stats.assignedEvidenceCount).toBe(1);
      expect(validation.stats.unassignedEvidenceCount).toBe(3);
    });

    it('should return warning for moderate coverage (50%-80%)', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
        makeEvidence({ id: 'ev4' }),
      ];
      // 3 out of 4 = 75% → moderate coverage warning
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '主题一', evidenceIds: ['ev1', 'ev2', 'ev3'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      // Should have warning but not error for coverage
      expect(validation.warnings.some(w => w.code === 'MODERATE_COVERAGE')).toBe(true);
      expect(validation.errors.some(e => e.code === 'LOW_COVERAGE')).toBe(false);
    });

    it('should not report coverage issue when coverage >= 80%', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
        makeEvidence({ id: 'ev4' }),
        makeEvidence({ id: 'ev5' }),
      ];
      // 4 out of 5 = 80% → no coverage warning
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '主题一', evidenceIds: ['ev1', 'ev2'] }),
          makeTopic({ id: 't2', title: '主题二', evidenceIds: ['ev3', 'ev4'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.warnings.some(w => w.code === 'MODERATE_COVERAGE')).toBe(false);
      expect(validation.errors.some(e => e.code === 'LOW_COVERAGE')).toBe(false);
      expect(validation.stats.coverageRate).toBe(0.8);
    });

    // -- Valid extraction --

    it('should pass for valid extraction', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '最大似然估计', evidenceIds: ['ev1'] }),
          makeTopic({ id: 't2', title: '贝叶斯推断', evidenceIds: ['ev2'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.stats.coverageRate).toBe(1);
      expect(validation.stats.topicCount).toBe(2);
      expect(validation.stats.genericTopicCount).toBe(0);
      expect(validation.stats.fabricatedIdCount).toBe(0);
    });

    it('should pass when all evidence is assigned across multiple topics', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
        makeEvidence({ id: 'ev4' }),
        makeEvidence({ id: 'ev5' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '线性回归', evidenceIds: ['ev1', 'ev2'] }),
          makeTopic({ id: 't2', title: '逻辑回归', evidenceIds: ['ev3'] }),
          makeTopic({ id: 't3', title: '正则化', evidenceIds: ['ev4', 'ev5'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(true);
      expect(validation.stats.coverageRate).toBe(1);
      expect(validation.stats.assignedEvidenceCount).toBe(5);
    });

    // -- Duplicate topics --

    it('should return warning for duplicate topics', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1'] }),
          makeTopic({ id: 't2', title: '梯度下降', evidenceIds: ['ev2'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.warnings.some(w => w.code === 'DUPLICATE_TOPIC')).toBe(true);
      expect(validation.stats.duplicateTopicCount).toBe(1);
    });

    it('should detect duplicate topics case-insensitively', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: 'Gradient Descent', evidenceIds: ['ev1'] }),
          makeTopic({ id: 't2', title: 'gradient descent', evidenceIds: ['ev2'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.warnings.some(w => w.code === 'DUPLICATE_TOPIC')).toBe(true);
    });

    it('should not flag different titles as duplicates', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1'] }),
          makeTopic({ id: 't2', title: '随机梯度下降', evidenceIds: ['ev2'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.warnings.some(w => w.code === 'DUPLICATE_TOPIC')).toBe(false);
      expect(validation.stats.duplicateTopicCount).toBe(0);
    });

    // -- Stats and repair feedback --

    it('should populate repairFeedback when there are errors', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '课程内容', evidenceIds: ['ev1'] })],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.repairFeedback).toBeTruthy();
      // repairFeedback uses error message text, not error code
      expect(validation.repairFeedback).toContain('课程内容');
      expect(validation.repairFeedback).toContain('泛化标题');
    });

    it('should have empty repairFeedback when valid', () => {
      const evidences = [makeEvidence({ id: 'ev1' })];
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '测试主题', evidenceIds: ['ev1'] })],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.valid).toBe(true);
      expect(validation.repairFeedback).toBe('');
    });

    it('should report correct evidenceCount in stats', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
        makeEvidence({ id: 'ev3' }),
      ];
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '测试', evidenceIds: ['ev1', 'ev2', 'ev3'] })],
      });
      const validation = validateTopicExtraction(result, evidences);
      expect(validation.stats.evidenceCount).toBe(3);
    });

    it('should allow evidence to be shared across topics', () => {
      const evidences = [
        makeEvidence({ id: 'ev1' }),
        makeEvidence({ id: 'ev2' }),
      ];
      const result = makeExtractionResult({
        topics: [
          makeTopic({ id: 't1', title: '主题A', evidenceIds: ['ev1', 'ev2'] }),
          makeTopic({ id: 't2', title: '主题B', evidenceIds: ['ev1', 'ev2'] }),
        ],
      });
      const validation = validateTopicExtraction(result, evidences);
      // Both topics reference real evidence → no fabricated ID error
      expect(validation.errors.some(e => e.code === 'FABRICATED_ID')).toBe(false);
      // Coverage should be 100% (both evidences are assigned)
      expect(validation.stats.coverageRate).toBe(1);
    });

    it('should handle zero evidences gracefully', () => {
      const result = makeExtractionResult({
        topics: [makeTopic({ id: 't1', title: '测试主题', evidenceIds: [] })],
      });
      const validation = validateTopicExtraction(result, []);
      expect(validation.valid).toBe(false);
      // No evidences → NO_EVIDENCE error, but no LOW_COVERAGE (totalEvidence is 0)
      expect(validation.errors.some(e => e.code === 'NO_EVIDENCE')).toBe(true);
      expect(validation.errors.some(e => e.code === 'LOW_COVERAGE')).toBe(false);
      expect(validation.stats.coverageRate).toBe(0);
    });
  });

  // ---------- validateRawStructure ----------

  describe('validateRawStructure', () => {
    it('should reject null', () => {
      const result = validateRawStructure(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject undefined', () => {
      const result = validateRawStructure(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject non-object (string)', () => {
      const result = validateRawStructure('not an object');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject non-object (number)', () => {
      const result = validateRawStructure(42);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject non-object (array)', () => {
      const result = validateRawStructure([1, 2, 3]);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject object without topics field', () => {
      const result = validateRawStructure({ foo: 'bar' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('topics');
    });

    it('should reject object where topics is not an array', () => {
      const result = validateRawStructure({ topics: 'not an array' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('topics');
    });

    it('should reject empty topics array', () => {
      const result = validateRawStructure({ topics: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject topic without title', () => {
      const result = validateRawStructure({
        topics: [{ evidenceIds: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('title');
    });

    it('should reject topic with non-string title', () => {
      const result = validateRawStructure({
        topics: [{ title: 123, evidenceIds: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('title');
    });

    it('should reject topic without evidenceIds', () => {
      const result = validateRawStructure({
        topics: [{ title: 'Test Topic' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('evidenceIds');
    });

    it('should reject topic where evidenceIds is not an array', () => {
      const result = validateRawStructure({
        topics: [{ title: 'Test Topic', evidenceIds: 'not an array' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('evidenceIds');
    });

    it('should accept valid structure with one topic', () => {
      const result = validateRawStructure({
        topics: [{ title: 'Topic 1', evidenceIds: ['ev1'] }],
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid structure with multiple topics', () => {
      const result = validateRawStructure({
        topics: [
          { title: 'Topic 1', evidenceIds: ['ev1'] },
          { title: 'Topic 2', evidenceIds: ['ev2', 'ev3'] },
          { title: 'Topic 3', evidenceIds: [] },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept structure with extra fields', () => {
      const result = validateRawStructure({
        topics: [{ title: 'Topic 1', evidenceIds: ['ev1'], type: 'concept', confidence: 0.9 }],
        unassignedEvidenceIds: [],
        granularityReason: 'test',
      });
      expect(result.valid).toBe(true);
    });

    it('should include topic index in error message for missing title', () => {
      const result = validateRawStructure({
        topics: [
          { title: 'Valid Topic', evidenceIds: ['ev1'] },
          { evidenceIds: ['ev2'] }, // missing title
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('2'); // 2nd topic (1-indexed)
    });

    it('should include topic title in error message for missing evidenceIds', () => {
      const result = validateRawStructure({
        topics: [{ title: 'My Topic', evidenceIds: 'wrong' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('My Topic');
    });
  });
});
