// ============== 基础类型 ==============

// 六步用户流程（主页面）
export type ProductStage = 'upload' | 'document' | 'mineru' | 'structure' | 'cards' | 'notes';

// 后台任务类型（页面内部状态）
export type BackgroundJob =
  | 'parsing-document'
  | 'extracting-evidence'
  | 'extracting-topics'
  | 'repairing-topics'
  | 'extracting-relations'
  | 'building-internal-structure'
  | 'enriching-knowledge-cards'
  | 'generating-topic-notes'
  | 'generating-topic-syntheses'
  | 'planning-chapters'
  | 'generating-chapter-notes'
  | 'assembling-master-note'
  | null;

// 后台任务状态
export type JobStatus = 'idle' | 'running' | 'blocked' | 'failed' | 'completed';

// 旧六步流程类型（仅用于迁移兼容）
/** @deprecated 使用 ProductStage 替代 */
export type WorkflowStage =
  | 'upload'
  | 'parse-review'
  | 'extracting-structure'
  | 'structure-review'
  | 'generating-notes'
  | 'notes';

// 侧栏步骤状态
export type ProductStepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'stale'
  | 'blocked'
  | 'failed';

// ============== Pipeline 进度 ==============

export type ProgressStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'blocked'
  | 'failed';

export interface PipelineProgressStep {
  id: string;
  label: string;
  status: ProgressStepStatus;
  detail?: string;
}

export interface PipelineProgress {
  operation: 'extract-structure' | 'generate-notes' | null;
  status:
    | 'idle'
    | 'running'
    | 'blocked'
    | 'failed'
    | 'completed';

  steps: PipelineProgressStep[];

  currentItem?: number;
  totalItems?: number;
  currentItemTitle?: string;

  message?: string;

  /** 估算进度（0-100），由真实事件 + 平滑计时器混合驱动。
   *  任务真正完成前永远不达到 100。 */
  estimatedProgress?: number;

  /** 进度是否为估算值（而非精确计算） */
  isEstimated?: boolean;

  /** 当前窗口进度（分窗口提取时使用） */
  windowProgress?: { current: number; total: number };

  /** 失败时的阶段信息，用于 UI 精准显示 */
  failedStage?: string;
  failedWindowIndex?: number;
}

/** 知识管线状态（V6 别名） */
export type KnowledgePipelineStatus = V2PipelineStage;

/** 知识库版本（V6 别名） */
export interface KnowledgeBaseVersions {
  source: number;
  normalization: number;
  topicStructure: number;
  teachingStructure: number;
  ordering: number;
  cards: number;
  notes: number;
  embeddings: number;
}

// EvidenceAtom 类型 - 扩展
export type EvidenceType =
  | 'title'
  | 'definition'
  | 'formula'
  | 'derivation'
  | 'conclusion'
  | 'example'
  | 'procedure'
  | 'comparison'
  | 'chart'
  | 'assumption'
  | 'condition'
  | 'text';

// PDF.js TextItem 的结构化映射（仅保留机械属性，不含语义判断）
export interface SourceTextItem {
  text: string;
  x: number;           // 水平坐标（PDF.js transform[4]）
  y: number;           // 垂直坐标（PDF.js transform[5]）
  fontSize: number;    // 字号（从 transform 矩阵推算）
  hasEol: boolean;     // PDF.js TextItem.hasEOL
  sourceIndex: number; // 在原始 items 数组中的位置
}

// 机械聚合的文本块（仅基于坐标/字号/换行/间距，不含语义判断）
export interface SourceTextBlock {
  items: SourceTextItem[];
  text: string;        // 合并后的文本（保留换行）
  pageNumber: number;
  blockIndex: number;  // 页内稳定序号
  // 机械属性（用于后续处理，不用于语义判断）
  avgFontSize: number;
  yStart: number;      // 块顶部 y 坐标
  yEnd: number;        // 块底部 y 坐标
}

// 课件页面
export interface CoursePage {
  pageNumber: number;
  text: string;          // 兼容旧逻辑：合并所有 block.text
  blocks?: SourceTextBlock[]; // 新：结构化文本块
  preview?: string; // data URL
  warning?: string;
}

// 证据原子 - 课件内容的最小可信单元
// 升级：支持跨课件唯一定位
export interface EvidenceAtom {
  id: string;
  documentId: string;      // 所属课件文档ID
  pageNumber: number;
  blockIndex: number;      // 页内稳定顺序
  type: EvidenceType;
  content: string;
  confidence: number; // 0-1
  contentHash: string;     // 内容指纹，用于变更检测
}

// 视图类型
export type ViewType = 'first-study' | 'review' | 'exam';

// 模型配置
export interface ModelConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

/** MinerU 精准解析 API 配置。与知识生成模型配置完全独立。 */
export interface MinerUConfig {
  endpoint: string;
  apiKey: string;
  modelVersion: 'pipeline' | 'vlm';
  language: string;
  enableFormula: boolean;
  enableTable: boolean;
}

export type MinerUParseStatus =
  | 'idle'
  | 'uploading'
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'normalizing'
  | 'completed'
  | 'failed';

