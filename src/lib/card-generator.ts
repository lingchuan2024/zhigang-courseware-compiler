/**
 * card-generator.ts
 *
 * 从 TeachingBlock[] 生成 KnowledgeCard[]。
 * 每个讲解块对应一张知识卡片，包含摘要、关键词、公式、前置/关联主题等信息。
 */

import {
  KnowledgeTopic,
  TeachingBlock,
  KnowledgeCard,
  FormulaCard,
  SourceRange,
  MarkdownBlock,
  TopicRelation,
  TopicNarrativePath,
} from '../types';
import { generateId } from './utils';

// ========== 常量 ==========

/** 停用词集合（中英文常见无意义词） */
const STOP_WORDS = new Set<string>([
  '的', '是', '在',
  'and', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'for', 'on', 'with',
]);

/** 默认关键词数量上限 */
const DEFAULT_MAX_KEYWORDS = 5;

// ========== 辅助函数 ==========

/**
 * 从文本中提取关键词。
 *
 * 算法步骤：
 * 1. 按非字母数字字符（含中文）分割为词元
 * 2. 过滤掉长度 ≤ 2 的词
 * 3. 移除常见停用词
 * 4. 按出现频率降序排列
 * 5. 取前 maxCount 个
 *
 * @param text - 待提取的文本
 * @param maxCount - 最多返回的关键词数量（默认 5）
 * @returns 关键词数组（按频率降序排列）
 */
export function extractKeywords(text: string, maxCount: number = DEFAULT_MAX_KEYWORDS): string[] {
  if (!text || !text.trim()) return [];

  // 按非字母数字（含中文）字符分割
  const tokens = text.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter(Boolean);

  // 统计词频
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    // 过滤：长度 ≤ 2
    if (token.length <= 2) continue;
    const lower = token.toLowerCase();
    // 过滤：停用词
    if (STOP_WORDS.has(lower)) continue;
    frequency.set(lower, (frequency.get(lower) ?? 0) + 1);
  }

  if (frequency.size === 0) return [];

  // 按频率降序排列，取前 maxCount 个
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([word]) => word);
}

/**
 * 根据 SourceRange 从全部 Markdown 块中查找范围内的块。
 *
 * 通过匹配 startBlockId / endBlockId 对应的 orderIndex，
 * 收集同一文档内、orderIndex 在区间内的所有块。
 *
 * @param sourceRanges - 来源范围数组
 * @param allBlocks - 全部 Markdown 块
 * @returns 范围内的 Markdown 块列表（按 orderIndex 升序）
 */
function getBlocksInRange(
  sourceRanges: SourceRange[],
  allBlocks: MarkdownBlock[],
): MarkdownBlock[] {
  const result: MarkdownBlock[] = [];
  const seen = new Set<string>();

  for (const range of sourceRanges) {
    const startBlock = allBlocks.find(b => b.id === range.startBlockId);
    const endBlock = allBlocks.find(b => b.id === range.endBlockId);

    if (!startBlock || !endBlock) {
      // 边界块缺失，尽量保留能找到的
      for (const block of [startBlock, endBlock]) {
        if (block && !seen.has(block.id)) {
          result.push(block);
          seen.add(block.id);
        }
      }
      continue;
    }

    const minIndex = Math.min(startBlock.orderIndex, endBlock.orderIndex);
    const maxIndex = Math.max(startBlock.orderIndex, endBlock.orderIndex);

    const blocksInRange = allBlocks
      .filter(
        b =>
          b.documentId === range.documentId &&
          b.orderIndex >= minIndex &&
          b.orderIndex <= maxIndex,
      )
      .sort((a, b) => a.orderIndex - b.orderIndex);

    for (const block of blocksInRange) {
      if (!seen.has(block.id)) {
        result.push(block);
        seen.add(block.id);
      }
    }
  }

  return result;
}

/**
 * 从讲解块中提取公式卡片。
 *
 * 仅当讲解块类型为 `'formula'` 或 `'derivation'` 时执行提取。
 * 从来源块的 Markdown 内容中匹配 `$$...$$`（块级公式）和 `$...$`（行内公式）模式，
 * 为每个匹配到的公式创建一个 FormulaCard。
 *
 * @param block - 讲解块
 * @param allBlocks - 全部 Markdown 块（用于查找来源内容）
 * @returns 公式卡片数组
 */
export function extractFormulas(block: TeachingBlock, allBlocks: MarkdownBlock[]): FormulaCard[] {
  // 仅公式和推导类型才提取
  if (block.type !== 'formula' && block.type !== 'derivation') {
    return [];
  }

  // 获取来源块内容
  const sourceBlocks = getBlocksInRange(block.sourceRanges, allBlocks);
  if (sourceBlocks.length === 0) return [];

  const formulas: FormulaCard[] = [];

  // 统一匹配 $$...$$（块级）和 $...$（行内）
  // 第一捕获组为块级公式内容，第二捕获组为行内公式内容
  const formulaRegex = /\$\$([\s\S]*?)\$\$|\$([^\n$]+?)\$/g;

  for (const sourceBlock of sourceBlocks) {
    const content = sourceBlock.content;
    let match: RegExpExecArray | null;

    while ((match = formulaRegex.exec(content)) !== null) {
      // 优先取块级公式（group 1），其次行内公式（group 2）
      const latex = (match[1] ?? match[2] ?? '').trim();
      if (!latex) continue;

      formulas.push({
        id: generateId('formula'),
        topicId: block.topicId,
        name: block.title,
        latex,
        formula: latex,
        description: block.title,
        variables: {},
        sourceRanges: block.sourceRanges,
      } as FormulaCard);
    }
  }

  return formulas;
}

