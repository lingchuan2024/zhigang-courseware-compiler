/**
 * 教学结构提取 — 第二层知识结构。
 *
 * 从知识点的 Markdown 内容中提取讲解块（TeachingBlock[]），
 * 分析知识点是通过什么方式讲清楚的，并生成讲解块间关系和叙事路径。
 *
 * 核心流程：
 * 1. 加载属于某个知识点的 Markdown 块
 * 2. 构建 AI 提示词（含知识类型叙事模板）
 * 3. 调用 AI 分析教学结构
 * 4. 解析 AI 响应，校验块 ID，生成 TeachingBlock / TeachingRelation / TopicNarrativePath
 */

import {
  ModelConfig,
  KnowledgeTopic,
  TeachingBlock,
  TeachingBlockType,
  TeachingRelation,
  TeachingRelationType,
  SourceRange,
  MarkdownBlock,
  TopicNarrativePath,
  KnowledgeGenre,
} from '../types';
import { callChatCompletion } from './model-v2';
import { generateId, sanitizeText, truncateText } from './utils';
import { ExtractionError } from './extraction-errors';
import type { CompiledPrompt } from './prompt-builder';

// ========== 配置常量 ==========

/** 每个知识点最多加载 80 个块 */
const MAX_BLOCKS_PER_TOPIC = 80;

/** 每个知识点最多 20000 字符 */
const MAX_CHARS_PER_TOPIC = 20000;

// ========== 运行时枚举校验 ==========

/** 合法的重要性等级集合 */
const VALID_IMPORTANCE = new Set<string>(['required', 'supporting', 'optional']);

// ========== AI 响应类型（内部） ==========

/** AI 返回的原始讲解块（未校验） */
interface RawTeachingBlock {
  type?: string;
  category?: string;
  secondaryTypes?: string[];
  title?: string;
  blockIds?: string[];
  summary?: string;
  detailedExplanation?: string;
  importance?: string;
  confidence?: number;
}

/** AI 返回的原始讲解关系（未校验） */
interface RawTeachingRelation {
  sourceIndex?: number;
  targetIndex?: number;
  type?: string;
  reason?: string;
  confidence?: number;
}

/** AI 返回的完整教学结构响应（未校验） */
interface RawTeachingResponse {
  blocks?: RawTeachingBlock[];
  relations?: RawTeachingRelation[];
  narrativeOrder?: number[];
  narrativeRationale?: string;
}

// ========== 辅助函数 ==========

/**
 * 根据知识类型返回叙事模板。
 *
 * 不同类型的知识有不同的最佳讲解顺序，此函数返回对应的叙事模板字符串，
 * 供 AI 在生成讲解顺序时参考。
 *
 * @param genre - 知识类型
 * @returns 叙事模板字符串
 */
function getGenreTemplate(genre: KnowledgeGenre): string {
  const templates: Record<KnowledgeGenre, string> = {
    concept: '问题 → 直觉 → 定义 → 正例与反例 → 性质 → 应用',
    mathematical_derivation: '推导目标 → 前提与符号 → 核心定义 → 推导步骤 → 最终结论 → 成立条件',
    algorithm: '问题 → 核心思想 → 数据结构 → 算法步骤 → 正确性 → 复杂度 → 示例',
    system_mechanism: '系统目标 → 参与组件 → 工作流程 → 状态变化 → 异常情况 → 性能权衡',
    comparison: '对比对象 → 对比维度 → 相同点 → 不同点 → 适用场景',
    case_study: '背景 → 问题描述 → 解决方案 → 实施过程 → 结果 → 经验总结',
    mixed: '根据内容自动判断最佳叙事结构',
  };
  return templates[genre] ?? templates.mixed;
}

/**
 * 加载属于某个知识点的 Markdown 块。
 *
 * 根据 topic.sourceRanges 过滤 allBlocks，找到每个范围（startBlockId 到 endBlockId）
 * 之间属于同一文档的所有块，然后按 orderIndex 排序，最后截断到 MAX_BLOCKS_PER_TOPIC。
 *
 * @param topic - 知识点
 * @param allBlocks - 全部 Markdown 块
 * @returns 属于该知识点且已排序、截断的块数组
 */
