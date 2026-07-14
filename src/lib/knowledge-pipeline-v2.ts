/**
 * 知识管线 V2 — 基于 Markdown 的 8 阶段处理流程
 *
 * 阶段：
 * 1. Markdown Normalizer — 标准化 MinerU Markdown
 * 2. Window Understanding — 分析连续内容窗口
 * 3. Topic Extraction — 提取候选知识
 * 4. Topic Reconciliation — 合并和消歧候选知识
 * 5. Teaching Structure Extraction — 提取每个知识的讲法结构
 * 6. Learning Order Generation — 生成两层学习顺序
 * 7. Card and Note Generation — 生成知识卡片与笔记
 * 8. Validation — 检查覆盖、结构和事实一致性
 */

import {
  ModelConfig,
  SourceDocument,
  MarkdownBlock,
  KnowledgeTopic,
  TopicRelation,
  TeachingBlock,
  TeachingRelation,
  CourseLearningPath,
  TopicNarrativePath,
  KnowledgeCard,
  TopicNote,
  GlossaryItem,
  FormulaCard,
  KnowledgePipelineStatus,
  KnowledgeBaseVersions,
  CourseKnowledgeBase,
} from '../types';
import { createSourceDocument } from './markdown-parser';
import { extractCandidatesFromAllWindows } from './topic-extraction-v2';
import { reconcileTopics } from './topic-reconciliation';
import { extractTeachingRelationGraph, extractTopicRelationGraph } from './knowledge-relation-traversal';
import { extractTeachingStructureForAllTopics } from './teaching-structure';
import { generateCourseLearningPath, generateNarrativePaths } from './learning-order';
import { generateCards } from './card-generator';
import { validateKnowledgeStructure, ValidationReport } from './knowledge-validation';
import { generateId } from './utils';
import { ExtractionError } from './extraction-errors';

// ========== 管线选项 ==========

export interface PipelineOptionsV2 {
  /** 进度回调 */
  onStatusChange?: (status: KnowledgePipelineStatus) => void;
  /** 窗口提取进度 */
  onWindowProgress?: (current: number, total: number) => void;
  /** 主题进度 */
  onTopicProgress?: (current: number, total: number) => void;
  /** 笔记进度 */
  onNoteProgress?: (current: number, total: number) => void;
}

// ========== 管线结果 ==========

export interface PipelineResultV2 {
  sourceDocuments: SourceDocument[];
  allBlocks: MarkdownBlock[];
  topics: KnowledgeTopic[];
  topicRelations: TopicRelation[];
  teachingBlocks: TeachingBlock[];
  teachingRelations: TeachingRelation[];
  courseLearningPath: CourseLearningPath;
  narrativePaths: Record<string, TopicNarrativePath>;
  knowledgeCards: KnowledgeCard[];
  topicNotes: TopicNote[];
  glossary: GlossaryItem[];
  formulaCards: FormulaCard[];
  unassignedBlocks: string[];
  versions: KnowledgeBaseVersions;
  validation: ValidationReport;
  warnings: string[];
  errors: string[];
  status: KnowledgePipelineStatus;
}

// ========== 主入口 ==========

/**
 * 执行完整的知识提取管线。
 *
 * 输入：MinerU Markdown 文本
 * 输出：完整的知识库结构
 */
