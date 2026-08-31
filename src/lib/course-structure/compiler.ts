import type { MarkdownBlock, ModelConfig, SourceDocument } from '../../types';
import { ExtractionError, inferErrorCode } from '../extraction-errors';
import { normalizeCandidates, type ResolvedTopicDraft } from './candidate-normalizer';
import { compileCourseOrder } from './course-scheduler';
import { reviewCurriculum } from './curriculum-review';
import { resolveEvidenceSpan } from './evidence-span';
import { preserveCorrectedObjects } from './incremental-reconcile';
import { buildSectionBatches, type SectionBatch } from './section-batching';
import { compileSectionBatch } from './section-compiler';
import { constraintStableKey, teachingUnitStableKey } from './stable-identity';
import { compileTeachingPath } from './teaching-path-compiler';
import type {
  CourseLearningStructure,
  CourseStructureIssue,
  EvidenceSpan,
  EvidenceSpanDraft,
  LearningTopic,
  OrderConstraint,
  SectionCompilation,
  SectionCompilationCheckpoint,
  TeachingUnit,
  TeachingUnitDraft,
} from './types';
import { validateCourseStructure } from './validator';

export interface CourseCompilerDependencies {
  compileBatch?: (batch: SectionBatch) => Promise<SectionCompilation>;
  review?: typeof reviewCurriculum;
  previous?: CourseLearningStructure | null;
  onBatchProgress?: (current: number, total: number) => void;
  onStage?: (stage: 'batching' | 'compiling' | 'normalizing' | 'reviewing' | 'scheduling' | 'validating') => void;
}

interface ResolvedUnitDraft {
  draft: TeachingUnitDraft;
  evidenceIds: string[];
}

interface ResolvedClaimDraft {
  beforeTopicLocalId: string;
  afterTopicLocalId: string;
  strength: 'hard' | 'soft';
  reason: string;
  evidenceIds: string[];
  source: 'explicit' | 'inferred';
  confidence: number;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

function effectiveCacheKey(batch: SectionBatch, config: ModelConfig): string {
  void config;
  return batch.cacheKey;
}

function unionInOrder(...groups: string[][]): string[] {
  const seen = new Set<string>();
  return groups.flatMap(group => group.filter(value => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }));
}

function splitSectionBatch(batch: SectionBatch): [SectionBatch, SectionBatch] | null {
  if (batch.blocks.length < 2) return null;
  const midpoint = Math.ceil(batch.blocks.length / 2);
  const createPart = (blocks: MarkdownBlock[], index: number): SectionBatch => ({
    ...batch,
    id: `${batch.id}__part${index + 1}`,
    blocks,
    estimatedTokens: Math.max(1, Math.ceil(batch.estimatedTokens * blocks.length / batch.blocks.length)),
    cacheKey: `${batch.cacheKey}__part${index + 1}`,
  });
  return [createPart(batch.blocks.slice(0, midpoint), 0), createPart(batch.blocks.slice(midpoint), 1)];
}

function mergeSectionCompilations(
  batch: SectionBatch,
  compilations: SectionCompilation[],
): SectionCompilation {
  const totalWeight = Math.max(1, batch.blocks.length);
  return {
    batchId: batch.id,
    sectionIds: unionInOrder(...compilations.map(compilation => compilation.sectionIds)),
    topicMentions: compilations.flatMap(compilation => compilation.topicMentions),
    teachingUnits: compilations.flatMap(compilation => compilation.teachingUnits),
    orderClaims: compilations.flatMap(compilation => compilation.orderClaims),
    unresolvedReferences: unionInOrder(...compilations.map(compilation => compilation.unresolvedReferences)),
    confidence: compilations.reduce((sum, compilation, index) => {
      const weight = Math.max(1, index === 0
        ? Math.ceil(batch.blocks.length / 2)
        : Math.floor(batch.blocks.length / 2));
      return sum + compilation.confidence * weight;
    }, 0) / totalWeight,
  };
}

function canRecoverBySplitting(error: unknown): boolean {
  const code = inferErrorCode(error);
  return code === 'api-timeout' || code === 'response-truncated';
}

