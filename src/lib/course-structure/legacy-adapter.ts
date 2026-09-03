import type {
  CourseLearningPath,
  KnowledgeGenre,
  KnowledgeTopic,
  MarkdownBlock,
  SourceRange,
  TeachingBlock,
  TeachingRelation,
  TopicNarrativePath,
  TopicRelation,
} from '../../types';
import type { CourseLearningStructure, EvidenceSpan, LearningGenre } from './types';

export interface LegacyStructureProjection {
  topics: KnowledgeTopic[];
  topicRelations: TopicRelation[];
  teachingBlocks: TeachingBlock[];
  teachingRelations: TeachingRelation[];
  courseLearningPath: CourseLearningPath;
  narrativePaths: Record<string, TopicNarrativePath>;
}

const GENRE_MAP: Record<LearningGenre, KnowledgeGenre> = {
  concept: 'concept',
  derivation: 'mathematical_derivation',
  algorithm: 'algorithm',
  mechanism: 'system_mechanism',
  comparison: 'comparison',
  case: 'case_study',
};

function rangesForEvidence(
  evidenceIds: string[],
  evidenceById: ReadonlyMap<string, EvidenceSpan>,
  blockById: ReadonlyMap<string, MarkdownBlock>,
): SourceRange[] {
  const blocksByDocument = new Map<string, MarkdownBlock[]>();
  const seen = new Set<string>();
  evidenceIds.forEach(id => {
    const evidence = evidenceById.get(id);
    const block = evidence ? blockById.get(evidence.blockId) : undefined;
    if (!evidence || !block || seen.has(block.id)) return;
    seen.add(block.id);
    blocksByDocument.set(evidence.documentId, [
      ...(blocksByDocument.get(evidence.documentId) ?? []),
      block,
    ]);
  });

  const ranges: SourceRange[] = [];
  blocksByDocument.forEach((documentBlocks, documentId) => {
    const sorted = [...documentBlocks].sort((left, right) => left.orderIndex - right.orderIndex);
    let start = sorted[0];
    let end = sorted[0];
    for (const block of sorted.slice(1)) {
      if (block.orderIndex === end.orderIndex + 1) {
        end = block;
      } else {
        ranges.push({ documentId, startBlockId: start.id, endBlockId: end.id });
        start = block;
        end = block;
      }
    }
    if (start && end) ranges.push({ documentId, startBlockId: start.id, endBlockId: end.id });
  });
  return ranges;
}

export function projectLegacyStructure(
  structure: CourseLearningStructure,
  blocks: MarkdownBlock[],
): LegacyStructureProjection {
  const evidenceById = new Map(structure.evidenceSpans.map(evidence => [evidence.id, evidence]));
  const blockById = new Map(blocks.map(block => [block.id, block]));
  const topics: KnowledgeTopic[] = structure.topics.map(topic => ({
    id: topic.id,
    courseId: topic.courseId,
    name: topic.name,
    aliases: topic.aliases,
    summary: topic.scope,
    learningObjective: topic.learningObjective,
    sourceRanges: rangesForEvidence(topic.evidenceIds, evidenceById, blockById),
    childTopicIds: [],
    importance: topic.importance,
    difficulty: topic.difficulty,
    knowledgeGenre: GENRE_MAP[topic.genre],
    confidence: topic.confidence,
    status: topic.status === 'corrected' ? 'corrected' : 'generated',
  }));

  const topicRelations: TopicRelation[] = structure.orderConstraints.map(constraint => ({
    id: constraint.id,
    sourceTopicId: constraint.beforeTopicId,
    targetTopicId: constraint.afterTopicId,
    type: constraint.strength === 'hard' ? 'hard_prerequisite' : 'helpful_before',
    reason: constraint.reason,
    confidence: constraint.confidence,
  }));

  const teachingBlocks: TeachingBlock[] = structure.teachingUnits.map(unit => ({
    id: unit.id,
    topicId: unit.topicId,
    type: unit.role,
    category: unit.role,
    title: unit.title,
    sourceRanges: rangesForEvidence(unit.evidenceIds, evidenceById, blockById),
    summary: unit.summary,
    importance: unit.required ? 'required' : 'supporting',
    confidence: unit.confidence,
  }));

  const teachingRelations: TeachingRelation[] = [];
  const narrativePaths: Record<string, TopicNarrativePath> = {};
  Object.entries(structure.teachingPaths).forEach(([topicId, ids]) => {
    narrativePaths[topicId] = {
      topicId,
      orderedTeachingBlockIds: ids,
      rationale: '按受控讲解角色与原文顺序编译',
    };
    ids.slice(0, -1).forEach((sourceBlockId, index) => {
      const targetBlockId = ids[index + 1];
      teachingRelations.push({
        id: `teaching-order:${topicId}:${sourceBlockId}:${targetBlockId}`,
        topicId,
        sourceBlockId,
        targetBlockId,
        type: 'should_explain_before',
        reason: '确定性讲解顺序',
        confidence: 1,
      });
    });
  });

  const courseLearningPath: CourseLearningPath = {
    orderedTopicIds: structure.orderedTopicIds,
    steps: structure.orderedTopicIds.map(topicId => {
      const prerequisites = structure.orderConstraints
        .filter(constraint => constraint.strength === 'hard' && constraint.afterTopicId === topicId);
      return {
        topicId,
        reason: prerequisites.map(constraint => constraint.reason).filter(Boolean).join('；') || '按课程结构稳定排序',
        prerequisiteTopicIds: prerequisites.map(constraint => constraint.beforeTopicId),
      };
    }),
  };

  return {
    topics,
    topicRelations,
    teachingBlocks,
    teachingRelations,
    courseLearningPath,
    narrativePaths,
  };
}
