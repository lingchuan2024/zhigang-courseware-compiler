import {
  CourseTopic,
  CourseTopicType,
  MacroKnowledgeRelation,
  MacroRelationType,
  EvidenceAtom,
} from '../types';
import { generateId } from './utils';

// ========== 有效枚举 ==========

const VALID_TOPIC_TYPES: Set<CourseTopicType> = new Set([
  'concept', 'principle', 'method', 'formula', 'problem', 'composite',
]);

const VALID_MACRO_RELATION_TYPES: Set<MacroRelationType> = new Set([
  'hard_prerequisite', 'soft_prerequisite', 'recommended_before',
  'contains', 'derives_to', 'used_by', 'contrasts_with',
]);

const PREREQUISITE_TYPES: MacroRelationType[] = [
  'hard_prerequisite',
  'soft_prerequisite',
  'recommended_before',
  'derives_to',
  'used_by',
];

const STRUCTURAL_TITLES = new Set([
  '目录', 'contents', 'table of contents',
  '总结', '小结', 'summary', 'conclusion',
  '参考资料', '参考文献', 'references', 'bibliography',
  '引言', 'introduction', '前言', 'preface',
  '封面', 'cover',
]);

// ========== 本地主题构建结果 ==========

export interface LocalTopicBuildResult {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  warnings: string[];
  diagnostics: {
    titleEvidenceCount: number;
    coveredEvidenceCount: number;
    uncoveredEvidenceIds: string[];
  };
}

export interface TopicQualityAssessment {
  acceptable: boolean;
  score: number;
  warnings: string[];
  reasons: string[];
}

// ========== 工具函数 ==========

function cleanTitleText(raw: string): string {
  // 移除编号但保留语义内容
  let cleaned = raw.trim();
  // 移除开头编号: 1. / 1、/ 1）/ 2.3 / 第一章 / 一、
  cleaned = cleaned.replace(/^(?:第[一二三四五六七八九十百千\d]+[章节节课讲]?\s*|[一二三四五六七八九十百千]+[、.）)]\s*|\d+(?:\.\d+)*\s*[.、)）]\s*|（[一二三四五六七八九十百千]+）\s*)/, '');
  // 移除Markdown #
  cleaned = cleaned.replace(/^#+\s*/, '');
  return cleaned.trim() || raw.trim();
}

function isStructuralTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  for (const st of STRUCTURAL_TITLES) {
    if (normalized.includes(st)) return true;
  }
  return false;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function generateTopicId(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
  const hash = hashString(title).toString(36).substring(0, 8);
  return `topic_${normalized.substring(0, 30)}_${hash}`;
}

function normalizedTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '').replace(/[的地得与和及]/g, '');
}

// ========== 归一化主题（从模型输出） ==========

export interface NormalizedTopic {
  title: string;
  aliases?: string[];
  type?: CourseTopicType;
  learningGoal?: string;
  importance?: 'core' | 'secondary';
  evidenceIds?: string[];
  confidence?: number;
}

