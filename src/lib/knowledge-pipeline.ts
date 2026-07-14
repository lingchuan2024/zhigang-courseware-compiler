import {
  EvidenceAtom,
  CourseTopic,
  MacroKnowledgeRelation,
  KnowledgePackage,
  RecommendedLearningPath,
  ModelConfig,
  StructureExtractionStatus,
  TopicQualityReport,
} from '../types';
import { createKnowledgePackage, updatePackageInternalStructure } from './knowledge-package';
import { extractTopicContent } from './model-v2';
import { createInternalStructure } from './internal-structure';
import { deriveLearningPath as deriveLearningPathFromGraph } from './learning-path';
import { extractTopicsWithBatching, type BatchExtractionOptions, type ExtractionCheckpoint } from './ai-extraction-batching';

// ========== Pipeline Result Types ==========

export interface PipelineResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  packages: KnowledgePackage[];
  learningPath: RecommendedLearningPath;
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  errors: string[];
  qualityReport: TopicQualityReport | null;
  /** 检查点数据，用于从失败阶段恢复 */
  checkpoint?: ExtractionCheckpoint;
  /** 失败时的详细阶段信息 */
  failedStage?: string;
  failedWindowIndex?: number;
}

export interface PipelineOptions {
  onStatusChange?: (status: StructureExtractionStatus) => void;
  onWindowProgress?: (current: number, total: number) => void;
  onQualityReport?: (report: TopicQualityReport, round: number) => void;
  /** 课件总页数（用于质量检测） */
  totalPages?: number;
  /** 从检查点恢复 */
  checkpoint?: ExtractionCheckpoint;
}

// ========== Layer 1: Macro Knowledge Graph (AI-only) ==========

/**
 * Build macro knowledge graph (layer 1) from evidences.
 *
 * Uses AI-only topic extraction with Map-Reduce for long courseware.
 * No local fallback. Returns model-required status when no model is configured.
 * Returns failed status when AI extraction fails after retries.
 */
export async function buildMacroKnowledgeGraph(
  evidences: EvidenceAtom[],
  modelConfig: ModelConfig | null,
  options: PipelineOptions = {}
): Promise<{
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  errors: string[];
  qualityReport: TopicQualityReport | null;
  checkpoint?: ExtractionCheckpoint;
  failedStage?: string;
  failedWindowIndex?: number;
}> {
  const batchOptions: BatchExtractionOptions = {
    onStatusChange: options.onStatusChange,
    onWindowProgress: options.onWindowProgress,
    onQualityReport: options.onQualityReport,
    totalPages: options.totalPages,
    checkpoint: options.checkpoint,
  };

  const result = await extractTopicsWithBatching(modelConfig, evidences, batchOptions);

  return {
    topics: result.topics,
    relations: result.relations,
    warnings: result.warnings,
    source: result.source,
    status: result.status,
    errors: result.errors,
    qualityReport: result.qualityReport,
    checkpoint: result.checkpoint,
    failedStage: result.failedStage,
    failedWindowIndex: result.failedWindowIndex,
  };
}

// ========== Layer 2: Internal Knowledge Structures (AI-only) ==========

/**
 * Build internal knowledge structures for all topics (layer 2).
 *
 * AI-only: uses extractTopicContent for each topic.
 * No local structure generation in the main flow.
 * Single topic AI failure is isolated — doesn't break the whole pipeline.
 */