function loadTopicBlocks(topic: KnowledgeTopic, allBlocks: MarkdownBlock[]): MarkdownBlock[] {
  const blockMap = new Map(allBlocks.map(b => [b.id, b]));

  // 收集所有被 sourceRanges 覆盖的块 ID
  const validBlockIds = new Set<string>();
  for (const range of topic.sourceRanges) {
    const startBlock = blockMap.get(range.startBlockId);
    const endBlock = blockMap.get(range.endBlockId);
    if (!startBlock || !endBlock) continue;

    const startIndex = Math.min(startBlock.orderIndex, endBlock.orderIndex);
    const endIndex = Math.max(startBlock.orderIndex, endBlock.orderIndex);

    // 收集同一文档中、orderIndex 在范围内的所有块
    for (const block of allBlocks) {
      if (
        block.documentId === range.documentId &&
        block.orderIndex >= startIndex &&
        block.orderIndex <= endIndex
      ) {
        validBlockIds.add(block.id);
      }
    }
  }

  // 过滤、排序、截断
  return allBlocks
    .filter(b => validBlockIds.has(b.id))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .slice(0, MAX_BLOCKS_PER_TOPIC);
}

/**
 * 将一组 Markdown 块转换为 SourceRange 数组。
 *
 * 将同一文档中 orderIndex 连续的块合并为一个 SourceRange，
 * 不连续的块或跨文档的块分别创建独立的 SourceRange。
 *
 * @param blocks - Markdown 块数组
 * @returns SourceRange 数组
 */
function buildSourceRangesFromBlocks(blocks: MarkdownBlock[]): SourceRange[] {
  if (blocks.length === 0) return [];

  // 按 (documentId, orderIndex) 排序
  const sorted = [...blocks].sort((a, b) => {
    if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
    return a.orderIndex - b.orderIndex;
  });

  const ranges: SourceRange[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const block = sorted[i];

    // 同一文档且 orderIndex 连续 → 扩展当前范围
    if (
      block.documentId === rangeEnd.documentId &&
      block.orderIndex === rangeEnd.orderIndex + 1
    ) {
      rangeEnd = block;
    } else {
      // 关闭当前范围，开启新范围
      ranges.push({
        documentId: rangeStart.documentId,
        startBlockId: rangeStart.id,
        endBlockId: rangeEnd.id,
      });
      rangeStart = block;
      rangeEnd = block;
    }
  }

  // 关闭最后一个范围
  ranges.push({
    documentId: rangeStart.documentId,
    startBlockId: rangeStart.id,
    endBlockId: rangeEnd.id,
  });

  return ranges;
}

/**
 * 构建教学结构提取的 AI 提示词。
 *
 * System 提示词包含角色设定、19 种讲解块类型说明、8 种关系类型说明、
 * 分类规则和输出 JSON 格式。User 提示词包含知识点信息和带块 ID 标注的内容。
 *
 * @param topic - 知识点
 * @param blocks - 属于该知识点的 Markdown 块
 * @returns 包含 system 和 user 提示词的对象
 */
