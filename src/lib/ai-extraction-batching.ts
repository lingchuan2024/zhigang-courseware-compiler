import { EvidenceAtom, CourseTopic, MacroKnowledgeRelation, ModelConfig, StructureExtractionStatus } from '../types';
import { extractTopics, extractTopicsWithFeedback, extractRelations, mergeTopicsWithAI, type TopicExtractionResult } from './model-v2';
import { validateTopicExtraction, type ValidationResult } from './topic-extraction-validation';
import { topologicalSort, applyRecommendedOrder } from './knowledge-graph';
import { generateId } from './utils';

// ========== 分阶段提取配置 ==========

const MAX_EVIDENCES_PER_WINDOW = 80;    // 每个窗口最多证据数
const MAX_CHARS_PER_WINDOW = 40000;      // 每个窗口最多字符数
const OVERLAP_COUNT = 5;                 // 窗口重叠证据数
const MIN_EVIDENCES_FOR_BATCHING = 100;  // 超过此数量才启用分阶段

// ========== 窗口切分 ==========

export interface EvidenceWindow {
  evidences: EvidenceAtom[];
  windowIndex: number;
  startIndex: number;
  endIndex: number;
}

/**
 * 将证据列表按窗口切分。
 * 使用证据数量和字符预算双重限制，窗口间有重叠。
 */
export function splitEvidencesIntoWindows(
  evidences: EvidenceAtom[]
): EvidenceWindow[] {
  if (evidences.length <= MAX_EVIDENCES_PER_WINDOW) {
    return [{
      evidences,
      windowIndex: 0,
      startIndex: 0,
      endIndex: evidences.length - 1,
    }];
  }

  const windows: EvidenceWindow[] = [];
  let currentIndex = 0;
  let windowIndex = 0;

  while (currentIndex < evidences.length) {
    const windowEvidences: EvidenceAtom[] = [];
    let charCount = 0;

    for (let i = currentIndex; i < evidences.length; i++) {
      const ev = evidences[i];
      const evChars = ev.content.length;

      // 检查是否超出窗口限制
      if (
        windowEvidences.length >= MAX_EVIDENCES_PER_WINDOW ||
        charCount + evChars > MAX_CHARS_PER_WINDOW
      ) {
        break;
      }

      windowEvidences.push(ev);
      charCount += evChars;
    }

    if (windowEvidences.length === 0) {
      // 单条证据就超限，强制加入
      windowEvidences.push(evidences[currentIndex]);
    }

    const endIndex = currentIndex + windowEvidences.length - 1;

    windows.push({
      evidences: windowEvidences,
      windowIndex,
      startIndex: currentIndex,
      endIndex,
    });

    windowIndex++;

    // 下一窗口起始位置（考虑重叠）
    const nextStart = endIndex - OVERLAP_COUNT + 1;
    if (nextStart <= currentIndex) {
      // 防止无限循环
      currentIndex = endIndex + 1;
    } else {
      currentIndex = nextStart;
    }
  }

  return windows;
}

// ========== 是否需要分阶段 ==========

export function shouldBatch(evidences: EvidenceAtom[]): boolean {
  return evidences.length > MIN_EVIDENCES_FOR_BATCHING;
}

// ========== Map: 窗口级主题提取 ==========

interface WindowExtractionResult {
  windowIndex: number;
  topics: CourseTopic[];
  warnings: string[];
  errors: string[];
  rawResult: TopicExtractionResult | null;
}

async function extractTopicsFromWindow(
  config: ModelConfig,
  window: EvidenceWindow
): Promise<WindowExtractionResult> {
  try {
    const result = await extractTopics(config, window.evidences);
    return {
      windowIndex: window.windowIndex,
      topics: result.topics,
      warnings: result.warnings,
      errors: [],
      rawResult: result,
    };
  } catch (e) {
    return {
      windowIndex: window.windowIndex,
      topics: [],
      warnings: [],
      errors: [e instanceof Error ? e.message : String(e)],
      rawResult: null,
    };
  }
}

// ========== 主入口：Map-Reduce 主题提取 ==========

export interface BatchExtractionOptions {
  onStatusChange?: (status: StructureExtractionStatus) => void;
  onWindowProgress?: (current: number, total: number) => void;
}

export interface BatchExtractionResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  errors: string[];
  windowCount: number;
  validation: ValidationResult | null;
}

/**
 * Map-Reduce 主题提取（适用于长课件）。
 *
 * Map 阶段：将证据分窗口，每窗口独立提取主题。
 * Reduce 阶段：AI 全局合并所有窗口的主题。
 *
 * 不使用本地相似度算法（TF-IDF、Embedding、Jaccard、关键词重叠）。
 */