export interface MinerUAsset {
  path: string;
  mimeType: string;
  size: number;
}

export interface MinerUParseResult {
  batchId?: string;
  status: MinerUParseStatus;
  progress: number;
  markdown?: string;
  assets: MinerUAsset[];
  error?: string;
  sourceFileName?: string;
  completedAt?: number;
}

// 课件文档
export interface CourseDocument {
  id: string;
  /** 所属课程空间；旧版单课件数据允许为空并在迁移时补齐。 */
  courseId?: string;
  title: string;
  fileName: string;
  fileType?: 'pdf' | 'pptx' | 'markdown';
  sourceKey?: string;
  pages: CoursePage[];
  uploadedAt: number;
}

export type LibraryDocumentStatus = 'new' | 'processing' | 'ready' | 'failed' | 'stale';

/** 本地课件库中的课程空间。 */
export interface LibraryCourse {
  id: string;
  name: string;
  description?: string;
  documentIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** 本地课件库中的课件元数据；具体处理产物保存在独立快照中。 */
export interface LibraryDocument {
  id: string;
  courseId: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'pptx' | 'markdown';
  pageCount: number;
  stage: ProductStage;
  status: LibraryDocumentStatus;
  uploadedAt: number;
  updatedAt: number;
  cardCount?: number;
  error?: string;
}

/** 面向全库问答的知识卡片检索记录。 */
export interface RetrievalRecord {
  id: string;
  cardId: string;
  courseId: string;
  documentId: string;
  topicId: string;
  teachingBlockId: string;
  title: string;
  content: string;
  keywords: string[];
  aliases: string[];
  /** 直接来自课件的短原文，供回答时核对卡片派生内容。 */
  sourceExcerpt?: string;
  prerequisiteTopicIds?: string[];
  relatedTopicIds?: string[];
  sourceRanges: SourceRange[];
  version: number;
}

// 视图投影视图配置
export interface ViewConfig {
  showSummary: boolean;
  showKeyClaims: boolean;
  showFormulas: boolean;
  showExamples: boolean;
  showProcedures: boolean;
  showEvidenceRefs: boolean;
  compressionLevel: 'full' | 'condensed' | 'keywords';
}

// ============== 旧版结构（保留兼容） ==============

// 学习单元 - 旧版扁平结构（保留用于迁移和降级）
export interface LearningUnit {
  id: string;
  title: string;
  objective: string;
  evidenceIds: string[];
  order: number;
}

// 母笔记中的声明 - 旧版结构（保留兼容）
export interface Claim {
  id: string;
  content: string;
  evidenceIds: string[];
  importance: 'core' | 'supporting' | 'detail';
}

// 母笔记单元 - 旧版结构（保留兼容）
export interface MasterNoteUnit {
  unitId: string;
  title: string;
  objective: string;
  summary: string;
  keyClaims: Claim[];
  formulas: Claim[];
  examples: Claim[];
  procedures: Claim[];
}

// ============== 第二阶段：两层知识结构 ==============

// 第一层：课程知识骨架 - 粗粒度主题类型
export type CourseTopicType =
  | 'concept'      // 概念
  | 'principle'    // 原理/定理
  | 'method'       // 方法/算法
  | 'formula'      // 重要公式
  | 'problem'      // 问题类型
  | 'composite';   // 复合主题

// 知识点笔记状态
export type TopicNoteStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'stale';

// 第一层节点：课程主题（粗粒度，可形成独立学习目标）
export interface CourseTopic {
  id: string;
  title: string;
  aliases: string[];
  type: CourseTopicType;
  learningGoal: string;

  chapterId?: string;
  evidenceIds: string[];
  originalPageNumbers: number[];

  importance: 'core' | 'secondary';
  confidence: number;

  originalOrder: number;        // PPT中原始位置
  recommendedOrder: number;     // 推荐学习顺序（是 RecommendedLearningPath 的投影）
  noteStatus: TopicNoteStatus;
}

// 第一层关系类型 - 统一方向语义
// 规则：所有有向关系 source → target，箭头含义从左到右阅读
export type MacroRelationType =
  | 'hard_prerequisite'   // source 是 target 的硬前置
  | 'soft_prerequisite'   // source 是 target 的软前置
  | 'recommended_before'  // source 推荐先于 target
  | 'contains'            // source 包含 target
  | 'derives_to'          // target 由 source 推导
  | 'used_by'             // target 使用 source
  | 'contrasts_with';     // 对称关系

// 旧关系类型映射（用于迁移）：
// 旧 part_of: A → B  迁移为 contains: B → A
// 旧 derived_from: A → B  迁移为 derives_to: A → B
// 旧 uses: A → B  迁移为 used_by: A → B

// 第一层知识关系
export interface MacroKnowledgeRelation {
  id: string;
  sourceTopicId: string;   // 关系起点
  targetTopicId: string;   // 关系终点
  type: MacroRelationType;

  evidenceIds: string[];
  reason: string;
  confidence: number;