export function normalizeTopics(
  modelTopics: NormalizedTopic[],
  evidences: EvidenceAtom[]
): CourseTopic[] {
  const validEvidenceIds = new Set(evidences.map(e => e.id));
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));

  // 第一步：过滤和基础校验
  const validTopics = modelTopics
    .map(t => {
      const title = (t.title || '').trim();
      if (!title || title.length > 80) return null;

      // 类型校验
      let type: CourseTopicType = 'composite';
      if (t.type && VALID_TOPIC_TYPES.has(t.type)) {
        type = t.type;
      }

      // evidenceId过滤
      const evidenceIds = (t.evidenceIds || []).filter(id => validEvidenceIds.has(id));
      if (evidenceIds.length === 0) return null;

      return {
        title,
        aliases: (t.aliases || []).map(a => a.trim()).filter(a => a.length > 0),
        type,
        learningGoal: (t.learningGoal || '').trim() || `学习${title}`,
        importance: t.importance === 'core' ? 'core' as const : 'secondary' as const,
        evidenceIds,
        confidence: Math.max(0, Math.min(1, t.confidence || 0.5)),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (validTopics.length === 0) return [];

  // 第二步：合并高度重复主题
  const merged: typeof validTopics = [];
  const keyToIndex = new Map<string, number>();

  for (const topic of validTopics) {
    const keys = [
      normalizedTitleKey(topic.title),
      ...topic.aliases.map(a => normalizedTitleKey(a)),
    ];

    let foundIndex = -1;
    for (const key of keys) {
      if (keyToIndex.has(key)) {
        foundIndex = keyToIndex.get(key)!;
        break;
      }
    }

    if (foundIndex !== -1) {
      const existing = merged[foundIndex];
      const allEvIds = new Set([...existing.evidenceIds, ...topic.evidenceIds]);
      const allAliases = new Set([...existing.aliases, ...topic.aliases, topic.title]);
      allAliases.delete(existing.title);

      merged[foundIndex] = {
        ...existing,
        evidenceIds: Array.from(allEvIds),
        aliases: Array.from(allAliases),
        confidence: Math.max(existing.confidence, topic.confidence),
        importance: existing.importance === 'core' || topic.importance === 'core' ? 'core' : 'secondary',
        learningGoal: existing.learningGoal.length > topic.learningGoal.length ? existing.learningGoal : topic.learningGoal,
      };
    } else {
      const index = merged.length;
      for (const key of keys) {
        keyToIndex.set(key, index);
      }
      merged.push(topic);
    }
  }

  // 第三步：构建CourseTopic，确保ID唯一
  const usedIds = new Set<string>();
  const topics: CourseTopic[] = merged.map((t, index) => {
    const pages = t.evidenceIds
      .map(id => evidenceMap.get(id)?.pageNumber)
      .filter((p): p is number => p !== undefined);
    const uniquePages = Array.from(new Set(pages)).sort((a, b) => a - b);
    const minPage = uniquePages.length > 0 ? Math.min(...uniquePages) : 0;

    let id = generateTopicId(t.title);
    let dedup = 1;
    while (usedIds.has(id)) {
      id = generateTopicId(`${t.title}-${dedup}`);
      dedup++;
    }
    usedIds.add(id);

    return {
      id,
      title: t.title,
      aliases: t.aliases,
      type: t.type,
      learningGoal: t.learningGoal,
      evidenceIds: t.evidenceIds,
      originalPageNumbers: uniquePages,
      importance: t.importance,
      confidence: t.confidence,
      chapterId: undefined,
      originalOrder: minPage > 0 ? minPage : index,
      recommendedOrder: index,
      noteStatus: 'pending' as const,
    };
  });

  // 按原始页码排序并设置originalOrder
  topics.sort((a, b) => {
    const pageA = a.originalPageNumbers[0] || 9999;
    const pageB = b.originalPageNumbers[0] || 9999;
    if (pageA !== pageB) return pageA - pageB;
    return a.originalOrder - b.originalOrder;
  });
  topics.forEach((t, i) => {
    t.originalOrder = i;
    t.recommendedOrder = i;
  });

  return topics;
}

// ========== 归一化关系 ==========

export interface NormalizedRelation {
  sourceTopicId: string;
  targetTopicId: string;
  type: MacroRelationType;
  evidenceIds?: string[];
  reason?: string;
  confidence?: number;
  origin?: 'courseware-explicit' | 'ai-inferred';
}

export function normalizeRelations(
  modelRelations: NormalizedRelation[],
  topics: CourseTopic[],
  evidences: EvidenceAtom[]
): MacroKnowledgeRelation[] {
  const validTopicIds = new Set(topics.map(t => t.id));
  const validEvidenceIds = new Set(evidences.map(e => e.id));

  const seen = new Set<string>();
  const relations: MacroKnowledgeRelation[] = [];

  for (const r of modelRelations) {
    // 类型校验
    if (!r.type || !VALID_MACRO_RELATION_TYPES.has(r.type)) continue;
    // 节点存在性
    if (!validTopicIds.has(r.sourceTopicId) || !validTopicIds.has(r.targetTopicId)) continue;
    // 自环
    if (r.sourceTopicId === r.targetTopicId) continue;

    // evidenceId过滤
    const validEvIds = (r.evidenceIds || []).filter(id => validEvidenceIds.has(id));

    // contrasts_with规范化：使用ID排序去重，避免A→B和B→A同时存在
    let source = r.sourceTopicId;
    let target = r.targetTopicId;
    if (r.type === 'contrasts_with' && source > target) {
      [source, target] = [target, source];
    }

    // 去重键
    const key = `${source}|${target}|${r.type}`;
    if (seen.has(key)) {
      const existing = relations.find(
        rel => rel.sourceTopicId === source && rel.targetTopicId === target && rel.type === r.type
      );
      if (existing) {
        existing.evidenceIds = Array.from(new Set([...existing.evidenceIds, ...validEvIds]));
        existing.confidence = Math.max(existing.confidence, r.confidence || 0.5);
        if (r.reason && !existing.reason) existing.reason = r.reason;
      }
      continue;
    }
    seen.add(key);

    relations.push({
      id: generateId('rel'),
      sourceTopicId: source,
      targetTopicId: target,
      type: r.type,
      evidenceIds: validEvIds,
      reason: r.reason || '',
      confidence: Math.max(0, Math.min(1, r.confidence || 0.5)),
      // AI返回的关系统一标记为ai-inferred，除非程序本地生成
      origin: r.origin === 'courseware-explicit' ? 'courseware-explicit' : 'ai-inferred',
    });
  }

  return relations;
}

// ========== 环检测 ==========

export interface CycleInfo {
  hasCycle: boolean;
  cycles: string[][];
  edgesToRemove: Array<{ source: string; target: string; confidence: number; id?: string }>;
}

function buildAdjacencyForTopo(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[]
): { adj: Map<string, string[]>; edgeInfo: Map<string, { confidence: number; source: string; target: string; id: string }> } {
  const topicIds = new Set(topics.map(t => t.id));
  const adj = new Map<string, string[]>();
  const edgeInfo = new Map<string, { confidence: number; source: string; target: string; id: string }>();

  for (const t of topics) adj.set(t.id, []);

  for (const r of relations) {
    if (!PREREQUISITE_TYPES.includes(r.type)) continue;
    if (!topicIds.has(r.sourceTopicId) || !topicIds.has(r.targetTopicId)) continue;
    adj.get(r.sourceTopicId)!.push(r.targetTopicId);
    const key = `${r.sourceTopicId}->${r.targetTopicId}`;
    const existing = edgeInfo.get(key);
    // 保留置信度最低的边用于断环（先按类型优先级，再按置信度）
    const typePriority = r.type === 'hard_prerequisite' ? 2 : r.type === 'soft_prerequisite' ? 1 : 0;
    if (!existing || r.confidence < existing.confidence || (r.confidence === existing.confidence && typePriority < 1)) {
      edgeInfo.set(key, { confidence: r.confidence, source: r.sourceTopicId, target: r.targetTopicId, id: r.id });
    }
  }

  return { adj, edgeInfo };
}

export function detectCycles(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[]
): CycleInfo {
  const { adj, edgeInfo } = buildAdjacencyForTopo(topics, relations);

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const t of topics) {
    if (!visited.has(t.id)) dfs(t.id);
  }

  const edgesToRemove: CycleInfo['edgesToRemove'] = [];
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      let lowestEdge: { source: string; target: string; confidence: number; id?: string } | null = null;
      for (let i = 0; i < cycle.length - 1; i++) {
        const key = `${cycle[i]}->${cycle[i + 1]}`;
        const edge = edgeInfo.get(key);
        if (edge) {
          // 确定性tie-breaker：置信度最低，然后是ID字母序
          if (!lowestEdge ||
              edge.confidence < lowestEdge.confidence ||
              (edge.confidence === lowestEdge.confidence && edge.id < (lowestEdge.id || ''))) {
            lowestEdge = edge;
          }
        }
      }
      if (lowestEdge) edgesToRemove.push(lowestEdge);
    }
  }

  return { hasCycle: cycles.length > 0, cycles, edgesToRemove };
}

