/**
 * topic-extraction-v2.ts
 *
 * 基于 Markdown 内容窗口的 AI 候选知识点提取。
 *
 * 核心流程：
 * 1. 将 MarkdownBlock 数组切分为可重叠的内容窗口（splitIntoWindows）
 * 2. 对每个窗口调用 AI 识别候选知识点（extractCandidatesFromWindow）
 * 3. 校验 AI 返回的 blockId，过滤虚构引用（validateBlockIds）
 * 4. 支持并发处理和失败重试（extractCandidatesFromAllWindows）
 *
 * 候选知识点（CandidateTopic）在后续全局合并阶段会转换为
 * 最终的 KnowledgeTopic 和 TopicRelation。
 */

import type {
  ModelConfig,
  MarkdownBlock,
  CandidateTopic,
  ContentWindowAnalysis,
  TopicTransition,
  KnowledgeTopic,
  SourceRange,
  TopicRelation,
} from '../types';
import { callChatCompletion } from './model-v2';
import { type ContentWindow, getWindowText, splitIntoWindows } from './content-window';
import { generateId, sanitizeText } from './utils';
import { ExtractionError } from './extraction-errors';
import type { CompiledPrompt } from './prompt-builder';

// ========== 配置常量 ==========

/** 最大并发窗口数 */
const MAX_CONCURRENT_WINDOWS = 2;

/** 窗口重试次数 */
const WINDOW_RETRY_COUNT = 2;

/** 每个窗口最大候选知识点数 */
const MAX_CANDIDATES_PER_WINDOW = 15;

// ========== 内部辅助函数 ==========

/**
 * 延时等待。
 *
 * @param ms - 等待毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 简单的信号量并发限制器。
 *
 * 按顺序启动最多 maxConcurrent 个 worker，每个 worker 从任务队列中
 * 依次取下一个任务执行，直到所有任务完成。结果按任务数组顺序返回。
 *
 * @param tasks - 任务工厂函数数组
 * @param maxConcurrent - 最大并发数
 * @returns 按任务数组顺序排列的结果数组
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  const workerCount = Math.min(maxConcurrent, tasks.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * 校验候选知识点中的 blockId，过滤掉虚构的 ID。
 *
 * 处理规则：
 * - 移除 sourceBlockIds 中不存在于 validBlockIds 集合的 ID
 * - 如果过滤后某个候选知识点的 sourceBlockIds 为空，则移除该候选
 *
 * @param candidates - 待校验的候选知识点数组
 * @param validBlockIds - 窗口中真实存在的 blockId 集合
 * @returns 过滤后的候选知识点数组
 */
function validateBlockIds(
  candidates: CandidateTopic[],
  validBlockIds: Set<string>,
): CandidateTopic[] {
  const result: CandidateTopic[] = [];

  for (const candidate of candidates) {
    const realBlockIds = candidate.sourceBlockIds.filter(id => validBlockIds.has(id));

    // 过滤后无有效 blockId，移除该候选
    if (realBlockIds.length === 0) {
      continue;
    }

    result.push({
      ...candidate,
      sourceBlockIds: realBlockIds,
    });
  }

  return result;
}

/**
 * 从候选知识点的 blockId 列表创建 SourceRange。
 *
 * 取 sourceBlockIds 的首尾作为范围的起止边界。
 * 在全局合并阶段，候选知识点会携带 SourceRange 转换为 KnowledgeTopic。
 *
 * @param candidate - 候选知识点
 * @param documentId - 所属文档 ID
 * @returns 来源范围，如果候选无 blockId 则返回 null
 */
function createSourceRangeFromCandidate(
  candidate: CandidateTopic,
  documentId: string,
): SourceRange | null {
  if (candidate.sourceBlockIds.length === 0) return null;

  return {
    documentId,
    startBlockId: candidate.sourceBlockIds[0],
    endBlockId: candidate.sourceBlockIds[candidate.sourceBlockIds.length - 1],
  };
}

/**
 * 尝试将候选知识点转换为 KnowledgeTopic 的部分结构。
 *
 * 用于验证候选知识点是否具备转换为最终知识主题的最低要求，
 * 并为后续全局合并阶段提供预转换数据。
 *
 * @param candidate - 候选知识点
 * @param courseId - 课程 ID
 * @param documentId - 文档 ID
 * @returns 部分 KnowledgeTopic 对象，如果不满足最低要求则返回 null
 */