  origin: 'courseware-explicit' | 'ai-inferred';
}

// 第二层：知识点内部内容类型
export type UnitContentType =
  | 'motivation'     // 动机/引入
  | 'problem'        // 问题陈述
  | 'prerequisite'   // 前置提醒
  | 'assumption'     // 假设条件
  | 'intuition'      // 直观解释
  | 'definition'     // 正式定义
  | 'formula'        // 公式
  | 'derivation'     // 推导步骤
  | 'procedure'      // 流程/步骤
  | 'example'        // 案例/例子
  | 'chart'          // 图表说明
  | 'comparison'     // 对比
  | 'condition'      // 适用条件
  | 'limitation'     // 局限
  | 'misconception'  // 常见误区
  | 'conclusion';    // 总结

// 第二层内容项
export interface UnitContentItem {
  id: string;
  topicId: string;
  type: UnitContentType;

  title?: string;
  content: string;

  evidenceIds: string[];      // 可以引用多个证据
  originalPageNumbers: number[];

  originalOrder: number;
  recommendedOrder: number;
  confidence: number;

  // AI 增强时可用的稳定引用键
  itemKey?: string;
}

// 第二层关系类型
export type MicroRelationType =
  | 'explains'        // 解释
  | 'defines'         // 定义
  | 'derived_from'    // 推导自
  | 'step_before'     // 前置步骤
  | 'example_of'      // 是...的例子
  | 'illustrates'     // 说明
  | 'supports'        // 支持
  | 'contrasts_with'  // 对比
  | 'qualifies';      // 限定/条件

// 第二层知识关系
export interface MicroKnowledgeRelation {
  id: string;
  sourceItemId: string;
  targetItemId: string;
  topicId: string;
  type: MicroRelationType;

  evidenceIds: string[];
  reason: string;
  confidence: number;
}

// ============== 内部结构状态 ==============

export type InternalStructureSource = 'local' | 'ai' | 'ai-fallback';
export type InternalStructureStatus = 'pending' | 'ready' | 'failed' | 'stale';

export interface InternalStructure {
  items: UnitContentItem[];
  relations: MicroKnowledgeRelation[];
  orderedItemIds: string[];
  source: InternalStructureSource;
  warnings: string[];
  status: InternalStructureStatus;
}

// ============== 推导追踪 ==============

export interface DerivationTrace {
  startEvidenceIds: string[];
  endEvidenceIds: string[];
  generatedSteps: string[];
  basis: string[];  // 使用的基础规则，如"代数运算"、"对数变换"
  status: 'courseware-explicit' | 'ai-completed';
}

// ============== 推荐学习路径 ==============

export interface LearningPathStep {
  topicId: string;
  position: number;
  reason: string;
  supportingRelationIds: string[];
}

export type LearningPathSource = 'deterministic' | 'ai-assisted' | 'fallback';

export interface RecommendedLearningPath {
  id: string;
  topicIds: string[];
  steps: LearningPathStep[];
  source: LearningPathSource;
  warnings: string[];
  version: number;
  generatedAt: number;
}

// ============== 粒度决策 ==============

export interface GranularityDecision {
  action: 'keep' | 'promote' | 'demote' | 'merge';
  subjectId: string;
  targetTopicId?: string;
  reason: string;
  evidenceIds: string[];
  confidence: number;
}

// ============== 自然笔记 ==============

export interface Citation {
  marker: string;       // 如 cite-1（不含方括号）
  evidenceIds: string[];
}

export interface NaturalKnowledgeNote {
  id: string;
  topicId: string;

  title: string;
  contentMarkdown: string;   // 主要阅读内容，自然流畅的Markdown
  shortSummary: string;      // 约50-100字的摘要，用于传递给后续知识点

  citations: Citation[];

  terminologyUpdates: Record<string, string>;  // 新引入术语: 解释
  symbolUpdates: Record<string, string>;       // 新引入符号: 含义
  derivationTraces?: DerivationTrace[];

  continuityMemory: string;  // 传递给下一个知识点的衔接信息
  warnings: string[];
}

// ============== KnowledgePackage ==============

export interface KnowledgePackageSourceEvidence {
  evidenceId: string;
  pageNumber: number;
  type: string;
  originalText: string;
  normalizedText?: string;
}

export interface KnowledgePackage {
  id: string;
  topic: CourseTopic;

  source: {
    evidenceIds: string[];
    combinedOriginalText: string;
    evidence: KnowledgePackageSourceEvidence[];
  };

  internalStructure: InternalStructure;

  macroRelations: MacroKnowledgeRelation[];  // 只存储与本topic直接相关的关系

  note?: NaturalKnowledgeNote;