export function breakCycles(
  relations: MacroKnowledgeRelation[],
  cycleInfo: CycleInfo
): MacroKnowledgeRelation[] {
  const toRemove = new Set(cycleInfo.edgesToRemove.map(e => `${e.source}->${e.target}`));
  return relations.filter(r => {
    if (!PREREQUISITE_TYPES.includes(r.type)) return true;
    return !toRemove.has(`${r.sourceTopicId}->${r.targetTopicId}`);
  });
}

// 循环检测直到无环（最多10轮防止无限循环）
function breakAllCycles(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[]
): { safeRelations: MacroKnowledgeRelation[]; warnings: string[] } {
  const warnings: string[] = [];
  let current = [...relations];
  let removedCount = 0;

  for (let round = 0; round < 10; round++) {
    const cycleInfo = detectCycles(topics, current);
    if (!cycleInfo.hasCycle) break;
    current = breakCycles(current, cycleInfo);
    removedCount += cycleInfo.edgesToRemove.length;
  }

  if (removedCount > 0) {
    warnings.push(`检测到前置关系环，已移除${removedCount}条低置信度边以保证学习顺序无环`);
  }

  return { safeRelations: current, warnings };
}

// ========== 稳定拓扑排序 ==========

export interface TopoResult {
  orderedTopicIds: string[];
  moves: Array<{ topicId: string; from: number; to: number; reason: string }>;
  warnings: string[];
}

