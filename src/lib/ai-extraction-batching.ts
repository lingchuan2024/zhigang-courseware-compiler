import { EvidenceAtom, CourseTopic, MacroKnowledgeRelation, ModelConfig, StructureExtractionStatus, TopicQualityReport, TopicCandidate } from '../types';
import { extractRelations, extractTopicCandidates, judgeTopicGranularity, repairTopicsTargeted, type TopicExtractionResult } from './model-v2';
import { validateTopicExtraction, type ValidationResult } from './topic-extraction-validation';
import { checkTopicQuality, buildQualityRepairFeedback } from './topic-quality';
import { topologicalSort, applyRecommendedOrder } from './knowledge-graph';
import { generateId } from './utils';
import { ExtractionError, type ExtractionStage } from './extraction-errors';

// ========== 页面窗口配置 ==========

const MAX_PAGES_PER_WINDOW = 6;       // 每个窗口最多页数
const MIN_PAGES_PER_WINDOW = 4;       // 每个窗口最少页数
const MAX_EVIDENCES_PER_WINDOW = 40;   // 每个窗口最多证据数
const MAX_CHARS_PER_WINDOW = 16000;    // 每个窗口最多字符数
const PAGE_OVERLAP = 1;                // 窗口间重叠页数
const MAX_CONCURRENT_WINDOWS = 2;      // 同时最多执行窗口请求数
const WINDOW_RETRY_COUNT = 2;          // 单窗口失败重试次数
const LOCAL_MERGE_BATCH_SIZE = 25;     // 局部合并每批最多候选数
const TARGETED_REPAIR_MAX_EVIDENCES = 40;  // 定向修复最多证据数
const TARGETED_REPAIR_MAX_CHARS = 12000;   // 定向修复最多字符数

// ========== 窗口切分（按页） ==========

export interface EvidenceWindow {
  evidences: EvidenceAtom[];
  windowIndex: number;
  startPage: number;
  endPage: number;
}

/**
 * 将证据按连续页切分成小窗口。
 * - 每个窗口 4~6 页
 * - 最大 40 条 Evidence
 * - 最大 16000 字符
 * - 与下一个窗口重叠 1 页
 */
export function splitEvidencesIntoWindows(
  evidences: EvidenceAtom[]
): EvidenceWindow[] {
  if (evidences.length === 0) return [];

  // 按页码分组
  const pageMap = new Map<number, EvidenceAtom[]>();
  for (const ev of evidences) {
    const page = ev.pageNumber;
    if (!pageMap.has(page)) pageMap.set(page, []);
    pageMap.get(page)!.push(ev);
  }

  const sortedPages = [...pageMap.keys()].sort((a, b) => a - b);
  if (sortedPages.length === 0) return [];

  const windows: EvidenceWindow[] = [];
  let pageIdx = 0;
  let windowIndex = 0;

  while (pageIdx < sortedPages.length) {
    const windowEvidences: EvidenceAtom[] = [];
    let charCount = 0;
    let pagesInWindow = 0;
    const startPage = sortedPages[pageIdx];

    for (let i = pageIdx; i < sortedPages.length; i++) {
      const page = sortedPages[i];
      const pageEvidences = pageMap.get(page)!;

      // 检查是否超出窗口限制
      if (pagesInWindow >= MAX_PAGES_PER_WINDOW) break;
      if (windowEvidences.length + pageEvidences.length > MAX_EVIDENCES_PER_WINDOW) break;

      const pageChars = pageEvidences.reduce((sum, ev) => sum + ev.content.length, 0);
      if (charCount + pageChars > MAX_CHARS_PER_WINDOW && pagesInWindow >= MIN_PAGES_PER_WINDOW) break;

      windowEvidences.push(...pageEvidences);
      charCount += pageChars;
      pagesInWindow++;

      // 如果已达最小页数且字符数接近上限，停止
      if (pagesInWindow >= MIN_PAGES_PER_WINDOW && charCount >= MAX_CHARS_PER_WINDOW * 0.8) break;
    }

    if (windowEvidences.length === 0) {
      // 单页就超限，强制加入第一页
      windowEvidences.push(...pageMap.get(startPage)!);
      pagesInWindow = 1;
    }

    const endPage = sortedPages[Math.min(pageIdx + pagesInWindow - 1, sortedPages.length - 1)];

    windows.push({
      evidences: windowEvidences,
      windowIndex,
      startPage,
      endPage,
    });

    windowIndex++;

    // 如果所有页都已覆盖，停止
    if (pageIdx + pagesInWindow >= sortedPages.length) break;

    // 下一窗口起始位置（考虑重叠）
    const nextStart = pageIdx + pagesInWindow - PAGE_OVERLAP;
    if (nextStart <= pageIdx) {
      pageIdx = pageIdx + pagesInWindow; // 防止无限循环
    } else {
      pageIdx = nextStart;
    }
  }

  return windows;
}