  versions: {
    sourceVersion: number;
    structureVersion: number;
    noteVersion: number;
    promptVersion: string;
    model?: string;
    generatedAt?: number;
  };
}

// ============== 课程级记忆 ==============

export interface TerminologyEntry {
  preferredName: string;
  aliases: string[];
  introducedByTopicId: string;
}

export interface SymbolConflict {
  meaning: string;
  topicId: string;
  evidenceIds: string[];
}

export interface SymbolEntry {
  meaning: string;
  introducedByTopicId: string;
  sourceEvidenceIds: string[];
  conflicts?: SymbolConflict[];
}

export interface CourseGenerationMemory {
  terminology: Record<string, TerminologyEntry>;
  symbols: Record<string, SymbolEntry>;
  generatedTopicSummaries: Record<string, string>;  // topicId -> shortSummary
  previousTransition?: string;
}

// ============== 母笔记章节 ==============

export interface MasterNoteChapter {
  id: string;
  title: string;
  topicIds: string[];
  introduction: string;
  transitions: string[];
  summary: string;
  warnings: string[];
}

export interface AssembledMasterNote {
  title: string;
  chapters: MasterNoteChapter[];
  topicNotes: Array<{
    topicId: string;
    title: string;
    contentMarkdown: string;
    shortSummary: string;
    warnings: string[];
    pageRange: string;
    chapterId?: string;
  }>;
  allCitations: Map<string, string[]>; // marker -> evidenceIds
  symbolConflicts: SymbolConflict[];
  terminologyAliases: Array<{ term: string; aliases: string[] }>;
}

// ============== 全局知识锚点 ==============

export interface GlobalKnowledgeAnchor {
  id: string;
  canonicalName: string;
  aliases: string[];
  type: CourseTopicType;
  occurrenceIds: string[];
}

export interface CourseKnowledgeOccurrence {
  id: string;
  globalAnchorId?: string;
  documentId: string;
  courseId?: string;
  knowledgePackageId: string;
  topicTitle: string;
}

// ============== 两阶段 AI 提取：候选知识点 ==============

/** 第一阶段：分批 AI 候选知识点（未经过全局整理） */
export interface TopicCandidate {
  temporaryId: string;
  title: string;
  aliases: string[];
  learningObjective: string;
  evidenceIds: string[];
  prerequisiteHints: string[];
  internalItemHints: string[];
  confidence: number;
}

/** 第二阶段：AI 全局粒度判定 */
export interface TopicGranularityDecision {
  candidateId: string;
  action: 'keep' | 'merge' | 'split' | 'promote' | 'demote' | 'discard';
  reason: string;
  resultingTopicIds: string[];
  evidenceIds: string[];
}

// ============== 质量检测 ==============

export type TopicQualityIssue =
  | 'too-few-topics'
  | 'topic-too-broad'
  | 'generic-topic-title'
  | 'missing-learning-objective'
  | 'low-evidence-coverage'
  | 'evidence-over-concentration'
  | 'topic-overlap'
  | 'orphan-evidence'
  | 'insufficient-internal-structure';

export interface TopicQualityReport {
  issues: Array<{
    type: TopicQualityIssue;
    severity: 'error' | 'warning';
    message: string;
    topicId?: string;
  }>;
  stats: {
    topicCount: number;
    evidenceCount: number;
    assignedEvidenceCount: number;
    unassignedEvidenceCount: number;
    coverageRate: number;
    maxTopicCoverage: number;
    genericTopicCount: number;
    duplicateTopicCount: number;
    orphanEvidenceIds: string[];
    broadTopicIds: string[];
  };
  needsRepair: boolean;
}

// ============== 章节展示分组（非第三层知识点） ==============

export interface CourseSection {
  id: string;
  title: string;
  topicIds: string[];
  evidenceIds: string[];
}

// ============== Stale 标记 ==============

export type StaleReason =
  | 'evidence-edited'
  | 'structure-edited'
  | 'topic-edited'
  | 'evidence-deleted';

export interface StaleMarker {
  reason: StaleReason;
  affectedTopicIds: string[];
  affectedPackageIds: string[];
  timestamp: number;
}

// ============== 导航守卫 ==============

export interface StageNavigationResult {
  allowed: boolean;
  targetStage: ProductStage;
  mode: 'view' | 'edit';
  invalidatedResources: string[];
  requiresConfirmation: boolean;
  reason?: string;
}

// 保留旧类型别名用于迁移兼容
/** @deprecated 使用 ProductStepStatus 替代 */
export type SidebarStepStatus = ProductStepStatus;

// ============== 结构提取状态 ==============

export type StructureExtractionStatus =
  | 'idle'
  | 'extracting-topics'
  | 'repairing-topics'
  | 'extracting-relations'
  | 'extracting-internal-structures'
  | 'ready'
  | 'failed'
  | 'model-required'
  | 'quality-checking'
  | 'quality-repairing';

// ============== 产品流程状态快照 ==============

export interface ProductStateSnapshot {
  document: CourseDocument | null;
  evidences: EvidenceAtom[];
  topics: CourseTopic[];
  knowledgePackages: KnowledgePackage[];
  structureExtractionStatus: StructureExtractionStatus;
  jobStatus: string;
  staleMarker: StaleMarker | null;
  sourceDocuments?: SourceDocument[];
  knowledgeTopics?: KnowledgeTopic[];
  knowledgeCards?: KnowledgeCard[];
  topicNotes?: TopicNote[];
  topicSyntheses?: TopicSynthesis[];
  chapterPlan?: ChapterPlanItem[];
  chapterNotes?: ChapterNote[];
  courseMasterNote?: CourseMasterNote | null;
  knowledgeBaseVersions?: KnowledgeBaseVersions;
  mineruParseResult?: MinerUParseResult | null;
}

// ============== 顺序模式 ==============

export type OrderMode = 'original' | 'ai-recommended';

// ============== 持久化Schema ==============

export const SCHEMA_VERSION = 8;

export interface PersistedState {
  schemaVersion: number;
  stage: ProductStage;
  job: BackgroundJob;
  jobStatus: JobStatus;
  document: CourseDocument | null;
  evidences: EvidenceAtom[];
  // v1 旧结构（迁移兼容）
  learningUnits?: LearningUnit[];
  masterNotes?: MasterNoteUnit[];
  // v2/v3 新结构
  topics: CourseTopic[];
  macroRelations: MacroKnowledgeRelation[];
  knowledgePackages: KnowledgePackage[];
  orderMode: OrderMode;
  currentView: ViewType;
  generationMemory: CourseGenerationMemory;
  globalAnchors: GlobalKnowledgeAnchor[];
  occurrences: CourseKnowledgeOccurrence[];
  // v3 新增
  learningPath?: RecommendedLearningPath;
  structureWarnings?: string[];
  structureSource?: 'ai' | 'local' | 'ai-fallback';
  structureExtractionStatus?: StructureExtractionStatus;
  extractionErrors?: string[];
  pipelineProgress?: PipelineProgress;
  // v4 新增
  staleMarker?: StaleMarker | null;
  qualityReport?: TopicQualityReport | null;
  courseSections?: CourseSection[];
  // v5 新增（旧 stage 迁移用）
  legacyStage?: WorkflowStage;
  // v6 新增（Markdown-based 架构）
  sourceDocuments?: SourceDocument[];
  knowledgeTopics?: KnowledgeTopic[];
  topicRelations?: TopicRelation[];
  teachingBlocks?: TeachingBlock[];
  teachingRelations?: TeachingRelation[];
  courseLearningPath?: CourseLearningPath | null;
  narrativePaths?: Record<string, TopicNarrativePath>;
  knowledgeCards?: KnowledgeCard[];
  topicNotes?: TopicNote[];
  topicSyntheses?: TopicSynthesis[];
  chapterPlan?: ChapterPlanItem[];
  chapterNotes?: ChapterNote[];
  courseMasterNote?: CourseMasterNote | null;
  glossary?: GlossaryItem[];
  formulaCards?: FormulaCard[];
  unassignedBlocks?: string[];
  knowledgeBaseVersions?: KnowledgeBaseVersions;
  knowledgePipelineStatus?: KnowledgePipelineStatus;
}

// ============== 完整项目状态（运行时） ==============

export interface ProjectState {
  stage: ProductStage;
  job: BackgroundJob;
  jobStatus: JobStatus;
  document: CourseDocument | null;
  evidences: EvidenceAtom[];