export function topologicalSort(
  topics: CourseTopic[],
  relations: MacroKnowledgeRelation[]
): TopoResult {
  const warnings: string[] = [];
  const topicMap = new Map(topics.map(t => [t.id, t]));

  // 先循环断环
  const { safeRelations, warnings: cycleWarnings } = breakAllCycles(topics, relations);
  warnings.push(...cycleWarnings);

  // 构建入度和邻接表
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of topics) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const r of safeRelations) {
    if (!PREREQUISITE_TYPES.includes(r.type)) continue;
    if (!topicMap.has(r.sourceTopicId) || !topicMap.has(r.targetTopicId)) continue;
    adj.get(r.sourceTopicId)!.push(r.targetTopicId);
    inDegree.set(r.targetTopicId, (inDegree.get(r.targetTopicId) || 0) + 1);
  }

  const originalOrderMap = new Map(topics.map(t => [t.id, t.originalOrder]));
  const firstPageMap = new Map(topics.map(t => [t.id, t.originalPageNumbers[0] || 9999]));

  const result: string[] = [];
  const queue: string[] = [];

  for (const t of topics) {
    if ((inDegree.get(t.id) || 0) === 0) queue.push(t.id);
  }

  // 稳定排序函数：按页码、原始顺序、ID（确定性tie-breaker）
  const sortQueue = () => {
    queue.sort((a, b) => {
      const pageA = firstPageMap.get(a) || 9999;
      const pageB = firstPageMap.get(b) || 9999;
      if (pageA !== pageB) return pageA - pageB;
      const ordA = originalOrderMap.get(a) || 0;
      const ordB = originalOrderMap.get(b) || 0;
      if (ordA !== ordB) return ordA - ordB;
      return a.localeCompare(b);
    });
  };

  const originalPosition = new Map(topics.map((t, i) => [t.id, i]));
  const moves: TopoResult['moves'] = [];

  while (queue.length > 0) {
    sortQueue();
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // 剩余节点（环中残留或孤立）按原始顺序追加
  if (result.length < topics.length) {
    const remaining = topics
      .filter(t => !result.includes(t.id))
      .sort((a, b) => (originalOrderMap.get(a.id) || 0) - (originalOrderMap.get(b.id) || 0));
    result.push(...remaining.map(t => t.id));
    warnings.push(`${remaining.length}个节点未被前置关系连接，已按课件原始顺序追加`);
  }

  // 计算移动记录
  for (let i = 0; i < result.length; i++) {
    const id = result[i];
    const from = originalPosition.get(id) ?? i;
    if (from !== i) {
      const prereqs = safeRelations.filter(r =>
        PREREQUISITE_TYPES.includes(r.type) && r.targetTopicId === id && result.indexOf(r.sourceTopicId) < i
      );
      const reason = prereqs.length > 0
        ? `前置"${topicMap.get(prereqs[0].sourceTopicId)?.title}"需要先学习`
        : '按页码和连贯性调整';
      moves.push({ topicId: id, from, to: i, reason });
    }
  }

  return { orderedTopicIds: result, moves, warnings };
}

