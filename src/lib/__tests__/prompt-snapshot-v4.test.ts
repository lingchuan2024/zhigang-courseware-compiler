import { describe, it, expect } from 'vitest';
import {
  buildTopicCandidateExtractionPrompt,
  buildTopicGranularityPrompt,
  buildTopicQualityRepairPrompt,
  SYSTEM_PROMPTS,
  PROMPT_VERSIONS,
} from '../prompt-builder';
import type { EvidenceAtom, TopicCandidate } from '../../types';

// ========== 测试辅助函数 ==========

function makeEvidence(id: string, page: number, content: string): EvidenceAtom {
  return {
    id,
    documentId: 'doc1',
    pageNumber: page,
    blockIndex: 0,
    type: 'text',
    content,
    confidence: 0.9,
    contentHash: `hash_${id}`,
  };
}

function makeCandidate(id: string, title: string, evidenceIds: string[]): TopicCandidate {
  return {
    temporaryId: id,
    title,
    aliases: [],
    learningObjective: '学习目标',
    evidenceIds,
    prerequisiteHints: [],
    internalItemHints: [],
    confidence: 0.8,
  };
}

// ========== 测试用例 ==========

describe('prompt-snapshot-v4: cache stability', () => {
  // ========== Case 1: 相同输入产生稳定前缀 ==========
  describe('stable prefix for same input', () => {
    it('候选提取 prompt 的 system + stablePrefix 对相同输入稳定', () => {
      const evidences = [makeEvidence('ev_1', 1, '内容1'), makeEvidence('ev_2', 2, '内容2')];

      const prompt1 = buildTopicCandidateExtractionPrompt(evidences);
      const prompt2 = buildTopicCandidateExtractionPrompt(evidences);

      expect(prompt1.system).toBe(prompt2.system);
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
      expect(prompt1.promptVersion).toBe(prompt2.promptVersion);
    });

    it('粒度判定 prompt 的 system + stablePrefix 对相同输入稳定', () => {
      const candidates = [
        makeCandidate('c1', '知识点A', ['ev_1']),
        makeCandidate('c2', '知识点B', ['ev_2']),
      ];
      const allEvidenceIds = new Set(['ev_1', 'ev_2']);

      const prompt1 = buildTopicGranularityPrompt(candidates, allEvidenceIds);
      const prompt2 = buildTopicGranularityPrompt(candidates, allEvidenceIds);

      expect(prompt1.system).toBe(prompt2.system);
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
    });

    it('质量修复 prompt 的 system + stablePrefix 对相同输入稳定', () => {
      const evidences = [makeEvidence('ev_1', 1, '内容1')];
      const topics = [{ title: '知识点A', evidenceIds: ['ev_1'], learningGoal: '目标', importance: 'core' }];
      const feedback = '质量检测错误';

      const prompt1 = buildTopicQualityRepairPrompt(evidences, topics, feedback);
      const prompt2 = buildTopicQualityRepairPrompt(evidences, topics, feedback);

      expect(prompt1.system).toBe(prompt2.system);
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
    });
  });

  // ========== Case 2: 不同输入不改变 system prompt ==========
  describe('system prompt independent of input', () => {
    it('候选提取 system prompt 不随证据变化', () => {
      const evidences1 = [makeEvidence('ev_1', 1, '内容1')];
      const evidences2 = [makeEvidence('ev_2', 2, '内容2'), makeEvidence('ev_3', 3, '内容3')];

      const prompt1 = buildTopicCandidateExtractionPrompt(evidences1);
      const prompt2 = buildTopicCandidateExtractionPrompt(evidences2);

      expect(prompt1.system).toBe(prompt2.system);
    });

    it('粒度判定 system prompt 不随候选变化', () => {
      const candidates1 = [makeCandidate('c1', '知识点A', ['ev_1'])];
      const candidates2 = [makeCandidate('c1', '知识点A', ['ev_1']), makeCandidate('c2', '知识点B', ['ev_2'])];
      const allEvidenceIds = new Set(['ev_1', 'ev_2']);

      const prompt1 = buildTopicGranularityPrompt(candidates1, allEvidenceIds);
      const prompt2 = buildTopicGranularityPrompt(candidates2, allEvidenceIds);

      expect(prompt1.system).toBe(prompt2.system);
    });
  });

  // ========== Case 3: prompt 版本号正确 ==========
  describe('prompt version', () => {
    it('候选提取使用 v4.0 版本', () => {
      const prompt = buildTopicCandidateExtractionPrompt([makeEvidence('ev_1', 1, '内容')]);
      expect(prompt.promptVersion).toBe('v4.0');
    });

    it('粒度判定使用 v4.0 版本', () => {
      const prompt = buildTopicGranularityPrompt(
        [makeCandidate('c1', 'A', ['ev_1'])],
        new Set(['ev_1'])
      );
      expect(prompt.promptVersion).toBe('v4.0');
    });

    it('质量修复使用 v4.0 版本', () => {
      const prompt = buildTopicQualityRepairPrompt(
        [makeEvidence('ev_1', 1, '内容')],
        [{ title: 'A', evidenceIds: ['ev_1'], learningGoal: '目标', importance: 'core' }],
        'feedback'
      );
      expect(prompt.promptVersion).toBe('v4.0');
    });

    it('PROMPT_VERSIONS 包含所有新任务类型', () => {
      expect(PROMPT_VERSIONS['topic-candidate-extraction']).toBe('v4.0');
      expect(PROMPT_VERSIONS['topic-granularity-judgment']).toBe('v4.0');
      expect(PROMPT_VERSIONS['topic-quality-repair']).toBe('v4.0');
    });
  });

  // ========== Case 4: system prompt 不包含动态内容 ==========
  describe('no dynamic content in system prompt', () => {
    it('候选提取 system 不包含时间戳或随机ID', () => {
      const prompt = buildTopicCandidateExtractionPrompt([makeEvidence('ev_1', 1, '内容')]);

      expect(prompt.system).not.toMatch(/\d{10,}/); // 无时间戳
      expect(prompt.system).not.toMatch(/uuid|random|crypto/i); // 无随机
    });

    it('粒度判定 system 不包含时间戳或随机ID', () => {
      const prompt = buildTopicGranularityPrompt(
        [makeCandidate('c1', 'A', ['ev_1'])],
        new Set(['ev_1'])
      );

      expect(prompt.system).not.toMatch(/\d{10,}/);
      expect(prompt.system).not.toMatch(/uuid|random|crypto/i);
    });

    it('质量修复 system 不包含时间戳或随机ID', () => {
      const prompt = buildTopicQualityRepairPrompt(
        [makeEvidence('ev_1', 1, '内容')],
        [{ title: 'A', evidenceIds: ['ev_1'], learningGoal: '目标', importance: 'core' }],
        'feedback'
      );

      expect(prompt.system).not.toMatch(/\d{10,}/);
      expect(prompt.system).not.toMatch(/uuid|random|crypto/i);
    });
  });

  // ========== Case 5: 证据数据放在 prompt 后部 ==========
  describe('evidence data at the end', () => {
    it('候选提取 dynamicInput 包含证据列表', () => {
      const evidences = [makeEvidence('ev_1', 1, '测试内容')];
      const prompt = buildTopicCandidateExtractionPrompt(evidences);

      expect(prompt.dynamicInput).toContain('ev_1');
      expect(prompt.dynamicInput).toContain('测试内容');
    });

    it('粒度判定 dynamicInput 包含候选列表', () => {
      const candidates = [makeCandidate('c1', '测试知识点', ['ev_1'])];
      const prompt = buildTopicGranularityPrompt(candidates, new Set(['ev_1']));

      expect(prompt.dynamicInput).toContain('测试知识点');
      expect(prompt.dynamicInput).toContain('c1');
    });
  });

  // ========== Case 6: 系统提示词可导出 ==========
  describe('SYSTEM_PROMPTS export', () => {
    it('包含所有新系统提示词', () => {
      expect(SYSTEM_PROMPTS.topicCandidateExtraction).toBeDefined();
      expect(SYSTEM_PROMPTS.topicGranularityJudgment).toBeDefined();
      expect(SYSTEM_PROMPTS.topicQualityRepair).toBeDefined();
    });

    it('系统提示词不为空', () => {
      expect(SYSTEM_PROMPTS.topicCandidateExtraction.length).toBeGreaterThan(100);
      expect(SYSTEM_PROMPTS.topicGranularityJudgment.length).toBeGreaterThan(100);
      expect(SYSTEM_PROMPTS.topicQualityRepair.length).toBeGreaterThan(100);
    });
  });
});
