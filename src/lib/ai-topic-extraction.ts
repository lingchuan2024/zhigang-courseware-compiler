import { EvidenceAtom, CourseTopic, MacroKnowledgeRelation, ModelConfig, StructureExtractionStatus } from '../types';
import {
  extractTopics,
  extractTopicsWithFeedback,
  extractRelations,
  type TopicExtractionResult,
  type RawTopicExtractionResult,
} from './model-v2';
import {
  validateTopicExtraction,
  type ValidationResult,
} from './topic-extraction-validation';
import {
  topologicalSort,
  applyRecommendedOrder,
} from './knowledge-graph';
import { generateId } from './utils';

// ========== 带修复重试的主题提取 ==========

const MAX_REPAIR_RETRIES = 2;

export interface TopicExtractionWithRepairOptions {
  onStatusChange?: (status: StructureExtractionStatus) => void;
  onValidationResult?: (validation: ValidationResult, attempt: number) => void;
}

export interface TopicExtractionWithRepairResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  validation: ValidationResult | null;
  attempts: number;
  rawResult: TopicExtractionResult | null;
  errors: string[];
}

/**
 * 带校验和修复重试的 AI 主题提取。
 *
 * 流程：
 * 1. 调用 extractTopics（初始提取）
 * 2. 校验结果
 * 3. 如果校验失败，将错误反馈给AI，请求修复
 * 4. 最多重试 MAX_REPAIR_RETRIES 次
 * 5. 如果最终仍失败，返回 failed 状态
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
      attempts: 0,
      rawResult: null,
      errors: ['未配置AI模型'],
    };
  }

  options.onStatusChange?.('extracting-topics');

  let currentResult: TopicExtractionResult | null = null;
  let currentValidation: ValidationResult | null = null;
  let lastRawResult: RawTopicExtractionResult | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt++) {
    try {
      if (attempt === 0) {
        // 初始提取
        currentResult = await extractTopics(config, evidences);
      } else {
        // 修复重试
        options.onStatusChange?.('repairing-topics');
        const feedback = currentValidation?.repairFeedback || '上一次提取结果存在问题';
        currentResult = await extractTopicsWithFeedback(
          config,
          evidences,
          feedback,
          lastRawResult
        );
      }

      if (!currentResult.usedModel || currentResult.topics.length === 0) {
        errors.push(`第${attempt + 1}次提取未返回有效结果`);
        continue;
      }

      lastRawResult = currentResult.raw;

      // 校验
      currentValidation = validateTopicExtraction(currentResult, evidences);
      options.onValidationResult?.(currentValidation, attempt + 1);

      if (currentValidation.valid) {
        // 校验通过
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
          attempts: attempt + 1,
          rawResult: currentResult,
          errors: [],
        };
      } else {
        // 校验失败
        errors.push(`第${attempt + 1}次提取校验失败：${currentValidation.errors.map(e => e.message).join('; ')}`);
        warnings.push(...currentValidation.warnings.map(w => w.message));
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      errors.push(`第${attempt + 1}次提取异常：${errorMsg}`);
    }
  }

  // 所有重试都失败
  return {
    topics: [],
    relations: [],
    warnings,
    source: 'failed',
    status: 'failed',
    validation: currentValidation,
    attempts: MAX_REPAIR_RETRIES + 1,
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