// ========== 兼容旧接口 ==========

/** @deprecated 使用 splitEvidencesIntoWindows 替代 */
export function shouldBatch(_evidences: EvidenceAtom[]): boolean {
  return true; // 始终使用窗口提取
}

// ========== 并发控制 ==========

/**
 * 简单的并发控制器 — 最多同时执行 maxConcurrent 个异步任务。
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const runners = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

// ========== Map: 窗口级候选知识点提取（带重试） ==========

interface WindowCandidateResult {
  windowIndex: number;
  candidates: TopicCandidate[];
  warnings: string[];
  error: ExtractionError | null;
  succeeded: boolean;
}

async function extractCandidatesFromWindowWithRetry(
  config: ModelConfig,
  window: EvidenceWindow,
): Promise<WindowCandidateResult> {
  let lastError: ExtractionError | null = null;

  for (let attempt = 0; attempt <= WINDOW_RETRY_COUNT; attempt++) {
    try {
      const result = await extractTopicCandidates(config, window.evidences);
      return {
        windowIndex: window.windowIndex,
        candidates: result.candidates,
        warnings: result.warnings,
        error: null,
        succeeded: true,
      };
    } catch (e) {
      if (e instanceof ExtractionError) {
        lastError = e;
        // 限流时等待更久
        if (e.code === 'api-rate-limit' && attempt < WINDOW_RETRY_COUNT) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
      } else {
        lastError = new ExtractionError(
          'unknown',
          'candidate-extraction',
          e instanceof Error ? e.message : String(e),
          { windowIndex: window.windowIndex, cause: e },
        );
      }

      if (attempt < WINDOW_RETRY_COUNT) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  return {
    windowIndex: window.windowIndex,
    candidates: [],
    warnings: [],
    error: lastError,
    succeeded: false,
  };
}

// ========== 两级合并 ==========

/**
 * 将 CourseTopic[] 转回 TopicCandidate[] 以便再次合并。
 */
function topicsToCandidates(topics: CourseTopic[], prefix: string): TopicCandidate[] {
  return topics.map((t, i) => ({
    temporaryId: `${prefix}_t${i + 1}`,
    title: t.title,
    aliases: [],
    learningObjective: t.learningGoal,
    evidenceIds: t.evidenceIds,
    prerequisiteHints: [],
    internalItemHints: [],
    confidence: 0.8,
  }));
}

/**
 * 全局合并不可用时，将已经由 AI 提取的窗口候选保留为可审核知识点。
 * 这里只做精确标题去重和真实 Evidence ID 校验，不做本地语义提取，
 * 因此不会生成“课程内容”一类泛化节点。
 */