function buildTeachingPrompt(
  topic: KnowledgeTopic,
  blocks: MarkdownBlock[],
): { system: string; user: string } {
  const system = `你是一位知识工程与教学结构分析专家。你的任务是分析某个核心知识的 Markdown 内容，自由概括它的第二层知识节点。

## 核心原则

1. 第二层节点是“这个核心知识内部有哪些值得单独理解的子主题”，不是套用固定模板。
2. 你可以自由生成 type 和 category。type 用简短英文机器标识，category 用简短中文概括。
3. 节点可以是子概念、公式体系、对象家族、成立条件、推导链、方法步骤、反例、应用边界等任何有学习价值的内容。
4. 例如 GLM 的第二层可以包含“GLM 的三部分公式”“哪些分布属于广义线性族”“链接函数如何选择”。
5. 节点粒度应该能形成一个清晰问题或学习目标，不要把整段原文塞进一个节点。

## 可参考的常见类型（不是限定集）

将每个内容片段分类为以下 19 种类型之一：

| 类型 | 说明 |
|------|------|
| motivation | 动机/引入：为什么需要学习这个知识 |
| problem | 问题陈述：要解决的具体问题 |
| prior_knowledge | 前置知识：学习此知识点需要的前置概念 |
| intuition | 直觉解释：用直观方式解释概念 |
| definition | 正式定义：概念的严格定义 |
| property | 性质：概念或对象的属性、特征 |
| formula | 公式：数学公式或表达式 |
| derivation | 推导：从已知到结论的推导过程 |
| proof | 证明：定理或命题的严格证明 |
| procedure | 流程/步骤：操作步骤或算法流程 |
| example | 示例：具体例子或案例 |
| visualization | 可视化：图表、图示等视觉辅助 |
| application | 应用：知识在实际场景中的应用 |
| comparison | 对比：与其他概念的对比 |
| condition | 条件：适用条件或前提 |
| limitation | 局限：知识点的局限性 |
| misconception | 常见误区：容易理解错误的地方 |
| conclusion | 结论：总结性内容 |
| exercise | 练习：习题或思考题 |

## 讲解关系类型（TeachingRelationType）

| 类型 | 说明 |
|------|------|
| should_explain_before | source 应在 target 之前讲解 |
| defines | source 定义了 target |
| explains | source 解释了 target |
| derived_from | source 由 target 推导而来 |
| example_of | source 是 target 的例子 |
| supports | source 支持/佐证 target |
| contrasts_with | source 与 target 形成对比 |
| qualifies | source 限定了 target 的适用范围 |

## 分类规则

1. 每个 TeachingBlock 必须引用内容中标注的真实块 ID
2. 按内容在教学中的作用分类，而非按内容的形式分类
3. 尊重下方给出的叙事模板，但可根据实际内容灵活调整
4. 一个内容块可以属于多个 TeachingBlock，但每个 TeachingBlock 应有明确的教学功能
5. importance 取值：required（核心必学）、supporting（辅助理解）、optional（可选拓展）
6. confidence 取值：0-1，表示分类的置信度
7. narrativeOrder 是 blocks 数组的索引排列（从 0 开始），表示推荐的讲解顺序

## 输出格式（JSON）

{
  "blocks": [
    {
      "type": "definition",
      "category": "核心概念",
      "secondaryTypes": ["property"],
      "title": "讲解块标题",
      "blockIds": ["blk_xxx", "blk_yyy"],
      "summary": "内容摘要",
      "detailedExplanation": "详细解释（可选）",
      "importance": "required",
      "confidence": 0.9
    }
  ],
  "relations": [
    {
      "sourceIndex": 0,
      "targetIndex": 1,
      "type": "defines",
      "reason": "关系原因",
      "confidence": 0.8
    }
  ],
  "narrativeOrder": [0, 2, 1, 3],
  "narrativeRationale": "叙事顺序的理由"
}

如果内容无法提取有意义的讲解块，返回 {"blocks": [], "relations": [], "narrativeOrder": [], "narrativeRationale": ""}。`;

  // 构建带块 ID 标注的内容
  const annotatedContent = blocks
    .map(block => {
      const content = truncateText(sanitizeText(block.content), 2000);
      return `[块ID: ${block.id}] (${block.type})\n${content}`;
    })
    .join('\n\n---\n\n');

  const genreLabel = topic.knowledgeGenre;
  const genreTemplate = getGenreTemplate(topic.knowledgeGenre);
  const aliases = topic.aliases.length > 0 ? topic.aliases.join('、') : '无';

  const user = `## 知识点信息

- 名称：${sanitizeText(topic.name)}
- 别名：${aliases}
- 摘要：${truncateText(sanitizeText(topic.summary), 500)}
- 学习目标：${truncateText(sanitizeText(topic.learningObjective), 500)}
- 知识类型：${genreLabel}
- 叙事模板：${genreTemplate}

## 内容（带块 ID 标注）

${annotatedContent}`;

  return { system, user };
}

/**
 * 创建兜底讲解块。
 *
 * 当 AI 未返回有效讲解块或提取失败时，创建一个包含全部内容的兜底块，
 * 类型为 conclusion，重要性为 required。
 *
 * @param topic - 知识点
 * @param blocks - 属于该知识点的 Markdown 块
 * @param blockId - 讲解块 ID
 * @returns 兜底 TeachingBlock
 */
function createFallbackBlock(
  topic: KnowledgeTopic,
  blocks: MarkdownBlock[],
  blockId: string,
): TeachingBlock {
  const sourceRanges = buildSourceRangesFromBlocks(blocks);
  const combinedContent = blocks.map(b => b.content).join('\n\n');

  return {
    id: blockId,
    topicId: topic.id,
    type: 'conclusion',
    title: topic.name,
    sourceRanges,
    summary: truncateText(combinedContent, 500),
    importance: 'required',
    confidence: 0.3,
  };
}

