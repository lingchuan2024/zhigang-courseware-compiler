import type { MarkdownBlock, ModelConfig, SourceDocument } from '../../types';
import { ExtractionError } from '../extraction-errors';
import { normalizeCandidates, type ResolvedTopicDraft } from './candidate-normalizer';
import { compileCourseOrder } from './course-scheduler';
import { reviewCurriculum } from './curriculum-review';
import { resolveEvidenceSpan } from './evidence-span';
import { preserveCorrectedObjects } from './incremental-reconcile';
import { buildSectionBatches, type SectionBatch } from './section-batching';
import { compileSectionBatch } from './section-compiler';
import { constraintStableKey, normalizeStableText, teachingUnitStableKey } from './stable-identity';
import { compileTeachingPath } from './teaching-path-compiler';
import type {
  CourseLearningStructure,
  CourseExtractionProgress,
  CourseExtractionUnitCheckpoint,
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
  compileBatch?: (batch: SectionBatch, timeoutMs?: number) => Promise<SectionCompilation>;
  review?: typeof reviewCurriculum;
  previous?: CourseLearningStructure | null;
  onBatchProgress?: (current: number, total: number) => void;
  onUnitCheckpoint?: (checkpoint: CourseExtractionUnitCheckpoint) => void;
  onExtractionProgress?: (progress: CourseExtractionProgress) => void;
  resumeCheckpoints?: CourseExtractionUnitCheckpoint[];
  /** 覆盖当前模型配置对应的前台语义识别启动预算。 */
  foregroundBudgetMs?: number;
  totalBudgetMs?: number;
  concurrency?: number;
  now?: () => number;
  onStage?: (stage: 'batching' | 'compiling' | 'normalizing' | 'reviewing' | 'scheduling' | 'validating') => void;
}