function candidatesToReviewableTopics(
  candidates: TopicCandidate[],
  evidences: EvidenceAtom[],
): CourseTopic[] {
  const evidenceById = new Map(evidences.map(evidence => [evidence.id, evidence]));
  const grouped = new Map<string, TopicCandidate>();

  for (const candidate of candidates) {
    const key = candidate.title.trim().toLocaleLowerCase();
    if (!key) continue;
    const evidenceIds = candidate.evidenceIds.filter(id => evidenceById.has(id));
    if (evidenceIds.length === 0) continue;

    const existing = grouped.get(key);
    if (existing) {
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...evidenceIds])];
      existing.aliases = [...new Set([...existing.aliases, ...candidate.aliases])];
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
    } else {
      grouped.set(key, { ...candidate, evidenceIds: [...new Set(evidenceIds)] });
    }
  }

  return [...grouped.values()].map((candidate, index) => {
    const pageNumbers = [...new Set(candidate.evidenceIds
      .map(id => evidenceById.get(id)?.pageNumber)
      .filter((page): page is number => page !== undefined))]
      .sort((left, right) => left - right);

    return {
      id: generateId('topic'),
      title: candidate.title.trim(),
      aliases: candidate.aliases,
      type: 'concept' as const,
      evidenceIds: candidate.evidenceIds,
      originalPageNumbers: pageNumbers,
      learningGoal: candidate.learningObjective,
      importance: 'core' as const,
      confidence: candidate.confidence,
      originalOrder: index,
      recommendedOrder: index,
      noteStatus: 'pending' as const,
    };
  });
}

/**
 * 两级合并：
 * 1. 候选超过 LOCAL_MERGE_BATCH_SIZE 时，分批局部合并
 * 2. 局部合并的结果再做一次全局合并
 * 3. 候选不多时直接全局合并
 */
async function twoLevelMerge(
  config: ModelConfig,
  allCandidates: TopicCandidate[],
  allEvidences: EvidenceAtom[],
): Promise<TopicExtractionResult> {
  // 候选不多 → 直接全局合并
  if (allCandidates.length <= LOCAL_MERGE_BATCH_SIZE) {
    return await judgeTopicGranularity(config, allCandidates, allEvidences);
  }

  // 分批局部合并
  const batches: TopicCandidate[][] = [];
  for (let i = 0; i < allCandidates.length; i += LOCAL_MERGE_BATCH_SIZE) {
    batches.push(allCandidates.slice(i, i + LOCAL_MERGE_BATCH_SIZE));
  }

  const localResults: CourseTopic[][] = [];
  for (let i = 0; i < batches.length; i++) {
    try {
      const localResult = await judgeTopicGranularity(
        config,
        batches[i],
        allEvidences,
      );
      localResults.push(localResult.topics);
    } catch (e) {
      if (e instanceof ExtractionError) {
        // 局部合并失败 — 保留原始候选，不中断
        localResults.push(
          batches[i].map((c, idx) => ({
            id: generateId('topic'),
            title: c.title,
            aliases: c.aliases,
            type: 'concept' as const,
            evidenceIds: c.evidenceIds,
            originalPageNumbers: [],
            learningGoal: c.learningObjective,
            importance: 'core' as const,
            confidence: c.confidence,
            originalOrder: i * LOCAL_MERGE_BATCH_SIZE + idx,
            recommendedOrder: i * LOCAL_MERGE_BATCH_SIZE + idx,
            noteStatus: 'pending' as const,
          }))
        );
      } else {
        throw e;
      }
    }
  }

  // 将局部合并结果转回候选，做全局合并
  const mergedCandidates: TopicCandidate[] = [];
  for (let i = 0; i < localResults.length; i++) {
    mergedCandidates.push(...topicsToCandidates(localResults[i], `m${i}`));
  }

  return await judgeTopicGranularity(config, mergedCandidates, allEvidences);
}

// ========== 定向修复 ==========

/**
 * 收集问题知识点相关的证据：
 * - 问题知识点已引用的证据
 * - 与问题知识点页码相邻的未覆盖证据
 * 最多 TARGETED_REPAIR_MAX_EVIDENCES 条、TARGETED_REPAIR_MAX_CHARS 字符。
 */
