import { EvidenceAtom } from '../types';
import type { TopicExtractionResult } from './model-v2';

// ========== 校验结果类型 ==========

export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  topicKey?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  // 修复建议（用于反馈给AI）
  repairFeedback: string;
  // 统计信息
  stats: {
    topicCount: number;
    evidenceCount: number;
    assignedEvidenceCount: number;
    unassignedEvidenceCount: number;
    coverageRate: number;
    duplicateTopicCount: number;
    genericTopicCount: number;
    fabricatedIdCount: number;
  };
}

// ========== 泛化主题标题检测 ==========

const GENERIC_TOPIC_TITLES = [
  '课程内容', '课件内容', '本章内容', '综合内容', '主要内容',
  '课程概述', '课件概述', '内容概述', '概述', '总结',
  '其他内容', '补充内容', '附录', '参考资料',
];

export function isGenericTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length === 0) return true;
  return GENERIC_TOPIC_TITLES.some(g =>
    trimmed === g || trimmed.includes(g)
  );
}

// ========== 核心校验逻辑 ==========

/**
 * 校验 AI 主题提取结果。
 *
 * 检查项：
 * 1. JSON 结构有效
 * 2. 主题数组非空
 * 3. 无泛化标题（"课程内容"等）
 * 4. 所有 evidenceId 都是真实的
 * 5. 证据覆盖率检查
 * 6. 无重复主题（相同标题或相同证据集）
 * 7. 每个主题有必要字段（title, type, evidenceIds）
 * 8. 每个主题至少有一个 evidenceId
 */
export function validateTopicExtraction(
  result: TopicExtractionResult,
  evidences: EvidenceAtom[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const validEvidenceIds = new Set(evidences.map(e => e.id));
  const topics = result.topics;

  // 1. 主题数组非空
  if (topics.length === 0) {
    errors.push({
      code: 'EMPTY_TOPICS',
      message: '主题列表为空，未能识别出任何知识点',
      severity: 'error',
    });
  }

  // 2. 收集所有已分配的证据
  const assignedEvidenceIds = new Set<string>();
  const duplicateTopics: Array<{ title: string; keys: string[] }> = [];
  const seenTitles = new Map<string, string[]>(); // normalized title -> topicKeys
  let genericCount = 0;
  let fabricatedCount = 0;

  for (const topic of topics) {
    // 3. 检查泛化标题
    if (isGenericTitle(topic.title)) {
      errors.push({
        code: 'GENERIC_TITLE',
        message: `主题"${topic.title}"是泛化标题，禁止使用"课程内容"等覆盖全部课件的标题`,
        severity: 'error',
        topicKey: topic.id,
      });
      genericCount++;
    }

    // 4. 检查 evidenceId 真实性
    const realEvidenceIds: string[] = [];
    for (const evId of topic.evidenceIds) {
      if (validEvidenceIds.has(evId)) {
        realEvidenceIds.push(evId);
        assignedEvidenceIds.add(evId);
      } else {
        fabricatedCount++;
        errors.push({
          code: 'FABRICATED_ID',
          message: `主题"${topic.title}"引用了不存在的evidenceId: ${evId}`,
          severity: 'error',
          topicKey: topic.id,
        });
      }
    }

    // 8. 每个主题至少有一个真实 evidenceId
    if (realEvidenceIds.length === 0) {
      errors.push({
        code: 'NO_EVIDENCE',
        message: `主题"${topic.title}"没有关联任何真实证据`,
        severity: 'error',
        topicKey: topic.id,
      });
    }

    // 6. 检查重复标题
    const normalizedTitle = topic.title.trim().toLowerCase();
    const existing = seenTitles.get(normalizedTitle);
    if (existing) {
      existing.push(topic.id);
      duplicateTopics.push({ title: topic.title, keys: existing });
    } else {
      seenTitles.set(normalizedTitle, [topic.id]);
    }
  }

  // 6. 报告重复主题
  for (const dup of duplicateTopics) {
    warnings.push({
      code: 'DUPLICATE_TOPIC',
      message: `存在重复主题"${dup.title}"（${dup.keys.length}个），应合并`,
      severity: 'warning',
    });
  }

  // 5. 证据覆盖率检查
  const totalEvidence = evidences.length;
  const assignedCount = assignedEvidenceIds.size;
  const unassignedCount = totalEvidence - assignedCount;
  const coverageRate = totalEvidence > 0 ? assignedCount / totalEvidence : 0;

  if (totalEvidence > 0 && coverageRate < 0.5) {
    errors.push({
      code: 'LOW_COVERAGE',
      message: `证据覆盖率仅${(coverageRate * 100).toFixed(0)}%（${assignedCount}/${totalEvidence}），超过一半的证据未分配到任何主题，需要细化主题粒度`,
      severity: 'error',
    });
  } else if (totalEvidence > 0 && coverageRate < 0.8) {
    warnings.push({
      code: 'MODERATE_COVERAGE',
      message: `证据覆盖率为${(coverageRate * 100).toFixed(0)}%（${assignedCount}/${totalEvidence}），部分证据未分配`,
      severity: 'warning',
    });
  }

  // 构建 repair feedback
  const repairParts: string[] = [];
  for (const err of errors) {
    repairParts.push(`[错误] ${err.message}`);
  }
  for (const warn of warnings) {
    repairParts.push(`[警告] ${warn.message}`);
  }
  const repairFeedback = repairParts.length > 0
    ? repairParts.join('\n')
    : '';

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    repairFeedback,
    stats: {
      topicCount: topics.length,
      evidenceCount: totalEvidence,
      assignedEvidenceCount: assignedCount,
      unassignedEvidenceCount: unassignedCount,
      coverageRate,
      duplicateTopicCount: duplicateTopics.length,
      genericTopicCount: genericCount,
      fabricatedIdCount: fabricatedCount,
    },
  };
}

/**
 * 快速检查原始 AI 输出是否具有有效结构。
 * 在尝试 normalize 之前调用。
 */
export function validateRawStructure(
  raw: unknown
): { valid: boolean; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'AI输出不是有效对象' };
  }

  const obj = raw as Record<string, unknown>;
  if (!obj.topics || !Array.isArray(obj.topics)) {
    return { valid: false, error: 'AI输出缺少topics数组' };
  }

  if (obj.topics.length === 0) {
    return { valid: false, error: 'topics数组为空' };
  }

  for (let i = 0; i < obj.topics.length; i++) {
    const t = obj.topics[i] as Record<string, unknown>;
    if (!t.title || typeof t.title !== 'string') {
      return { valid: false, error: `第${i + 1}个主题缺少title字段` };
    }
    if (!t.evidenceIds || !Array.isArray(t.evidenceIds)) {
      return { valid: false, error: `主题"${t.title}"缺少evidenceIds数组` };
    }
  }

  return { valid: true };
}