interface ResolvedUnitDraft {
  draft: TeachingUnitDraft;
  evidenceIds: string[];
  batchId: string;
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

interface CompilerRuntimeProfile {
  batchTokens: number;
  atomTokens: number;
  concurrency: number;
  foregroundBudgetMs: number;
  totalBudgetMs: number;
}

function runtimeProfile(config: ModelConfig): CompilerRuntimeProfile {
  if (config.apiMode === 'responses') {
    return {
      // Agent Plan 的 GLM 有固定推理开销。继续使用 1000-token 小请求会让
      // 推理开销和排队时间被重复支付；3000 仍保持输入有界，同时把典型
      // 课件的请求数量压缩到原来的约三分之一。
      batchTokens: 3000,
      atomTokens: 1000,
      // Agent Plan 同一 Token 的第三路并发容易排队到客户端截止时间。
      concurrency: 2,
      // 单请求允许 120 秒，因此全局调度不能在 60/90 秒提前中止它。
      foregroundBudgetMs: 120_000,
      totalBudgetMs: 150_000,
    };
  }
  return {
    batchTokens: 1000,
    atomTokens: 1000,
    concurrency: 3,
    foregroundBudgetMs: 60_000,
    totalBudgetMs: 90_000,
  };
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
  return [batch.cacheKey, config.apiMode ?? 'chat-completions', config.endpoint, config.model].join('|');
}

function unionInOrder(...groups: string[][]): string[] {
  const seen = new Set<string>();
  return groups.flatMap(group => group.filter(value => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }));
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
  const bySemanticIdentity = new Map<string, TeachingUnit>();
  units.forEach(unit => {
    const key = `${unit.topicId}:${unit.role}:${normalizeStableText(unit.title)}`;
    const existing = bySemanticIdentity.get(key);
    if (!existing) {
      bySemanticIdentity.set(key, unit);
      return;
    }
    bySemanticIdentity.set(key, {
      ...(existing.confidence >= unit.confidence ? existing : unit),
      evidenceIds: unionInOrder(existing.evidenceIds, unit.evidenceIds),
      required: existing.required || unit.required,
      confidence: Math.max(existing.confidence, unit.confidence),
    });
  });
  return [...bySemanticIdentity.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey));
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
  const profile = runtimeProfile(config);
  // 请求前完成有界分批，不再等超时后递归拆分。Agent Plan 会合并轻量
  // 证据单元，以摊薄推理模型每次请求的固定开销。
  const batches = buildSectionBatches(documents, profile.batchTokens, profile.atomTokens);
  const previous = dependencies.previous ?? null;
  const previousByCacheKey = new Map(
    (previous?.checkpoints ?? []).map(checkpoint => [checkpoint.cacheKey, checkpoint]),
  );
  const resumedByCacheKey = new Map(
    (dependencies.resumeCheckpoints ?? [])
      .filter(checkpoint => checkpoint.status === 'succeeded' && checkpoint.result)
      .map(checkpoint => [checkpoint.cacheKey, checkpoint]),
  );
  const issues: CourseStructureIssue[] = [];
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const foregroundBudgetMs = Math.max(1, dependencies.foregroundBudgetMs ?? profile.foregroundBudgetMs);
  const deadlineAt = startedAt + foregroundBudgetMs;
  const totalDeadlineAt = startedAt + Math.max(
    foregroundBudgetMs,
    dependencies.totalBudgetMs ?? profile.totalBudgetMs,
  );
  const compileBatch = dependencies.compileBatch
    ?? ((batch, timeoutMs) => compileSectionBatch(config, batch, timeoutMs));
  let completedBatches = 0;
  let successfulBatches = 0;
  let failedBatches = 0;
  let discoveredTopicMentions = 0;

  const emitProgress = () => dependencies.onExtractionProgress?.({
    completedUnits: completedBatches,
    successfulUnits: successfulBatches,
    failedUnits: failedBatches,
    totalUnits: batches.length,
    discoveredTopicMentions,
    elapsedMs: Math.max(0, now() - startedAt),
  });

  dependencies.onStage?.('compiling');
  dependencies.onBatchProgress?.(0, batches.length);
  emitProgress();
  const checkpointResults = await mapConcurrent(
    batches,
    Math.max(1, dependencies.concurrency ?? profile.concurrency),
    async batch => {
      const cacheKey = effectiveCacheKey(batch, config);
      const resumed = resumedByCacheKey.get(cacheKey);
      const reusableResult = resumed?.result ?? previousByCacheKey.get(cacheKey)?.result;
      let unitCheckpoint: CourseExtractionUnitCheckpoint;
      let attempted = false;
      try {
        if (!reusableResult && now() >= deadlineAt) {
          throw new ExtractionError('api-timeout', 'section-compile', '已达到前台处理时限，剩余证据单元待下次续跑');
        }
        attempted = !reusableResult;
        const remainingTotalMs = Math.max(1, totalDeadlineAt - now());
        const result = reusableResult ?? await compileBatch(batch, Math.min(120_000, remainingTotalMs));
        successfulBatches += 1;
        discoveredTopicMentions += result.topicMentions.length;
        unitCheckpoint = {
          cacheKey,
          batchId: batch.id,
          sectionIds: batch.sectionIds,
          status: 'succeeded',
          attempts: reusableResult ? 0 : 1,
          result,
          completedAt: now(),
        };
        if (!reusableResult) dependencies.onUnitCheckpoint?.(unitCheckpoint);
        return { cacheKey, batchId: batch.id, sectionIds: batch.sectionIds, result } satisfies SectionCompilationCheckpoint;
      } catch (error) {
        const message = batchFailureMessage(batch, error);
        failedBatches += 1;
        unitCheckpoint = {
          cacheKey,
          batchId: batch.id,
          sectionIds: batch.sectionIds,
          status: 'failed',
          attempts: attempted ? 1 : 0,
          error: message,
          completedAt: now(),
        };
        dependencies.onUnitCheckpoint?.(unitCheckpoint);
        issues.push({
          code: 'FAILED_SECTION_BATCH',
          severity: 'error',
          message,
          batchId: batch.id,
        });
        return null;
      } finally {
        completedBatches += 1;
        dependencies.onBatchProgress?.(completedBatches, batches.length);
        emitProgress();
      }
    },
  );
  const checkpoints = checkpointResults.filter((item): item is SectionCompilationCheckpoint => item !== null);

  const evidenceById = new Map<string, EvidenceSpan>();
  const resolvedTopics: ResolvedTopicDraft[] = [];
  const resolvedUnits: ResolvedUnitDraft[] = [];
  const resolvedClaims: ResolvedClaimDraft[] = [];
  const batchById = new Map(batches.map(batch => [batch.id, batch]));
  const originalBlocksByDocument = new Map(documents.map(document => [
    document.id,
    new Map(document.blocks.map(block => [block.id, block])),
  ]));

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
    const blockById = originalBlocksByDocument.get(batch.documentId) ?? new Map<string, MarkdownBlock>();
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
      batchId: batch.id,
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
    const remainingReviewMs = Math.max(0, totalDeadlineAt - now());
    if (remainingReviewMs === 0) {
      issues.push({
        code: 'CURRICULUM_REVIEW_FAILED',
        severity: 'error',
        message: '已达到总处理时限，跳过课程级审查并使用确定性结果继续编译',
      });
    } else {
      try {
        reviewResult = await (dependencies.review ?? reviewCurriculum)(
          config,
          normalized.topics,
          evidenceById,
          Math.min(120_000, remainingReviewMs),
        );
      } catch {
        issues.push({
          code: 'CURRICULUM_REVIEW_FAILED',
          severity: 'error',
          message: '课程级审查失败，已使用确定性结果继续编译',
        });
      }
    }
  }
  issues.push(...reviewResult.warnings);
  const reviewed = applyCurriculumOperations(normalized.topics, reviewResult.operations);
  const mapTopicId = (id: string | undefined): string => id ? reviewed.topicRemap.get(id) ?? id : '';

  const topics = reviewed.topics;
  const topicById = new Map(topics.map(topic => [topic.id, topic]));
  const unitBatchIds = new Map<string, Set<string>>();
  const unitOrderByStableKey = new Map<string, number>();
  const teachingUnits = dedupeTeachingUnits(resolvedUnits.flatMap(({ draft, evidenceIds, batchId }, unitOrder) => {
    const initialTopicId = normalized.localTopicToCanonicalId.get(draft.topicLocalId);
    const topicId = mapTopicId(initialTopicId);
    const topic = topicById.get(topicId);
    if (!topic) return [];
    const stableKey = teachingUnitStableKey(topic.stableKey, draft.role, evidenceIds[0] ?? `unit:${draft.localId}`);
    const batchIds = unitBatchIds.get(stableKey) ?? new Set<string>();
    batchIds.add(batchId);
    unitBatchIds.set(stableKey, batchIds);
    if (!unitOrderByStableKey.has(stableKey)) unitOrderByStableKey.set(stableKey, unitOrder);
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

  // 模型只负责在每个有界批次内识别两层语义结构；它常常只为一个
  // 教学单元返回一条代表性 anchor。如果直接把“没有 anchor”当成“没有内容”，
  // 同一小节的公式、推导和例子就会在卡片/笔记中永久丢失。因此在语义结构
  // 已确定后，把成功批次里每个尚未被覆盖的原文块确定性地归到最近的
  // 二层教学单元。这一步不创造新知识，只保证已选中课件的原文不被丢弃。
  const attachBlockEvidence = (unit: TeachingUnit, block: MarkdownBlock): void => {
    const resolved = resolveEvidenceSpan({
      blockId: block.id,
      quote: block.content,
      role: unit.role === 'formula' ? 'formula'
        : unit.role === 'condition' ? 'condition'
          : unit.role === 'derivation_step' ? 'derivation'
            : unit.role === 'example' ? 'example'
              : unit.role === 'comparison' ? 'comparison'
                : unit.role === 'application' ? 'application'
                  : unit.role === 'definition' ? 'definition'
                    : 'statement',
      startOffset: 0,
      endOffset: block.content.length,
    }, block);
    if (!resolved.span) return;
    evidenceById.set(resolved.span.id, resolved.span);
    unit.evidenceIds = unionInOrder(unit.evidenceIds, [resolved.span.id]);
    unit.status = 'verified';
  };

  checkpoints.forEach(checkpoint => {
    const batch = batchById.get(checkpoint.batchId);
    if (!batch) return;
    const originalBlocks = originalBlocksByDocument.get(batch.documentId);
    if (!originalBlocks) return;
    const blocks = [...new Set(batch.blocks.map(block => block.id))]
      .map(blockId => originalBlocks.get(blockId))
      .filter((block): block is MarkdownBlock => Boolean(block && block.type !== 'heading' && block.content.trim()));
    const batchUnits = teachingUnits
      .filter(unit => unitBatchIds.get(unit.stableKey)?.has(batch.id))
      .sort((left, right) => (unitOrderByStableKey.get(left.stableKey) ?? 0)
        - (unitOrderByStableKey.get(right.stableKey) ?? 0));
    if (blocks.length === 0 || batchUnits.length === 0) return;

    const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
    const distinctiveTokens = (value: string): Set<string> => {
      const normalizedValue = value.normalize('NFKC').toLocaleLowerCase();
      const tokens = new Set(
        normalizedValue.match(/[a-z][a-z0-9-]{2,}|\d+/gu) ?? [],
      );
      // 课程结构常由中文模型输出，而课件原文多为英文。这里只扩展少量
      // 高辨识度教学术语，不做开放式翻译，仍要求至少两个标记唯一命中。
      const bilingualTerms: Array<[string, string[]]> = [
        ['高斯', ['gaussian']], ['概率', ['probability']], ['密度', ['density', 'pdf']],
        ['核', ['kernel']], ['贝叶斯', ['bayesian']], ['非参数', ['nonparametric']],
        ['线性', ['linear']], ['非线性', ['nonlinear']], ['回归', ['regression']],
        ['梯度', ['gradient']], ['稀疏', ['sparse']], ['正则', ['regularizer', 'regularization']],
        ['似然', ['likelihood']], ['矩阵', ['matrix']], ['特征', ['feature']],
        ['样本', ['sample']], ['对称', ['symmetry']], ['归一化', ['normalization']],
      ];
      bilingualTerms.forEach(([term, translations]) => {
        if (normalizedValue.includes(term)) translations.forEach(token => tokens.add(token));
      });
      return tokens;
    };
    const semanticBlockForUnit = (
      unit: TeachingUnit,
      candidateBlocks: MarkdownBlock[],
    ): MarkdownBlock | undefined => {
      const titleTokens = distinctiveTokens(unit.title);
      const summaryTokens = distinctiveTokens(unit.summary);
      const wanted = new Set([...titleTokens, ...summaryTokens]);
      if (wanted.size === 0) return undefined;
      const scored = candidateBlocks.map(block => {
        const present = distinctiveTokens(block.content);
        const matchedTokens = [...wanted].filter(token => present.has(token));
        const score = matchedTokens.reduce((total, token) => (
          total + (titleTokens.has(token) ? 2 : 0) + (summaryTokens.has(token) ? 1 : 0)
        ), 0);
        return { block, score, matchedTokenCount: matchedTokens.length };
      }).sort((left, right) => right.score - left.score
        || left.block.orderIndex - right.block.orderIndex);
      // 只在至少有两个区分性标记（如 23/25/RBF）且最优块唯一时使用，
      // 避免把普通的“model”、“kernel”等高频词当成可靠定位。
      return scored[0]?.matchedTokenCount >= 2 && scored[0].score > (scored[1]?.score ?? -1)
        ? scored[0].block
        : undefined;
    };

    const anchorIndex = (unit: TeachingUnit, fallback: number): number => {
      for (const evidenceId of unit.evidenceIds) {
        const index = blockIndexById.get(evidenceById.get(evidenceId)?.blockId ?? '');
        if (index !== undefined) return index;
      }
      return fallback;
    };

    // 先按第一层主题划定原文范围，再只在主题内部为第二层单元补证据。
    // 不能直接在整个批次上按 teachingUnits 数组下标插值：模型可能交错返回
    // 不同主题的单元，那会把相邻主题的原文挂到错误单元。
    const topicGroups = [...new Set(batchUnits.map(unit => unit.topicId))].map((topicId, topicIndex) => ({
      topicId,
      topicIndex,
      units: batchUnits.filter(unit => unit.topicId === topicId),
    }));
    const topicAnchorIndices = (topicId: string): number[] => {
      const topicEvidenceIds = topicById.get(topicId)?.evidenceIds ?? [];
      const unitEvidenceIds = batchUnits
        .filter(unit => unit.topicId === topicId)
        .flatMap(unit => unit.evidenceIds);
      return [...new Set([...topicEvidenceIds, ...unitEvidenceIds].flatMap(evidenceId => {
        const index = blockIndexById.get(evidenceById.get(evidenceId)?.blockId ?? '');
        return index === undefined ? [] : [index];
      }))].sort((left, right) => left - right);
    };
    const anchorsByTopicId = new Map(topicGroups.map(group => [
      group.topicId,
      topicAnchorIndices(group.topicId),
    ]));
    const fallbackTopicIndex = (topicIndex: number): number => topicGroups.length === 1
      ? 0
      : Math.round(topicIndex * (blocks.length - 1) / (topicGroups.length - 1));
    const ownerTopicIdByBlockId = new Map(blocks.map((block, blockIndex) => {
      const owner = topicGroups.reduce((best, group) => {
        const anchors = anchorsByTopicId.get(group.topicId) ?? [];
        const distance = anchors.length > 0
          ? Math.min(...anchors.map(index => Math.abs(index - blockIndex)))
          : Math.abs(fallbackTopicIndex(group.topicIndex) - blockIndex);
        return distance < best.distance ? { topicId: group.topicId, distance } : best;
      }, { topicId: topicGroups[0].topicId, distance: Number.POSITIVE_INFINITY });
      return [block.id, owner.topicId] as const;
    }));

    topicGroups.forEach(group => {
      const topicBlocks = blocks.filter(block => ownerTopicIdByBlockId.get(block.id) === group.topicId);
      const candidateBlocks = topicBlocks.length > 0 ? topicBlocks : blocks;

      // 每个无 anchor 的单元先在本主题的原文范围中寻找公式/编号标记，
      // 找不到再按照该主题内部的教学单元顺序插值。
      group.units.forEach((unit, unitIndex) => {
        if (unit.evidenceIds.some(id => {
          const blockId = evidenceById.get(id)?.blockId;
          return blockId !== undefined && blockIndexById.has(blockId);
        })) return;
        const semanticBlock = semanticBlockForUnit(unit, candidateBlocks);
        if (semanticBlock) {
          attachBlockEvidence(unit, semanticBlock);
          return;
        }
        const candidateIndex = group.units.length === 1
          ? 0
          : Math.round(unitIndex * (candidateBlocks.length - 1) / (group.units.length - 1));
        attachBlockEvidence(unit, candidateBlocks[Math.max(0, candidateIndex)]);
      });
    });

    const coveredBlockIds = new Set([...evidenceById.values()].map(item => item.blockId));
    blocks.forEach((block, blockIndex) => {
      if (coveredBlockIds.has(block.id)) return;
      const topicId = ownerTopicIdByBlockId.get(block.id);
      const candidateUnits = batchUnits.filter(unit => unit.topicId === topicId);
      const nearest = candidateUnits.reduce((best, unit, unitIndex) => {
        const distance = Math.abs(anchorIndex(unit, unitIndex) - blockIndex);
        return distance < best.distance ? { unit, distance } : best;
      }, { unit: candidateUnits[0] ?? batchUnits[0], distance: Number.POSITIVE_INFINITY });
      attachBlockEvidence(nearest.unit, block);
      coveredBlockIds.add(block.id);
    });
  });

  topics.forEach(topic => {
    const unitEvidenceIds = teachingUnits
      .filter(unit => unit.topicId === topic.id)
      .flatMap(unit => unit.evidenceIds);
    topic.evidenceIds = unionInOrder(topic.evidenceIds, unitEvidenceIds);
    if (topic.evidenceIds.length > 0 && topic.status === 'draft') topic.status = 'verified';
  });

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
    compilerVersion: 'course-structure-v2-fast',
    ...base,
    status: validated.status,
    validation: validated.validation,
    checkpoints,
  });
}