function collectTargetedEvidences(
  problematicTopics: CourseTopic[],
  allEvidences: EvidenceAtom[],
): EvidenceAtom[] {
  const topicEvidenceIds = new Set<string>();
  const topicPages = new Set<number>();

  for (const topic of problematicTopics) {
    for (const evId of topic.evidenceIds) {
      topicEvidenceIds.add(evId);
    }
  }

  // 收集问题知识点涉及页码
  for (const topic of problematicTopics) {
    for (const ev of allEvidences) {
      if (topic.evidenceIds.includes(ev.id)) {
        topicPages.add(ev.pageNumber);
      }
    }
  }

  // 扩展到相邻页
  const adjacentPages = new Set<number>();
  for (const page of topicPages) {
    adjacentPages.add(page);
    adjacentPages.add(page - 1);
    adjacentPages.add(page + 1);
  }

  // 收集证据：先收集直接引用的，再收集相邻页的
  const directEvidences = allEvidences.filter(ev => topicEvidenceIds.has(ev.id));
  const adjacentEvidences = allEvidences.filter(
    ev => !topicEvidenceIds.has(ev.id) && adjacentPages.has(ev.pageNumber)
  );

  const result: EvidenceAtom[] = [...directEvidences];
  let charCount = result.reduce((sum, ev) => sum + ev.content.length, 0);

  for (const ev of adjacentEvidences) {
    if (result.length >= TARGETED_REPAIR_MAX_EVIDENCES) break;
    if (charCount + ev.content.length > TARGETED_REPAIR_MAX_CHARS) break;
    result.push(ev);
    charCount += ev.content.length;
  }

  return result;
}

/**
 * 定向修复：只发送有问题的知识点和它们的证据。
 * 修复后局部替换对应知识点。
 */
async function runTargetedRepair(
  config: ModelConfig,
  allTopics: CourseTopic[],
  allEvidences: EvidenceAtom[],
  problematicTopics: CourseTopic[],
  qualityFeedback: string,
): Promise<CourseTopic[]> {
  const targetEvidences = collectTargetedEvidences(problematicTopics, allEvidences);

  const repairResult = await repairTopicsTargeted(
    config,
    targetEvidences,
    problematicTopics,
    qualityFeedback,
  );

  if (!repairResult.usedModel || repairResult.topics.length === 0) {
    return allTopics; // 修复失败，保留原结果
  }

  // 局部替换：用修复后的知识点替换原来有问题的知识点
  const repairedTitles = new Set(repairResult.topics.map(t => t.title));
  const repairedById = new Map(repairResult.topics.map(t => [t.title, t]));

  const merged: CourseTopic[] = [];
  let nextOrder = 0;

  for (const topic of allTopics) {
    if (repairedTitles.has(topic.title)) {
      const repaired = repairedById.get(topic.title)!;
      merged.push({
        ...repaired,
        id: topic.id, // 保持 ID 不变
        originalOrder: nextOrder++,
        noteStatus: topic.noteStatus,
      });
    } else {
      merged.push({
        ...topic,
        originalOrder: nextOrder++,
      });
    }
  }

  // 添加新增的知识点（修复后可能产生新知识点）
  for (const repaired of repairResult.topics) {
    if (!allTopics.some(t => t.title === repaired.title)) {
      merged.push({
        ...repaired,
        originalOrder: nextOrder++,
      });
    }
  }

  return merged;
}

// ========== 检查点 ==========

export interface ExtractionCheckpoint {
  lastCompletedStage: ExtractionStage | null;
  candidates?: TopicCandidate[];
  mergedTopics?: CourseTopic[];
  qualityReport?: TopicQualityReport;
  repairedTopics?: CourseTopic[];
  windowCount?: number;
  successfulWindowCount?: number;
}

// ========== 主入口 ==========

export interface BatchExtractionOptions {
  onStatusChange?: (status: StructureExtractionStatus) => void;
  onWindowProgress?: (current: number, total: number) => void;
  onQualityReport?: (report: TopicQualityReport, round: number) => void;
  /** 课件总页数（用于质量检测） */
  totalPages?: number;
  /** 从检查点恢复 */
  checkpoint?: ExtractionCheckpoint;
}

export interface BatchExtractionResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  source: 'ai' | 'ai-fallback' | 'failed';
  status: StructureExtractionStatus;
  errors: string[];
  windowCount: number;
  validation: ValidationResult | null;
  qualityReport: TopicQualityReport | null;
  /** 检查点数据，用于从失败阶段恢复 */
  checkpoint: ExtractionCheckpoint;
  /** 失败时的详细阶段信息 */
  failedStage?: string;
  failedWindowIndex?: number;
}