// ========== 主函数 ==========

/**
 * 根据 KnowledgeTopic[] 和 TeachingBlock[] 生成知识卡片数组。
 *
 * 对每个 TeachingBlock，结合其所属 KnowledgeTopic 的元信息，
 * 生成一张包含摘要、关键词、公式、前置/关联主题等信息的 KnowledgeCard。
 *
 * @param topics - 全部知识主题
 * @param teachingBlocks - 全部讲解块
 * @param allBlocks - 全部 Markdown 块（用于公式提取）
 * @param topicRelations - 主题间关系（可选，用于提取前置/关联主题）
 * @returns 知识卡片数组
 */
export function generateCards(
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  allBlocks: MarkdownBlock[],
  topicRelations?: TopicRelation[],
  narrativePaths?: Record<string, TopicNarrativePath>,
): KnowledgeCard[] {
  // 构建主题查找表
  const topicMap = new Map<string, KnowledgeTopic>(topics.map(t => [t.id, t]));

  const cards: KnowledgeCard[] = [];
  const originalIndex = new Map(teachingBlocks.map((block, index) => [block.id, index]));
  const orderedBlocks = topics.flatMap(topic => {
    // 无原文范围的讲解单元不能伪装成“关联课件原文”的知识卡片。
    const topicBlocks = teachingBlocks.filter(block => block.topicId === topic.id && block.sourceRanges.length > 0);
    const pathOrder = new Map(
      (narrativePaths?.[topic.id]?.orderedTeachingBlockIds ?? []).map((id, index) => [id, index]),
    );
    return [...topicBlocks].sort((a, b) => {
      const aOrder = pathOrder.get(a.id);
      const bOrder = pathOrder.get(b.id);
      if (aOrder !== undefined || bOrder !== undefined) {
        return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
    });
  });

  for (let blockIndex = 0; blockIndex < orderedBlocks.length; blockIndex++) {
    const block = orderedBlocks[blockIndex];
    const topic = topicMap.get(block.topicId);

    // 找不到对应主题时跳过
    if (!topic) continue;

    // 提取关键词（从摘要中提取，最多 5 个）
    const keywords = extractKeywords(block.summary, DEFAULT_MAX_KEYWORDS);

    // 提取前置主题 ID
    // hard_prerequisite: source 是 target 的硬前置
    // 当前主题是 target 时，source 是其前置
    const prerequisiteTopicIds = topicRelations
      ? topicRelations
          .filter(r => r.type === 'hard_prerequisite' && r.targetTopicId === topic.id)
          .map(r => r.sourceTopicId)
      : [];

    // 提取关联主题 ID
    // 包含 derived_from, contrast_with, extension_of, application_of, parallel_with, part_of 等
    // 排除前置类关系（hard_prerequisite, helpful_before）
    const relatedTopicIds = topicRelations
      ? topicRelations
          .filter(
            r =>
              (r.sourceTopicId === topic.id || r.targetTopicId === topic.id) &&
              r.type !== 'hard_prerequisite' &&
              r.type !== 'helpful_before',
          )
          .map(r => (r.sourceTopicId === topic.id ? r.targetTopicId : r.sourceTopicId))
      : [];

    // 提取公式（仅 formula / derivation 类型）
    const formulas = extractFormulas(block, allBlocks);
    const sourceExcerpt = getBlocksInRange(block.sourceRanges, allBlocks)
      .map(sourceBlock => sourceBlock.content.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 3000);

    // 提取误区（仅 misconception 类型）
    const misconceptions =
      block.type === 'misconception'
        ? [block.detailedExplanation || block.summary]
        : undefined;

    const card: KnowledgeCard = {
      id: `card_${topic.id}_${block.id}`,
      courseId: topic.courseId,
      topicId: topic.id,
      topicName: topic.name,
      teachingBlockId: block.id,
      teachingType: block.type,
      title: block.title,
      conciseSummary: block.summary,
      detailedNote: block.detailedExplanation || block.summary,
      sourceExcerpt,
      sourceRanges: block.sourceRanges,
      keywords,
      aliases: topic.aliases,
      prerequisiteTopicIds,
      relatedTopicIds,
      formulas: formulas.length > 0 ? formulas : undefined,
      misconceptions,
      confidence: block.confidence,
      reviewStatus: 'generated',
      narrativeIndex: cards.filter(existing => existing.topicId === topic.id).length,
      // 这里只是可追溯的基础卡片，尚未经过 AI 深化与质量检查。
      status: 'partial',
      sourceVersion: 1,
      cardVersion: 0,
    };

    cards.push(card);
  }

  return cards;
}