export function applyRecommendedOrder(
  topics: CourseTopic[],
  topoResult: TopoResult
): CourseTopic[] {
  const orderMap = new Map(topoResult.orderedTopicIds.map((id, i) => [id, i]));
  return topics.map(t => ({
    ...t,
    recommendedOrder: orderMap.get(t.id) ?? t.originalOrder,
  }));
}

export function getOrderedTopics(
  topics: CourseTopic[],
  orderMode: 'original' | 'ai-recommended'
): CourseTopic[] {
  const sorted = [...topics];
  if (orderMode === 'original') {
    sorted.sort((a, b) => a.originalOrder - b.originalOrder);
  } else {
    sorted.sort((a, b) => a.recommendedOrder - b.recommendedOrder);
  }
  return sorted;
}

export function getTopicRelations(
  topicId: string,
  relations: MacroKnowledgeRelation[]
): {
  prerequisites: MacroKnowledgeRelation[];
  dependents: MacroKnowledgeRelation[];
  related: MacroKnowledgeRelation[];
} {
  const prerequisites: MacroKnowledgeRelation[] = [];
  const dependents: MacroKnowledgeRelation[] = [];
  const related: MacroKnowledgeRelation[] = [];

  for (const r of relations) {
    const isPrereqType = PREREQUISITE_TYPES.includes(r.type);
    if (r.targetTopicId === topicId && isPrereqType) {
      prerequisites.push(r);
    } else if (r.sourceTopicId === topicId && isPrereqType) {
      dependents.push(r);
    } else if (r.sourceTopicId === topicId || r.targetTopicId === topicId) {
      related.push(r);
    }
  }

  return { prerequisites, dependents, related };
}

// ========== 本地主题构建 ==========

function isValidTitleEvidence(ev: EvidenceAtom): boolean {
  if (ev.type !== 'title') return false;
  const title = cleanTitleText(ev.content);
  if (title.length < 2) return false;
  if (title.length > 50) return false;
  return true;
}

export function generateLocalTopicsFromEvidences(
  evidences: EvidenceAtom[]
): LocalTopicBuildResult {
  const warnings: string[] = [];

  // 按证据在数组中的顺序找出有效标题
  const titleIndices: number[] = [];
  for (let i = 0; i < evidences.length; i++) {
    if (isValidTitleEvidence(evidences[i])) {
      titleIndices.push(i);
    }
  }

  // 过滤掉结构性标题（目录、总结等），但保留它们绑定的证据
  const contentTitleIndices = titleIndices.filter(idx => {
    const title = cleanTitleText(evidences[idx].content);
    return !isStructuralTitle(title);
  });

  const diagnostics = {
    titleEvidenceCount: titleIndices.length,
    coveredEvidenceCount: 0,
    uncoveredEvidenceIds: [] as string[],
  };

  if (contentTitleIndices.length === 0) {
    // 无标题：尝试从高信息证据中提取
    // 先尝试找definition/formula/procedure/comparison作为候选主题起点
    const highInfoIndices: number[] = [];
    for (let i = 0; i < evidences.length; i++) {
      const ev = evidences[i];
      if (['definition', 'formula', 'procedure', 'comparison'].includes(ev.type) && ev.content.length < 60) {
        // 避免太近的重复
        if (highInfoIndices.length === 0 || i - highInfoIndices[highInfoIndices.length - 1] > 1) {
          highInfoIndices.push(i);
        }
      }
    }

    if (highInfoIndices.length >= 2) {
      // 使用高信息块作为主题起点
      return buildTopicsFromBoundaries(evidences, highInfoIndices, diagnostics, warnings);
    }

    // 实在无法拆分：单主题降级
    warnings.push('未检测到明确章节标题，已将全部内容作为一个主题');
    const topic: CourseTopic = {
      id: generateTopicId('课程内容'),
      title: '课程内容',
      aliases: [],
      type: 'composite',
      learningGoal: '学习本课件的核心内容',
      evidenceIds: evidences.map(e => e.id),
      originalPageNumbers: Array.from(new Set(evidences.map(e => e.pageNumber))).sort((a, b) => a - b),
      importance: 'core',
      confidence: 0.3,
      originalOrder: 0,
      recommendedOrder: 0,
      noteStatus: 'pending',
    };
    diagnostics.coveredEvidenceCount = evidences.length;
    return { topics: [topic], relations: [], warnings, diagnostics };
  }

  return buildTopicsFromBoundaries(evidences, contentTitleIndices, diagnostics, warnings);
}

