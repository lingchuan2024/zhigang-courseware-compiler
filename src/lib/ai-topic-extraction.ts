import { EvidenceAtom, CourseTopic, MacroKnowledgeRelation, ModelConfig, StructureExtractionStatus, TopicQualityReport } from '../types';
import {
  extractTopicCandidates,
  judgeTopicGranularity,
  repairTopicsWithQuality,
  extractRelations,
  type TopicExtractionResult,
  type CandidateExtractionResult,
} from './model-v2';
import { ExtractionError } from './extraction-errors';
import {
  validateTopicExtraction,
  type ValidationResult,
} from './topic-extraction-validation';
import {
  checkTopicQuality,
  buildQualityRepairFeedback,
  type QualityCheckOptions,
} from './topic-quality';
import {
  topologicalSort,
  applyRecommendedOrder,
} from './knowledge-graph';
import { generateId } from './utils';

// ========== 两阶段 AI 提取 + 质量门 ==========

const MAX_QUALITY_REPAIR_ROUNDS = 2;

export interface TopicExtractionWithRepairOptions {
  onStatusChange?: (status: StructureExtractionStatus) => void;
  onValidationResult?: (validation: ValidationResult, attempt: number) => void;
  onQualityReport?: (report: TopicQualityReport, round: number) => void;
  /** 课件总页数（用于质量检测） */
  totalPages?: number;
}

export interface TopicExtractionWithRepairResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  validation: ValidationResult | null;
  qualityReport: TopicQualityReport | null;
  attempts: number;
  rawResult: TopicExtractionResult | null;
  errors: string[];
}

/**
 * 两阶段 AI 提取 + 一阶段 AI 修复。
 *
 * 流程：
 * 1. 第一阶段：分批生成候选知识点（extractTopicCandidates）
 * 2. 第二阶段：全局合并与粒度判定（judgeTopicGranularity）
 * 3. 第三阶段：质量检测与 AI 修复（checkTopicQuality + repairTopicsWithQuality）
 *    - 最多修复两轮
 *    - 两轮后仍不合格时进入明确失败状态，展示质量诊断
 *    - 不能降级成一个"课程内容"节点
 *
 * 不使用本地回退。没有模型时返回 model-required。
 */