/**
 * 解析 AI 教学结构响应，校验块 ID，生成 TeachingBlock / TeachingRelation / TopicNarrativePath。
 *
 * 校验规则：
 * - 讲解块类型必须是 19 种合法类型之一
 * - blockIds 必须引用真实存在的块 ID
 * - 讲解关系类型必须是 8 种合法类型之一
 * - sourceIndex / targetIndex 必须指向有效的讲解块
 * - confidence 被限制在 [0, 1] 范围内
 *
 * 如果 AI 未返回任何有效讲解块，创建一个兜底块。
 *
 * @param response - AI 返回的原始数据
 * @param topic - 知识点
 * @param blocks - 属于该知识点的 Markdown 块（用于校验 blockIds）
 * @returns 解析后的讲解块、关系和叙事路径
 */
function parseTeachingResponse(
  response: unknown,
  topic: KnowledgeTopic,
  blocks: MarkdownBlock[],
): { blocks: TeachingBlock[]; relations: TeachingRelation[]; narrativePath: TopicNarrativePath } {
  // 构建块 ID 集合和映射
  const validBlockIds = new Set(blocks.map(b => b.id));
  const blockMap = new Map(blocks.map(b => [b.id, b]));

  // 提取原始数据
  const raw = (response ?? {}) as RawTeachingResponse;
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const rawRelations = Array.isArray(raw.relations) ? raw.relations : [];
  const rawNarrativeOrder = Array.isArray(raw.narrativeOrder) ? raw.narrativeOrder : [];
  const rawNarrativeRationale =
    typeof raw.narrativeRationale === 'string' ? raw.narrativeRationale : '';

  // ---- 解析讲解块 ----
  const teachingBlocks: TeachingBlock[] = [];
  /** AI blocks 数组索引 → 生成的 TeachingBlock ID */
  const indexToBlockId = new Map<number, string>();

  for (let i = 0; i < rawBlocks.length; i++) {
    const rawBlock = rawBlocks[i];

    // 校验类型
    const type = sanitizeText(rawBlock?.type ?? '').trim();
    if (!type) continue;

    // 校验 blockIds — 只保留真实存在的块 ID
    const rawBlockIds = Array.isArray(rawBlock?.blockIds) ? rawBlock.blockIds : [];
    const validRefs = rawBlockIds.filter(
      (id): id is string => typeof id === 'string' && validBlockIds.has(id),
    );

    // 从有效的块 ID 构建 SourceRange
    const referencedBlocks = validRefs
      .map(id => blockMap.get(id))
      .filter((b): b is MarkdownBlock => b !== undefined);
    const sourceRanges = buildSourceRangesFromBlocks(referencedBlocks);

    // 校验重要性
    const importance = rawBlock?.importance;
    const validImportance = VALID_IMPORTANCE.has(importance ?? '')
      ? (importance as 'required' | 'supporting' | 'optional')
      : 'supporting';

    // 校验次要类型
    const secondaryTypes = Array.isArray(rawBlock?.secondaryTypes)
      ? (rawBlock.secondaryTypes.filter(
          (t): t is TeachingBlockType => typeof t === 'string' && t.trim().length > 0,
        ) as TeachingBlockType[])
      : undefined;

    // 校验置信度
    const confidence =
      typeof rawBlock?.confidence === 'number'
        ? Math.max(0, Math.min(1, rawBlock.confidence))
        : 0.5;

    // 生成讲解块 ID
    const blockId = `tb_${topic.id}_${teachingBlocks.length}`;

    teachingBlocks.push({
      id: blockId,
      topicId: topic.id,
      type: type as TeachingBlockType,
      category: truncateText(sanitizeText(rawBlock?.category ?? ''), 80) || undefined,
      secondaryTypes: secondaryTypes && secondaryTypes.length > 0 ? secondaryTypes : undefined,
      title: truncateText(sanitizeText(rawBlock?.title ?? ''), 200) || `${topic.name} - 讲解块 ${teachingBlocks.length + 1}`,
      sourceRanges,
      summary: truncateText(sanitizeText(rawBlock?.summary ?? ''), 1000),
      detailedExplanation: rawBlock?.detailedExplanation
        ? truncateText(sanitizeText(rawBlock.detailedExplanation), 2000)
        : undefined,
      importance: validImportance,
      confidence,
    });

    indexToBlockId.set(i, blockId);
  }

  // ---- 无有效讲解块时创建兜底 ----
  if (teachingBlocks.length === 0) {
    const fallbackId = `tb_${topic.id}_0`;
    const fallbackBlock = createFallbackBlock(topic, blocks, fallbackId);
    return {
      blocks: [fallbackBlock],
      relations: [],
      narrativePath: {
        topicId: topic.id,
        orderedTeachingBlockIds: [fallbackId],
        rationale: 'AI 未返回有效讲解块，使用兜底块',
      },
    };
  }

  // ---- 解析讲解关系 ----
  const teachingRelations: TeachingRelation[] = [];

  for (const rawRel of rawRelations) {
    // 校验关系类型
    const relType = rawRel?.type;
    if (!relType || typeof relType !== 'string' || relType.trim().length === 0) continue;

    // 校验 source/target 索引
    const sourceIndex = rawRel?.sourceIndex;
    const targetIndex = rawRel?.targetIndex;
    if (typeof sourceIndex !== 'number' || typeof targetIndex !== 'number') continue;

    const sourceBlockId = indexToBlockId.get(sourceIndex);
    const targetBlockId = indexToBlockId.get(targetIndex);
    if (!sourceBlockId || !targetBlockId) continue;
    if (sourceBlockId === targetBlockId) continue;

    // 校验置信度
    const confidence =
      typeof rawRel?.confidence === 'number'
        ? Math.max(0, Math.min(1, rawRel.confidence))
        : 0.5;

    teachingRelations.push({
      id: `tr_${topic.id}_${teachingRelations.length}`,
      topicId: topic.id,
      sourceBlockId,
      targetBlockId,
      type: relType as TeachingRelationType,
      reason: truncateText(sanitizeText(rawRel?.reason ?? ''), 500),
      confidence,
    });
  }

  // ---- 构建叙事路径 ----
  let orderedBlockIds: string[];

  if (rawNarrativeOrder.length > 0) {
    // 按AI建议的顺序排列
    const ordered = rawNarrativeOrder
      .filter((idx): idx is number => typeof idx === 'number' && indexToBlockId.has(idx))
      .map(idx => indexToBlockId.get(idx)!);

    // 补充未包含在 narrativeOrder 中的块
    const orderedSet = new Set(ordered);
    for (const block of teachingBlocks) {
      if (!orderedSet.has(block.id)) {
        ordered.push(block.id);
      }
    }
    orderedBlockIds = ordered;
  } else {
    // 默认按提取顺序排列
    orderedBlockIds = teachingBlocks.map(b => b.id);
  }

  const narrativePath: TopicNarrativePath = {
    topicId: topic.id,
    orderedTeachingBlockIds: orderedBlockIds,
    rationale: rawNarrativeRationale || '默认按提取顺序排列',
  };

  return { blocks: teachingBlocks, relations: teachingRelations, narrativePath };
}

