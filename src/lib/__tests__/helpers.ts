import {
  EvidenceAtom,
  EvidenceType,
  CourseTopic,
  CourseTopicType,
  MacroKnowledgeRelation,
  MacroRelationType,
  KnowledgePackage,
  NaturalKnowledgeNote,
  CourseGenerationMemory,
  InternalStructure,
  Citation,
} from '../../types';

// ========== EvidenceAtom Helper ==========

export function makeEvidence(
  overrides: Partial<EvidenceAtom> & {
    id?: string;
    pageNumber?: number;
    type?: EvidenceType;
    content?: string;
  }
): EvidenceAtom {
  const pageNumber = overrides.pageNumber ?? 1;
  const type = overrides.type ?? 'text';
  const content = overrides.content ?? 'test content';
  const documentId = overrides.documentId ?? 'test-doc';
  const blockIndex = overrides.blockIndex ?? 0;
  const contentHash =
    overrides.contentHash ??
    `${documentId}-${pageNumber}-${blockIndex}-${type}-${content.slice(0, 20)}`;
  return {
    id: overrides.id || `ev_${documentId}_${pageNumber}_${blockIndex}_${contentHash}`,
    documentId,
    pageNumber,
    blockIndex,
    type,
    content,
    confidence: overrides.confidence ?? 0.8,
    contentHash,
  };
}

// ========== CourseTopic Helper ==========

export function makeTopic(
  overrides: Partial<CourseTopic> & { id?: string; title?: string }
): CourseTopic {
  const id = overrides.id ?? 'test-topic';
  const title = overrides.title ?? 'Test Topic';
  return {
    aliases: [],
    type: 'composite' as CourseTopicType,
    learningGoal: `学习${title}`,
    evidenceIds: [],
    originalPageNumbers: [1],
    importance: 'core' as const,
    confidence: 0.7,
    originalOrder: 0,
    recommendedOrder: 0,
    noteStatus: 'pending' as const,
    ...overrides,
    id,
    title,
  };
}

// ========== MacroKnowledgeRelation Helper ==========

export function makeRelation(
  overrides: Partial<MacroKnowledgeRelation> & {
    id?: string;
    sourceTopicId?: string;
    targetTopicId?: string;
    type?: MacroRelationType;
  }
): MacroKnowledgeRelation {
  const id = overrides.id ?? 'test-rel';
  const sourceTopicId = overrides.sourceTopicId ?? 'topic-a';
  const targetTopicId = overrides.targetTopicId ?? 'topic-b';
  const type = overrides.type ?? 'hard_prerequisite';
  return {
    evidenceIds: [],
    reason: '',
    confidence: 0.7,
    origin: 'ai-inferred' as const,
    ...overrides,
    id,
    sourceTopicId,
    targetTopicId,
    type,
  };
}

// ========== NaturalKnowledgeNote Helper ==========

export function makeNote(
  overrides: Partial<NaturalKnowledgeNote> & { topicId?: string }
): NaturalKnowledgeNote {
  const topicId = overrides.topicId ?? 'test-topic';
  return {
    id: 'test-note',
    topicId,
    title: 'Test Note',
    contentMarkdown: 'Test content',
    shortSummary: 'Test summary',
    citations: [],
    terminologyUpdates: {},
    symbolUpdates: {},
    continuityMemory: '',
    warnings: [],
    ...overrides,
  };
}

// ========== CourseGenerationMemory Helper ==========

export function makeMemory(
  overrides?: Partial<CourseGenerationMemory>
): CourseGenerationMemory {
  return {
    terminology: {},
    symbols: {},
    generatedTopicSummaries: {},
    ...overrides,
  };
}

// ========== KnowledgePackage Helper ==========

export function makeKnowledgePackage(
  overrides: Partial<KnowledgePackage> & { id?: string; topic?: CourseTopic }
): KnowledgePackage {
  const id = overrides.id ?? 'test-kp';
  const topic = overrides.topic ?? makeTopic({});
  const internalStructure: InternalStructure = overrides.internalStructure ?? {
    items: [],
    relations: [],
    orderedItemIds: [],
    source: 'local',
    warnings: [],
    status: 'ready',
  };
  return {
    source: {
      evidenceIds: [],
      combinedOriginalText: '',
      evidence: [],
    },
    internalStructure,
    macroRelations: [],
    note: undefined,
    versions: {
      sourceVersion: 1,
      structureVersion: 1,
      noteVersion: 0,
      promptVersion: 'test',
    },
    ...overrides,
    id,
    topic,
  };
}

// ========== Citation Helper ==========

export function makeCitation(
  overrides: Partial<Citation> & { marker?: string }
): Citation {
  const marker = overrides.marker ?? 'cite-1';
  return {
    evidenceIds: [],
    ...overrides,
    marker,
  };
}