export async function extractTopicsWithRepair(
  config: ModelConfig | null,
  evidences: EvidenceAtom[],
  options: TopicExtractionWithRepairOptions = {}
): Promise<TopicExtractionWithRepairResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 没有模型配置 → model-required
  if (!config?.apiKey) {
    return {
      topics: [],
      relations: [],
      warnings: ['未配置AI模型，无法提取知识点。请先配置模型。'],
      source: 'failed',
      status: 'model-required',
      validation: null,
      qualityReport: null,
      attempts: 0,
      rawResult: null,
      errors: ['未配置AI模型'],
    };
  }

  const totalPages = options.totalPages || 0;

  // ========== 第一阶段：候选知识点提取 ==========
  options.onStatusChange?.('extracting-topics');

  // model-v2 不再吞掉异常 — 网络/HTTP/JSON 等错误会以 ExtractionError 抛出。
  // 这里捕获后转成 failed 状态，保持 extractTopicsWithRepair 的旧接口契约
  // （返回结果对象而非抛出），同时把结构化错误信息透出到 errors 中。
  let candidateResult: CandidateExtractionResult;
  try {
    candidateResult = await extractTopicCandidates(config, evidences);
  } catch (e) {
    const detail = e instanceof ExtractionError
      ? e.toUserMessage()
      : e instanceof Error ? e.message : String(e);
    errors.push(`第一阶段候选知识点提取失败：未返回有效候选（${detail}）`);
    return {
      topics: [],
      relations: [],
      warnings: [...warnings],
      source: 'failed',
      status: 'failed',
      validation: null,
      qualityReport: null,
      attempts: 1,
      rawResult: null,
      errors,
    };
  }

  if (!candidateResult.usedModel || candidateResult.candidates.length === 0) {
    errors.push('第一阶段候选知识点提取失败：未返回有效候选');
    return {
      topics: [],
      relations: [],
      warnings: [...warnings, ...candidateResult.warnings],
      source: 'failed',
      status: 'failed',
      validation: null,
      qualityReport: null,
      attempts: 1,
      rawResult: null,
      errors,
    };
  }

  warnings.push(...candidateResult.warnings);
  warnings.push(`第一阶段提取了 ${candidateResult.candidates.length} 个候选知识点`);

  // ========== 第二阶段：全局合并与粒度判定 ==========
  options.onStatusChange?.('repairing-topics');

  let currentResult: TopicExtractionResult;
  try {
    currentResult = await judgeTopicGranularity(
      config,
      candidateResult.candidates,
      evidences
    );
  } catch (e) {
    const detail = e instanceof ExtractionError
      ? e.toUserMessage()
      : e instanceof Error ? e.message : String(e);
    errors.push(`第二阶段全局合并失败：未返回有效知识点（${detail}）`);
    return {
      topics: [],
      relations: [],
      warnings: [...warnings],
      source: 'failed',
      status: 'failed',
      validation: null,
      qualityReport: null,
      attempts: 2,
      rawResult: null,
      errors,
    };
  }

  if (!currentResult.usedModel || currentResult.topics.length === 0) {
    errors.push('第二阶段全局合并失败：未返回有效知识点');
    return {
      topics: [],
      relations: [],
      warnings: [...warnings, ...currentResult.warnings],
      source: 'failed',
      status: 'failed',
      validation: null,
      qualityReport: null,
      attempts: 2,
      rawResult: currentResult,
      errors,
    };
  }

  warnings.push(...currentResult.warnings);
  warnings.push(`第二阶段全局整理后得到 ${currentResult.topics.length} 个知识点`);

  // ========== 第三阶段：质量检测与 AI 修复 ==========
  let currentValidation: ValidationResult | null = null;
  let currentQualityReport: TopicQualityReport | null = null;

  for (let round = 0; round <= MAX_QUALITY_REPAIR_ROUNDS; round++) {
    options.onStatusChange?.('quality-checking');

    // 基础校验
    currentValidation = validateTopicExtraction(currentResult, evidences);
    options.onValidationResult?.(currentValidation, round + 1);

    // 质量检测
    const qualityOpts: QualityCheckOptions = { totalPages };
    currentQualityReport = checkTopicQuality(currentResult.topics, evidences, qualityOpts);
    options.onQualityReport?.(currentQualityReport, round + 1);

    // 如果基础校验通过且质量检测无 error，进入关系提取
    if (currentValidation.valid && !currentQualityReport.needsRepair) {
      warnings.push(...currentValidation.warnings.map(w => w.message));

      // 提取关系
      options.onStatusChange?.('extracting-relations');
      let relations: MacroKnowledgeRelation[] = [];
      let relationSource: 'ai' | 'ai-fallback' = 'ai-fallback';

      try {
        const { relations: aiRelations, usedModel: relUsedModel } =
          await extractRelations(config, currentResult.topics, evidences);

        if (relUsedModel) {
          relations = aiRelations;
          relationSource = 'ai';
        } else {
          relations = generateBasicRelations(currentResult.topics);
          warnings.push('AI关系提取未使用模型，已生成基础连续关系');
        }
      } catch (e) {
        relations = generateBasicRelations(currentResult.topics);
        warnings.push('AI关系提取失败，已回退到基础连续关系');
      }

      // 拓扑排序
      const topoResult = topologicalSort(currentResult.topics, relations);
      const orderedTopics = applyRecommendedOrder(currentResult.topics, topoResult);
      warnings.push(...topoResult.warnings);

      return {
        topics: orderedTopics,
        relations,
        warnings,
        source: relationSource,
        status: 'ready',
        validation: currentValidation,
        qualityReport: currentQualityReport,
        attempts: round + 1,
        rawResult: currentResult,
        errors: [],
      };
    }

    // 校验或质量检测失败
    if (currentValidation.errors.length > 0) {
      errors.push(`第${round + 1}次校验失败：${currentValidation.errors.map(e => e.message).join('; ')}`);
    }
    if (currentQualityReport.needsRepair) {
      const errorIssues = currentQualityReport.issues.filter(i => i.severity === 'error');
      errors.push(`第${round + 1}次质量检测发现 ${errorIssues.length} 个错误`);
    }
    warnings.push(...currentValidation.warnings.map(w => w.message));

    // 如果还有修复机会
    if (round < MAX_QUALITY_REPAIR_ROUNDS) {
      options.onStatusChange?.('quality-repairing');

      // 构建修复反馈
      const qualityFeedback = buildQualityRepairFeedback(
        currentResult.topics,
        evidences,
        currentQualityReport
      );

      // 合并基础校验反馈和质量修复反馈
      const fullFeedback = currentValidation.repairFeedback
        ? `${currentValidation.repairFeedback}\n\n${qualityFeedback}`
        : qualityFeedback;

      try {
        const repairResult = await repairTopicsWithQuality(
          config,
          evidences,
          currentResult.topics,
          fullFeedback
        );

        if (repairResult.usedModel && repairResult.topics.length > 0) {
          currentResult = repairResult;
          warnings.push(...repairResult.warnings);
          warnings.push(`第${round + 1}轮修复后得到 ${repairResult.topics.length} 个知识点`);
        } else {
          errors.push(`第${round + 1}轮修复未返回有效结果`);
          // 修复失败，继续用之前的结果
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        errors.push(`第${round + 1}轮修复异常：${errorMsg}`);
      }
    }
  }

  // 所有修复轮次都用完，仍然不合格
  // 进入明确失败状态，展示质量诊断，不降级为"课程内容"
  errors.push('两轮质量修复后仍不合格，进入失败状态。不会降级为泛化节点。');

  return {
    topics: [],
    relations: [],
    warnings,
    source: 'failed',
    status: 'failed',
    validation: currentValidation,
    qualityReport: currentQualityReport,
    attempts: MAX_QUALITY_REPAIR_ROUNDS + 1,
    rawResult: currentResult,
    errors,
  };
}

/**
 * 生成基础连续关系（当AI关系提取失败时的回退）。
 * 只在AI主题提取成功后使用。
 */
function generateBasicRelations(topics: CourseTopic[]): MacroKnowledgeRelation[] {
  const relations: MacroKnowledgeRelation[] = [];
  const sorted = [...topics].sort((a, b) => a.originalOrder - b.originalOrder);
  for (let i = 0; i < sorted.length - 1; i++) {
    relations.push({
      id: generateId('rel'),
      sourceTopicId: sorted[i].id,
      targetTopicId: sorted[i + 1].id,
      type: 'recommended_before' as const,
      evidenceIds: [],
      reason: '课件连续',
      confidence: 0.5,
      origin: 'ai-inferred' as const,
    });
  }
  return relations;
}