  // v1 兼容（保留降级路径）
  learningUnits: LearningUnit[];
  masterNotes: MasterNoteUnit[];

  // v2/v3 新结构
  topics: CourseTopic[];
  macroRelations: MacroKnowledgeRelation[];
  knowledgePackages: KnowledgePackage[];
  orderMode: OrderMode;
  structureWarnings: string[];
  structureSource: 'ai' | 'local' | 'ai-fallback' | 'failed';

  // v3 新增
  learningPath: RecommendedLearningPath | null;

  // AI提取状态
  structureExtractionStatus: StructureExtractionStatus;
  extractionErrors: string[];

  // Pipeline 进度
  pipelineProgress: PipelineProgress;

  // v4 新增
  staleMarker: StaleMarker | null;
  qualityReport: TopicQualityReport | null;
  courseSections: CourseSection[];

  currentView: ViewType;
  viewMode: 'view' | 'edit';
  modelConfig: ModelConfig | null;
  mineruConfig: MinerUConfig | null;
  mineruParseResult: MinerUParseResult | null;
  generationMemory: CourseGenerationMemory;
  globalAnchors: GlobalKnowledgeAnchor[];
  occurrences: CourseKnowledgeOccurrence[];

  // ===== v6 新架构：Markdown-based =====
  /** 源文档列表（MinerU Markdown） */
  sourceDocuments: SourceDocument[];
  /** 知识主题（替代 CourseTopic） */
  knowledgeTopics: KnowledgeTopic[];
  /** 主题间关系 */
  topicRelations: TopicRelation[];
  /** 讲解块（替代 UnitContentItem） */
  teachingBlocks: TeachingBlock[];
  /** 讲解块间关系 */
  teachingRelations: TeachingRelation[];
  /** 课程学习路径 */
  courseLearningPath: CourseLearningPath | null;
  /** 每个知识点的叙事路径 */
  narrativePaths: Record<string, TopicNarrativePath>;
  /** 知识卡片 */
  knowledgeCards: KnowledgeCard[];
  /** 知识笔记 */
  topicNotes: TopicNote[];
  /** 一级知识综合 */
  topicSyntheses: TopicSynthesis[];
  /** AI 规划并供用户预览的章节框架 */
  chapterPlan: ChapterPlanItem[];
  /** 可独立持久化与重试的章节笔记 */
  chapterNotes: ChapterNote[];
  /** 确定性组装的课程完整笔记 */
  courseMasterNote: CourseMasterNote | null;
  /** 术语表 */
  glossary: GlossaryItem[];
  /** 公式卡片 */
  formulaCards: FormulaCard[];
  /** 未分配的内容块 */
  unassignedBlocks: string[];
  /** 知识库版本 */
  knowledgeBaseVersions: KnowledgeBaseVersions;
  /** 新架构处理状态 */
  knowledgePipelineStatus: KnowledgePipelineStatus;
}
// ======================================================================
// ============== Markdown 知识库架构（V2） ==============
// 基于 MinerU Markdown → MarkdownBlock → KnowledgeTopic + TeachingBlock
// 替代旧的 EvidenceAtom 体系
// ======================================================================

// ============== V2: Markdown 结构类型 ==============

/** Markdown 块类型 */
export type MarkdownBlockType =
  | 'heading'
  | 'paragraph'
  | 'formula'
  | 'image'
  | 'table'
  | 'code'
  | 'list'
  | 'quote';

/** Markdown 结构块 — 原始课件内容的基本寻址单元 */
export interface MarkdownBlock {
  id: string;
  documentId: string;

