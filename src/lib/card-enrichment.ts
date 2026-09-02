import type {
  KnowledgeCard,
  KnowledgeTopic,
  MarkdownBlock,
  ModelConfig,
  TeachingBlock,
  TeachingRelation,
} from '../types';
import type { CompiledPrompt } from './prompt-builder';
import { evaluateKnowledgeCardDraft } from './card-quality';
import { prepareGeneratedMarkdown } from './generated-markdown';
import { callChatCompletion } from './model-v2';
import { sanitizeText, truncateText } from './utils';

const MAX_CONCURRENT_CARDS = 3;
const MAX_SOURCE_CHARS = 12000;
const MAX_EXCERPT_CHARS = 3000;

interface RawEnrichedCard {
  conciseSummary?: string;
  detailedNote?: string;
  keyPoints?: string[];
  applicableConditions?: string[];
  examples?: string[];
  misconceptions?: string[];
  selfCheckQuestions?: string[];
}

export interface CardEnrichmentResult {
  cards: KnowledgeCard[];
  failedCardIds: string[];
}

function strings(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => sanitizeText(item).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function sourceBlocksForCard(card: KnowledgeCard, allBlocks: MarkdownBlock[]): MarkdownBlock[] {
  const blockById = new Map(allBlocks.map(block => [block.id, block]));
  const selected = new Map<string, MarkdownBlock>();

  for (const range of card.sourceRanges) {
    const start = blockById.get(range.startBlockId);
    const end = blockById.get(range.endBlockId);
    if (!start || !end) continue;
    const low = Math.min(start.orderIndex, end.orderIndex);
    const high = Math.max(start.orderIndex, end.orderIndex);
    for (const block of allBlocks) {
      if (block.documentId === range.documentId && block.orderIndex >= low && block.orderIndex <= high) {
        selected.set(block.id, block);
      }
    }
  }

  return [...selected.values()].sort((a, b) => a.orderIndex - b.orderIndex);
}

function sourceText(blocks: MarkdownBlock[]): string {
  return truncateText(blocks.map(block => `[${block.id}]\n${block.content}`).join('\n\n'), MAX_SOURCE_CHARS);
}

function buildPrompt(
  topic: KnowledgeTopic,
  teachingBlock: TeachingBlock,
  relations: TeachingRelation[],
  allTeachingBlocks: TeachingBlock[],
  source: string,
  repairReasons: string[] = [],
): CompiledPrompt {
  const system = `你是一位严谨的课程知识卡片作者。知识卡片必须是可独立学习、可用于问答检索的知识原料包，而不是笔记片段或写作建议。

要求：
1. 所有课程事实必须来自给定课件原文，不得补造课件没有表达的结论。
2. 课件之外的通用教材解释、基础代数步骤或典型例子，必须放在统一引用块中：
> AI 教学补充：以下内容用于补足课件省略的解释或推导，不属于课件原文。
3. 按知识类型自然组织，不要机械填充空章节：
   - 概念类：课程位置、直觉、正式定义、性质、边界、相关概念、误区。
   - 推导或公式类：假设、符号、起点、至少两个连续步骤、结论、含义、成立条件。
   - 方法类：解决的问题、核心直觉、步骤、代价、适用条件、例子。
   - 对比类：真实比较对象、共同目标、至少两个比较维度、Markdown 对比表、选择建议。
   - 分类或知识族类：分类依据、各分支特点、联系和选择地图。
4. 禁止输出“可能包含”“可能包括”“可从以下方面介绍”“等对比信息”等占位文字。
5. conciseSummary 为 60～180 字；detailedNote 通常为 400～1200 字。证据不足时必须明确写出“课件证据不足”，再谨慎补充。
6. 公式使用 $...$ 或 $$...$$，不要使用方括号伪公式。
7. 自检问题必须能由本卡片内容回答。
8. 只返回 JSON：{ conciseSummary, detailedNote, keyPoints, applicableConditions, examples, misconceptions, selfCheckQuestions }。`;
  const blockById = new Map(allTeachingBlocks.map(block => [block.id, block]));
  const relationContext = [...relations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(relation => ({
      type: relation.type,
      reason: relation.reason,
      source: blockById.get(relation.sourceBlockId)?.title ?? relation.sourceBlockId,
      target: blockById.get(relation.targetBlockId)?.title ?? relation.targetBlockId,
    }));
  const siblingDirectory = allTeachingBlocks
    .filter(block => block.topicId === topic.id)
    .map((block, index) => ({
      order: index + 1,
      id: block.id,
      title: block.title,
      type: block.type,
      summary: block.summary,
      current: block.id === teachingBlock.id,
    }));
  const user = [
    `一级知识：${topic.name}`,
    `一级知识学习目标：${topic.learningObjective}`,
    `当前二级节点：${teachingBlock.title}`,
    `节点类型：${teachingBlock.type}`,
    `节点摘要：${teachingBlock.summary}`,
    `同级二级知识目录：${JSON.stringify(siblingDirectory)}`,
    `一跳关系：${JSON.stringify(relationContext)}`,
    `课件原文：\n${source || '当前节点没有成功定位到课件原文，只能基于已有节点摘要生成，并明确说明证据不足。'}`,
    repairReasons.length > 0
      ? `上一次结果未通过质量检查：${repairReasons.join('；')}。请重写整张卡片，不要解释检查规则。`
      : '',
  ].filter(Boolean).join('\n\n');
  return {
    system,
    stablePrefix: system,
    dynamicInput: user,
    promptVersion: 'knowledge-card-enrichment-v2',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

async function generateCardDraft(
  config: ModelConfig,
  card: KnowledgeCard,
  topic: KnowledgeTopic,
  teachingBlock: TeachingBlock,
  relations: TeachingRelation[],
  teachingBlocks: TeachingBlock[],
  source: string,
  repairReasons: string[] = [],
): Promise<RawEnrichedCard> {
  const { data } = await callChatCompletion<RawEnrichedCard>(
    config,
    buildPrompt(topic, teachingBlock, relations, teachingBlocks, source, repairReasons),
    'note-generation',
    120000,
    card.topicId,
    'note-generation',
  );
  return data;
}

async function enrichOne(
  config: ModelConfig,
  card: KnowledgeCard,
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  teachingRelations: TeachingRelation[],
  allBlocks: MarkdownBlock[],
): Promise<{ card: KnowledgeCard; failed: boolean }> {
  const topic = topics.find(item => item.id === card.topicId);
  const teachingBlock = teachingBlocks.find(item => item.id === card.teachingBlockId);
  const blocks = sourceBlocksForCard(card, allBlocks);
  const excerpt = truncateText(blocks.map(block => block.content).join('\n\n'), MAX_EXCERPT_CHARS);
  if (!topic || !teachingBlock) {
    return { card: { ...card, sourceExcerpt: excerpt, status: 'partial' }, failed: true };
  }

  const relations = teachingRelations.filter(relation =>
    relation.topicId === card.topicId &&
    (relation.sourceBlockId === card.teachingBlockId || relation.targetBlockId === card.teachingBlockId)
  );

  try {
    const source = sourceText(blocks);
    let data = await generateCardDraft(
      config,
      card,
      topic,
      teachingBlock,
      relations,
      teachingBlocks,
      source,
    );
    let detailedNote = prepareGeneratedMarkdown(sanitizeText(data.detailedNote ?? ''));
    let quality = evaluateKnowledgeCardDraft({
      teachingType: teachingBlock.type,
      title: card.title,
      detailedNote,
      sourceRangeCount: card.sourceRanges.length,
    });
    if (!quality.accepted) {
      data = await generateCardDraft(
        config,
        card,
        topic,
        teachingBlock,
        relations,
        teachingBlocks,
        source,
        quality.reasons,
      );
      detailedNote = prepareGeneratedMarkdown(sanitizeText(data.detailedNote ?? ''));
      quality = evaluateKnowledgeCardDraft({
        teachingType: teachingBlock.type,
        title: card.title,
        detailedNote,
        sourceRangeCount: card.sourceRanges.length,
      });
    }
    if (!quality.accepted) throw new Error(`知识卡片未通过质量检查：${quality.reasons.join('；')}`);
    const conciseSummary = sanitizeText(data.conciseSummary ?? '').trim() || card.conciseSummary;
    if (!detailedNote) throw new Error('模型返回的知识卡片正文为空');
    return {
      card: {
        ...card,
        conciseSummary,
        detailedNote,
        keyPoints: strings(data.keyPoints),
        applicableConditions: strings(data.applicableConditions),
        examples: strings(data.examples),
        misconceptions: strings(data.misconceptions),
        selfCheckQuestions: strings(data.selfCheckQuestions),
        sourceExcerpt: excerpt,
        status: 'completed',
        cardVersion: (card.cardVersion ?? 0) + 1,
      },
      failed: false,
    };
  } catch (error) {
    console.warn(`知识卡片深化失败（${card.title}）:`, error);
    const existingQuality = evaluateKnowledgeCardDraft({
      teachingType: card.teachingType,
      title: card.title,
      detailedNote: card.detailedNote,
      sourceRangeCount: card.sourceRanges.length,
    });
    if (card.status === 'completed' && existingQuality.accepted) {
      return {
        card: { ...card, sourceExcerpt: excerpt },
        failed: true,
      };
    }
    return {
      card: {
        ...card,
        sourceExcerpt: excerpt,
        status: 'partial',
        cardVersion: card.cardVersion ?? 1,
      },
      failed: true,
    };
  }
}

export async function enrichKnowledgeCards(
  config: ModelConfig,
  cards: KnowledgeCard[],
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  teachingRelations: TeachingRelation[],
  allBlocks: MarkdownBlock[],
  onProgress?: (current: number, total: number) => void,
  maxConcurrent = MAX_CONCURRENT_CARDS,
): Promise<CardEnrichmentResult> {
  const results: Array<{ card: KnowledgeCard; failed: boolean }> = new Array(cards.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < cards.length) {
      const index = nextIndex++;
      results[index] = await enrichOne(config, cards[index], topics, teachingBlocks, teachingRelations, allBlocks);
      completed++;
      onProgress?.(completed, cards.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, maxConcurrent), cards.length) }, () => worker()),
  );
  return {
    cards: results.map(result => result.card),
    failedCardIds: results.filter(result => result.failed).map(result => result.card.id),
  };
}