function buildTopicsFromBoundaries(
  evidences: EvidenceAtom[],
  boundaryIndices: number[],
  diagnostics: { titleEvidenceCount: number; coveredEvidenceCount: number; uncoveredEvidenceIds: string[] },
  warnings: string[]
): LocalTopicBuildResult {
  const topics: CourseTopic[] = [];
  const assignedEvIds = new Set<string>();

  for (let i = 0; i < boundaryIndices.length; i++) {
    const titleIdx = boundaryIndices[i];
    const nextBoundaryIdx = i < boundaryIndices.length - 1 ? boundaryIndices[i + 1] : evidences.length;

    // 左闭右开区间：[titleIdx, nextBoundaryIdx)
    const topicEvidences: EvidenceAtom[] = [];
    for (let j = titleIdx; j < nextBoundaryIdx; j++) {
      topicEvidences.push(evidences[j]);
      assignedEvIds.add(evidences[j].id);
    }

    if (topicEvidences.length === 0) continue;

    const titleEv = evidences[titleIdx];
    const cleanTitle = cleanTitleText(titleEv.content);
    const pages = Array.from(new Set(topicEvidences.map(e => e.pageNumber))).sort((a, b) => a - b);

    // 判断主题类型
    let topicType: CourseTopicType = 'composite';
    const allContent = topicEvidences.map(e => e.content).join('\n');
    if (/推导|证明|推导|推导/.test(allContent) || topicEvidences.some(e => e.type === 'formula')) {
      topicType = /推导|证明/.test(cleanTitle) ? 'principle' : 'method';
    }
    if (/定义|概念|含义/.test(cleanTitle)) topicType = 'concept';
    if (/公式|equation|formula/i.test(cleanTitle)) topicType = 'formula';

    const id = generateTopicId(cleanTitle);

    topics.push({
      id,
      title: cleanTitle,
      aliases: [],
      type: topicType,
      learningGoal: `掌握${cleanTitle}的核心内容`,
      chapterId: undefined,
      evidenceIds: topicEvidences.map(e => e.id),
      originalPageNumbers: pages,
      importance: i < Math.ceil(boundaryIndices.length / 2) ? 'core' : 'secondary',
      confidence: 0.7,
      originalOrder: i,
      recommendedOrder: i,
      noteStatus: 'pending',
    });
  }

  // 检查未分配的证据
  const uncovered = evidences.filter(e => !assignedEvIds.has(e.id));
  diagnostics.uncoveredEvidenceIds = uncovered.map(e => e.id);
  diagnostics.coveredEvidenceCount = assignedEvIds.size;

  if (uncovered.length > 0) {
    // 将封面/前置内容附加到第一个主题
    if (topics.length > 0) {
      const firstTopic = topics[0];
      const firstTopicIdx = boundaryIndices[0];
      for (let j = 0; j < firstTopicIdx; j++) {
        if (!assignedEvIds.has(evidences[j].id)) {
          firstTopic.evidenceIds.push(evidences[j].id);
          assignedEvIds.add(evidences[j].id);
        }
      }
      firstTopic.originalPageNumbers = Array.from(
        new Set([...firstTopic.originalPageNumbers, ...evidences.slice(0, firstTopicIdx).map(e => e.pageNumber)])
      ).sort((a, b) => a - b);
    }
    const remainingUncovered = evidences.filter(e => !assignedEvIds.has(e.id));
    if (remainingUncovered.length > 0) {
      warnings.push(`${remainingUncovered.length}条证据（如总结、参考资料等）未绑定到核心知识点`);
    }
  }

  // 去重originalPageNumbers
  for (const t of topics) {
    t.originalPageNumbers = Array.from(new Set(t.originalPageNumbers)).sort((a, b) => a - b);
  }

  // 为连续主题添加recommended_before关系
  const relations: MacroKnowledgeRelation[] = [];
  for (let i = 0; i < topics.length - 1; i++) {
    relations.push({
      id: generateId('rel'),
      sourceTopicId: topics[i].id,
      targetTopicId: topics[i + 1].id,
      type: 'recommended_before',
      evidenceIds: [],
      reason: '课件原始顺序',
      confidence: 0.4,
      origin: 'courseware-explicit',
    });
  }

  return { topics, relations, warnings, diagnostics };
}