async function compileBatchAdaptively(
  batch: SectionBatch,
  compileBatch: (batch: SectionBatch) => Promise<SectionCompilation>,
  allowSplit: boolean,
): Promise<SectionCompilation> {
  try {
    return await compileBatch(batch);
  } catch (error) {
    const parts = allowSplit && canRecoverBySplitting(error) ? splitSectionBatch(batch) : null;
    if (!parts) throw error;
    // 顺序执行，避免同一个 Agent Plan 同时承担多个长推理请求。
    const compilations: SectionCompilation[] = [];
    for (const part of parts) {
      compilations.push(await compileBatchAdaptively(part, compileBatch, allowSplit));
    }
    return mergeSectionCompilations(batch, compilations);
  }
}

function batchFailureMessage(batch: SectionBatch, error: unknown): string {
  const detail = error instanceof ExtractionError
    ? error.toUserMessage()
    : error instanceof Error
      ? error.message
      : String(error);
  return `章节批次 ${batch.id} 编译失败：${detail}`;
}

function applyCurriculumOperations(
  topics: LearningTopic[],
  operations: Awaited<ReturnType<typeof reviewCurriculum>>['operations'],
): { topics: LearningTopic[]; topicRemap: Map<string, string> } {
  let current = [...topics];
  const topicRemap = new Map(topics.map(topic => [topic.id, topic.id]));
  const resolveId = (id: string): string => topicRemap.get(id) ?? id;

  operations.forEach(operation => {
    const ids = [...new Set(operation.topicIds.map(resolveId))];
    if (operation.type === 'drop') {
      const dropped = new Set(ids);
      current = current.filter(topic => !dropped.has(topic.id));
      topicRemap.forEach((mapped, original) => {
        if (dropped.has(mapped)) topicRemap.set(original, '');
      });
      return;
    }

    const mergeTopics = current.filter(topic => ids.includes(topic.id));
    if (mergeTopics.length < 2) return;
    const winner = [...mergeTopics].sort((left, right) => right.confidence - left.confidence
      || left.stableKey.localeCompare(right.stableKey))[0];
    const losers = new Set(mergeTopics.filter(topic => topic.id !== winner.id).map(topic => topic.id));
    const merged: LearningTopic = {
      ...winner,
      aliases: [...new Set([
        ...mergeTopics.flatMap(topic => topic.aliases),
        ...mergeTopics.filter(topic => topic.id !== winner.id).map(topic => topic.name),
      ])].sort(),
      evidenceIds: unionInOrder(...mergeTopics.map(topic => topic.evidenceIds)),
      sourceSectionIds: [...new Set(mergeTopics.flatMap(topic => topic.sourceSectionIds))].sort(),
      confidence: Math.max(...mergeTopics.map(topic => topic.confidence)),
    };
    current = current.filter(topic => !losers.has(topic.id)).map(topic => (
      topic.id === winner.id ? merged : topic
    ));
    topicRemap.forEach((mapped, original) => {
      if (losers.has(mapped)) topicRemap.set(original, winner.id);
    });
  });

  return { topics: current, topicRemap };
}

function dedupeTeachingUnits(units: TeachingUnit[]): TeachingUnit[] {
  const byId = new Map<string, TeachingUnit>();
  units.forEach(unit => {
    const existing = byId.get(unit.id);
    if (!existing) {
      byId.set(unit.id, unit);
      return;
    }
    byId.set(unit.id, {
      ...(existing.confidence >= unit.confidence ? existing : unit),
      evidenceIds: unionInOrder(existing.evidenceIds, unit.evidenceIds),
      required: existing.required || unit.required,
      confidence: Math.max(existing.confidence, unit.confidence),
    });
  });
  return [...byId.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey));
}

