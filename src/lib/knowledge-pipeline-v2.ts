/**
 * 知识管线 V2。
 *
 * 课程结构只由 course-structure compiler 生成；旧类型仅作为现有 UI 的兼容投影。
 * 卡片在这里仅生成确定性的基础版本，AI 深化由独立的卡片增强操作负责。
 */
import type {
  CourseKnowledgeBase,
  CourseLearningPath,
  FormulaCard,
  GlossaryItem,
  KnowledgeBaseVersions,
  KnowledgeCard,
  KnowledgePipelineStatus,
  KnowledgeTopic,
  MarkdownBlock,
  ModelConfig,
  SourceDocument,
  TeachingBlock,
  TeachingRelation,
  TopicNarrativePath,
  TopicNote,
  TopicRelation,
  V2PipelineStage,
} from '../types';
import { createSourceDocument } from './markdown-parser';
import { generateCards } from './card-generator';
import type { ValidationIssue, ValidationReport } from './knowledge-validation';
import { compileCourseStructure } from './course-structure/compiler';
import { projectLegacyStructure } from './course-structure/legacy-adapter';
import type {
  CourseLearningStructure,
  CourseStructureIssue,
  CourseStructureStatus,
} from './course-structure/types';

export type CourseCompilerStage =
  | 'batching'
  | 'compiling'
  | 'normalizing'
  | 'reviewing'
  | 'scheduling'
  | 'validating';

export interface PipelineOptionsV2 {
  onStatusChange?: (status: KnowledgePipelineStatus) => void;
  onWindowProgress?: (current: number, total: number) => void;
  /** @deprecated 结构编译不再逐知识点调用模型。 */
  onTopicProgress?: (current: number, total: number) => void;
  /** @deprecated 笔记生成不属于结构编译。 */
  onNoteProgress?: (current: number, total: number) => void;
  onCompilerStage?: (stage: CourseCompilerStage) => void;
  sourceDocuments?: SourceDocument[];
  previousStructure?: CourseLearningStructure | null;
}

export interface PipelineResultV2 {
  sourceDocuments: SourceDocument[];
  allBlocks: MarkdownBlock[];
  courseLearningStructure: CourseLearningStructure | null;
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

const AUTH_ERROR_HINT = ' —— API Key 无效或被服务端拒绝，请在「服务配置」中检查知识生成模型密钥';

const COMPILER_STATUS: Record<CourseCompilerStage, V2PipelineStage> = {
  batching: 'normalizing',
  compiling: 'topic-extraction',
  normalizing: 'topic-reconciliation',
  reviewing: 'ordering',
  scheduling: 'ordering',
  validating: 'validation',
};

function compilerFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const hint = /401|Unauthorized|invalid[_ ]?api[_ ]?key|Incorrect API key|api key not valid/i.test(message)
    ? AUTH_ERROR_HINT
    : '';
  return `课程结构编译失败：${message}${hint}`;
}

function toValidationIssue(issue: CourseStructureIssue): ValidationIssue {
  return {
    code: issue.code,
    message: issue.message,
    topicId: issue.topicId,
    blockId: issue.blockId,
    severity: issue.severity,
  };
}

function buildValidationReport(
  structure: CourseLearningStructure,
  teachingBlocks: TeachingBlock[],
  unassignedBlocks: string[],
): ValidationReport {
  const issues = structure.validation.issues.map(toValidationIssue);
  const topicsWithTeachingBlocks = new Set(teachingBlocks.map(block => block.topicId)).size;
  return {
    errors: issues.filter(issue => issue.severity === 'error'),
    warnings: issues.filter(issue => issue.severity === 'warning'),
    coverage: {
      totalBlocks: structure.validation.meaningfulBlockCount,
      assignedBlocks: structure.validation.coveredMeaningfulBlockCount,
      unassignedBlocks,
      coverageRate: structure.validation.coverageRate,
    },
    topicStats: {
      totalTopics: structure.topics.length,
      topicsWithTeachingBlocks,
      avgTeachingBlocksPerTopic: structure.topics.length === 0
        ? 0
        : teachingBlocks.length / structure.topics.length,
    },
    qualityIssues: issues.map(issue => issue.message),
  };
}

function versionsFor(structure: CourseLearningStructure, cardCount: number): KnowledgeBaseVersions {
  return {
    source: structure.sourceVersion,
    normalization: structure.sourceVersion,
    topicStructure: structure.structureVersion,
    teachingStructure: structure.structureVersion,
    ordering: structure.structureVersion,
    cards: cardCount > 0 ? 1 : 0,
    notes: 0,
    embeddings: 0,
  };
}

