import type { SectionBatch } from './section-batching';
import type {
  CourseLearningStructure,
  CourseStructureIssue,
  SectionCompilationCheckpoint,
} from './types';

export function reconcileIncremental(
  previous: CourseLearningStructure | null,
  batches: SectionBatch[],
): {
  reusable: Map<string, SectionCompilationCheckpoint>;
  reusedBatchIds: string[];
  changedBatchIds: string[];
} {
  const previousByCacheKey = new Map(
    (previous?.checkpoints ?? []).map(checkpoint => [checkpoint.cacheKey, checkpoint]),
  );
  const reusable = new Map<string, SectionCompilationCheckpoint>();
  const reusedBatchIds: string[] = [];
  const changedBatchIds: string[] = [];
  batches.forEach(batch => {
    const checkpoint = previousByCacheKey.get(batch.cacheKey);
    if (checkpoint) {
      reusable.set(batch.id, checkpoint);
      reusedBatchIds.push(batch.id);
    } else {
      changedBatchIds.push(batch.id);
    }
  });
  return { reusable, reusedBatchIds, changedBatchIds };
}

export function preserveCorrectedObjects(
  previous: CourseLearningStructure | null,
  generated: CourseLearningStructure,
): CourseLearningStructure {
  if (!previous) return generated;
  const validEvidenceIds = new Set(generated.evidenceSpans.map(evidence => evidence.id));
  const issues: CourseStructureIssue[] = [];
  const topicIdRemap = new Map<string, string>();
  const previousCorrectedByStableKey = new Map(
    previous.topics.filter(topic => topic.status === 'corrected').map(topic => [topic.stableKey, topic]),
  );

  const topics = generated.topics.map(topic => {
    const corrected = previousCorrectedByStableKey.get(topic.stableKey);
    if (!corrected) return topic;
    if (!corrected.evidenceIds.every(id => validEvidenceIds.has(id))) {
      issues.push({
        code: 'INVALID_EVIDENCE',
        severity: 'error',
        message: `用户修正主题“${corrected.name}”的原文证据已失效，未自动保留`,
        topicId: corrected.id,
      });
      return topic;
    }
    topicIdRemap.set(topic.id, corrected.id);
    return corrected;
  });
  const mapTopicId = (id: string): string => topicIdRemap.get(id) ?? id;
  const topicIds = new Set(topics.map(topic => topic.id));

  const unitIdRemap = new Map<string, string>();
  const previousCorrectedUnits = new Map(
    previous.teachingUnits.filter(unit => unit.status === 'corrected').map(unit => [unit.stableKey, unit]),
  );
  const teachingUnits = generated.teachingUnits.flatMap(unit => {
    const mapped = { ...unit, topicId: mapTopicId(unit.topicId) };
    const corrected = previousCorrectedUnits.get(unit.stableKey);
    if (!corrected) return topicIds.has(mapped.topicId) ? [mapped] : [];
    if (!corrected.evidenceIds.every(id => validEvidenceIds.has(id))) {
      issues.push({
        code: 'INVALID_EVIDENCE',
        severity: 'error',
        message: `用户修正讲解单元“${corrected.title}”的原文证据已失效，未自动保留`,
        teachingUnitId: corrected.id,
      });
      return topicIds.has(mapped.topicId) ? [mapped] : [];
    }
    unitIdRemap.set(unit.id, corrected.id);
    return [{ ...corrected, topicId: mapTopicId(corrected.topicId) }];
  });
  const mapUnitId = (id: string): string => unitIdRemap.get(id) ?? id;

  const generatedConstraints = generated.orderConstraints.flatMap(constraint => {
    const mapped = {
      ...constraint,
      beforeTopicId: mapTopicId(constraint.beforeTopicId),
      afterTopicId: mapTopicId(constraint.afterTopicId),
    };
    return topicIds.has(mapped.beforeTopicId) && topicIds.has(mapped.afterTopicId) ? [mapped] : [];
  });
  const correctedConstraints = previous.orderConstraints.filter(constraint => (
    constraint.source === 'corrected'
    && topicIds.has(constraint.beforeTopicId)
    && topicIds.has(constraint.afterTopicId)
  ));
  const correctedDirections = new Set(correctedConstraints.map(constraint => (
    `${constraint.beforeTopicId}:${constraint.afterTopicId}`
  )));
  const orderConstraints = [
    ...generatedConstraints.filter(constraint => !correctedDirections.has(
      `${constraint.beforeTopicId}:${constraint.afterTopicId}`,
    )),
    ...correctedConstraints,
  ];

  const teachingPaths: Record<string, string[]> = {};
  Object.entries(generated.teachingPaths).forEach(([topicId, path]) => {
    teachingPaths[mapTopicId(topicId)] = path.map(mapUnitId);
  });

  const validationIssues = [...generated.validation.issues, ...issues];
  return {
    ...generated,
    topics,
    teachingUnits,
    orderConstraints,
    orderedTopicIds: generated.orderedTopicIds.map(mapTopicId),
    teachingPaths,
    status: generated.status === 'failed' ? 'failed' : issues.length > 0 ? 'degraded' : generated.status,
    validation: { ...generated.validation, issues: validationIssues },
  };
}
