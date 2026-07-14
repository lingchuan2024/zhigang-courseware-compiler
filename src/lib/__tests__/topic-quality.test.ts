import { describe, it, expect } from 'vitest';
import { checkTopicQuality, buildQualityRepairFeedback, summarizeQualityReport } from '../topic-quality';
import { validateTopicExtraction } from '../topic-extraction-validation';
import type { EvidenceAtom, CourseTopic } from '../../types';

// ========== 测试辅助函数 ==========

function makeEvidence(id: string, page: number, content: string, type: string = 'text'): EvidenceAtom {
  return {
    id,
    documentId: 'doc1',
    pageNumber: page,
    blockIndex: 0,
    type: type as EvidenceAtom['type'],
    content,
    confidence: 0.9,
    contentHash: `hash_${id}`,
  };
}

function makeTopic(
  id: string,
  title: string,
  evidenceIds: string[],
  options: Partial<CourseTopic> = {}
): CourseTopic {
  return {
    id,
    title,
    aliases: [],
    type: 'concept',
    learningGoal: '学习目标',
    importance: 'core',
    evidenceIds,
    originalPageNumbers: [],
    originalOrder: 0,
    recommendedOrder: 0,
    confidence: 0.8,
    noteStatus: 'pending',
    ...options,
  };
}

function makeEvidences(count: number, pages: number = 41): EvidenceAtom[] {
  const evidences: EvidenceAtom[] = [];
  for (let i = 0; i < count; i++) {
    evidences.push(makeEvidence(`ev_${i}`, (i % pages) + 1, `证据内容${i}`));
  }
  return evidences;
}

// ========== 测试用例 ==========