function resolveSourceDocuments(
  markdownTexts: Array<{ markdown: string; title: string }>,
  courseId: string,
  provided?: SourceDocument[],
): SourceDocument[] {
  if (provided) return provided;
  return markdownTexts.map(({ markdown, title }) => createSourceDocument(markdown, courseId, title));
}

export async function runKnowledgePipeline(
  config: ModelConfig | null,
  markdownTexts: Array<{ markdown: string; title: string }>,
  courseId: string,
  options: PipelineOptionsV2 = {},
): Promise<PipelineResultV2> {
  options.onStatusChange?.('normalizing');
  const sourceDocuments = resolveSourceDocuments(markdownTexts, courseId, options.sourceDocuments);
  const allBlocks = sourceDocuments.flatMap(document => document.blocks);
  const warnings = [`已准备 ${sourceDocuments.length} 个文档，共 ${allBlocks.length} 个内容块`];
  const errors: string[] = [];

  if (!config?.apiKey) {
    return createEmptyResult(sourceDocuments, allBlocks, warnings, errors, 'model-required');
  }

  let structure: CourseLearningStructure;
  try {
    structure = await compileCourseStructure(config, sourceDocuments, courseId, {
      previous: options.previousStructure ?? null,
      onBatchProgress: options.onWindowProgress,
      onStage: stage => {
        options.onCompilerStage?.(stage);
        options.onStatusChange?.(COMPILER_STATUS[stage]);
      },
    });
  } catch (error) {
    errors.push(compilerFailureMessage(error));
    options.onStatusChange?.('failed');
    return createEmptyResult(sourceDocuments, allBlocks, warnings, errors, 'failed');
  }

  const projected = projectLegacyStructure(structure, allBlocks);
  const meaningfulBlockIds = new Set(allBlocks
    .filter(block => block.type !== 'heading' && block.content.trim().length > 0)
    .map(block => block.id));
  const assignedBlockIds = new Set(structure.evidenceSpans
    .map(evidence => evidence.blockId)
    .filter(blockId => meaningfulBlockIds.has(blockId)));
  const unassignedBlocks = [...meaningfulBlockIds].filter(blockId => !assignedBlockIds.has(blockId));
  const validation = buildValidationReport(structure, projected.teachingBlocks, unassignedBlocks);
  errors.push(...validation.errors.map(issue => issue.message));
  warnings.push(...validation.warnings.map(issue => issue.message));

  options.onStatusChange?.('card-generation');
  let knowledgeCards: KnowledgeCard[] = [];
  try {
    knowledgeCards = generateCards(
      projected.topics,
      projected.teachingBlocks,
      allBlocks,
      projected.topicRelations,
      projected.narrativePaths,
    );
    warnings.push(`生成了 ${knowledgeCards.length} 张基础知识卡片`);
  } catch (error) {
    warnings.push(`基础知识卡片生成失败：${error instanceof Error ? error.message : String(error)}`);
  }

  options.onStatusChange?.(structure.status);
  return {
    sourceDocuments,
    allBlocks,
    courseLearningStructure: structure,
    ...projected,
    knowledgeCards,
    topicNotes: [],
    glossary: [],
    formulaCards: [],
    unassignedBlocks,
    versions: versionsFor(structure, knowledgeCards.length),
    validation,
    warnings,
    errors,
    status: structure.status,
  };
}

function createEmptyResult(
  sourceDocuments: SourceDocument[],
  allBlocks: MarkdownBlock[],
  warnings: string[],
  errors: string[],
  status: KnowledgePipelineStatus,
): PipelineResultV2 {
  const unassignedBlocks = allBlocks
    .filter(block => block.type !== 'heading' && block.content.trim().length > 0)
    .map(block => block.id);
  return {
    sourceDocuments,
    allBlocks,
    courseLearningStructure: null,
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
    unassignedBlocks,
    versions: {
      source: 0, normalization: 0, topicStructure: 0, teachingStructure: 0,
      ordering: 0, cards: 0, notes: 0, embeddings: 0,
    },
    validation: {
      errors: [], warnings: [],
      coverage: {
        totalBlocks: unassignedBlocks.length, assignedBlocks: 0,
        unassignedBlocks, coverageRate: unassignedBlocks.length === 0 ? 1 : 0,
      },
      topicStats: { totalTopics: 0, topicsWithTeachingBlocks: 0, avgTeachingBlocksPerTopic: 0 },
      qualityIssues: [],
    },
    warnings,
    errors,
    status,
  };
}

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

export function isSuccessfulStructureStatus(status: CourseStructureStatus): boolean {
  return status === 'ready' || status === 'degraded';
}