// ========== 导出函数 ==========

/**
 * 提取单个知识点的教学讲解结构。
 *
 * 构建 AI 提示词，调用 AI 分析知识点的 Markdown 内容，
 * 识别教学讲解方式，分类为 TeachingBlock，生成讲解关系和叙事路径。
 *
 * 如果 AI 返回空讲解块，返回一个包含全部内容的兜底块。
 * 如果没有输入块或未配置 API Key，直接返回兜底结果。
 *
 * @param config - 模型配置
 * @param topic - 知识点
 * @param topicBlocks - 属于该知识点的 Markdown 块
 * @returns 讲解块数组、讲解关系数组和叙事路径
 * @throws {ExtractionError} 当 API 调用失败时抛出
 */
export async function extractTeachingStructure(
  config: ModelConfig,
  topic: KnowledgeTopic,
  topicBlocks: MarkdownBlock[],
): Promise<{
  blocks: TeachingBlock[];
  relations: TeachingRelation[];
  narrativePath: TopicNarrativePath;
}> {
  // 无内容或无 API Key 时直接返回兜底
  if (topicBlocks.length === 0 || !config.apiKey) {
    const fallbackId = `tb_${topic.id}_0`;
    const fallbackBlock = createFallbackBlock(topic, topicBlocks, fallbackId);
    return {
      blocks: [fallbackBlock],
      relations: [],
      narrativePath: {
        topicId: topic.id,
        orderedTeachingBlockIds: [fallbackId],
        rationale: '无可用内容或未配置模型，使用兜底块',
      },
    };
  }

  // 构建提示词
  const prompt = buildTeachingPrompt(topic, topicBlocks);

  // 构造 CompiledPrompt
  const compiled: CompiledPrompt = {
    system: prompt.system,
    stablePrefix: '',
    dynamicInput: prompt.user,
    promptVersion: 'teaching-v1.0',
    messages: [
      { role: 'system' as const, content: prompt.system },
      { role: 'user' as const, content: prompt.user },
    ],
  };

  // 调用 AI（失败时抛出 ExtractionError，由调用方处理）
  const { data } = await callChatCompletion<RawTeachingResponse>(
    config,
    compiled,
    'internal-structure',
    90000,
    topic.id,
    'internal-structure',
  );

  // 解析响应
  return parseTeachingResponse(data, topic, topicBlocks);
}