export async function extractTopicsWithBatching(
  config: ModelConfig | null,
  evidences: EvidenceAtom[],
  options: BatchExtractionOptions = {}
): Promise<BatchExtractionResult> {
  if (!config?.apiKey) {
    return {
      topics: [],
      relations: [],
      warnings: ['未配置AI模型，无法提取知识点。'],
      source: 'failed',
      status: 'model-required',
      errors: ['未配置AI模型'],
      windowCount: 0,
      validation: null,
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  // 不需要分阶段 → 直接使用 extractTopicsWithRepair
  if (!shouldBatch(evidences)) {
    const { extractTopicsWithRepair } = await import('./ai-topic-extraction');
    const result = await extractTopicsWithRepair(config, evidences, {
      onStatusChange: options.onStatusChange,
    });
    return {
      topics: result.topics,
      relations: result.relations,
      warnings: result.warnings,
      source: result.source,
      status: result.status,
      errors: result.errors,
      windowCount: 1,
      validation: result.validation,
    };
  }

  // Map 阶段
  options.onStatusChange?.('extracting-topics');
  const windows = splitEvidencesIntoWindows(evidences);
  warnings.push(`课件较长（${evidences.length}条证据），已分为${windows.length}个窗口进行分阶段提取`);

  const windowResults: WindowExtractionResult[] = [];
  for (let i = 0; i < windows.length; i++) {
    options.onWindowProgress?.(i + 1, windows.length);
    const result = await extractTopicsFromWindow(config, windows[i]);
    windowResults.push(result);
    if (result.errors.length > 0) {
      errors.push(`窗口${i + 1}提取失败: ${result.errors.join('; ')}`);
    }
    if (result.warnings.length > 0) {
      warnings.push(...result.warnings.map(w => `窗口${i + 1}: ${w}`));
    }
  }

  // 检查是否有窗口成功
  const successfulWindows = windowResults.filter(wr => wr.topics.length > 0);
  if (successfulWindows.length === 0) {
    return {
      topics: [],
      relations: [],
      warnings,
      source: 'failed',
      status: 'failed',
      errors: [...errors, '所有窗口提取均失败'],
      windowCount: windows.length,
      validation: null,
    };
  }

  // Reduce 阶段：AI 合并
  options.onStatusChange?.('repairing-topics');
  let mergedResult: TopicExtractionResult;
  try {
    mergedResult = await mergeTopicsWithAI(config, successfulWindows, new Set(evidences.map(e => e.id)));
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    errors.push(`AI合并失败: ${errorMsg}`);

    // 合并失败 → 直接拼接所有窗口的主题（去重标题）
    const allTopics: CourseTopic[] = [];
    const seenTitles = new Set<string>();
    for (const wr of successfulWindows) {
      for (const t of wr.topics) {
        const normalized = t.title.trim().toLowerCase();
        if (!seenTitles.has(normalized)) {
          seenTitles.add(normalized);
          allTopics.push(t);
        }
      }
    }
    mergedResult = {
      topics: allTopics,
      usedModel: allTopics.length > 0,
      unassignedEvidenceIds: [],
      granularityReason: '窗口直接拼接（AI合并失败）',
      warnings: ['AI全局合并失败，已直接拼接各窗口主题'],
      raw: null,
    };
  }

  if (mergedResult.topics.length === 0) {
    return {
      topics: [],
      relations: [],
      warnings,
      source: 'failed',
      status: 'failed',
      errors: [...errors, '合并后主题为空'],
      windowCount: windows.length,
      validation: null,
    };
  }

  // 校验合并结果
  let validation = validateTopicExtraction(mergedResult, evidences);
  warnings.push(...validation.warnings.map(w => w.message));

  if (!validation.valid) {
    errors.push(`合并结果校验失败: ${validation.errors.map(e => e.message).join('; ')}`);

    // 尝试一次修复
    try {
      const repairResult = await extractTopicsWithFeedback(
        config,
        evidences,
        validation.repairFeedback,
        mergedResult.raw
      );

      if (repairResult.topics.length > 0) {
        const repairValidation = validateTopicExtraction(repairResult, evidences);
        if (repairValidation.valid) {
          mergedResult = repairResult;
          validation = repairValidation;
          warnings.push('修复后校验通过');
        } else {
          warnings.push('修复后校验仍失败，使用修复后的结果');
          mergedResult = repairResult;
          validation = repairValidation;
        }
      }
    } catch (e) {
      errors.push(`修复重试失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 提取关系
  options.onStatusChange?.('extracting-relations');
  let relations: MacroKnowledgeRelation[] = [];
  let relationSource: 'ai' | 'ai-fallback' = 'ai-fallback';

  try {
    const { relations: aiRelations, usedModel } = await extractRelations(
      config, mergedResult.topics, evidences
    );
    if (usedModel) {
      relations = aiRelations;
      relationSource = 'ai';
    } else {
      relations = generateBasicRelations(mergedResult.topics);
      warnings.push('AI关系提取未使用模型，已生成基础连续关系');
    }
  } catch {
    relations = generateBasicRelations(mergedResult.topics);
    warnings.push('AI关系提取失败，已回退到基础连续关系');
  }

  // 拓扑排序
  const topoResult = topologicalSort(mergedResult.topics, relations);
  const orderedTopics = applyRecommendedOrder(mergedResult.topics, topoResult);
  warnings.push(...topoResult.warnings);

  return {
    topics: orderedTopics,
    relations,
    warnings,
    source: relationSource,
    status: 'ready',
    errors,
    windowCount: windows.length,
    validation,
  };
}

/**
 * 生成基础连续关系。
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