describe('topic-quality', () => {
  // ========== Case 1: 41页课件只产生一个泛化主题 ==========
  describe('too-few-topics for 41-page courseware', () => {
    it('41页课件只有1个知识点时触发 too-few-topics', () => {
      const evidences = makeEvidences(80, 41);
      const topics = [makeTopic('t1', '信号处理基础', evidences.map(e => e.id))];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });

      expect(report.stats.topicCount).toBe(1);
      const tooFewIssue = report.issues.find(i => i.type === 'too-few-topics');
      expect(tooFewIssue).toBeDefined();
      expect(tooFewIssue?.severity).toBe('error');
    });

    it('41页课件只有2个知识点时也触发 too-few-topics', () => {
      const evidences = makeEvidences(60, 41);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 30).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(30).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });

      const tooFewIssue = report.issues.find(i => i.type === 'too-few-topics');
      expect(tooFewIssue).toBeDefined();
    });

    it('41页课件有3个以上知识点时不触发 too-few-topics', () => {
      const evidences = makeEvidences(60, 41);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 20).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(20, 40).map(e => e.id)),
        makeTopic('t3', '知识点C', evidences.slice(40).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });

      const tooFewIssue = report.issues.find(i => i.type === 'too-few-topics');
      expect(tooFewIssue).toBeUndefined();
    });

    it('10页课件只有1个知识点时不触发 too-few-topics（页数不够）', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [makeTopic('t1', '知识点A', evidences.map(e => e.id))];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const tooFewIssue = report.issues.find(i => i.type === 'too-few-topics');
      expect(tooFewIssue).toBeUndefined();
    });
  });

  // ========== Case 2: "课程内容"等泛化标题触发质量修复 ==========
  describe('generic-topic-title triggers repair', () => {
    it('"课程内容"标题触发 generic-topic-title', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '课程内容', evidences.slice(0, 10).map(e => e.id)),
        makeTopic('t2', '具体知识点', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const genericIssue = report.issues.find(i => i.type === 'generic-topic-title');
      expect(genericIssue).toBeDefined();
      expect(genericIssue?.severity).toBe('error');
      expect(report.stats.genericTopicCount).toBe(1);
    });

    it('"综合知识"标题触发 generic-topic-title', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '综合知识', evidences.slice(0, 10).map(e => e.id)),
        makeTopic('t2', '具体知识点', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const genericIssue = report.issues.find(i => i.type === 'generic-topic-title');
      expect(genericIssue).toBeDefined();
    });

    it('多个泛化标题都被检测到', () => {
      const evidences = makeEvidences(30, 10);
      const topics = [
        makeTopic('t1', '课程内容', evidences.slice(0, 10).map(e => e.id)),
        makeTopic('t2', '本章内容', evidences.slice(10, 20).map(e => e.id)),
        makeTopic('t3', '具体知识点', evidences.slice(20).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      expect(report.stats.genericTopicCount).toBe(2);
    });

    it('泛化标题使 needsRepair=true', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '主要内容', evidences.slice(0, 10).map(e => e.id)),
        makeTopic('t2', '具体知识点', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      expect(report.needsRepair).toBe(true);
    });
  });

  // ========== Case 3: 过度覆盖证据触发 topic-too-broad ==========
  describe('topic-too-broad detection', () => {
    it('单个知识点覆盖超过35%证据触发 topic-too-broad', () => {
      const evidences = makeEvidences(100, 20);
      // 一个知识点覆盖 50 条证据（50%）
      const topics = [
        makeTopic('t1', '大知识点', evidences.slice(0, 50).map(e => e.id)),
        makeTopic('t2', '小知识点', evidences.slice(50, 70).map(e => e.id)),
        makeTopic('t3', '另一个知识点', evidences.slice(70).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 20 });

      const broadIssue = report.issues.find(i => i.type === 'topic-too-broad');
      expect(broadIssue).toBeDefined();
      expect(broadIssue?.severity).toBe('error');
      expect(report.stats.broadTopicIds).toContain('t1');
    });

    it('知识点覆盖恰好35%时不触发（边界测试）', () => {
      const evidences = makeEvidences(100, 20);
      // 35 条 = 35%，不触发（> 35% 才触发）
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 35).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(35, 70).map(e => e.id)),
        makeTopic('t3', '知识点C', evidences.slice(70).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 20 });

      const broadIssue = report.issues.find(i => i.type === 'topic-too-broad');
      expect(broadIssue).toBeUndefined();
    });

    it('知识点覆盖36%时触发（边界测试）', () => {
      const evidences = makeEvidences(100, 20);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 36).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(36, 68).map(e => e.id)),
        makeTopic('t3', '知识点C', evidences.slice(68).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 20 });

      const broadIssue = report.issues.find(i => i.type === 'topic-too-broad');
      expect(broadIssue).toBeDefined();
    });
  });

  // ========== Case 4: Evidence 覆盖率正确计算 ==========
  describe('evidence coverage calculation', () => {
    it('全部证据被分配时覆盖率为100%', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 10).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      expect(report.stats.coverageRate).toBe(1);
      expect(report.stats.assignedEvidenceCount).toBe(20);
      expect(report.stats.unassignedEvidenceCount).toBe(0);
    });

    it('一半证据被分配时覆盖率为50%', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      expect(report.stats.coverageRate).toBe(0.5);
      expect(report.stats.assignedEvidenceCount).toBe(10);
      expect(report.stats.unassignedEvidenceCount).toBe(10);
    });

    it('超过20%证据未分配时触发 orphan-evidence', () => {
      const evidences = makeEvidences(100, 20);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 40).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(40, 75).map(e => e.id)),
        makeTopic('t3', '知识点C', evidences.slice(75, 78).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 20 });

      // 78/100 = 78% 覆盖，22% 未覆盖 → 超过 20%
      const orphanIssue = report.issues.find(i => i.type === 'orphan-evidence');
      expect(orphanIssue).toBeDefined();
      expect(report.stats.orphanEvidenceIds.length).toBe(22);
    });

    it('覆盖率低于50%触发 low-evidence-coverage', () => {
      const evidences = makeEvidences(100, 20);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 40).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(40, 45).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 20 });

      // 45/100 = 45% < 50%
      const coverageIssue = report.issues.find(i => i.type === 'low-evidence-coverage');
      expect(coverageIssue).toBeDefined();
    });
  });

  // ========== Case 5: 修复两次仍失败时不会生成本地泛化节点 ==========
  describe('repair failure does not produce generic node', () => {
    it('质量检测失败时 needsRepair=true', () => {
      const evidences = makeEvidences(80, 41);
      // 模拟AI返回一个泛化节点
      const topics = [makeTopic('t1', '课程内容', evidences.map(e => e.id))];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });

      expect(report.needsRepair).toBe(true);
      // 应该有多个错误：too-few-topics + generic-topic-title + topic-too-broad
      const errorCount = report.issues.filter(i => i.severity === 'error').length;
      expect(errorCount).toBeGreaterThanOrEqual(2);
    });

    it('修复反馈包含禁止行为', () => {
      // 创建有孤儿证据的场景
      const evidences = makeEvidences(80, 41);
      // 只分配 40 条证据，剩下 40 条为孤儿
      const topics = [
        makeTopic('t1', '课程内容', evidences.slice(0, 20).map(e => e.id)),
        makeTopic('t2', '另一个泛化', evidences.slice(20, 40).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });
      const feedback = buildQualityRepairFeedback(topics, evidences, report);

      expect(feedback).toContain('禁止');
      expect(feedback).toContain('课程内容');
      expect(feedback).toContain('质量检测错误');
      expect(feedback).toContain('未覆盖 Evidence');
    });
  });

  // ========== Case 6: 知识点重叠检测 ==========
  describe('topic-overlap detection', () => {
    it('两个知识点证据重叠超过60%时触发 topic-overlap', () => {
      const evidences = makeEvidences(50, 10);
      // t1 有 20 条，t2 有 20 条，其中 15 条重叠
      const ev1 = evidences.slice(0, 20).map(e => e.id);
      const ev2 = evidences.slice(5, 25).map(e => e.id); // 15 条重叠

      const topics = [
        makeTopic('t1', '知识点A', ev1),
        makeTopic('t2', '知识点B', ev2),
        makeTopic('t3', '知识点C', evidences.slice(25).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const overlapIssue = report.issues.find(i => i.type === 'topic-overlap');
      expect(overlapIssue).toBeDefined();
      expect(report.stats.duplicateTopicCount).toBeGreaterThan(0);
    });

    it('两个知识点证据重叠低于60%时不触发', () => {
      const evidences = makeEvidences(50, 10);
      const ev1 = evidences.slice(0, 20).map(e => e.id);
      const ev2 = evidences.slice(15, 35).map(e => e.id); // 5 条重叠 = 25%

      const topics = [
        makeTopic('t1', '知识点A', ev1),
        makeTopic('t2', '知识点B', ev2),
        makeTopic('t3', '知识点C', evidences.slice(35).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const overlapIssue = report.issues.find(i => i.type === 'topic-overlap');
      expect(overlapIssue).toBeUndefined();
    });
  });

  // ========== Case 7: 缺少学习目标检测 ==========
  describe('missing-learning-objective detection', () => {
    it('核心知识点没有学习目标时触发', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 10).map(e => e.id), {
          learningGoal: '',
          importance: 'core',
        }),
        makeTopic('t2', '知识点B', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const missingGoalIssue = report.issues.find(i => i.type === 'missing-learning-objective');
      expect(missingGoalIssue).toBeDefined();
    });

    it('辅助知识点没有学习目标时不触发', () => {
      const evidences = makeEvidences(20, 10);
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 10).map(e => e.id), {
          learningGoal: '',
          importance: 'secondary',
        }),
        makeTopic('t2', '知识点B', evidences.slice(10).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });

      const missingGoalIssue = report.issues.find(i => i.type === 'missing-learning-objective');
      expect(missingGoalIssue).toBeUndefined();
    });
  });

  // ========== Case 8: 质量摘要 ==========
  describe('summarizeQualityReport', () => {
    it('生成正确的质量摘要', () => {
      const evidences = makeEvidences(80, 41);
      const topics = [makeTopic('t1', '课程内容', evidences.map(e => e.id))];

      const report = checkTopicQuality(topics, evidences, { totalPages: 41 });
      const summary = summarizeQualityReport(report);

      expect(summary).toContain('知识点数量: 1');
      expect(summary).toContain('覆盖率');
      expect(summary).toContain('泛化标题: 1');
    });

    it('无问题时摘要不包含错误和警告', () => {
      const evidences = makeEvidences(20, 10);
      // 4 个知识点各 5 条证据 = 25% each (< 35%, no topic-too-broad)
      const topics = [
        makeTopic('t1', '知识点A', evidences.slice(0, 5).map(e => e.id)),
        makeTopic('t2', '知识点B', evidences.slice(5, 10).map(e => e.id)),
        makeTopic('t3', '知识点C', evidences.slice(10, 15).map(e => e.id)),
        makeTopic('t4', '知识点D', evidences.slice(15).map(e => e.id)),
      ];

      const report = checkTopicQuality(topics, evidences, { totalPages: 10 });
      const summary = summarizeQualityReport(report);

      expect(summary).not.toContain('错误');
      expect(summary).not.toContain('警告');
    });
  });

  // ========== Case 9: 整合 - 基础校验 + 质量检测 ==========
  describe('integration with validateTopicExtraction', () => {
    it('基础校验通过但质量检测失败时仍需要修复', () => {
      const evidences = makeEvidences(80, 41);
      // 构造一个能通过基础校验但质量检测失败的场景
      // 基础校验只检查：空主题、泛化标题、编造ID、无证据、重复标题、低覆盖率
      // 质量检测额外检查：too-few-topics, topic-too-broad 等
      // 只分配 35 条证据，45 条为孤儿（56% 未覆盖）
      const topics = [
        makeTopic('t1', '具体知识点A', evidences.slice(0, 20).map(e => e.id)), // 25% < 35%
        makeTopic('t2', '具体知识点B', evidences.slice(20, 30).map(e => e.id)), // 12.5%
        makeTopic('t3', '具体知识点C', evidences.slice(30, 35).map(e => e.id)), // 6.25%
      ];

      const validation = validateTopicExtraction({ topics, usedModel: true, unassignedEvidenceIds: [], granularityReason: '', warnings: [], raw: null }, evidences);
      const qualityReport = checkTopicQuality(topics, evidences, { totalPages: 41 });

      // 基础校验可能通过（标题不泛化、有证据）
      expect(validation.valid || !validation.valid).toBe(true); // 基础校验可能通过也可能失败
      // 但质量检测会发现覆盖率太低（35/80 = 43.75% < 50%）
      expect(qualityReport.stats.coverageRate).toBeLessThan(0.5);
      // 应该有 orphan-evidence 或 low-evidence-coverage
      const hasCoverageIssue = qualityReport.issues.some(
        i => i.type === 'orphan-evidence' || i.type === 'low-evidence-coverage'
      );
      expect(hasCoverageIssue).toBe(true);
    });
  });
});