  type: MarkdownBlockType;
  content: string;

  /** 标题路径，如 ['第一章', '1.1 线性分类器'] */
  headingPath: string[];
  /** 文档内顺序索引 */
  orderIndex: number;

  /** 标题级别（仅 heading 类型有值） */
  headingLevel?: number;

  /** 引用的资源文件（图片、文件等） */
  assetRefs?: string[];

  /** 内容指纹，用于变更检测 */
  contentHash: string;
}

/** Markdown 章节（标题区间） */
export interface MarkdownSection {
  id: string;
  title: string;
  level: number;

  blockIds: string[];
  childSectionIds: string[];

  parentSectionId?: string;
  startOrder: number;
  endOrder: number;
}

/** 源文档 — 一个 MinerU Markdown 文件 */
export interface SourceDocument {
  id: string;
  courseId: string;
  title: string;
  markdown: string;

  blocks: MarkdownBlock[];
  outline: MarkdownSection[];

  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

// ============== V2: 来源范围 ==============

/** 来源范围 — 引用原始 Markdown 中的连续块区间 */
export interface SourceRange {
  documentId: string;
  startBlockId: string;
  endBlockId: string;
}

// ============== V2: 第一层知识结构 ==============

/** 知识类型 */
export type KnowledgeGenre =
  | 'concept'
  | 'mathematical_derivation'
  | 'algorithm'
  | 'system_mechanism'
  | 'comparison'
  | 'case_study'
  | 'mixed';

/** 知识点状态 */
export type KnowledgeTopicStatus = 'generated' | 'reviewed' | 'corrected';

/** 知识主题 — 第一层：课程认知地图中的节点 */
export interface KnowledgeTopic {
  id: string;
  courseId: string;

  name: string;
  aliases: string[];

  summary: string;
  learningObjective: string;

  /** 来源范围 — 原始 Markdown 中哪些块属于这个知识 */
  sourceRanges: SourceRange[];

  parentTopicId?: string;
  childTopicIds: string[];

  importance: 'core' | 'important' | 'supplementary';
  difficulty: 1 | 2 | 3 | 4 | 5;

  knowledgeGenre: KnowledgeGenre;

  confidence: number;
  status: KnowledgeTopicStatus;
}

/** 第一层关系类型 — 面向学习的关系 */
export type TopicRelationType =
  | 'hard_prerequisite'
  | 'helpful_before'
  | 'derived_from'
  | 'part_of'
  | 'application_of'
  | 'extension_of'
  | 'contrast_with'
  | 'parallel_with';

/** 第一层知识关系 */
export interface TopicRelation {
  id: string;
  sourceTopicId: string;
  targetTopicId: string;
  type: TopicRelationType;

  reason: string;
  confidence: number;
}

// ============== V2: 候选知识与窗口分析 ==============

/** 候选知识点（窗口级，未全局合并） */
export interface CandidateTopic {
  temporaryId: string;

  name: string;
  aliases: string[];

  /** 引用的 Markdown 块 ID */
  sourceBlockIds: string[];

  scopeDescription: string;
  learningObjective: string;

  parentTopicCandidate?: string;
  confidence: number;
}

/** 窗口内主题转换 */
export interface TopicTransition {
  fromCandidateId: string;
  toCandidateId: string;
  transitionType: 'continues' | 'extends' | 'contrasts' | 'applies';
}

/** 内容窗口分析结果 */
export interface ContentWindowAnalysis {
  windowId: string;

  candidateTopics: CandidateTopic[];
  topicTransitions: TopicTransition[];