export async function buildInternalKnowledgeStructures(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[],
  evidences: EvidenceAtom[],
  modelConfig: ModelConfig | null,
  options: PipelineOptions = {}
): Promise<KnowledgePackage[]> {
  const packages: KnowledgePackage[] = [];

  for (const topic of topics) {
    // Create basic package with source evidence and macro relations
    const kp = createKnowledgePackage(topic, relations, evidences);

    if (modelConfig?.apiKey) {
      options.onStatusChange?.('extracting-internal-structures');
      try {
        const { items: aiItems, relations: aiRelations, usedModel } =
          await extractTopicContent(modelConfig, kp, topics);

        if (usedModel && aiItems.length > 0) {
          // AI extraction succeeded
          const enhancedKp = updatePackageInternalStructure(kp, aiItems, aiRelations);

          if (enhancedKp.internalStructure.items.length > 0) {
            kp.internalStructure = {
              items: enhancedKp.internalStructure.items,
              relations: enhancedKp.internalStructure.relations,
              orderedItemIds: enhancedKp.internalStructure.orderedItemIds,
              source: 'ai',
              status: 'ready',
              warnings: [],
            };
          } else {
            // AI items were all invalid — create empty structure with failed status
            kp.internalStructure = createInternalStructure(topic, evidences, 'local');
            kp.internalStructure = {
              ...kp.internalStructure,
              source: 'ai-fallback',
              status: 'failed',
              warnings: ['AI提取的内容项全部无效，已使用本地结构'],
            };
          }
        } else {
          // AI not used or returned no items — create local structure as fallback
          kp.internalStructure = createInternalStructure(topic, evidences, 'local');
          kp.internalStructure = {
            ...kp.internalStructure,
            source: 'ai-fallback',
            warnings: ['AI内容提取未返回结果，使用本地结构'],
          };
        }
      } catch (e) {
        // Single topic AI failure — keep local structure, don't break pipeline
        kp.internalStructure = createInternalStructure(topic, evidences, 'local');
        kp.internalStructure = {
          ...kp.internalStructure,
          source: 'ai-fallback',
          status: 'failed',
          warnings: [`AI内部结构提取失败: ${e instanceof Error ? e.message : '未知错误'}`],
        };
      }
    } else {
      // No model — create local structure but mark as needing AI
      kp.internalStructure = createInternalStructure(topic, evidences, 'local');
      kp.internalStructure = {
        ...kp.internalStructure,
        source: 'local',
        warnings: ['未配置AI模型，使用本地结构（质量较低）'],
      };
    }

    packages.push(kp);
  }

  return packages;
}

// ========== Learning Path Derivation ==========

/**
 * Derive learning path from stable two-layer structure.
 * Delegates to the deterministic learning-path module.
 */
export function deriveLearningPath(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[],
  packages: KnowledgePackage[]
): RecommendedLearningPath {
  const packageTopicIds = new Set(packages.map(p => p.topic.id));
  const missingTopics = topics.filter(t => !packageTopicIds.has(t.id));

  const additionalWarnings: string[] = [];
  if (missingTopics.length > 0) {
    additionalWarnings.push(
      `${missingTopics.length}个主题缺少对应的知识包：${missingTopics.map(t => t.title).join('、')}`
    );
  }

  const path = deriveLearningPathFromGraph(topics, relations);

  return {
    ...path,
    warnings: [...path.warnings, ...additionalWarnings],
  };
}

// ========== Full Pipeline ==========

/**
 * Full pipeline: evidence → topics → packages → learning path.
 *
 * AI-only: no local fallback for topic extraction.
 * - No model → returns model-required status
 * - AI failure → returns failed status with errors
 * - AI success → continues to internal structures and learning path
 */
export async function runFullPipeline(
  evidences: EvidenceAtom[],
  modelConfig: ModelConfig | null,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const errors: string[] = [];

  // Layer 1: Build macro knowledge graph (AI-only)
  const macroResult = await buildMacroKnowledgeGraph(evidences, modelConfig, options);

  // Handle model-required or failed states
  if (macroResult.status === 'model-required') {
    return {
      topics: [],
      relations: [],
      packages: [],
      learningPath: deriveLearningPathFromGraph([], []),
      warnings: macroResult.warnings,
      source: 'failed',
      status: 'model-required',
      errors: macroResult.errors,
      qualityReport: macroResult.qualityReport,
      checkpoint: macroResult.checkpoint,
      failedStage: macroResult.failedStage,
      failedWindowIndex: macroResult.failedWindowIndex,
    };
  }

  if (macroResult.status === 'failed' || macroResult.topics.length === 0) {
    return {
      topics: [],
      relations: [],
      packages: [],
      learningPath: deriveLearningPathFromGraph([], []),
      warnings: macroResult.warnings,
      source: 'failed',
      status: 'failed',
      errors: [...macroResult.errors, 'AI主题提取失败'],
      qualityReport: macroResult.qualityReport,
      checkpoint: macroResult.checkpoint,
      failedStage: macroResult.failedStage,
      failedWindowIndex: macroResult.failedWindowIndex,
    };
  }

  // Layer 2: Build internal knowledge structures (AI-only)
  const packages = await buildInternalKnowledgeStructures(
    macroResult.topics,
    macroResult.relations,
    evidences,
    modelConfig,
    options
  );

  // Derive learning path
  const learningPath = deriveLearningPath(
    macroResult.topics,
    macroResult.relations,
    packages
  );

  return {
    topics: macroResult.topics,
    relations: macroResult.relations,
    packages,
    learningPath,
    warnings: macroResult.warnings,
    source: macroResult.source,
    status: 'ready',
    errors: [...errors, ...macroResult.errors],
    qualityReport: macroResult.qualityReport,
    checkpoint: macroResult.checkpoint,
  };
}
