import {
  EvidenceAtom,
  CourseTopic,
  TopicQualityIssue,
  TopicQualityReport,
  KnowledgePackage,
} from '../types';
import { isGenericTitle } from './topic-extraction-validation';

// ========== 质量检测阈值 ==========

/** 课件页数超过此值时，1～2 个知识点视为过少 */
const TOO_FEW_TOPICS_PAGE_THRESHOLD = 20;
/** 课件页数超过此值时，至少需要的知识点数 */
const TOO_FEW_TOPICS_MIN_COUNT = 3;
/** 单个知识点覆盖证据超过此比例时视为过粗 */
const TOPIC_TOO_BROAD_RATIO = 0.35;
/** 未覆盖证据超过此比例时视为孤儿证据过多 */
const ORPHAN_EVIDENCE_RATIO = 0.2;
/** 两个知识点证据重叠超过此比例时视为重复 */
const TOPIC_OVERLAP_RATIO = 0.6;
/** 核心知识点至少需要的内部内容项数 */
const MIN_INTERNAL_ITEMS_FOR_CORE = 2;

// ========== 质量检测选项 ==========

export interface QualityCheckOptions {
  /** 课件总页数（用于判断 too-few-topics） */
  totalPages: number;
  /** 可选：已有知识包（用于检查内部结构充分性） */
  packages?: KnowledgePackage[];
}

// ========== 核心质量检测 ==========

/**
 * 对 AI 提取的知识点做质量检测。
 *
 * 检测项：
 * 1. too-few-topics: 20+ 页课件只有 1～2 个知识点
 * 2. topic-too-broad: 单个知识点覆盖超过全部有效证据的 35%
 * 3. generic-topic-title: 节点标题是泛化名称
 * 4. missing-learning-objective: 核心知识点没有独立学习目标
 * 5. low-evidence-coverage: 超过 20% 有效证据未被引用
 * 6. evidence-over-concentration: 多个知识点的 Evidence ID 高度重复
 * 7. topic-overlap: 多个知识点证据高度重叠
 * 8. orphan-evidence: 未被任何知识点引用的证据
 * 9. insufficient-internal-structure: 核心知识点没有足够内部内容
 */