  unresolvedReferences: string[];
  confidence: number;
}

// ============== V2: 候选知识合并 ==============

/** 合并决策类型 */
export type TopicMergeDecision =
  | 'same_topic'
  | 'parent_child'
  | 'overlapping'
  | 'related_but_distinct'
  | 'same_name_different_meaning'
  | 'unrelated';

/** 合并决策结果 */
export interface TopicMergeResult {
  decision: TopicMergeDecision;
  candidateIds: string[];
  mergedName: string;
  mergedAliases: string[];
  mergedBlockIds: string[];
  reason: string;
  confidence: number;
}

// ============== V2: 第二层讲解结构 ==============

/** 讲解块类型 — 描述知识是怎么讲的 */
/**
 * 第二层节点的机器可读类型。
 *
 * 不再限定为预设教学模板：AI 可根据具体学科生成
 * `formula_system`、`knowledge_family`、`decision_boundary` 等类型。
 */
export type TeachingBlockType = string;

/** 讲解块 — 第二层：一个知识是通过什么方式讲清楚的 */
export interface TeachingBlock {
  id: string;
  topicId: string;

  type: TeachingBlockType;
  /** AI 自由概括的人类可读分类，如“GLM 公式”“广义线性族” */
  category?: string;
  secondaryTypes?: TeachingBlockType[];

  title: string;

  sourceRanges: SourceRange[];

  summary: string;
  detailedExplanation?: string;

  importance: 'required' | 'supporting' | 'optional';

  confidence: number;
}

/** 讲解关系类型 */
/** 第二层关系允许 AI 使用学科化关系，常见值仍保留兼容。 */
export type TeachingRelationType = string;

/** 讲解块间关系 */
export interface TeachingRelation {
  id: string;
  topicId: string;
  sourceBlockId: string;
  targetBlockId: string;
  type: TeachingRelationType;

  reason: string;
  confidence: number;
}

// ============== V2: 学习顺序 ==============

/** 课程学习路径 — 第一层排序 */
export interface CourseLearningPath {
  orderedTopicIds: string[];

  steps: Array<{
    topicId: string;
    reason: string;
    prerequisiteTopicIds: string[];
  }>;
}

/** 知识讲解路径 — 第二层排序 */
export interface TopicNarrativePath {
  topicId: string;
  orderedTeachingBlockIds: string[];

  rationale: string;
}

// ============== V2: 知识卡片 ==============

/** 公式卡片 */
export interface FormulaCard {
  id: string;
  topicId: string;

  formula: string;
  description: string;

  sourceRanges: SourceRange[];

  variables?: Record<string, string>;
}

/** 术语表条目 */
export interface GlossaryItem {
  term: string;
  aliases: string[];
  definition: string;
  topicId?: string;
  sourceRanges?: SourceRange[];
}

/** 知识卡片 — 以 TeachingBlock 为主要单位 */
export interface KnowledgeCard {
  id: string;

  courseId: string;
  topicId: string;
  topicName: string;

  teachingBlockId: string;
  teachingType: TeachingBlockType;

  title: string;

  conciseSummary: string;
  detailedNote: string;

  /** AI 深化后的结构化学习信息。 */
  keyPoints?: string[];
  applicableConditions?: string[];
  examples?: string[];
  selfCheckQuestions?: string[];
  /** 直接从当前卡片引用范围截取的 MinerU 原文。 */
  sourceExcerpt?: string;

  sourceRanges: SourceRange[];

  keywords: string[];
  aliases: string[];

  prerequisiteTopicIds: string[];
  relatedTopicIds: string[];

  formulas?: FormulaCard[];
  misconceptions?: string[];

  confidence: number;
  reviewStatus: 'generated' | 'reviewed' | 'corrected';

  /** 当前一级知识的二级叙事顺序，从 0 开始。 */
  narrativeIndex?: number;

  /** 卡片及其来源的版本，用于精准标记下游过期状态。 */
  status?: GenerationStatus;
  sourceVersion?: number;
  cardVersion?: number;

  embeddingId?: string;
}

// ============== V2: 笔记 ==============

/** 知识点笔记 — 基于 TeachingBlock 排序后生成 */
export interface TopicNote {
  topicId: string;

  markdown: string;

  sectionBindings: Array<{
    generatedSectionId: string;
    teachingBlockIds: string[];
    sourceRanges: SourceRange[];
  }>;

  glossaryUpdates: GlossaryItem[];
  formulaUpdates: FormulaCard[];