// ========== 主题集合质量门 ==========

export function assessTopicSetQuality(
  topics: CourseTopic[],
  evidences: EvidenceAtom[]
): TopicQualityAssessment {
  const warnings: string[] = [];
  const reasons: string[] = [];
  let score = 100;

  const totalEvidences = evidences.length;
  const coveredEvIds = new Set<string>();
  for (const t of topics) {
    for (const id of t.evidenceIds) coveredEvIds.add(id);
  }
  const coverage = totalEvidences > 0 ? coveredEvIds.size / totalEvidences : 0;

  // 覆盖率检查
  if (coverage < 0.5) {
    score -= 40;
    reasons.push(`证据覆盖率仅${Math.round(coverage * 100)}%，过低`);
    warnings.push('主题未能覆盖大部分课件证据');
  } else if (coverage < 0.7) {
    score -= 15;
    reasons.push(`证据覆盖率${Math.round(coverage * 100)}%，偏低`);
  }

  // 单主题覆盖过多检查
  if (topics.length === 1 && totalEvidences > 5) {
    const titleEvCount = evidences.filter(e => e.type === 'title').length;
    // 如果有多个标题证据但只生成一个主题，说明异常
    if (titleEvCount >= 3) {
      score -= 50;
      reasons.push('课件有多个标题但只生成了一个主题，可能是泛化过度');
      warnings.push('AI返回了单一泛化主题，已降级到本地结构');
    } else if (totalEvidences > 15) {
      score -= 30;
      reasons.push('单主题覆盖证据过多');
    }
  }

  // 标题质量检查
  for (const t of topics) {
    if (!t.title || t.title.trim().length === 0) {
      score -= 20;
      reasons.push('存在空标题主题');
    }
    if (t.title.length > 50) {
      score -= 10;
      reasons.push(`主题"${t.title.slice(0, 20)}..."标题过长，可能包含正文`);
    }
    if (t.evidenceIds.length === 0) {
      score -= 20;
      reasons.push(`主题"${t.title}"无有效证据`);
    }
  }

  // 主题重复检查
  const titleKeys = new Map<string, number>();
  for (const t of topics) {
    const key = normalizedTitleKey(t.title);
    titleKeys.set(key, (titleKeys.get(key) || 0) + 1);
  }
  for (const [, count] of titleKeys) {
    if (count > 1) {
      score -= 10 * count;
      reasons.push(`存在${count}个高度相似的主题`);
    }
  }

  // 证据过度共享检查
  const evTopicCount = new Map<string, number>();
  for (const t of topics) {
    for (const id of t.evidenceIds) {
      evTopicCount.set(id, (evTopicCount.get(id) || 0) + 1);
    }
  }
  let overShared = 0;
  for (const [, count] of evTopicCount) {
    if (count > 3) overShared++;
  }
  if (overShared > totalEvidences * 0.2) {
    score -= 15;
    reasons.push('大量证据被无理由分配给多个主题');
  }

  const acceptable = score >= 50;

  return { acceptable, score: Math.max(0, score), warnings, reasons };
}