function tryConvertCandidateToTopic(
  candidate: CandidateTopic,
  courseId: string,
  documentId: string,
): Partial<KnowledgeTopic> | null {
  if (candidate.name.length === 0) return null;

  const sourceRange = createSourceRangeFromCandidate(candidate, documentId);
  if (!sourceRange) return null;

  return {
    courseId,
    name: candidate.name,
    aliases: candidate.aliases,
    learningObjective: candidate.learningObjective,
    sourceRanges: [sourceRange],
    childTopicIds: [],
    confidence: candidate.confidence,
  };
}

/**
 * 尝试将主题转换关系转换为 TopicRelation 的部分结构。
 *
 * 用于验证转换关系是否具备转换为最终主题关系的最低要求。
 *
 * @param transition - 主题转换关系
 * @returns 部分 TopicRelation 对象，如果不满足最低要求则返回 null
 */
function tryConvertTransitionToRelation(
  transition: TopicTransition,
): Partial<TopicRelation> | null {
  if (!transition.fromCandidateId || !transition.toCandidateId) return null;

  return {
    sourceTopicId: transition.fromCandidateId,
    targetTopicId: transition.toCandidateId,
    reason: transition.transitionType || '',
    confidence: 0.5,
  };
}

// ========== Prompt 构建 ==========

/**
 * 构建窗口分析的 system 和 user prompt。
 *
 * System prompt 定义 AI 的角色（课程知识结构分析专家）、任务、分析规则和输出 JSON 格式。
 * User prompt 提供窗口的 Markdown 内容，并为每个块标注 blockId 供 AI 引用。
 *
 * @param window - 内容窗口
 * @returns 包含 system 和 user prompt 的对象
 */
export function buildWindowPrompt(
  window: ContentWindow,
): { system: string; user: string } {
  const system = `你是一位课程知识结构分析专家。

## 任务

分析给定的 Markdown 内容窗口，识别其中包含的候选知识点。

## 分析规则

1. **不要直接将标题等同于知识点** — 一个标题下可能包含多个知识点，一个知识点也可能跨多个标题。你需要基于内容的语义来判断知识点的边界，而非仅仅依赖标题层级。

2. **每个候选知识点必须引用真实的 blockId** — 你只能引用在下方内容中明确出现的 blockId。不要编造不存在的 blockId。

3. **给出清晰的学习目标** — 每个知识点需要一个明确的学习目标，说明学完后能理解或做到什么。

4. **识别知识点之间的转换关系** — 如果窗口中存在知识点之间的过渡（如"接下来看..."、"与之对比..."、"作为应用..."），请用 topicTransitions 记录。

5. **标记未解决的引用** — 如"见上文"、"如前所述"等指向上文但目标不明确的引用，请记录到 unresolvedReferences。

## 输出 JSON 格式

\`\`\`json
{
  "candidateTopics": [
    {
      "temporaryId": "c1",
      "name": "知识点名称",
      "aliases": ["别名1", "别名2"],
      "sourceBlockIds": ["blk_xxx", "blk_yyy"],
      "scopeDescription": "该知识点涵盖的内容范围描述",
      "learningObjective": "学完这个知识点后，学生应该能...",
      "parentTopicCandidate": "c0",
      "confidence": 0.85
    }
  ],
  "topicTransitions": [
    {
      "fromCandidateId": "c1",
      "toCandidateId": "c2",
      "reason": "从概念A过渡到概念B的原因",
      "transitionType": "continues"
    }
  ],
  "unresolvedReferences": [
    "见上文第3页的公式"
  ],
  "confidence": 0.8
}
\`\`\`

### 字段说明

- **temporaryId**: 窗口内唯一的临时标识，如 "c1"、"c2"
- **name**: 知识点名称（简洁、准确）
- **aliases**: 该知识点的别名或同义术语
- **sourceBlockIds**: 该知识点对应的 Markdown 块 ID 列表（必须引用下方出现的真实 blockId）
- **scopeDescription**: 描述该知识点涵盖了哪些内容
- **learningObjective**: 学习目标
- **parentTopicCandidate**: 如果该知识点是另一个知识点的子知识点，填写父知识点的 temporaryId；否则不填此字段
- **confidence**: 对该知识点识别的置信度（0-1）
- **fromCandidateId / toCandidateId**: 转换关系中前后知识点的 temporaryId
- **reason**: 转换原因说明
- **transitionType**: 转换类型，可选值："continues"（延续）、"extends"（扩展）、"contrasts"（对比）、"applies"（应用）
- **unresolvedReferences**: 无法确定指向的引用文本列表
- **confidence**（顶层）: 对整个窗口分析的整体置信度（0-1）

请只返回 JSON 对象，不要返回其他内容。`;

  // 构建 user prompt：为每个块标注 blockId
  const windowText = getWindowText(window);

  const blockListing = window.blocks.map(block => {
    const path = block.headingPath.length > 0
      ? block.headingPath.join(' > ')
      : '（无标题路径）';
    return `[blockId: ${block.id}] (type: ${block.type}, path: ${path})\n${sanitizeText(block.content)}`;
  }).join('\n\n---\n\n');

  const user = `以下是一个课程内容的 Markdown 窗口（窗口ID: ${window.windowId}，共 ${window.blocks.length} 个块，约 ${windowText.length} 字符）。

请分析其中包含的候选知识点，严格按照指定的 JSON 格式输出。

---

${blockListing}`;

  return { system, user };
}