export function checkTopicQuality(
  topics: CourseTopic[],
  evidences: EvidenceAtom[],
  options: QualityCheckOptions
): TopicQualityReport {
  const issues: TopicQualityReport['issues'] = [];
  const validEvidenceIds = new Set(evidences.map(e => e.id));
  const totalEvidence = evidences.length;

  // 收集所有已分配的证据
  const assignedEvidenceIds = new Set<string>();
  const topicEvidenceMaps = new Map<string, Set<string>>();

  let genericCount = 0;
  const broadTopicIds: string[] = [];

  for (const topic of topics) {
    // 过滤真实证据
    const realEvIds = new Set(
      topic.evidenceIds.filter(id => validEvidenceIds.has(id))
    );
    topicEvidenceMaps.set(topic.id, realEvIds);
    for (const id of realEvIds) {
      assignedEvidenceIds.add(id);
    }

    // 检查泛化标题
    if (isGenericTitle(topic.title)) {
      issues.push({
        type: 'generic-topic-title' as TopicQualityIssue,
        severity: 'error',
        message: `知识点"${topic.title}"使用了泛化标题，禁止使用"课程内容"等覆盖全部课件的标题`,
        topicId: topic.id,
      });
      genericCount++;
    }

    // 检查学习目标缺失
    if (topic.importance === 'core' && (!topic.learningGoal || topic.learningGoal.trim().length === 0)) {
      issues.push({
        type: 'missing-learning-objective' as TopicQualityIssue,
        severity: 'error',
        message: `核心知识点"${topic.title}"缺少独立学习目标`,
        topicId: topic.id,
      });
    }

    // 检查单个知识点覆盖比例
    if (totalEvidence > 0 && realEvIds.size / totalEvidence > TOPIC_TOO_BROAD_RATIO) {
      const ratio = (realEvIds.size / totalEvidence * 100).toFixed(0);
      issues.push({
        type: 'topic-too-broad' as TopicQualityIssue,
        severity: 'error',
        message: `知识点"${topic.title}"覆盖了${ratio}%的证据（${realEvIds.size}/${totalEvidence}），粒度过粗，需要拆分`,
        topicId: topic.id,
      });
      broadTopicIds.push(topic.id);
    }
  }

  // 检查知识点数量过少
  if (options.totalPages >= TOO_FEW_TOPICS_PAGE_THRESHOLD && topics.length < TOO_FEW_TOPICS_MIN_COUNT) {
    issues.push({
      type: 'too-few-topics' as TopicQualityIssue,
      severity: 'error',
      message: `${options.totalPages}页课件只提取了${topics.length}个知识点，粒度过粗。预期至少${TOO_FEW_TOPICS_MIN_COUNT}个知识点`,
    });
  }

  // 检查证据覆盖率
  const assignedCount = assignedEvidenceIds.size;
  const unassignedCount = totalEvidence - assignedCount;
  const coverageRate = totalEvidence > 0 ? assignedCount / totalEvidence : 0;
  const orphanRatio = totalEvidence > 0 ? unassignedCount / totalEvidence : 0;

  if (totalEvidence > 0 && coverageRate < 0.5) {
    issues.push({
      type: 'low-evidence-coverage' as TopicQualityIssue,
      severity: 'error',
      message: `证据覆盖率仅${(coverageRate * 100).toFixed(0)}%（${assignedCount}/${totalEvidence}），超过一半的证据未分配`,
    });
  }

  // 孤儿证据
  const orphanEvidenceIds = evidences
    .filter(e => !assignedEvidenceIds.has(e.id))
    .map(e => e.id);

  if (totalEvidence > 0 && orphanRatio > ORPHAN_EVIDENCE_RATIO) {
    issues.push({
      type: 'orphan-evidence' as TopicQualityIssue,
      severity: 'error',
      message: `${unassignedCount}条证据（${(orphanRatio * 100).toFixed(0)}%）未被任何知识点引用`,
    });
  }

  // 检查知识点重叠
  let duplicateCount = 0;
  const topicArray = [...topicEvidenceMaps.entries()];
  for (let i = 0; i < topicArray.length; i++) {
    for (let j = i + 1; j < topicArray.length; j++) {
      const [id1, ev1] = topicArray[i];
      const [id2, ev2] = topicArray[j];
      const intersection = [...ev1].filter(id => ev2.has(id));
      if (ev1.size > 0 && ev2.size > 0) {
        const overlapRatio1 = intersection.length / ev1.size;
        const overlapRatio2 = intersection.length / ev2.size;
        const maxOverlap = Math.max(overlapRatio1, overlapRatio2);
        if (maxOverlap > TOPIC_OVERLAP_RATIO) {
          const topic1 = topics.find(t => t.id === id1);
          const topic2 = topics.find(t => t.id === id2);
          duplicateCount++;
          issues.push({
            type: 'topic-overlap' as TopicQualityIssue,
            severity: 'warning',
            message: `知识点"${topic1?.title}"和"${topic2?.title}"的证据重叠率达${(maxOverlap * 100).toFixed(0)}%，应合并或区分`,
            topicId: id1,
          });
        }
      }
    }
  }

  // 检查证据过度集中（多个知识点引用同一组证据）
  // 已经在 topic-overlap 中覆盖

  // 检查内部结构充分性
  if (options.packages) {
    for (const kp of options.packages) {
      if (kp.topic.importance === 'core') {
        const itemCount = kp.internalStructure.items.length;
        if (itemCount < MIN_INTERNAL_ITEMS_FOR_CORE) {
          issues.push({
            type: 'insufficient-internal-structure' as TopicQualityIssue,
            severity: 'warning',
            message: `核心知识点"${kp.topic.title}"只有${itemCount}个内部内容项，预期至少${MIN_INTERNAL_ITEMS_FOR_CORE}个`,
            topicId: kp.topic.id,
          });
        }
      }
    }
  }

  // 计算最大知识点覆盖比例
  let maxTopicCoverage = 0;
  for (const [, evSet] of topicEvidenceMaps) {
    if (totalEvidence > 0) {
      maxTopicCoverage = Math.max(maxTopicCoverage, evSet.size / totalEvidence);
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const needsRepair = errorCount > 0;

  return {
    issues,
    stats: {
      topicCount: topics.length,
      evidenceCount: totalEvidence,
      assignedEvidenceCount: assignedCount,
      unassignedEvidenceCount: unassignedCount,
      coverageRate,
      maxTopicCoverage,
      genericTopicCount: genericCount,
      duplicateTopicCount: duplicateCount,
      orphanEvidenceIds,
      broadTopicIds,
    },
    needsRepair,
  };
}

// ========== 修复反馈构建 ==========

/**
 * 根据质量报告构建 AI 修复反馈。
 *
 * 修复提示必须包含：
 * - 原始候选主题
 * - 全部主题目录
 * - 质量检测错误
 * - 未覆盖 Evidence
 * - 过度集中的 Evidence
 * - 建议检查的学习目标
 * - 禁止行为
 */
export function buildQualityRepairFeedback(
  topics: CourseTopic[],
  evidences: EvidenceAtom[],
  report: TopicQualityReport
): string {
  const parts: string[] = [];

  // 质量检测错误
  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');

  parts.push('=== 质量检测错误 ===');
  for (const err of errors) {
    parts.push(`[错误] ${err.message}`);
  }
  if (warnings.length > 0) {
    parts.push('\n=== 质量检测警告 ===');
    for (const warn of warnings) {
      parts.push(`[警告] ${warn.message}`);
    }
  }

  // 全部主题目录
  parts.push('\n=== 全部主题目录 ===');
  for (const topic of topics) {
    parts.push(`- ${topic.title}（${topic.evidenceIds.length}条证据, ${topic.importance}）: ${topic.learningGoal || '无学习目标'}`);
  }

  // 未覆盖 Evidence
  if (report.stats.orphanEvidenceIds.length > 0) {
    parts.push('\n=== 未覆盖 Evidence ===');
    const orphanEv = evidences.filter(e => report.stats.orphanEvidenceIds.includes(e.id));
    for (const ev of orphanEv.slice(0, 30)) {
      parts.push(`[${ev.id}] (P${ev.pageNumber}, ${ev.type}): ${ev.content.substring(0, 100)}`);
    }
    if (orphanEv.length > 30) {
      parts.push(`... 共 ${orphanEv.length} 条未覆盖证据`);
    }
  }

  // 过度集中的 Evidence
  if (report.stats.broadTopicIds.length > 0) {
    parts.push('\n=== 过度集中的 Evidence ===');
    for (const topicId of report.stats.broadTopicIds) {
      const topic = topics.find(t => t.id === topicId);
      if (topic) {
        const ratio = (topic.evidenceIds.length / evidences.length * 100).toFixed(0);
        parts.push(`"${topic.title}" 占用了 ${ratio}% 的证据（${topic.evidenceIds.length}/${evidences.length}）`);
        parts.push(`  证据ID: ${topic.evidenceIds.slice(0, 20).join(', ')}${topic.evidenceIds.length > 20 ? '...' : ''}`);
      }
    }
  }

  // 建议检查的学习目标
  const topicsWithoutGoal = topics.filter(t => !t.learningGoal || t.learningGoal.trim().length === 0);
  if (topicsWithoutGoal.length > 0) {
    parts.push('\n=== 建议检查的学习目标 ===');
    for (const topic of topicsWithoutGoal) {
      parts.push(`- "${topic.title}" 缺少学习目标`);
    }
  }

  // 禁止行为
  parts.push('\n=== 禁止行为 ===');
  parts.push('1. 禁止输出"课程内容""综合知识""本章内容"等泛化主题');
  parts.push('2. 禁止一个知识点覆盖超过35%的证据');
  parts.push('3. 禁止编造 evidenceId');
  parts.push('4. 禁止机械按页生成知识点');
  parts.push('5. 禁止在AI失败时回退成单一泛化节点');
  parts.push('6. 每个知识点必须有明确学习目标');

  return parts.join('\n');
}

// ========== 质量摘要 ==========

/**
 * 生成质量检测的简短摘要（用于UI展示）
 */
export function summarizeQualityReport(report: TopicQualityReport): string {
  const errorCount = report.issues.filter(i => i.severity === 'error').length;
  const warningCount = report.issues.filter(i => i.severity === 'warning').length;

  const parts: string[] = [];
  parts.push(`知识点数量: ${report.stats.topicCount}`);
  parts.push(`证据覆盖率: ${(report.stats.coverageRate * 100).toFixed(0)}%`);
  parts.push(`最大知识点覆盖: ${(report.stats.maxTopicCoverage * 100).toFixed(0)}%`);
  parts.push(`泛化标题: ${report.stats.genericTopicCount}`);
  parts.push(`重复知识点: ${report.stats.duplicateTopicCount}`);
  parts.push(`未覆盖证据: ${report.stats.orphanEvidenceIds.length}条`);
  if (errorCount > 0) parts.push(`错误: ${errorCount}`);
  if (warningCount > 0) parts.push(`警告: ${warningCount}`);

  return parts.join(' · ');
}