/**
 * 批量提取所有知识点的教学讲解结构。
 *
 * 遍历每个知识点，加载并截断其 Markdown 块，调用 extractTeachingStructure，
 * 收集所有讲解块、关系和叙事路径。
 *
 * 单个知识点提取失败时，创建兜底讲解块并继续处理后续知识点，
 * 不会中断整个流程。
 *
 * @param config - 模型配置
 * @param topics - 全部知识点
 * @param allBlocks - 全部 Markdown 块
 * @param onProgress - 进度回调（current 为已处理数量，total 为知识点总数）
 * @returns 全部讲解块、全部讲解关系和按知识点 ID 索引的叙事路径
 */
export async function extractTeachingStructureForAllTopics(
  config: ModelConfig,
  topics: KnowledgeTopic[],
  allBlocks: MarkdownBlock[],
  onProgress?: (current: number, total: number) => void,
): Promise<{
  allTeachingBlocks: TeachingBlock[];
  allTeachingRelations: TeachingRelation[];
  narrativePaths: Record<string, TopicNarrativePath>;
}> {
  const allTeachingBlocks: TeachingBlock[] = [];
  const allTeachingRelations: TeachingRelation[] = [];
  const narrativePaths: Record<string, TopicNarrativePath> = {};

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];

    // 1. 加载属于该知识点的块（已截断到 MAX_BLOCKS_PER_TOPIC）
    let topicBlocks = loadTopicBlocks(topic, allBlocks);

    // 2. 按字符数截断到 MAX_CHARS_PER_TOPIC（至少保留第一个块）
    let totalChars = 0;
    const truncatedBlocks: MarkdownBlock[] = [];
    for (const block of topicBlocks) {
      if (truncatedBlocks.length > 0 && totalChars + block.content.length > MAX_CHARS_PER_TOPIC) {
        break;
      }
      truncatedBlocks.push(block);
      totalChars += block.content.length;
    }
    topicBlocks = truncatedBlocks;

    try {
      // 3. 调用教学结构提取
      const result = await extractTeachingStructure(config, topic, topicBlocks);

      // 4. 收集结果
      allTeachingBlocks.push(...result.blocks);
      allTeachingRelations.push(...result.relations);
      narrativePaths[topic.id] = result.narrativePath;
    } catch (error) {
      // 提取失败 — 创建兜底块并继续
      const errorMsg = error instanceof ExtractionError
        ? error.toUserMessage()
        : error instanceof Error
          ? error.message
          : String(error);
      console.warn(`教学结构提取失败 (${topic.name}): ${errorMsg}`);
      const fallbackBlock = createFallbackBlock(topic, topicBlocks, generateId('tb'));
      allTeachingBlocks.push(fallbackBlock);
      narrativePaths[topic.id] = {
        topicId: topic.id,
        orderedTeachingBlockIds: [fallbackBlock.id],
        rationale: '提取失败，使用兜底块',
      };
    }

    // 报告进度
    onProgress?.(i + 1, topics.length);
  }

  return { allTeachingBlocks, allTeachingRelations, narrativePaths };
}