// ========== 核心提取函数 ==========

/**
 * 从单个内容窗口提取候选知识点。
 *
 * 流程：
 * 1. 构建 prompt（system + user），要求 AI 识别窗口中的候选知识点
 * 2. 调用 AI（callChatCompletion），强制 response_format 为 json_object
 * 3. 解析 AI 返回的 JSON，校验所有 sourceBlockId 是否引用了真实的 blockId
 * 4. 过滤掉引用了虚构 blockId 的候选知识点
 * 5. 如果过滤后所有候选为空（但 AI 原本返回了候选），抛出 ExtractionError（code: 'evidence-filtered'）
 *
 * @param config - 模型配置
 * @param window - 内容窗口
 * @returns 窗口分析结果
 * @throws {ExtractionError} 当 AI 调用失败或校验后无有效候选时抛出
 */
export async function extractCandidatesFromWindow(
  config: ModelConfig,
  window: ContentWindow,
): Promise<ContentWindowAnalysis> {
  // 1. 构建 prompt
  const { system, user } = buildWindowPrompt(window);

  const compiled: CompiledPrompt = {
    system,
    stablePrefix: system,
    dynamicInput: user,
    promptVersion: 'window-extraction-v2.0',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  // 2. 调用 AI（callChatCompletion 内部已设置 response_format: { type: 'json_object' }）
  const { data } = await callChatCompletion<{
    candidateTopics?: Array<{
      temporaryId?: string;
      name?: string;
      aliases?: string[];
      sourceBlockIds?: string[];
      scopeDescription?: string;
      learningObjective?: string;
      parentTopicCandidate?: string;
      confidence?: number;
    }>;
    topicTransitions?: Array<{
      fromCandidateId?: string;
      toCandidateId?: string;
      reason?: string;
      transitionType?: string;
    }>;
    unresolvedReferences?: string[];
    confidence?: number;
  }>(
    config,
    compiled,
    'topic-candidate-extraction',
    90000,
    undefined,
    'candidate-extraction',
  );

  // 3. 构建有效 blockId 集合
  const validBlockIds = new Set(window.blocks.map(b => b.id));

  // 4. 解析候选知识点
  const rawCandidates: CandidateTopic[] = (data.candidateTopics || []).map(c => ({
    temporaryId: c.temporaryId?.trim() || generateId('cand'),
    name: (c.name || '').trim(),
    aliases: c.aliases || [],
    sourceBlockIds: c.sourceBlockIds || [],
    scopeDescription: (c.scopeDescription || '').trim(),
    learningObjective: (c.learningObjective || '').trim(),
    parentTopicCandidate: c.parentTopicCandidate?.trim() || undefined,
    confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
  }));

  // 过滤掉名称为空的候选
  const namedCandidates = rawCandidates.filter(c => c.name.length > 0);

  // 5. 校验 blockId — 过滤掉引用了虚构 blockId 的候选
  const validatedCandidates = validateBlockIds(namedCandidates, validBlockIds);

  // 6. 限制候选数量
  const limitedCandidates = validatedCandidates.slice(0, MAX_CANDIDATES_PER_WINDOW);

  // 7. 如果 AI 返回了候选但过滤后全部无效，抛出错误
  if (limitedCandidates.length === 0 && rawCandidates.length > 0) {
    throw new ExtractionError(
      'evidence-filtered',
      'candidate-extraction',
      `模型返回了 ${rawCandidates.length} 个候选知识点，但全部因 blockId 不匹配被过滤`,
    );
  }

  // 8. 预检候选可转换性（为后续全局合并阶段验证数据完整性）
  const documentId = window.blocks[0]?.documentId || '';
  limitedCandidates.forEach(candidate => {
    tryConvertCandidateToTopic(candidate, '', documentId);
  });

  // 9. 解析主题转换关系
  const validCandidateIds = new Set(limitedCandidates.map(c => c.temporaryId));
  const validTransitionTypes = new Set(['continues', 'extends', 'contrasts', 'applies']);

  const topicTransitions: TopicTransition[] = (data.topicTransitions || [])
    .filter(t =>
      t.fromCandidateId &&
      t.toCandidateId &&
      validCandidateIds.has(t.fromCandidateId) &&
      validCandidateIds.has(t.toCandidateId),
    )
    .map(t => {
      const transition: TopicTransition = {
        fromCandidateId: t.fromCandidateId!,
        toCandidateId: t.toCandidateId!,
        transitionType: validTransitionTypes.has(t.transitionType || '')
          ? (t.transitionType as 'continues' | 'extends' | 'contrasts' | 'applies')
          : 'continues',
      };
      // 预检转换关系可转换性
      tryConvertTransitionToRelation(transition);
      return transition;
    });

  // 10. 解析未解决引用
  const unresolvedReferences = (data.unresolvedReferences || [])
    .filter(r => r.trim().length > 0);

  // 11. 整体置信度
  const confidence = Math.max(0, Math.min(1, data.confidence ?? 0.5));

  return {
    windowId: window.windowId,
    candidateTopics: limitedCandidates,
    topicTransitions,
    unresolvedReferences,
    confidence,
  };
}

/**
 * 从所有窗口提取候选知识点（并发处理 + 失败重试）。
 *
 * 流程：
 * 1. 将 blocks 切分为内容窗口（splitIntoWindows）
 * 2. 以 MAX_CONCURRENT_WINDOWS 的并发度处理各窗口
 * 3. 每个窗口最多重试 WINDOW_RETRY_COUNT 次（即总共 WINDOW_RETRY_COUNT + 1 次尝试）
 * 4. 遇到限流错误（api-rate-limit）时，等待 2s * (attempt+1) 后重试
 * 5. 每个窗口完成后调用 onProgress 回调
 * 6. 如果某窗口所有重试均失败，记录其索引但继续处理其他窗口
 *
 * @param config - 模型配置
 * @param blocks - Markdown 块数组
 * @param onProgress - 进度回调（current: 已完成窗口数, total: 总窗口数）
 * @returns 分析结果、窗口总数和失败窗口索引列表
 */
export async function extractCandidatesFromAllWindows(
  config: ModelConfig,
  blocks: MarkdownBlock[],
  onProgress?: (current: number, total: number) => void,
): Promise<{
  analyses: ContentWindowAnalysis[];
  windowCount: number;
  failedWindows: number[];
}> {
  // 1. 切分窗口
  const windows = splitIntoWindows(blocks);
  const total = windows.length;

  if (total === 0) {
    return { analyses: [], windowCount: 0, failedWindows: [] };
  }

  let completed = 0;
  const failedWindows: number[] = [];

  // 2. 构建任务
  interface WindowTaskResult {
    index: number;
    analysis: ContentWindowAnalysis | null;
  }

  const tasks: (() => Promise<WindowTaskResult>)[] = windows.map((window, index) => {
    return async (): Promise<WindowTaskResult> => {
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= WINDOW_RETRY_COUNT; attempt++) {
        try {
          const analysis = await extractCandidatesFromWindow(config, window);

          completed++;
          onProgress?.(completed, total);

          return { index, analysis };
        } catch (error) {
          lastError = error;

          // 如果不是最后一次尝试，决定是否重试
          if (attempt < WINDOW_RETRY_COUNT) {
            if (error instanceof ExtractionError && error.code === 'api-rate-limit') {
              // 限流：等待 2s * (attempt + 1)
              await sleep(2000 * (attempt + 1));
            } else {
              // 其他错误：短暂等待后重试
              await sleep(1000 * (attempt + 1));
            }
          }
        }
      }

      // 所有重试均失败
      console.warn(
        `窗口 ${index}（${windows[index].windowId}）在 ${WINDOW_RETRY_COUNT + 1} 次尝试后仍失败:`,
        lastError,
      );
      failedWindows.push(index);

      completed++;
      onProgress?.(completed, total);

      return { index, analysis: null };
    };
  });

  // 3. 并发执行
  const results = await runWithConcurrency(tasks, MAX_CONCURRENT_WINDOWS);

  // 4. 收集成功的分析结果（按窗口顺序）
  const analyses: ContentWindowAnalysis[] = [];
  for (const result of results) {
    if (result.analysis) {
      analyses.push(result.analysis);
    }
  }

  // 5. 排序失败窗口索引
  failedWindows.sort((a, b) => a - b);

  return {
    analyses,
    windowCount: total,
    failedWindows,
  };
}
