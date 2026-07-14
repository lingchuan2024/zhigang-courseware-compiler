import type {
  KnowledgeTopic,
  ModelConfig,
  TeachingBlock,
  TeachingRelation,
  TopicRelation,
  TopicRelationType,
} from '../types';
import type { CompiledPrompt } from './prompt-builder';
import { callChatCompletion } from './model-v2';
import { generateId, sanitizeText, truncateText } from './utils';

const TOPIC_RELATION_TYPES = new Set<TopicRelationType>([
  'hard_prerequisite', 'helpful_before', 'derived_from', 'part_of',
  'application_of', 'extension_of', 'contrast_with', 'parallel_with',
]);

interface RawTopicRelation {
  sourceTopicId?: string;
  targetTopicId?: string;
  type?: string;
  reason?: string;
  confidence?: number;
}

interface RawTeachingRelation {
  sourceBlockId?: string;
  targetBlockId?: string;
  type?: string;
  reason?: string;
  confidence?: number;
}

function clamp01(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function compiled(system: string, user: string, version: string): CompiledPrompt {
  return {
    system,
    stablePrefix: system,
    dynamicInput: user,
    promptVersion: version,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
}

export function buildTopicRelationTraversalPrompt(topics: KnowledgeTopic[]): CompiledPrompt {
  const system = `你是课程知识图谱专家。现在候选知识点已经确定，请遍历全部第一层节点，只建立有明确学习意义的网状关系。

允许的关系类型：hard_prerequisite、helpful_before、derived_from、part_of、application_of、extension_of、contrast_with、parallel_with。
规则：
1. 不要为了连通而强行建边；
2. 不要输出自环或重复边；
3. 只能使用输入中的 topicId；
4. 输出 {"relations":[{"sourceTopicId":"...","targetTopicId":"...","type":"...","reason":"...","confidence":0.9}]} JSON。`;
  const user = JSON.stringify({ topics: topics.map(topic => ({
    topicId: topic.id,
    name: topic.name,
    aliases: topic.aliases,
    summary: truncateText(topic.summary, 500),
    learningObjective: truncateText(topic.learningObjective, 400),
    genre: topic.knowledgeGenre,
    difficulty: topic.difficulty,
  })) });
  return compiled(system, user, 'topic-relation-traversal-v1');
}

export async function extractTopicRelationGraph(
  config: ModelConfig,
  topics: KnowledgeTopic[],
): Promise<TopicRelation[]> {
  if (topics.length < 2) return [];
  const { data } = await callChatCompletion<{ relations?: RawTopicRelation[] }>(
    config,
    buildTopicRelationTraversalPrompt(topics),
    'relation-extraction',
    120000,
    undefined,
    'relation-extraction',
  );
  const validIds = new Set(topics.map(topic => topic.id));
  const seen = new Set<string>();
  const result: TopicRelation[] = [];
  for (const raw of Array.isArray(data?.relations) ? data.relations : []) {
    const sourceTopicId = raw.sourceTopicId ?? '';
    const targetTopicId = raw.targetTopicId ?? '';
    const type = raw.type as TopicRelationType;
    if (!validIds.has(sourceTopicId) || !validIds.has(targetTopicId) || sourceTopicId === targetTopicId || !TOPIC_RELATION_TYPES.has(type)) continue;
    const key = `${sourceTopicId}:${targetTopicId}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: generateId('topic_rel'), sourceTopicId, targetTopicId, type,
      reason: truncateText(sanitizeText(raw.reason ?? ''), 500), confidence: clamp01(raw.confidence),
    });
  }
  return result;
}

export function buildTeachingRelationTraversalPrompt(
  topic: KnowledgeTopic,
  blocks: TeachingBlock[],
): CompiledPrompt {
  const system = `你是知识图谱专家。第二层知识节点已经提取完成，请遍历全部节点建立内部网状关系。

关系类型可以使用 should_explain_before、defines、explains、derived_from、example_of、supports、contrasts_with、qualifies，也可根据学科内容创建简短英文关系，如 member_of、scopes、parameterizes。
只能引用输入 blockId，不要自环、重复边或强行连通。
输出 {"relations":[{"sourceBlockId":"...","targetBlockId":"...","type":"...","reason":"...","confidence":0.9}]} JSON。`;
  const user = JSON.stringify({
    topic: { id: topic.id, name: topic.name, summary: truncateText(topic.summary, 500) },
    nodes: blocks.map(block => ({
      blockId: block.id,
      type: block.type,
      category: block.category,
      title: block.title,
      summary: truncateText(block.summary, 600),
    })),
  });
  return compiled(system, user, 'teaching-relation-traversal-v1');
}

export async function extractTeachingRelationGraph(
  config: ModelConfig,
  topic: KnowledgeTopic,
  blocks: TeachingBlock[],
): Promise<TeachingRelation[]> {
  if (blocks.length < 2) return [];
  const { data } = await callChatCompletion<{ relations?: RawTeachingRelation[] }>(
    config,
    buildTeachingRelationTraversalPrompt(topic, blocks),
    'relation-extraction',
    90000,
    topic.id,
    'relation-extraction',
  );
  const validIds = new Set(blocks.map(block => block.id));
  const seen = new Set<string>();
  const result: TeachingRelation[] = [];
  for (const raw of Array.isArray(data?.relations) ? data.relations : []) {
    const sourceBlockId = raw.sourceBlockId ?? '';
    const targetBlockId = raw.targetBlockId ?? '';
    const type = truncateText(sanitizeText(raw.type ?? ''), 80);
    if (!validIds.has(sourceBlockId) || !validIds.has(targetBlockId) || sourceBlockId === targetBlockId || !type) continue;
    const key = `${sourceBlockId}:${targetBlockId}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: generateId('teaching_rel'), topicId: topic.id, sourceBlockId, targetBlockId, type,
      reason: truncateText(sanitizeText(raw.reason ?? ''), 500), confidence: clamp01(raw.confidence),
    });
  }
  return result;
}