function dedupeConstraints(constraints: OrderConstraint[]): OrderConstraint[] {
  const byDirection = new Map<string, OrderConstraint>();
  const sourceRank = { corrected: 3, explicit: 2, inferred: 1 } as const;
  constraints.forEach(constraint => {
    const key = `${constraint.beforeTopicId}:${constraint.afterTopicId}`;
    const existing = byDirection.get(key);
    const preferred = !existing
      || sourceRank[constraint.source] > sourceRank[existing.source]
      || (sourceRank[constraint.source] === sourceRank[existing.source]
        && constraint.strength === 'hard' && existing.strength === 'soft')
      || (constraint.confidence > existing.confidence);
    if (preferred) byDirection.set(key, constraint);
  });
  return [...byDirection.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalSignature(structure: Pick<CourseLearningStructure,
  'topics' | 'teachingUnits' | 'evidenceSpans' | 'orderConstraints' | 'orderedTopicIds' | 'teachingPaths'
>): string {
  return JSON.stringify({
    topics: structure.topics,
    teachingUnits: structure.teachingUnits,
    evidenceSpans: structure.evidenceSpans,
    orderConstraints: structure.orderConstraints,
    orderedTopicIds: structure.orderedTopicIds,
    teachingPaths: structure.teachingPaths,
  });
}

export async function compileCourseStructure(
  config: ModelConfig,
  documents: SourceDocument[],
  courseId: string,
  dependencies: CourseCompilerDependencies = {},
): Promise<CourseLearningStructure> {
  dependencies.onStage?.('batching');
  // 统一 3000 token 批次预算：内容之外还有 JSON 封装与提示词开销，
  // 6000 预算的批次实测输出会逼近 max_tokens 上限并拉长生成时间。
  const batches = buildSectionBatches(documents, 3000);
  const previous = dependencies.previous ?? null;
  const previousByCacheKey = new Map(
    (previous?.checkpoints ?? []).map(checkpoint => [checkpoint.cacheKey, checkpoint]),
  );
  const compileBatch = dependencies.compileBatch ?? (batch => compileSectionBatch(config, batch));
  const issues: CourseStructureIssue[] = [];
  let completedBatches = 0;

  dependencies.onStage?.('compiling');
  dependencies.onBatchProgress?.(0, batches.length);
  const checkpointResults = await mapConcurrent(batches, 2, async batch => {
    const cacheKey = effectiveCacheKey(batch, config);
    const reusable = previousByCacheKey.get(cacheKey);
    try {
      const result = reusable?.result ?? await compileBatchAdaptively(batch, compileBatch, true);
      return { cacheKey, batchId: batch.id, sectionIds: batch.sectionIds, result } satisfies SectionCompilationCheckpoint;
    } catch (error) {
      issues.push({
        code: 'FAILED_SECTION_BATCH',
        severity: 'error',
        message: batchFailureMessage(batch, error),
        batchId: batch.id,
      });
      return null;
    } finally {
      completedBatches += 1;
      dependencies.onBatchProgress?.(completedBatches, batches.length);
    }
  });
  const checkpoints = checkpointResults.filter((item): item is SectionCompilationCheckpoint => item !== null);

  const evidenceById = new Map<string, EvidenceSpan>();
  const resolvedTopics: ResolvedTopicDraft[] = [];
  const resolvedUnits: ResolvedUnitDraft[] = [];
  const resolvedClaims: ResolvedClaimDraft[] = [];
  const batchById = new Map(batches.map(batch => [batch.id, batch]));

  const resolveDrafts = (drafts: EvidenceSpanDraft[], blockById: Map<string, MarkdownBlock>): string[] => {
    const ids: string[] = [];
    drafts.forEach(draft => {
      const block = blockById.get(draft.blockId);
      if (!block) {
        issues.push({ code: 'INVALID_EVIDENCE', severity: 'warning', message: `证据引用了未知块 ${draft.blockId}`, blockId: draft.blockId });
        return;
      }
      const resolved = resolveEvidenceSpan(draft, block);
      if (resolved.issue) issues.push(resolved.issue);
      if (resolved.span) {
        evidenceById.set(resolved.span.id, resolved.span);
        ids.push(resolved.span.id);
      }
    });
    return unionInOrder(ids);
  };

  checkpoints.forEach(checkpoint => {
    const batch = batchById.get(checkpoint.batchId);
    if (!batch) return;
    const blockById = new Map(batch.blocks.map(block => [block.id, block]));
    const compilation: SectionCompilation = checkpoint.result;
    // 批次调用成功但一条结构都没解析出来，多半是响应字段名不符；不能静默吞掉。
    if (compilation.topicMentions.length === 0 && compilation.teachingUnits.length === 0) {
      issues.push({
        code: 'EMPTY_SECTION_COMPILATION',
        severity: 'warning',
        message: `章节批次 ${batch.id} 调用成功但未解析出任何主题或讲解单元（响应格式可能不符）`,
        batchId: batch.id,
      });
    }
    compilation.topicMentions.forEach(mention => resolvedTopics.push({
      localId: mention.localId,
      name: mention.name,
      aliases: mention.aliases,
      learningObjective: mention.learningObjective,
      scope: mention.scope,
      genre: mention.genre,
      difficulty: mention.difficulty,
      importance: mention.importance,
      evidenceIds: resolveDrafts(mention.evidence, blockById),
      sectionIds: compilation.sectionIds,
      confidence: mention.confidence,
    }));
    compilation.teachingUnits.forEach(draft => resolvedUnits.push({
      draft,
      evidenceIds: resolveDrafts(draft.evidence, blockById),
    }));
    compilation.orderClaims.forEach(claim => resolvedClaims.push({
      beforeTopicLocalId: claim.beforeTopicLocalId,
      afterTopicLocalId: claim.afterTopicLocalId,
      strength: claim.source === 'inferred' ? 'soft' : claim.strength,
      reason: claim.reason,
      evidenceIds: resolveDrafts(claim.evidence, blockById),
      source: claim.source,
      confidence: claim.confidence,
    }));
    compilation.unresolvedReferences.forEach(reference => issues.push({
      code: 'UNRESOLVED_REFERENCE',
      severity: 'warning',
      message: `章节仍有未解析引用：${reference}`,
      batchId: batch.id,
    }));
  });

  dependencies.onStage?.('normalizing');
  const normalized = normalizeCandidates(courseId, resolvedTopics);
  let reviewResult: Awaited<ReturnType<typeof reviewCurriculum>> = {
    operations: [], constraints: [], warnings: [],
  };
  dependencies.onStage?.('reviewing');
  if (normalized.topics.length > 0) {
    try {
      reviewResult = await (dependencies.review ?? reviewCurriculum)(config, normalized.topics, evidenceById);
    } catch {
      issues.push({
        code: 'CURRICULUM_REVIEW_FAILED',
        severity: 'warning',
        message: '课程级审查失败，已使用确定性结果继续编译',
      });
    }
  }
  issues.push(...reviewResult.warnings);
  const reviewed = applyCurriculumOperations(normalized.topics, reviewResult.operations);
  const mapTopicId = (id: string | undefined): string => id ? reviewed.topicRemap.get(id) ?? id : '';

  const topics = reviewed.topics;
  const topicById = new Map(topics.map(topic => [topic.id, topic]));
  const teachingUnits = dedupeTeachingUnits(resolvedUnits.flatMap(({ draft, evidenceIds }) => {
    const initialTopicId = normalized.localTopicToCanonicalId.get(draft.topicLocalId);
    const topicId = mapTopicId(initialTopicId);
    const topic = topicById.get(topicId);
    if (!topic) return [];
    const stableKey = teachingUnitStableKey(topic.stableKey, draft.role, evidenceIds[0] ?? `unit:${draft.localId}`);
    return [{
      id: stableKey,
      stableKey,
      topicId,
      role: draft.role,
      title: draft.title,
      summary: draft.summary,
      evidenceIds,
      required: draft.required,
      confidence: draft.confidence,
      status: evidenceIds.length > 0 ? 'verified' as const : 'draft' as const,
    }];
  }));

  const claimConstraints: OrderConstraint[] = resolvedClaims.flatMap(claim => {
    const beforeTopicId = mapTopicId(normalized.localTopicToCanonicalId.get(claim.beforeTopicLocalId));
    const afterTopicId = mapTopicId(normalized.localTopicToCanonicalId.get(claim.afterTopicLocalId));
    if (!topicById.has(beforeTopicId) || !topicById.has(afterTopicId) || beforeTopicId === afterTopicId) return [];
    const strength = claim.source === 'inferred' ? 'soft' : claim.strength;
    return [{
      id: constraintStableKey(beforeTopicId, afterTopicId, strength),
      beforeTopicId,
      afterTopicId,
      strength,
      reason: claim.reason,
      evidenceIds: claim.evidenceIds,
      source: claim.source,
      confidence: claim.confidence,
    }];
  });
  const reviewConstraints = reviewResult.constraints.flatMap(constraint => {
    const beforeTopicId = mapTopicId(constraint.beforeTopicId);
    const afterTopicId = mapTopicId(constraint.afterTopicId);
    if (!topicById.has(beforeTopicId) || !topicById.has(afterTopicId) || beforeTopicId === afterTopicId) return [];
    return [{ ...constraint, beforeTopicId, afterTopicId }];
  });
  const orderConstraints = dedupeConstraints([...claimConstraints, ...reviewConstraints]);

  dependencies.onStage?.('scheduling');
  const sectionOrderById = new Map<string, number>();
  batches.forEach((batch, batchIndex) => batch.sectionIds.forEach(sectionId => {
    if (!sectionOrderById.has(sectionId)) sectionOrderById.set(sectionId, batchIndex);
  }));
  const sourceOrderByEvidenceId = new Map<string, number>();
  const documentOrder = new Map(documents.map((document, index) => [document.id, index]));
  const allBlocks = documents.flatMap(document => document.blocks);
  const blockById = new Map(allBlocks.map(block => [block.id, block]));
  evidenceById.forEach(evidence => {
    const block = blockById.get(evidence.blockId);
    const order = (documentOrder.get(evidence.documentId) ?? 0) * 1_000_000_000
      + (block?.orderIndex ?? 0) * 1_000_000
      + evidence.startOffset;
    sourceOrderByEvidenceId.set(evidence.id, order);
  });
  const schedule = compileCourseOrder(topics, orderConstraints, sectionOrderById);
  const teachingPaths: Record<string, string[]> = {};
  topics.forEach(topic => {
    teachingPaths[topic.id] = compileTeachingPath(
      topic.genre,
      teachingUnits.filter(unit => unit.topicId === topic.id),
      sourceOrderByEvidenceId,
    );
  });

  dependencies.onStage?.('validating');
  const meaningfulBlockIds = allBlocks
    .filter(block => block.type !== 'heading' && block.content.trim().length > 0)
    .map(block => block.id);
  const validated = validateCourseStructure({
    topics,
    teachingUnits,
    evidenceSpans: [...evidenceById.values()],
    orderedTopicIds: schedule.orderedTopicIds,
    orderConstraints,
    schedulerIssues: [...issues, ...schedule.issues],
    // 失败已作为包含真实原因的 scheduler issue 注入，避免再生成一条泛化重复错误。
    failedBatchIds: [],
    meaningfulBlockIds,
  });
  const sourceChanged = !previous || batches.some(batch => !previousByCacheKey.has(effectiveCacheKey(batch, config)))
    || previous.checkpoints.length !== batches.length;
  const base = {
    topics,
    teachingUnits,
    evidenceSpans: [...evidenceById.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
    orderConstraints,
    orderedTopicIds: schedule.orderedTopicIds,
    teachingPaths,
  };
  const structureChanged = !previous || canonicalSignature(base) !== canonicalSignature(previous);

  return preserveCorrectedObjects(previous, {
    courseId,
    sourceVersion: previous ? previous.sourceVersion + (sourceChanged ? 1 : 0) : 1,
    structureVersion: previous ? previous.structureVersion + (structureChanged ? 1 : 0) : 1,
    compilerVersion: 'course-structure-v1',
    ...base,
    status: validated.status,
    validation: validated.validation,
    checkpoints,
  });
}
