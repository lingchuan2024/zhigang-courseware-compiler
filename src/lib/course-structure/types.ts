export type EvidenceRole =
  | 'statement'
  | 'definition'
  | 'formula'
  | 'condition'
  | 'derivation'
  | 'example'
  | 'comparison'
  | 'application';

export type LearningGenre =
  | 'concept'
  | 'derivation'
  | 'algorithm'
  | 'mechanism'
  | 'comparison'
  | 'case';

export type TeachingRole =
  | 'motivation'
  | 'problem'
  | 'intuition'
  | 'definition'
  | 'formula'
  | 'condition'
  | 'derivation_step'
  | 'procedure_step'
  | 'property'
  | 'example'
  | 'comparison'
  | 'misconception'
  | 'application'
  | 'summary';

export type CourseStructureStatus = 'ready' | 'degraded' | 'failed';

export interface EvidenceSpan {
  id: string;
  stableKey: string;
  documentId: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  role: EvidenceRole;
  contentHash: string;
}

export interface LearningTopic {
  id: string;
  stableKey: string;
  courseId: string;
  name: string;
  aliases: string[];
  learningObjective: string;
  scope: string;
  genre: LearningGenre;
  difficulty: 1 | 2 | 3 | 4 | 5;
  importance: 'core' | 'important' | 'supplementary';
  evidenceIds: string[];
  sourceSectionIds: string[];
  confidence: number;
  status: 'draft' | 'verified' | 'corrected';
}

export interface TeachingUnit {
  id: string;
  stableKey: string;
  topicId: string;
  role: TeachingRole;
  title: string;
  summary: string;
  evidenceIds: string[];
  required: boolean;
  confidence: number;
  status: 'draft' | 'verified' | 'corrected';
}

export interface OrderConstraint {
  id: string;
  beforeTopicId: string;
  afterTopicId: string;
  strength: 'hard' | 'soft';
  reason: string;
  evidenceIds: string[];
  source: 'explicit' | 'inferred' | 'corrected';
  confidence: number;
}

export type CourseStructureIssueCode =
  | 'INVALID_EVIDENCE'
  | 'TOPIC_WITHOUT_EVIDENCE'
  | 'GENERIC_TOPIC'
  | 'REQUIRED_UNIT_WITHOUT_EVIDENCE'
  | 'TEACHING_UNIT_WITHOUT_EVIDENCE'
  | 'UNKNOWN_TOPIC'
  | 'ORDER_CONSTRAINT_VIOLATION'
  | 'HARD_ORDER_CYCLE'
  | 'FAILED_SECTION_BATCH'
  | 'EMPTY_SECTION_COMPILATION'
  | 'CURRICULUM_REVIEW_FAILED'
  | 'UNRESOLVED_REFERENCE'
  | 'LOW_COVERAGE';

export interface CourseStructureIssue {
  code: CourseStructureIssueCode;
  severity: 'error' | 'warning';
  message: string;
  topicId?: string;
  teachingUnitId?: string;
  blockId?: string;
  batchId?: string;
}

export interface CourseStructureValidation {
  issues: CourseStructureIssue[];
  meaningfulBlockCount: number;
  coveredMeaningfulBlockCount: number;
  coverageRate: number;
}

export interface EvidenceSpanDraft {
  blockId: string;
  startOffset?: number;
  endOffset?: number;
  quote: string;
  role: EvidenceRole;
}

export interface TopicMentionDraft {
  localId: string;
  name: string;
  aliases: string[];
  learningObjective: string;
  scope: string;
  genre: LearningGenre;
  difficulty: number;
  importance: LearningTopic['importance'];
  evidence: EvidenceSpanDraft[];
  confidence: number;
}

export interface TeachingUnitDraft {
  localId: string;
  topicLocalId: string;
  role: TeachingRole;
  title: string;
  summary: string;
  evidence: EvidenceSpanDraft[];
  required: boolean;
  confidence: number;
}

export interface OrderClaimDraft {
  beforeTopicLocalId: string;
  afterTopicLocalId: string;
  strength: 'hard' | 'soft';
  reason: string;
  evidence: EvidenceSpanDraft[];
  source: 'explicit' | 'inferred';
  confidence: number;
}

export interface SectionCompilation {
  batchId: string;
  sectionIds: string[];
  topicMentions: TopicMentionDraft[];
  teachingUnits: TeachingUnitDraft[];
  orderClaims: OrderClaimDraft[];
  unresolvedReferences: string[];
  confidence: number;
}

export interface SectionCompilationCheckpoint {
  cacheKey: string;
  batchId: string;
  sectionIds: string[];
  result: SectionCompilation;
}

/** 单个证据单元的可持久化执行结果。失败项保留原因，成功项可直接断点复用。 */
export interface CourseExtractionUnitCheckpoint {
  cacheKey: string;
  batchId: string;
  sectionIds: string[];
  status: 'succeeded' | 'failed';
  attempts: number;
  result?: SectionCompilation;
  error?: string;
  completedAt: number;
}

/** 仅由真实完成事件驱动的提取进度，不使用假进度计时器。 */
export interface CourseExtractionProgress {
  completedUnits: number;
  successfulUnits: number;
  failedUnits: number;
  totalUnits: number;
  discoveredTopicMentions: number;
  elapsedMs: number;
}

export interface CourseExtractionSession {
  id: string;
  courseId: string;
  startedAt: number;
  deadlineAt: number;
  checkpoints: CourseExtractionUnitCheckpoint[];
}

export interface CourseLearningStructure {
  courseId: string;
  sourceVersion: number;
  structureVersion: number;
  compilerVersion: string;
  topics: LearningTopic[];
  teachingUnits: TeachingUnit[];
  evidenceSpans: EvidenceSpan[];
  orderConstraints: OrderConstraint[];
  orderedTopicIds: string[];
  teachingPaths: Record<string, string[]>;
  status: CourseStructureStatus;
  validation: CourseStructureValidation;
  checkpoints: SectionCompilationCheckpoint[];
}
