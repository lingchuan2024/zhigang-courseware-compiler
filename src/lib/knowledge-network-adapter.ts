import type {
  CourseDocument,
  CourseLearningPath,
  CourseTopic,
  EvidenceAtom,
  KnowledgePackage,
  KnowledgeTopic,
  MacroKnowledgeRelation,
  RecommendedLearningPath,
  SourceDocument,
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

const LEGACY_TOPIC_RELATION_LABELS: Record<string, string> = {
  hard_prerequisite: '硬前置',
  soft_prerequisite: '软前置',
  recommended_before: '建议先学',
  contains: '包含',
  derives_to: '推导至',
  used_by: '被使用',
  contrasts_with: '对比',
};

const LEGACY_TEACHING_RELATION_LABELS: Record<string, string> = {
  explains: '解释', defines: '定义', derived_from: '推导自', step_before: '先讲',
  example_of: '举例', illustrates: '图示', supports: '支持', contrasts_with: '对比', qualifies: '限定',
};

const LEGACY_TEACHING_TYPE_LABELS: Record<string, string> = {
  motivation: '学习动机', problem: '问题', prerequisite: '前置知识', assumption: '假设条件',
  intuition: '直观理解', definition: '定义', formula: '公式', derivation: '推导', procedure: '方法步骤',
  example: '案例', chart: '图表', comparison: '对比', condition: '适用条件', limitation: '局限',
  misconception: '常见误区', conclusion: '结论',
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

/**
 * 将选中主题的第二层网投影到同一张课程画布。
 * 第一层始终保留，第二层可以作为一个可删除的聚焦子网。
 */
export function buildExpandedKnowledgeNetwork(
  courseNetwork: KnowledgeNetworkModel,
  teachingNetwork: KnowledgeNetworkModel,
  topicId: string,
): KnowledgeNetworkModel {
  if (teachingNetwork.nodes.length === 0) return courseNetwork;

  const topicNode = courseNetwork.nodes.find(node => node.id === topicId);
  const topicLabel = topicNode?.label ?? '当前知识';
  const topicSequence = topicNode?.sequence;
  const expandedTeachingNodes = teachingNetwork.nodes.map(node => ({
    ...node,
    sequenceLabel: topicSequence !== undefined && node.sequence !== undefined
      ? `${topicSequence}.${node.sequence}`
      : node.sequence !== undefined ? String(node.sequence) : undefined,
  }));

  const firstInternalNode = [...expandedTeachingNodes]
    .sort((a, b) => a.order - b.order)[0];
  const bridge: KnowledgeNetworkEdge = {
    id: `expanded-${topicId}-${firstInternalNode.id}`,
    sourceId: topicId,
    targetId: firstInternalNode.id,
    type: 'contains_internal',
    label: '内部知识',
    reason: '当前核心知识的第二层展开结构',
    confidence: 1,
    isPath: false,
  };

  return {
    nodes: [...courseNetwork.nodes, ...expandedTeachingNodes],
    edges: [...courseNetwork.edges, bridge, ...teachingNetwork.edges],
    pathEdges: [],
    warnings: [...courseNetwork.warnings, ...teachingNetwork.warnings],
    focusNodeIds: expandedTeachingNodes.map(node => node.id),
    expandedGroup: {
      topicId,
      label: `${topicLabel} · 内部知识网`,
      nodeIds: expandedTeachingNodes.map(node => node.id),
    },
  };
}

function legacySourceRanges(evidenceIds: string[], evidenceMap: Map<string, EvidenceAtom>): SourceRange[] {
  return evidenceIds.flatMap((id): SourceRange[] => {
    const evidence = evidenceMap.get(id);
    return evidence ? [{ documentId: evidence.documentId, startBlockId: evidence.id, endBlockId: evidence.id }] : [];
  });
}

/** 将迁移前的 EvidenceAtom 投影成只读 SourceDocument，供统一原文面板精确定位。 */
export function buildLegacySourceDocuments(
  evidences: EvidenceAtom[],
  courseDocument: CourseDocument | null,
): SourceDocument[] {
  const grouped = new Map<string, EvidenceAtom[]>();
  evidences.forEach(evidence => grouped.set(evidence.documentId, [...(grouped.get(evidence.documentId) ?? []), evidence]));

  return Array.from(grouped.entries()).map(([documentId, documentEvidences]) => {
    const ordered = [...documentEvidences].sort((a, b) => a.pageNumber - b.pageNumber || a.blockIndex - b.blockIndex);
    const blocks = ordered.map((evidence, orderIndex) => ({
      id: evidence.id,
      documentId,
      type: evidence.type === 'title' ? 'heading' as const : evidence.type === 'formula' ? 'formula' as const : 'paragraph' as const,
      content: evidence.content,
      headingPath: [`第 ${evidence.pageNumber} 页`],
      orderIndex,
      contentHash: evidence.contentHash,
    }));
    return {
      id: documentId,
      courseId: courseDocument?.id ?? documentId,
      title: courseDocument?.id === documentId ? courseDocument.title : `课件 ${documentId}`,
      markdown: blocks.map(block => block.content).join('\n\n'),
      blocks,
      outline: [],
      contentHash: blocks.map(block => block.contentHash).join(':'),
      createdAt: courseDocument ? new Date(courseDocument.uploadedAt).toISOString() : '',
      updatedAt: courseDocument ? new Date(courseDocument.uploadedAt).toISOString() : '',
    };
  });
}

/** 旧版 CourseTopic 数据的第一层网络投影，不改变原始持久化数据。 */
export function buildLegacyCourseNetwork(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[],
  learningPath: RecommendedLearningPath | null,
  evidences: EvidenceAtom[],
): KnowledgeNetworkModel {
  const evidenceMap = new Map(evidences.map(evidence => [evidence.id, evidence]));
  const validIds = new Set(topics.map(topic => topic.id));
  const preferredOrder = learningPath?.topicIds ?? [];
  const pathOrder = new Map(preferredOrder.map((id, index) => [id, index]));
  const warnings: string[] = [];
  const edges = relations.flatMap((relation): KnowledgeNetworkEdge[] => {
    if (!validIds.has(relation.sourceTopicId) || !validIds.has(relation.targetTopicId)) {
      warnings.push(`关系 ${relation.id} 引用了不存在的节点：${relation.sourceTopicId} → ${relation.targetTopicId}`);
      return [];
    }
    return [{
      id: relation.id, sourceId: relation.sourceTopicId, targetId: relation.targetTopicId,
      type: relation.type, label: LEGACY_TOPIC_RELATION_LABELS[relation.type] ?? relation.type,
      reason: relation.reason, confidence: relation.confidence, isPath: false,
    }];
  });

  return {
    nodes: topics.map((topic, index) => ({
      id: topic.id,
      label: topic.title,
      description: topic.learningGoal,
      kind: 'topic' as const,
      category: topic.type,
      importance: topic.importance,
      confidence: topic.confidence,
      sourceRanges: legacySourceRanges(topic.evidenceIds, evidenceMap),
      order: pathOrder.get(topic.id) ?? preferredOrder.length + topic.recommendedOrder + index / 1000,
      sequence: (pathOrder.get(topic.id) ?? topic.recommendedOrder) + 1,
    })),
    edges,
    pathEdges: pathEdges(preferredOrder, validIds, 'legacy-course-path'),
    warnings,
  };
}

/** 旧版 KnowledgePackage 内部内容的第二层网络投影。 */
export function buildLegacyTeachingNetwork(
  topicId: string,
  packages: KnowledgePackage[],
  evidences: EvidenceAtom[],
): KnowledgeNetworkModel {
  const knowledgePackage = packages.find(item => item.topic.id === topicId);
  if (!knowledgePackage) return { nodes: [], edges: [], pathEdges: [], warnings: [] };

  const evidenceMap = new Map(evidences.map(evidence => [evidence.id, evidence]));
  const structure = knowledgePackage.internalStructure;
  const validIds = new Set(structure.items.map(item => item.id));
  const orderMap = new Map(structure.orderedItemIds.map((id, index) => [id, index]));
  const warnings = [...structure.warnings];
  const edges = structure.relations.flatMap((relation): KnowledgeNetworkEdge[] => {
    if (!validIds.has(relation.sourceItemId) || !validIds.has(relation.targetItemId)) {
      warnings.push(`内部关系 ${relation.id} 引用了不存在的节点：${relation.sourceItemId} → ${relation.targetItemId}`);
      return [];
    }
    return [{
      id: relation.id, sourceId: relation.sourceItemId, targetId: relation.targetItemId,
      type: relation.type, label: LEGACY_TEACHING_RELATION_LABELS[relation.type] ?? relation.type,
      reason: relation.reason, confidence: relation.confidence, isPath: false,
    }];
  });

  return {
    nodes: structure.items.map((item, index) => ({
      id: item.id,
      label: item.title || LEGACY_TEACHING_TYPE_LABELS[item.type] || item.type,
      description: item.content,
      kind: 'teaching' as const,
      category: item.type,
      importance: item.confidence >= 0.75 ? 'required' : 'supporting',
      confidence: item.confidence,
      sourceRanges: legacySourceRanges(item.evidenceIds, evidenceMap),
      order: orderMap.get(item.id) ?? structure.orderedItemIds.length + item.recommendedOrder + index / 1000,
      sequence: (orderMap.get(item.id) ?? item.recommendedOrder) + 1,
    })),
    edges,
    pathEdges: pathEdges(structure.orderedItemIds, validIds, `legacy-topic-${topicId}-path`),
    warnings,
  };
}