  version: number;
}

// ============== V2: 知识综合与完整笔记 ==============

export type GenerationStatus =
  | 'pending'
  | 'generating'
  | 'partial'
  | 'completed'
  | 'stale'
  | 'failed';

export interface ParallelKnowledgeGroup {
  title: string;
  cardIds: string[];
  summary: string;
}

export interface KnowledgeComparison {
  title: string;
  dimensions: string[];
  rows: string[][];
}

export interface FormulaChain {
  title: string;
  cardIds: string[];
  explanation: string;
}

export interface TopicSynthesisSection {
  id: string;
  title: string;
  cardIds: string[];
  relationReason: string;
  markdown: string;
}

/** 一个一级知识对其全部二级知识卡片的综合结果。 */
export interface TopicSynthesis {
  id: string;
  topicId: string;
  framework: string[];
  orderedCardIds: string[];
  sections: TopicSynthesisSection[];
  parallelGroups: ParallelKnowledgeGroup[];
  comparisons: KnowledgeComparison[];
  formulaChains: FormulaChain[];
  markdown: string;
  cardVersions: Record<string, number>;
  status: GenerationStatus;
  error?: string;
}

export interface ChapterPlanItem {
  id: string;
  title: string;
  objective: string;
  topicIds: string[];
  framework: string[];
}

export interface ChapterNote extends ChapterPlanItem {
  markdown: string;
  sourceCardIds: string[];
  status: GenerationStatus;
  error?: string;
  retryCount: number;
}

export interface CourseNoteCoverage {
  totalCardIds: string[];
  coveredCardIds: string[];
  missingCardIds: string[];
}

export interface CourseMasterNote {
  id: string;
  title: string;
  outline: ChapterPlanItem[];
  chapters: ChapterNote[];
  glossary: GlossaryItem[];
  formulaIndex: FormulaCard[];
  markdown: string;
  coverage: CourseNoteCoverage;
  status: GenerationStatus;
  generatedFromStructureVersion: number;
  error?: string;
}

// ============== V2: 多文档融合 ==============

/** 知识在不同课件中的出现方式 */
export type TreatmentType =
  | 'introduced'
  | 'defined'
  | 'explained'
  | 'derived'
  | 'applied'
  | 'reviewed'
  | 'extended';

/** 知识点在某个文档中的出现 */
export interface CourseTopicOccurrence {
  documentId: string;
  localTopicId: string;

  sourceRanges: SourceRange[];

  treatmentType: TreatmentType;
}

// ============== V2: 校验 ==============

/** 块分类类型（用于覆盖检查） */
export type BlockClassification =
  | 'topic'
  | 'course-intro'
  | 'section-navigation'
  | 'transition'
  | 'exercise'
  | 'reference'
  | 'unclassified';

/** 事实检查结果 */
export type FactCheckResult =
  | 'fully_supported'
  | 'reasonable_paraphrase'
  | 'requires_inference'
  | 'not_in_source'
  | 'conflicts_with_source';

/** 校验报告 */
export interface KnowledgeValidationReport {
  /** 未分配块 */
  unassignedBlocks: string[];
  /** 知识点缺少来源 */
  topicsWithoutSource: string[];
  /** 讲解块缺少来源 */
  teachingBlocksWithoutSource: string[];
  /** 事实检查问题 */
  factCheckIssues: Array<{
    noteSection: string;
    result: FactCheckResult;
    detail: string;
  }>;
  /** 结构质量问题 */
  structuralIssues: string[];
  /** 低置信度项 */
  lowConfidenceItems: Array<{
    type: 'topic' | 'teaching_block' | 'relation';
    id: string;
    confidence: number;
    question: string;
  }>;
}

// ============== V2: 知识库 ==============

/** 课程知识库 — 完整数据模型 */
export interface CourseKnowledgeBase {
  id: string;
  name: string;

  documents: SourceDocument[];

  topics: KnowledgeTopic[];
  topicRelations: TopicRelation[];

  teachingBlocks: TeachingBlock[];
  teachingRelations: TeachingRelation[];

  learningPath: CourseLearningPath;
  narrativePaths: Record<string, TopicNarrativePath>;

  knowledgeCards: KnowledgeCard[];
  topicNotes: TopicNote[];

  glossary: GlossaryItem[];
  formulas: FormulaCard[];

  unassignedBlocks: string[];

  validation?: KnowledgeValidationReport;

  versions: {
    source: number;
    normalization: number;
    topicStructure: number;
    teachingStructure: number;
    ordering: number;
    cards: number;
    notes: number;
    embeddings: number;
  };
}

// ============== V2: 管线阶段 ==============

/** V2 管线阶段标识 */
export type V2PipelineStage =
  | 'idle'
  | 'normalizing'
  | 'window-analysis'
  | 'topic-extraction'
  | 'topic-reconciliation'
  | 'teaching-extraction'
  | 'ordering'
  | 'card-generation'
  | 'note-generation'
  | 'validation'
  | 'ready'
  | 'failed'
  | 'model-required';

/** V2 管线进度步骤 */
export interface V2PipelineProgressStep {
  id: string;
  stage: V2PipelineStage;
  label: string;
  status: ProgressStepStatus;
  detail?: string;
}

/** V2 检查点 — 用于从失败阶段恢复 */
export interface V2Checkpoint {
  lastCompletedStage: V2PipelineStage | null;
  documents?: SourceDocument[];
  windows?: ContentWindowAnalysis[];
  candidates?: CandidateTopic[];
  topics?: KnowledgeTopic[];
  topicRelations?: TopicRelation[];
  teachingBlocks?: TeachingBlock[];
  teachingRelations?: TeachingRelation[];
  learningPath?: CourseLearningPath;
  narrativePaths?: Record<string, TopicNarrativePath>;
  failedStage?: string;
  failedWindowIndex?: number;
}
