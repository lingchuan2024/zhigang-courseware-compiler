import type {
  KnowledgeCard,
  KnowledgeTopic,
  MarkdownBlock,
  ModelConfig,
  TeachingBlock,
  TeachingRelation,
} from '../types';
import type { CompiledPrompt } from './prompt-builder';
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
): CompiledPrompt {
  const system = `你是一位严谨的课程知识卡片作者。请把一个二级知识节点写成可独立学习、可用于问答检索的知识卡片。

要求：
1. 所有课程事实必须来自给定课件原文，不得补造课件没有表达的结论。
2. 可以补全基础代数步骤或常识性连接，但必须在正文中标记为“AI 补全”。
3. detailedNote 使用自然 Markdown，根据知识类型组织核心解释、公式推导、条件、例子或比较；不要机械填充空章节。
4. conciseSummary 为 60～180 字；detailedNote 通常为 400～1200 字，原文信息不足时宁可简短并说明不足。
5. 公式使用 $...$ 或 $$...$$，不要使用方括号伪公式。
6. 自检问题必须能由本卡片内容回答。
7. 只返回 JSON：{ conciseSummary, detailedNote, keyPoints, applicableConditions, examples, misconceptions, selfCheckQuestions }。`;
  const blockById = new Map(allTeachingBlocks.map(block => [block.id, block]));
  const relationContext = relations.map(relation => ({
    type: relation.type,
    reason: relation.reason,
    source: blockById.get(relation.sourceBlockId)?.title ?? relation.sourceBlockId,
    target: blockById.get(relation.targetBlockId)?.title ?? relation.targetBlockId,
  }));
  const user = [
    `一级知识：${topic.name}`,
    `一级知识学习目标：${topic.learningObjective}`,
    `当前二级节点：${teachingBlock.title}`,
    `节点类型：${teachingBlock.type}`,
    `节点摘要：${teachingBlock.summary}`,
    `当前节点在二级知识网中的关系：${JSON.stringify(relationContext)}`,
    `课件原文：\n${source || '当前节点没有成功定位到课件原文，只能基于已有节点摘要生成，并明确说明证据不足。'}`,
  ].join('\n\n');
  return {
    system,
    stablePrefix: system,
    dynamicInput: user,
    promptVersion: 'knowledge-card-enrichment-v1',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
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
    const { data } = await callChatCompletion<RawEnrichedCard>(
      config,
      buildPrompt(topic, teachingBlock, relations, teachingBlocks, sourceText(blocks)),
      'note-generation',
      120000,
      card.topicId,
      'note-generation',
    );
    const conciseSummary = sanitizeText(data.conciseSummary ?? '').trim() || card.conciseSummary;
    const detailedNote = (data.detailedNote ?? '').trim();
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