/**
 * 统一的小窗口 Map-Reduce 知识点提取。
 *
 * 所有课件统一分窗口提取，不再以 100 条 Evidence 为门槛。
 *
 * 流程：
 * 1. 准备 Evidence → 按连续页切成小窗口
 * 2. 分窗口候选提取（max 2 并发，单窗口失败重试）
 * 3. 两级合并（局部合并 → 全局合并）
 * 4. 本地质量检查（不调用 AI）
 * 5. 定向修复（只修复问题知识点，不重发整份课件）
 * 6. 关系提取
 */
export async function extractTopicsWithBatching(
  config: ModelConfig | null,
  evidences: EvidenceAtom[],
  options: BatchExtractionOptions = {}
): Promise<BatchExtractionResult> {
  const emptyCheckpoint: ExtractionCheckpoint = { lastCompletedStage: null };

  if (!config?.apiKey) {
    return {
      topics: [],
      relations: [],
      warnings: ['未配置AI模型，无法提取知识点。'],
      source: 'failed',
      status: 'model-required',
      errors: ['未配置AI模型'],
      windowCount: 0,
      validation: null,
      qualityReport: null,
      checkpoint: emptyCheckpoint,
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const totalPages = options.totalPages || 0;
  const checkpoint: ExtractionCheckpoint = options.checkpoint
    ? { ...options.checkpoint }
    : { lastCompletedStage: null };

  // ========== 阶段 1: 准备 + 窗口切分 ==========

  const windows = splitEvidencesIntoWindows(evidences);
  warnings.push(`课件已分为 ${windows.length} 个窗口进行提取（每窗口 ${MIN_PAGES_PER_WINDOW}~${MAX_PAGES_PER_WINDOW} 页，重叠 ${PAGE_OVERLAP} 页）`);

  // ========== 阶段 2: 分窗口候选提取 ==========

  let allCandidates: TopicCandidate[];

  if (checkpoint.lastCompletedStage === 'candidate-extraction' && checkpoint.candidates) {
    // 从检查点恢复
    allCandidates = checkpoint.candidates;
    warnings.push('从检查点恢复：跳过候选提取阶段');
  } else {
    options.onStatusChange?.('extracting-topics');

    const windowResults = await runWithConcurrency(
      windows.map(w => () => extractCandidatesFromWindowWithRetry(config, w)),
      MAX_CONCURRENT_WINDOWS,
    );

    // 报告窗口进度
    options.onWindowProgress?.(windowResults.length, windows.length);

    // 处理结果
    const successfulWindows = windowResults.filter(wr => wr.succeeded);
    const failedWindows = windowResults.filter(wr => !wr.succeeded);

    for (const wr of failedWindows) {
      const errorMsg = wr.error?.toUserMessage() || `窗口 ${wr.windowIndex + 1} 提取失败`;
      errors.push(errorMsg);
    }

    for (const wr of windowResults) {
      if (wr.warnings.length > 0) {
        warnings.push(...wr.warnings.map(w => `窗口${wr.windowIndex + 1}: ${w}`));
      }
    }

    // 70% 成功率才继续
    const successRate = windows.length > 0 ? successfulWindows.length / windows.length : 0;
    if (successRate < 0.7) {
      const failedWindow = failedWindows[0];
      return {
        topics: [],
        relations: [],
        warnings,
        source: 'failed',
        status: 'failed',
        errors: [...errors, `窗口成功率 ${Math.round(successRate * 100)}% 低于 70%，无法继续`],
        windowCount: windows.length,
        validation: null,
        qualityReport: null,
        checkpoint,
        failedStage: 'candidate-extraction',
        failedWindowIndex: failedWindow?.windowIndex,
      };
    }

    if (failedWindows.length > 0) {
      warnings.push(`${failedWindows.length} 个窗口提取失败，已跳过（成功率 ${Math.round(successRate * 100)}%）`);
    }

    // 收集所有候选知识点
    allCandidates = [];
    for (const wr of successfulWindows) {
      for (const c of wr.candidates) {
        allCandidates.push({
          ...c,
          temporaryId: `w${wr.windowIndex}_${c.temporaryId}`,
        });
      }
    }

    if (allCandidates.length === 0) {
      return {
        topics: [],
        relations: [],
        warnings,
        source: 'failed',
        status: 'failed',
        errors: [...errors, '所有窗口候选提取均为空'],
        windowCount: windows.length,
        validation: null,
        qualityReport: null,
        checkpoint,
        failedStage: 'candidate-extraction',
      };
    }

    warnings.push(`候选提取阶段共获得 ${allCandidates.length} 个候选知识点`);

    // 保存检查点
    checkpoint.candidates = allCandidates;
    checkpoint.windowCount = windows.length;
    checkpoint.successfulWindowCount = successfulWindows.length;
    checkpoint.lastCompletedStage = 'candidate-extraction';
  }

  // ========== 阶段 3: 两级合并 ==========

  let mergedTopics: CourseTopic[];
  let mergeFallbackUsed = false;
  const stageAfterExtraction: string | null = String(checkpoint.lastCompletedStage ?? '');

  if (stageAfterExtraction === 'global-merge' && checkpoint.mergedTopics) {
    mergedTopics = checkpoint.mergedTopics;
    warnings.push('从检查点恢复：跳过合并阶段');
  } else {
    options.onStatusChange?.('repairing-topics');

    try {
      const mergedResult = await twoLevelMerge(config, allCandidates, evidences);

      if (mergedResult.topics.length === 0) {
        throw new ExtractionError(
          'model-returned-empty',
          'global-merge',
          '合并后知识点为空',
        );
      }

      mergedTopics = mergedResult.topics;
      warnings.push(...mergedResult.warnings);
      warnings.push(`合并后得到 ${mergedTopics.length} 个知识点`);

      checkpoint.mergedTopics = mergedTopics;
      checkpoint.lastCompletedStage = 'global-merge';
    } catch (e) {
      const extractionError = e instanceof ExtractionError
        ? e
        : new ExtractionError('unknown', 'global-merge', e instanceof Error ? e.message : String(e));

      mergedTopics = candidatesToReviewableTopics(allCandidates, evidences);
      if (mergedTopics.length === 0) {
        errors.push(extractionError.toUserMessage());
        return {
          topics: [],
          relations: [],
          warnings,
          source: 'failed',
          status: 'failed',
          errors: [...errors, '全局合并失败，且没有可保留的窗口候选'],
          windowCount: windows.length,
          validation: null,
          qualityReport: null,
          checkpoint,
          failedStage: 'global-merge',
        };
      }

      mergeFallbackUsed = true;
      warnings.push(`${extractionError.toUserMessage()}；已保留窗口候选进入质量检查`);
      checkpoint.mergedTopics = mergedTopics;
      checkpoint.lastCompletedStage = 'global-merge';
    }
  }

  // ========== 阶段 4: 本地质量检查 ==========

  let validation = validateTopicExtraction({ topics: mergedTopics } as TopicExtractionResult, evidences);
  let qualityReport = checkTopicQuality(mergedTopics, evidences, { totalPages });
  options.onQualityReport?.(qualityReport, 1);
  warnings.push(...validation.warnings.map(w => w.message));

  checkpoint.qualityReport = qualityReport;
  checkpoint.lastCompletedStage = 'quality-check';

  // ========== 阶段 5: 定向修复 ==========

  if (validation.errors.length > 0 || qualityReport.needsRepair) {
    const stageAfterQualityCheck: string | null = String(checkpoint.lastCompletedStage ?? '');
    if (stageAfterQualityCheck === 'targeted-repair' && checkpoint.repairedTopics) {
      mergedTopics = checkpoint.repairedTopics;
      warnings.push('从检查点恢复：跳过修复阶段');
    } else {
      options.onStatusChange?.('quality-repairing');

      // 识别有问题的知识点
      const problematicTopicIds = new Set<string>();
      for (const issue of qualityReport.issues) {
        if (issue.topicId) problematicTopicIds.add(issue.topicId);
      }

      const problematicTopics = mergedTopics.filter(t => problematicTopicIds.has(t.id));

      // 如果没有特定问题知识点，修复全部
      const topicsToRepair = problematicTopics.length > 0 ? problematicTopics : mergedTopics;

      const qualityFeedback = buildQualityRepairFeedback(mergedTopics, evidences, qualityReport);
      const fullFeedback = validation.repairFeedback
        ? `${validation.repairFeedback}\n\n${qualityFeedback}`
        : qualityFeedback;

      try {
        const repairedTopics = await runTargetedRepair(
          config,
          mergedTopics,
          evidences,
          topicsToRepair,
          fullFeedback,
        );

        if (repairedTopics !== mergedTopics) {
          mergedTopics = repairedTopics;
          validation = validateTopicExtraction({ topics: mergedTopics } as TopicExtractionResult, evidences);
          qualityReport = checkTopicQuality(mergedTopics, evidences, { totalPages });
          options.onQualityReport?.(qualityReport, 2);
          warnings.push(`定向修复后得到 ${mergedTopics.length} 个知识点`);
        }
      } catch (e) {
        const errorMsg = e instanceof ExtractionError
          ? e.toUserMessage()
          : e instanceof Error ? e.message : String(e);
        errors.push(`定向修复失败: ${errorMsg}`);
        // 修复失败不中断 — 保留合并后的可审核草稿
        warnings.push('定向修复失败，已保留合并后的草稿');
      }
    }
  }

  checkpoint.repairedTopics = mergedTopics;
  checkpoint.lastCompletedStage = 'targeted-repair';

  // 检查最终质量
  if (validation.errors.length > 0 || qualityReport.needsRepair) {
    errors.push('质量修复后仍存在质量问题，进入失败状态。不会降级为泛化节点。');
    return {
      topics: [],
      relations: [],
      warnings,
      source: 'failed',
      status: 'failed',
      errors,
      windowCount: windows.length,
      validation,
      qualityReport,
      checkpoint,
      failedStage: 'targeted-repair',
    };
  }

  // ========== 阶段 6: 关系提取 ==========

  options.onStatusChange?.('extracting-relations');
  let relations: MacroKnowledgeRelation[] = [];
  let relationSource: 'ai' | 'ai-fallback' = 'ai-fallback';

  try {
    const { relations: aiRelations, usedModel } = await extractRelations(
      config, mergedTopics, evidences
    );
    if (usedModel) {
      relations = aiRelations;
      relationSource = 'ai';
    } else {
      relations = generateBasicRelations(mergedTopics);
      warnings.push('AI关系提取未使用模型，已生成基础连续关系');
    }
  } catch (e) {
    relations = generateBasicRelations(mergedTopics);
    const errorMsg = e instanceof ExtractionError
      ? e.toUserMessage()
      : e instanceof Error ? e.message : String(e);
    warnings.push(`AI关系提取失败（${errorMsg}），已回退到基础连续关系`);
  }

  // 拓扑排序
  const topoResult = topologicalSort(mergedTopics, relations);
  const orderedTopics = applyRecommendedOrder(mergedTopics, topoResult);
  warnings.push(...topoResult.warnings);

  checkpoint.lastCompletedStage = 'relation-extraction';

  return {
    topics: orderedTopics,
    relations,
    warnings,
    source: mergeFallbackUsed ? 'ai-fallback' : relationSource,
    status: 'ready',
    errors,
    windowCount: windows.length,
    validation,
    qualityReport,
    checkpoint,
  };
}

/**
 * 生成基础连续关系。
 */
function generateBasicRelations(topics: CourseTopic[]): MacroKnowledgeRelation[] {
  const relations: MacroKnowledgeRelation[] = [];
  const sorted = [...topics].sort((a, b) => a.originalOrder - b.originalOrder);
  for (let i = 0; i < sorted.length - 1; i++) {
    relations.push({
      id: generateId('rel'),
      sourceTopicId: sorted[i].id,
      targetTopicId: sorted[i + 1].id,
      type: 'recommended_before' as const,
      evidenceIds: [],
      reason: '课件连续',
      confidence: 0.5,
      origin: 'ai-inferred' as const,
    });
  }
  return relations;
}
