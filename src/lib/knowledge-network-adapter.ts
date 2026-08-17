import type {
  CourseLearningPath,
  KnowledgeTopic,
  SourceRange,
  TeachingBlock,
  TeachingRelation,
  TopicNarrativePath,
  TopicRelation,
} from '../types';

export interface KnowledgeNetworkNode {
  id: string;
  label: string;
  description: string;
  kind: 'topic' | 'teaching';
  category: string;
  importance: string;
  confidence: number;
  sourceRanges: SourceRange[];
  order: number;
  /** 当前层的遍历顺序，用于直接显示在节点上 */
  sequence?: number;
  /** 同画布展开时的层级编号，例如 2.3。 */
  sequenceLabel?: string;
  difficulty?: number;
}

export interface KnowledgeNetworkEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  label: string;
  reason: string;
  confidence: number;
  isPath: boolean;
}

export interface ExpandedNetworkGroup {
  topicId: string;
  label: string;
  nodeIds: string[];
}

export interface KnowledgeNetworkModel {
  nodes: KnowledgeNetworkNode[];
  edges: KnowledgeNetworkEdge[];
  pathEdges: KnowledgeNetworkEdge[];
  warnings: string[];
  /** 展开内部网时画布应自动聚焦的节点 */
  focusNodeIds?: string[];
  /** 当前在课程主网上展开的第二层分组。仅描述显示状态，不改变知识数据。 */
  expandedGroup?: ExpandedNetworkGroup;
}

const TOPIC_RELATION_LABELS: Record<string, string> = {
  hard_prerequisite: '硬前置',
  helpful_before: '建议先学',
  derived_from: '派生自',
  part_of: '属于',
  application_of: '应用',
  extension_of: '扩展',
  contrast_with: '对比',
  parallel_with: '并列',
};

const TEACHING_RELATION_LABELS: Record<string, string> = {
  should_explain_before: '先讲',
  defines: '定义',
  explains: '解释',
  derived_from: '推导自',
  example_of: '举例',
  supports: '支持',
  contrasts_with: '对比',
  qualifies: '限定',
};

function pathEdges(ids: string[], validIds: Set<string>, prefix: string): KnowledgeNetworkEdge[] {
  const validPath = ids.filter(id => validIds.has(id));
  return validPath.slice(0, -1).map((sourceId, index) => ({
    id: `${prefix}-${index}-${sourceId}-${validPath[index + 1]}`,
    sourceId,
    targetId: validPath[index + 1],
    type: 'recommended_path',
    label: '推荐顺序',
    reason: 'AI 推荐学习顺序',
    confidence: 1,
    isPath: true,
  }));
}

export function buildCourseNetwork(
  topics: KnowledgeTopic[],
  relations: TopicRelation[],
  learningPath: CourseLearningPath | null,
): KnowledgeNetworkModel {
  const validIds = new Set(topics.map(topic => topic.id));
  const preferredOrder = learningPath?.orderedTopicIds ?? [];
  const orderMap = new Map(preferredOrder.map((id, index) => [id, index]));
  const nodes = topics.map((topic, index): KnowledgeNetworkNode => ({
    id: topic.id,
    label: topic.name,
    description: topic.summary,
    kind: 'topic',
    category: topic.knowledgeGenre,
    importance: topic.importance,
    confidence: topic.confidence,
    sourceRanges: topic.sourceRanges,
    order: orderMap.get(topic.id) ?? preferredOrder.length + index,
    sequence: (orderMap.get(topic.id) ?? preferredOrder.length + index) + 1,
    difficulty: topic.difficulty,
  }));
  const warnings: string[] = [];
  const edges = relations.flatMap((relation): KnowledgeNetworkEdge[] => {
    if (!validIds.has(relation.sourceTopicId) || !validIds.has(relation.targetTopicId)) {
      warnings.push(`关系 ${relation.id} 引用了不存在的节点：${relation.sourceTopicId} → ${relation.targetTopicId}`);
      return [];
    }
    return [{
      id: relation.id,
      sourceId: relation.sourceTopicId,
      targetId: relation.targetTopicId,
      type: relation.type,
      label: TOPIC_RELATION_LABELS[relation.type] ?? relation.type,
      reason: relation.reason,
      confidence: relation.confidence,
      isPath: false,
    }];
  });

  return {
    nodes,
    edges,
    pathEdges: pathEdges(preferredOrder, validIds, 'course-path'),
    warnings,
  };
}

export function buildTeachingNetwork(
  topicId: string,
  blocks: TeachingBlock[],
  relations: TeachingRelation[],
  narrativePath: TopicNarrativePath | null,
): KnowledgeNetworkModel {
  const topicBlocks = blocks.filter(block => block.topicId === topicId);
  const validIds = new Set(topicBlocks.map(block => block.id));
  const preferredOrder = narrativePath?.topicId === topicId
    ? narrativePath.orderedTeachingBlockIds
    : [];
  const orderMap = new Map(preferredOrder.map((id, index) => [id, index]));
  const nodes = topicBlocks.map((block, index): KnowledgeNetworkNode => ({
    id: block.id,
    label: block.title,
    description: block.summary,
    kind: 'teaching',
    category: block.category || block.type,
    importance: block.importance,
    confidence: block.confidence,
    sourceRanges: block.sourceRanges,
    order: orderMap.get(block.id) ?? preferredOrder.length + index,
    sequence: (orderMap.get(block.id) ?? preferredOrder.length + index) + 1,
  }));
  const warnings: string[] = [];
  const edges = relations
    .filter(relation => relation.topicId === topicId)
    .flatMap((relation): KnowledgeNetworkEdge[] => {
      if (!validIds.has(relation.sourceBlockId) || !validIds.has(relation.targetBlockId)) {
        warnings.push(`内部关系 ${relation.id} 引用了不存在的节点：${relation.sourceBlockId} → ${relation.targetBlockId}`);
        return [];
      }
      return [{
        id: relation.id,
        sourceId: relation.sourceBlockId,
        targetId: relation.targetBlockId,
        type: relation.type,
        label: TEACHING_RELATION_LABELS[relation.type] ?? relation.type,
        reason: relation.reason,
        confidence: relation.confidence,
        isPath: false,
      }];
    });

  return {
    nodes,
    edges,
    pathEdges: pathEdges(preferredOrder, validIds, `topic-${topicId}-path`),
    warnings,
  };
}

