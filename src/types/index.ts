// ============== 基础类型（保持兼容） ==============

// 流程状态
export type WorkflowStage = 'upload' | 'parse-review' | 'structure-review' | 'generating' | 'notes';

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

// 课件文档
export interface CourseDocument {
  id: string;
  title: string;
  fileName: string;
  pages: CoursePage[];
  uploadedAt: number;
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

// ============== 结构提取状态 ==============

export type StructureExtractionStatus =
  | 'idle'
  | 'extracting-topics'
  | 'repairing-topics'
  | 'extracting-relations'
  | 'extracting-internal-structures'
  | 'ready'
  | 'failed'
  | 'model-required';

// ============== 顺序模式 ==============

export type OrderMode = 'original' | 'ai-recommended';

// ============== 持久化Schema ==============

export const SCHEMA_VERSION = 3;

export interface PersistedState {
  schemaVersion: number;
  stage: WorkflowStage;
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
}

// ============== 完整项目状态（运行时） ==============

export interface ProjectState {
  stage: WorkflowStage;
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

  currentView: ViewType;
  modelConfig: ModelConfig | null;
  generationMemory: CourseGenerationMemory;
  globalAnchors: GlobalKnowledgeAnchor[];
  occurrences: CourseKnowledgeOccurrence[];
}