export async function runKnowledgePipeline(
  config: ModelConfig | null,
  markdownTexts: Array<{ markdown: string; title: string }>,
  courseId: string,
  options: PipelineOptionsV2 = {}
): Promise<PipelineResultV2> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const versions: KnowledgeBaseVersions = {
    source: 0,
    normalization: 0,
    topicStructure: 0,
    teachingStructure: 0,
    ordering: 0,
    cards: 0,
    notes: 0,
    embeddings: 0,
  };

  // 检查模型配置
  if (!config?.apiKey) {
    return createEmptyResult([], [], warnings, errors, 'model-required');
  }

  // ========== 阶段 1: Markdown Normalizer ==========

  options.onStatusChange?.('normalizing');
  const sourceDocuments: SourceDocument[] = [];
  const allBlocks: MarkdownBlock[] = [];

  for (const { markdown, title } of markdownTexts) {
    const doc = createSourceDocument(markdown, courseId, title);
    sourceDocuments.push(doc);
    allBlocks.push(...doc.blocks);
    versions.source++;
    versions.normalization++;
  }
  warnings.push(`已标准化 ${sourceDocuments.length} 个文档，共 ${allBlocks.length} 个内容块`);

  // ========== 阶段 2 + 3: Window Understanding + Topic Extraction ==========

  options.onStatusChange?.('window-analysis');
  const { analyses, windowCount, failedWindows } =
    await extractCandidatesFromAllWindows(
      config,
      allBlocks,
      options.onWindowProgress,
    );

  if (failedWindows.length > 0) {
    warnings.push(`${failedWindows.length}/${windowCount} 个窗口提取失败，已跳过`);
  }

  // 收集所有候选知识
  const allCandidates = analyses.flatMap(a => a.candidateTopics);

  if (allCandidates.length === 0) {
    errors.push('候选知识点提取为空');
    return createEmptyResult(sourceDocuments, allBlocks, warnings, errors, 'failed');
  }

  warnings.push(`候选提取阶段共获得 ${allCandidates.length} 个候选知识点`);

  // ========== 阶段 4: Topic Reconciliation ==========

  options.onStatusChange?.('topic-reconciliation');
  let topics: KnowledgeTopic[] = [];
  let topicRelations: TopicRelation[] = [];

  try {
    const reconciled = await reconcileTopics(config, allCandidates, allBlocks);
    topics = reconciled.topics;
    topicRelations = reconciled.relations;
    warnings.push(...reconciled.mergeWarnings);
    versions.topicStructure++;

    if (topics.length === 0) {
      errors.push('全局合并后知识点为空');
      return createEmptyResult(sourceDocuments, allBlocks, warnings, errors, 'failed');
    }

    warnings.push(`全局合并后得到 ${topics.length} 个知识点`);

    // 候选合并与关系建网分离：先确定第一层节点，再让 AI 遍历完整目录建边。
    try {
      const traversedRelations = await extractTopicRelationGraph(config, topics);
      if (traversedRelations.length > 0) {
        topicRelations = traversedRelations;
        warnings.push(`遍历第一层节点后建立 ${topicRelations.length} 条课程关系`);
      } else if (topicRelations.length > 0) {
        warnings.push('第一层独立关系遍历未产生新边，已保留合并阶段关系');
      }
    } catch (relationError) {
      warnings.push(`第一层关系遍历失败，已保留现有关系：${relationError instanceof Error ? relationError.message : String(relationError)}`);
    }
  } catch (e) {
    const msg = e instanceof ExtractionError
      ? e.toUserMessage()
      : e instanceof Error ? e.message : String(e);
    errors.push(`知识点合并失败: ${msg}`);
    return createEmptyResult(sourceDocuments, allBlocks, warnings, errors, 'failed');
  }

  // ========== 阶段 5: Teaching Structure Extraction ==========

  options.onStatusChange?.('teaching-extraction');
  let teachingBlocks: TeachingBlock[] = [];
  let teachingRelations: TeachingRelation[] = [];
  let narrativePaths: Record<string, TopicNarrativePath> = {};

  try {
    const teachingResult = await extractTeachingStructureForAllTopics(
      config,
      topics,
      allBlocks,
      options.onTopicProgress,
    );
    teachingBlocks = teachingResult.allTeachingBlocks;
    teachingRelations = teachingResult.allTeachingRelations;
    narrativePaths = teachingResult.narrativePaths;
    versions.teachingStructure++;

    warnings.push(`提取了 ${teachingBlocks.length} 个讲解块`);

    // 节点提取完成后，逐个知识点遍历其第二层节点建网。
    const traversedTeachingRelations: TeachingRelation[] = [];
    for (const topic of topics) {
      const topicBlocks = teachingBlocks.filter(block => block.topicId === topic.id);
      const existing = teachingRelations.filter(relation => relation.topicId === topic.id);
      try {
        const traversed = await extractTeachingRelationGraph(config, topic, topicBlocks);
        traversedTeachingRelations.push(...(traversed.length > 0 ? traversed : existing));
      } catch (relationError) {
        traversedTeachingRelations.push(...existing);
        warnings.push(`“${topic.name}”内部关系遍历失败，已保留提取阶段关系：${relationError instanceof Error ? relationError.message : String(relationError)}`);
      }
    }
    teachingRelations = traversedTeachingRelations;
    warnings.push(`遍历第二层节点后建立 ${teachingRelations.length} 条内部关系`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`讲解结构提取失败: ${msg}，使用降级结构`);
    // 创建降级讲解块
    teachingBlocks = topics.map(t => ({
      id: generateId('tb'),
      topicId: t.id,
      type: 'conclusion' as const,
      title: t.name,
      sourceRanges: t.sourceRanges,
      summary: t.summary,
      importance: 'required' as const,
      confidence: 0.5,
    }));
    narrativePaths = {};
    for (const t of topics) {
      narrativePaths[t.id] = {
        topicId: t.id,
        orderedTeachingBlockIds: teachingBlocks.filter(b => b.topicId === t.id).map(b => b.id),
        rationale: '降级结构',
      };
    }
  }

  // ========== 阶段 6: Learning Order Generation ==========

  options.onStatusChange?.('ordering');
  let courseLearningPath: CourseLearningPath;

  try {
    courseLearningPath = generateCourseLearningPath(topics, topicRelations);
    narrativePaths = generateNarrativePaths(topics, teachingBlocks, teachingRelations);
    versions.ordering++;
    warnings.push('学习顺序生成完成');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`学习顺序生成失败: ${msg}，使用原始顺序`);
    courseLearningPath = {
      orderedTopicIds: topics.map(t => t.id),
      steps: topics.map(t => ({
        topicId: t.id,
        reason: '原始顺序',
        prerequisiteTopicIds: [],
      })),
    };
  }

  // ========== 阶段 7: Knowledge Card Generation ==========

  options.onStatusChange?.('card-generation');
  let knowledgeCards: KnowledgeCard[] = [];
  const topicNotes: TopicNote[] = [];
  const glossary: GlossaryItem[] = [];
  const formulaCards: FormulaCard[] = [];

  try {
    knowledgeCards = generateCards(topics, teachingBlocks, allBlocks, topicRelations);
    versions.cards++;
    warnings.push(`生成了 ${knowledgeCards.length} 张知识卡片`);
  } catch (e) {
    warnings.push(`知识卡片生成失败: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ========== 阶段 8: Validation ==========

  options.onStatusChange?.('validation');
  const validation = validateKnowledgeStructure(
    allBlocks,
    topics,
    teachingBlocks,
    topicRelations,
    topicNotes,
  );

  // 收集未分配的块
  const assignedBlockIds = new Set<string>();
  for (const topic of topics) {
    for (const range of topic.sourceRanges) {
      collectBlockIdsInRange(range, allBlocks, assignedBlockIds);
    }
  }
  for (const tb of teachingBlocks) {
    for (const range of tb.sourceRanges) {
      collectBlockIdsInRange(range, allBlocks, assignedBlockIds);
    }
  }
  const unassignedBlocks = allBlocks
    .filter(b => !assignedBlockIds.has(b.id) && b.type !== 'heading')
    .map(b => b.id);

  if (validation.errors.length > 0) {
    errors.push(...validation.errors.map(e => e.message));
  }
  warnings.push(...validation.warnings.map(w => w.message));

  options.onStatusChange?.('ready');

  return {
    sourceDocuments,
    allBlocks,
    topics,
    topicRelations,
    teachingBlocks,
    teachingRelations,
    courseLearningPath,
    narrativePaths,
    knowledgeCards,
    topicNotes,
    glossary,
    formulaCards,
    unassignedBlocks,
    versions,
    validation,
    warnings,
    errors,
    status: 'ready',
  };
}

// ========== 辅助函数 ==========

/**
 * 收集 SourceRange 中的所有块 ID。
 */
function collectBlockIdsInRange(
  range: { documentId: string; startBlockId: string; endBlockId: string },
  allBlocks: MarkdownBlock[],
  result: Set<string>,
): void {
  const docBlocks = allBlocks.filter(b => b.documentId === range.documentId);
  const startIdx = docBlocks.findIndex(b => b.id === range.startBlockId);
  const endIdx = docBlocks.findIndex(b => b.id === range.endBlockId);

  if (startIdx === -1 || endIdx === -1) return;

  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);

  for (let i = lo; i <= hi; i++) {
    result.add(docBlocks[i].id);
  }
}

/**
 * 创建空结果（用于失败或无模型情况）。
 */
function createEmptyResult(
  sourceDocuments: SourceDocument[],
  allBlocks: MarkdownBlock[],
  warnings: string[],
  errors: string[],
  status: KnowledgePipelineStatus,
): PipelineResultV2 {
  return {
    sourceDocuments,
    allBlocks,
    topics: [],
    topicRelations: [],
    teachingBlocks: [],
    teachingRelations: [],
    courseLearningPath: { orderedTopicIds: [], steps: [] },
    narrativePaths: {},
    knowledgeCards: [],
    topicNotes: [],
    glossary: [],
    formulaCards: [],
    unassignedBlocks: allBlocks.filter(b => b.type !== 'heading').map(b => b.id),
    versions: {
      source: 0,
      normalization: 0,
      topicStructure: 0,
      teachingStructure: 0,
      ordering: 0,
      cards: 0,
      notes: 0,
      embeddings: 0,
    },
    validation: {
      errors: [],
      warnings: [],
      coverage: {
        totalBlocks: allBlocks.length,
        assignedBlocks: 0,
        unassignedBlocks: allBlocks.filter(b => b.type !== 'heading').map(b => b.id),
        coverageRate: 0,
      },
      topicStats: {
        totalTopics: 0,
        topicsWithTeachingBlocks: 0,
        avgTeachingBlocksPerTopic: 0,
      },
      qualityIssues: [],
    },
    warnings,
    errors,
    status,
  };
}

/**
 * 从 PipelineResultV2 构建 CourseKnowledgeBase。
 */
export function buildKnowledgeBase(
  result: PipelineResultV2,
  courseId: string,
  courseName: string,
): CourseKnowledgeBase {
  return {
    id: courseId,
    name: courseName,
    documents: result.sourceDocuments,
    topics: result.topics,
    topicRelations: result.topicRelations,
    teachingBlocks: result.teachingBlocks,
    teachingRelations: result.teachingRelations,
    learningPath: result.courseLearningPath,
    narrativePaths: result.narrativePaths,
    knowledgeCards: result.knowledgeCards,
    topicNotes: result.topicNotes,
    glossary: result.glossary,
    formulas: result.formulaCards,
    unassignedBlocks: result.unassignedBlocks,
    versions: result.versions,
  };
}
