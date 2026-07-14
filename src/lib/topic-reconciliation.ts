/**
 * 主题协调（全局合并）
 *
 * 将多个内容窗口提取的候选知识点（CandidateTopic）合并为全局唯一的知识点列表
 * （KnowledgeTopic[]）及主题间关系（TopicRelation[]）。
 *
 * 合并策略：
 * - 候选数量 ≤ LOCAL_MERGE_BATCH_SIZE 时：直接做一次全局合并。
 * - 候选数量 > LOCAL_MERGE_BATCH_SIZE 时：两级合并。
 *   1. 将候选分批（每批 LOCAL_MERGE_BATCH_SIZE 个），逐批做局部合并；
 *   2. 将局部合并结果转回候选知识点（topicsToCandidates）；
 *   3. 对转回的候选拟做一次全局合并，得到最终知识点与关系。
 */

import type {
  ModelConfig,
  CandidateTopic,
  KnowledgeTopic,
  TopicRelation,
  TopicRelationType,
  SourceRange,
  TopicMergeDecision,
  MarkdownBlock,
} from '../types';
import { callChatCompletion } from './model-v2';
import type { CompiledPrompt } from './prompt-builder';
import type { ModelTaskType } from './model-usage';
import { generateId, sanitizeText } from './utils';
import { ExtractionError } from './extraction-errors';

// ====================================================================
// 配置
// ====================================================================

/** 局部批次保持小尺寸，避免结构化输出因候选过多被截断。 */
const LOCAL_MERGE_BATCH_SIZE = 10;
const MAX_GLOBAL_MERGE_CANDIDATES = 20;
const MAX_COMPACTION_ROUNDS = 3;

// ====================================================================
// 运行时枚举校验集合
// ====================================================================

const VALID_TOPIC_RELATION_TYPES: Set<TopicRelationType> = new Set([
  'hard_prerequisite',
  'helpful_before',
  'derived_from',
  'part_of',
  'application_of',
  'extension_of',
  'contrast_with',
  'parallel_with',
]);

const VALID_GENRES = new Set([
  'concept',
  'mathematical_derivation',
  'algorithm',
  'system_mechanism',
  'comparison',
  'case_study',
  'mixed',
]);

const VALID_MERGE_DECISIONS: Set<TopicMergeDecision> = new Set([
  'same_topic',
  'parent_child',
  'overlapping',
  'related_but_distinct',
  'same_name_different_meaning',
  'unrelated',
]);

const VALID_IMPORTANCE = new Set(['core', 'important', 'supplementary']);

// ====================================================================
// 小工具
// ====================================================================

/**
 * 将数值限制在 [0, 1] 区间，非数字时取默认值 0.5。
 */
function clamp01(n: unknown): number {
  const c = typeof n === 'number' && Number.isFinite(n) ? n : 0.5;
  return Math.max(0, Math.min(1, c));
}

/**
 * 将数值限制在 [1, 5] 并取整，非数字时取默认值 3。
 */
function clampDifficulty(n: unknown): 1 | 2 | 3 | 4 | 5 {
  const d = typeof n === 'number' && Number.isFinite(n) ? n : 3;
  return Math.max(1, Math.min(5, Math.round(d))) as 1 | 2 | 3 | 4 | 5;
}

function normalizedCandidateName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function deduplicateExactCandidates(candidates: CandidateTopic[]): CandidateTopic[] {
  const grouped = new Map<string, CandidateTopic>();
  for (const candidate of candidates) {
    const key = normalizedCandidateName(candidate.name);
    if (!key) continue;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...candidate,
        aliases: [...new Set(candidate.aliases)],
        sourceBlockIds: [...new Set(candidate.sourceBlockIds)],
      });
      continue;
    }
    existing.aliases = [...new Set([...existing.aliases, ...candidate.aliases])];
    existing.sourceBlockIds = [...new Set([...existing.sourceBlockIds, ...candidate.sourceBlockIds])];
    if (candidate.scopeDescription.length > existing.scopeDescription.length) {
      existing.scopeDescription = candidate.scopeDescription;
    }
    if (candidate.learningObjective.length > existing.learningObjective.length) {
      existing.learningObjective = candidate.learningObjective;
    }
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
  }
  return [...grouped.values()];
}

function candidatesToReviewableTopics(
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): KnowledgeTopic[] {
  return deduplicateExactCandidates(candidates).flatMap(candidate => {
    const sourceRanges = buildSourceRanges(candidate.sourceBlockIds, allBlocks);
    if (sourceRanges.length === 0) return [];
    return [{
      id: generateId('topic'),
      courseId: '',
      name: candidate.name.trim(),
      aliases: candidate.aliases,
      summary: candidate.scopeDescription,
      learningObjective: candidate.learningObjective,
      sourceRanges,
      childTopicIds: [],
      importance: 'important' as const,
      difficulty: 3 as const,
      knowledgeGenre: 'mixed' as const,
      confidence: candidate.confidence,
      status: 'generated' as const,
    }];
  });
}

function isRecoverableMergeError(error: unknown): error is ExtractionError {
  return error instanceof ExtractionError && [
    'response-truncated',
    'json-parse-failed',
    'json-schema-mismatch',
    'model-returned-empty',
  ].includes(error.code);
}

// ====================================================================
// AI 响应的原始类型定义
// ====================================================================

/** AI 返回的单个合并后知识点（未校验） */
interface RawMergeTopic {
  name?: string;
  aliases?: string[];
  summary?: string;
  learningObjective?: string;
  knowledgeGenre?: string;
  importance?: string;
  difficulty?: number;
  sourceCandidateIds?: string[];
  sourceBlockIds?: string[];
  /** 父主题在 topics 数组中的索引（从 0 开始），无父主题时省略 */
  parentTopicIndex?: number;
  confidence?: number;
}

/** AI 返回的主题间关系（未校验） */
interface RawMergeRelation {
  sourceTopicIndex?: number;
  targetTopicIndex?: number;
  type?: string;
  reason?: string;
  confidence?: number;
}

/** AI 返回的合并决策（未校验） */
interface RawMergeDecision {
  decision?: string;
  candidateIds?: string[];
  reason?: string;
}

/** AI 全局合并的完整响应（未校验） */
interface RawMergeResponse {
  topics?: RawMergeTopic[];
  relations?: RawMergeRelation[];
  decisions?: RawMergeDecision[];
}

// ====================================================================
// buildSourceRanges
// ====================================================================

/**
 * 将一组块 ID 转换为来源范围（SourceRange[]）。
 *
 * 算法：
 * 1. 在 allBlocks 中查找每个块 ID，过滤掉不存在的；
 * 2. 按 orderIndex 升序排序；
 * 3. 将同一文档中 orderIndex 连续（前一个 +1 == 后一个）的块合并为一个范围；
 * 4. 返回 `{ documentId, startBlockId, endBlockId }` 数组。
 *
 * @param blockIds  - 候选知识点引用的块 ID 列表
 * @param allBlocks - 全部 Markdown 块（用于查找 orderIndex 与 documentId）
 * @returns 来源范围数组
 */
export function buildSourceRanges(
  blockIds: string[],
  allBlocks: MarkdownBlock[],
): SourceRange[] {
  if (blockIds.length === 0) return [];

  const blockMap = new Map<string, MarkdownBlock>();
  for (const b of allBlocks) blockMap.set(b.id, b);

  // 过滤真实存在的块，并按 orderIndex 排序
  const sorted = blockIds
    .filter(id => blockMap.has(id))
    .map(id => blockMap.get(id)!)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  if (sorted.length === 0) return [];

  const ranges: SourceRange[] = [];
  let runStart = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = i < sorted.length ? sorted[i] : null;

    // 是否仍在同一连续区间：同文档且 orderIndex 连续
    const stillContiguous =
      curr !== null &&
      curr.documentId === runStart.documentId &&
      curr.orderIndex === prev.orderIndex + 1;

    if (!stillContiguous) {
      // 当前区间在 prev 处结束
      ranges.push({
        documentId: runStart.documentId,
        startBlockId: runStart.id,
        endBlockId: prev.id,
      });
      if (curr !== null) runStart = curr;
    }
  }

  return ranges;
}

// ====================================================================
// topicsToCandidates
// ====================================================================

/**
 * 将知识点列表转换回候选知识点列表，用于二级合并。
 *
 * 从每个知识点的 sourceRanges 重建 sourceBlockIds（取每个范围的起止块 ID），
 * 并以给定前缀生成新的 temporaryId。
 *
 * @param topics - 局部合并后的知识点列表
 * @param prefix - 临时 ID 前缀（如 'lm'）
 * @returns 候选知识点列表
 */
export function topicsToCandidates(
  topics: KnowledgeTopic[],
  prefix: string,
): CandidateTopic[] {
  return topics.map((topic, idx) => {
    // 从 sourceRanges 重建 sourceBlockIds（取起止块 ID，去重）
    const sourceBlockIds: string[] = [];
    const seen = new Set<string>();
    for (const range of topic.sourceRanges) {
      for (const bid of [range.startBlockId, range.endBlockId]) {
        if (!seen.has(bid)) {
          seen.add(bid);
          sourceBlockIds.push(bid);
        }
      }
    }

    return {
      temporaryId: `${prefix}_${idx + 1}`,
      name: topic.name,
      aliases: [...topic.aliases],
      sourceBlockIds,
      scopeDescription: topic.summary,
      learningObjective: topic.learningObjective,
      confidence: topic.confidence,
    };
  });
}

// ====================================================================
// buildMergePrompt
// ====================================================================

/**
 * 构建全局合并提示词（system + user）。
 *
 * System 提示词定义了角色（课程知识整合专家）、合并决策类型、合并规则与输出 JSON 格式。
 * User 提示词列出全部候选知识点及其块引用，并附上块内容参考（每块截断至 200 字符）。
 *
 * @param candidates - 候选知识点列表
 * @param allBlocks  - 全部 Markdown 块
 * @returns 包含 system 和 user 字符串的对象
 */
export function buildMergePrompt(
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): { system: string; user: string } {
  const blockMap = new Map<string, MarkdownBlock>();
  for (const b of allBlocks) blockMap.set(b.id, b);

  const system = `你是一位课程知识整合专家。你的任务是将多个候选知识点合并为全局唯一的知识点列表。

## 合并决策类型
对任意两个候选知识点，判断它们的关系：
- same_topic：相同知识点，应合并为一个
- parent_child：父子关系，一个是另一个的更细分子主题
- overlapping：内容重叠但不完全相同，保留为独立知识点但标注关系
- related_but_distinct：相关但独立的知识点
- same_name_different_meaning：同名但含义不同，必须分开
- unrelated：无直接关系

## 合并规则
1. 名称相同、定义一致、内容范围重叠的候选 → 合并为一个知识点
2. 名称不同但实际指同一概念 → 合并，保留所有别名
3. 一个是另一个的子主题 → 建立父子关系（parentTopicIndex）
4. 同名不同义 → 必须分开，不要合并
5. 合并时不要丢失任何内容覆盖——合并后知识点的 sourceBlockIds 必须包含所有被合并候选的块
6. 公式/符号一致、学习目标一致的候选倾向于合并

## 判断维度
请综合考虑：名称相似度、定义一致性、内容范围重叠、公式/符号一致性、学习目标一致性。

## 输出格式（JSON）
\`\`\`json
{
  "topics": [
    {
      "name": "知识点名称",
      "aliases": ["别名1"],
      "summary": "简要描述（1-2句）",
      "learningObjective": "学习目标",
      "knowledgeGenre": "concept|mathematical_derivation|algorithm|system_mechanism|comparison|case_study|mixed",
      "importance": "core|important|supplementary",
      "difficulty": 1,
      "sourceCandidateIds": ["c1", "c2"],
      "sourceBlockIds": ["block-1", "block-2"],
      "parentTopicIndex": 0,
      "confidence": 0.8
    }
  ],
  "relations": [
    {
      "sourceTopicIndex": 0,
      "targetTopicIndex": 1,
      "type": "derived_from|part_of|application_of|extension_of|contrast_with|parallel_with|hard_prerequisite|helpful_before",
      "reason": "关系理由",
      "confidence": 0.7
    }
  ],
  "decisions": [
    {
      "decision": "same_topic|parent_child|overlapping|related_but_distinct|same_name_different_meaning|unrelated",
      "candidateIds": ["c1", "c2"],
      "reason": "决策理由"
    }
  ]
}
\`\`\`

注意：
- parentTopicIndex 指向 topics 数组中的父知识点索引（从 0 开始），无父主题则省略
- sourceTopicIndex / targetTopicIndex 同样指向 topics 数组索引
- sourceBlockIds 必须只使用下方提供的真实块 ID
- 合并后的知识点数量应少于或等于候选数量
- 只返回 JSON，不要输出其他内容`;

  // 构建候选列表
  const candidateLines = candidates.map((c, i) => {
    const blockRefs = c.sourceBlockIds.join(', ');
    return `### 候选 ${i + 1}（ID: ${c.temporaryId}）
- 名称: ${sanitizeText(c.name)}
- 别名: ${c.aliases.length ? c.aliases.map(a => sanitizeText(a)).join(', ') : '无'}
- 范围描述: ${sanitizeText(c.scopeDescription)}
- 学习目标: ${sanitizeText(c.learningObjective)}
- 来源块: [${blockRefs}]
- 置信度: ${c.confidence}`;
  });

  // 构建块内容映射（截断到 200 字符）
  const referencedBlockIds = new Set<string>();
  for (const c of candidates) {
    for (const bid of c.sourceBlockIds) referencedBlockIds.add(bid);
  }
  const blockLines: string[] = [];
  for (const bid of referencedBlockIds) {
    const block = blockMap.get(bid);
    if (!block) continue;
    const content =
      block.content.length > 200
        ? block.content.substring(0, 200) + '...'
        : block.content;
    blockLines.push(
      `- ${bid}（文档 ${block.documentId}）: ${sanitizeText(content)}`,
    );
  }

  const user = `## 候选知识点列表（共 ${candidates.length} 个）

${candidateLines.join('\n\n')}

## 块内容参考（每块截断至 200 字符）

${blockLines.length ? blockLines.join('\n') : '（无块内容参考）'}

请将以上候选知识点合并为全局唯一的知识点列表，输出 JSON。`;

  return { system, user };
}

// ====================================================================
// buildLocalMergePrompt（内部）
// ====================================================================

/**
 * 构建局部合并提示词（比全局更简单，只要求合并本批次内的重复候选）。
 */
function buildLocalMergePrompt(
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): { system: string; user: string } {
  const blockMap = new Map<string, MarkdownBlock>();
  for (const b of allBlocks) blockMap.set(b.id, b);

  const system = `你是一位课程知识整合专家。你的任务是将本批次内的候选知识点合并，消除重复。

## 合并规则
1. 名称相同、定义一致、内容范围重叠的候选 → 合并为一个知识点
2. 名称不同但指同一概念 → 合并，保留所有别名
3. 同名不同义 → 必须分开
4. 合并后知识点的 sourceBlockIds 必须包含所有被合并候选的块
5. 不要丢失任何内容覆盖

## 判断维度
请综合考虑：名称相似度、定义一致性、内容范围重叠、公式/符号一致性、学习目标一致性。

## 输出格式（JSON）
\`\`\`json
{
  "topics": [
    {
      "name": "知识点名称",
      "aliases": ["别名1"],
      "summary": "简要描述（1-2句）",
      "learningObjective": "学习目标",
      "knowledgeGenre": "concept|mathematical_derivation|algorithm|system_mechanism|comparison|case_study|mixed",
      "importance": "core|important|supplementary",
      "difficulty": 1,
      "sourceCandidateIds": ["c1", "c2"],
      "sourceBlockIds": ["block-1", "block-2"],
      "confidence": 0.8
    }
  ]
}
\`\`\`

注意：
- sourceBlockIds 必须只使用下方提供的真实块 ID
- 只返回 JSON，不要输出其他内容`;

  const candidateLines = candidates.map((c, i) => {
    const blockRefs = c.sourceBlockIds.join(', ');
    return `### 候选 ${i + 1}（ID: ${c.temporaryId}）
- 名称: ${sanitizeText(c.name)}
- 别名: ${c.aliases.length ? c.aliases.map(a => sanitizeText(a)).join(', ') : '无'}
- 范围描述: ${sanitizeText(c.scopeDescription)}
- 学习目标: ${sanitizeText(c.learningObjective)}
- 来源块: [${blockRefs}]
- 置信度: ${c.confidence}`;
  });

  const referencedBlockIds = new Set<string>();
  for (const c of candidates) {
    for (const bid of c.sourceBlockIds) referencedBlockIds.add(bid);
  }
  const blockLines: string[] = [];
  for (const bid of referencedBlockIds) {
    const block = blockMap.get(bid);
    if (!block) continue;
    const content =
      block.content.length > 200
        ? block.content.substring(0, 200) + '...'
        : block.content;
    blockLines.push(
      `- ${bid}（文档 ${block.documentId}）: ${sanitizeText(content)}`,
    );
  }

  const user = `## 候选知识点列表（共 ${candidates.length} 个）

${candidateLines.join('\n\n')}

## 块内容参考（每块截断至 200 字符）

${blockLines.length ? blockLines.join('\n') : '（无块内容参考）'}

请将以上候选知识点合并，消除本批次内的重复，输出 JSON。`;

  return { system, user };
}

// ====================================================================
// parseMergeResponse
// ====================================================================

/**
 * 解析 AI 全局合并响应，转换为知识点列表与主题间关系。
 *
 * 校验逻辑：
 * - 响应为空或 topics 缺失 → 抛 ExtractionError（model-returned-empty / json-schema-mismatch）
 * - 逐个校验 topic：name 非空、sourceBlockIds 必须全部存在于 allBlocks
 * - 生成稳定 ID（topic_{timestamp}_{random}）
 * - 从 sourceBlockIds 构建 SourceRanges
 * - 解析 parentTopicIndex → 设置 parentTopicId / childTopicIds
 * - 解析 relations → 解析索引为已生成 ID，构建 TopicRelation
 *
 * @param response   - AI 原始响应（unknown）
 * @param candidates - 候选知识点列表（用于校验候选 ID 引用）
 * @param allBlocks  - 全部 Markdown 块（用于校验块 ID 与构建来源范围）
 * @returns 知识点列表与主题间关系
 */
export function parseMergeResponse(
  response: unknown,
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): { topics: KnowledgeTopic[]; relations: TopicRelation[] } {
  if (!response || typeof response !== 'object') {
    throw new ExtractionError(
      'json-schema-mismatch',
      'global-merge',
      '合并响应不是有效对象',
    );
  }

  const data = response as RawMergeResponse;
  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new ExtractionError(
      'model-returned-empty',
      'global-merge',
      '模型返回了空的 topics 数组',
    );
  }

  const validBlockIds = new Set(allBlocks.map(b => b.id));
  const validCandidateIds = new Set(candidates.map(c => c.temporaryId));

  // 第一遍：生成稳定 ID，构建知识点（暂不设父子关系）
  const topics: KnowledgeTopic[] = [];
  const indexToId = new Map<number, string>();

  for (let i = 0; i < data.topics.length; i++) {
    const t = data.topics[i];

    // name 必须非空
    if (!t.name || !t.name.trim()) continue;

    // sourceBlockIds 必须全部有效；过滤后为空则跳过
    const rawBlockIds = Array.isArray(t.sourceBlockIds) ? t.sourceBlockIds : [];
    const sourceBlockIds = rawBlockIds.filter(id => validBlockIds.has(id));
    if (sourceBlockIds.length === 0) continue;

    // sourceCandidateIds 校验（仅保留真实存在的候选 ID）
    const sourceCandidateIds = Array.isArray(t.sourceCandidateIds)
      ? t.sourceCandidateIds.filter(id => validCandidateIds.has(id))
      : [];

    // 若该知识点引用了候选 ID，确认覆盖（日志用途，不阻断）
    void sourceCandidateIds;

    const topicId = generateId('topic');
    indexToId.set(i, topicId);

    const genre = VALID_GENRES.has(t.knowledgeGenre as string)
      ? (t.knowledgeGenre as KnowledgeTopic['knowledgeGenre'])
      : 'mixed';

    const importance = VALID_IMPORTANCE.has(t.importance as string)
      ? (t.importance as 'core' | 'important' | 'supplementary')
      : 'important';

    topics.push({
      id: topicId,
      courseId: '',
      name: t.name.trim(),
      aliases: Array.isArray(t.aliases) ? t.aliases.map(a => String(a).trim()).filter(Boolean) : [],
      summary: t.summary?.trim() || '',
      learningObjective: t.learningObjective?.trim() || '',
      sourceRanges: buildSourceRanges(sourceBlockIds, allBlocks),
      childTopicIds: [],
      importance,
      difficulty: clampDifficulty(t.difficulty),
      knowledgeGenre: genre,
      confidence: clamp01(t.confidence),
      status: 'generated',
      // parentTopicId 在第二遍设置
    });
  }

  if (topics.length === 0) {
    throw new ExtractionError(
      'model-returned-empty',
      'global-merge',
      '过滤无效块 ID 后没有有效知识点',
    );
  }

  // 第二遍：设置父子关系
  for (let i = 0; i < data.topics.length; i++) {
    const t = data.topics[i];
    const childId = indexToId.get(i);
    if (childId === undefined) continue;
    if (t.parentTopicIndex === undefined || t.parentTopicIndex === null) continue;

    const parentId = indexToId.get(t.parentTopicIndex);
    if (parentId === undefined || parentId === childId) continue;

    const childTopic = topics.find(tp => tp.id === childId);
    if (childTopic) {
      childTopic.parentTopicId = parentId;
    }
    const parentTopic = topics.find(tp => tp.id === parentId);
    if (parentTopic && !parentTopic.childTopicIds.includes(childId)) {
      parentTopic.childTopicIds.push(childId);
    }
  }

  // 第三遍：构建主题间关系
  const relations: TopicRelation[] = [];
  const rawRelations = Array.isArray(data.relations) ? data.relations : [];
  for (const r of rawRelations) {
    if (
      r.sourceTopicIndex === undefined ||
      r.targetTopicIndex === undefined
    ) {
      continue;
    }
    if (!r.type || !VALID_TOPIC_RELATION_TYPES.has(r.type as TopicRelationType)) {
      continue;
    }

    const sourceId = indexToId.get(r.sourceTopicIndex);
    const targetId = indexToId.get(r.targetTopicIndex);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    relations.push({
      id: generateId('trel'),
      sourceTopicId: sourceId,
      targetTopicId: targetId,
      type: r.type as TopicRelationType,
      reason: r.reason?.trim() || '',
      confidence: clamp01(r.confidence),
    });
  }

  return { topics, relations };
}

// ====================================================================
// parseLocalMergeResponse（内部）
// ====================================================================

/**
 * 解析局部合并响应，返回合并后的知识点列表（不含关系）。
 *
 * 与 parseMergeResponse 类似但更简单：不解析 relations / decisions，
 * 不设置父子关系。阶段为 'local-merge'。
 */
function parseLocalMergeResponse(
  response: unknown,
  allBlocks: MarkdownBlock[],
): KnowledgeTopic[] {
  if (!response || typeof response !== 'object') {
    throw new ExtractionError(
      'json-schema-mismatch',
      'local-merge',
      '局部合并响应不是有效对象',
    );
  }

  const data = response as { topics?: RawMergeTopic[] };
  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new ExtractionError(
      'model-returned-empty',
      'local-merge',
      '局部合并返回了空的 topics 数组',
    );
  }

  const validBlockIds = new Set(allBlocks.map(b => b.id));
  const topics: KnowledgeTopic[] = [];

  for (const t of data.topics) {
    if (!t.name || !t.name.trim()) continue;

    const rawBlockIds = Array.isArray(t.sourceBlockIds) ? t.sourceBlockIds : [];
    const sourceBlockIds = rawBlockIds.filter(id => validBlockIds.has(id));
    if (sourceBlockIds.length === 0) continue;

    const genre = VALID_GENRES.has(t.knowledgeGenre as string)
      ? (t.knowledgeGenre as KnowledgeTopic['knowledgeGenre'])
      : 'mixed';

    const importance = VALID_IMPORTANCE.has(t.importance as string)
      ? (t.importance as 'core' | 'important' | 'supplementary')
      : 'important';

    topics.push({
      id: generateId('topic'),
      courseId: '',
      name: t.name.trim(),
      aliases: Array.isArray(t.aliases) ? t.aliases.map(a => String(a).trim()).filter(Boolean) : [],
      summary: t.summary?.trim() || '',
      learningObjective: t.learningObjective?.trim() || '',
      sourceRanges: buildSourceRanges(sourceBlockIds, allBlocks),
      childTopicIds: [],
      importance,
      difficulty: clampDifficulty(t.difficulty),
      knowledgeGenre: genre,
      confidence: clamp01(t.confidence),
      status: 'generated',
    });
  }

  if (topics.length === 0) {
    throw new ExtractionError(
      'model-returned-empty',
      'local-merge',
      '过滤无效块 ID 后没有有效知识点',
    );
  }

  return topics;
}

// ====================================================================
// extractDecisions（内部）
// ====================================================================

/**
 * 从 AI 全局合并响应中提取合并决策类型列表。
 */
function extractDecisions(response: unknown): TopicMergeDecision[] {
  if (!response || typeof response !== 'object') return [];
  const data = response as RawMergeResponse;
  if (!Array.isArray(data.decisions)) return [];

  const result: TopicMergeDecision[] = [];
  for (const d of data.decisions) {
    if (
      d.decision &&
      VALID_MERGE_DECISIONS.has(d.decision as TopicMergeDecision)
    ) {
      result.push(d.decision as TopicMergeDecision);
    }
  }
  return result;
}

// ====================================================================
// 内部：构建 CompiledPrompt
// ====================================================================

/**
 * 从 { system, user } 构建 CompiledPrompt，用于 callChatCompletion。
 */
function toCompiledPrompt(
  system: string,
  user: string,
  promptVersion: string,
): CompiledPrompt {
  return {
    system,
    stablePrefix: system,
    dynamicInput: user,
    promptVersion,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

// ====================================================================
// performGlobalMerge（内部）
// ====================================================================

/**
 * 执行全局合并，返回知识点、关系与合并决策（含决策列表，供 reconcileTopics 使用）。
 *
 * @internal
 */
async function performGlobalMerge(
  config: ModelConfig,
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): Promise<{
  topics: KnowledgeTopic[];
  relations: TopicRelation[];
  decisions: TopicMergeDecision[];
}> {
  const { system, user } = buildMergePrompt(candidates, allBlocks);
  const compiled = toCompiledPrompt(system, user, 'topic-reconciliation-v1');

  const { data } = await callChatCompletion<unknown>(
    config,
    compiled,
    'topic-merge' as ModelTaskType,
    120000,
    undefined,
    'global-merge',
  );

  const { topics, relations } = parseMergeResponse(data, candidates, allBlocks);
  const decisions = extractDecisions(data);

  return { topics, relations, decisions };
}

// ====================================================================
// globalMerge（导出）
// ====================================================================

/**
 * 全局合并：将候选知识点交给 AI，合并为全局唯一的知识点列表与主题间关系。
 *
 * AI 需要完成：
 * 1. 判断候选之间的关系（same_topic / parent_child / overlapping /
 *    related_but_distinct / same_name_different_meaning / unrelated）；
 * 2. 将 same_topic 的候选合并为一个知识点；
 * 3. 为 parent_child 决策建立父子关系；
 * 4. 输出最终唯一的知识点列表（SourceRanges 由块 ID 推导）；
 * 5. 输出 derived_from / part_of 等主题间关系。
 *
 * 生成的知识点 ID 格式为 `topic_{timestamp}_{random}`。
 * 若 AI 返回空知识点列表，抛出 ExtractionError（code: 'model-returned-empty',
 * stage: 'global-merge'）。
 *
 * @param config     - 模型配置
 * @param candidates - 候选知识点列表
 * @param allBlocks  - 全部 Markdown 块
 * @returns 知识点列表与主题间关系
 */
export async function globalMerge(
  config: ModelConfig,
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): Promise<{ topics: KnowledgeTopic[]; relations: TopicRelation[] }> {
  if (candidates.length === 0) {
    return { topics: [], relations: [] };
  }

  const { topics, relations } = await performGlobalMerge(
    config,
    candidates,
    allBlocks,
  );
  return { topics, relations };
}

// ====================================================================
// localMerge（导出）
// ====================================================================

/**
 * 局部合并：对一批候选知识点做合并，消除批次内重复。
 *
 * 与 globalMerge 类似但更简单：只要求合并本批次内的相同候选，
 * 不提取主题间关系，不建立父子关系。返回合并后的知识点列表。
 *
 * @param config     - 模型配置
 * @param candidates - 本批次候选知识点列表
 * @param allBlocks  - 全部 Markdown 块
 * @returns 合并后的知识点列表
 */
export async function localMerge(
  config: ModelConfig,
  candidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): Promise<KnowledgeTopic[]> {
  if (candidates.length === 0) return [];

  const { system, user } = buildLocalMergePrompt(candidates, allBlocks);
  const compiled = toCompiledPrompt(system, user, 'local-merge-v1');

  const { data } = await callChatCompletion<unknown>(
    config,
    compiled,
    'topic-merge' as ModelTaskType,
    120000,
    undefined,
    'local-merge',
  );

  return parseLocalMergeResponse(data, allBlocks);
}

// ====================================================================
// reconcileTopics（导出）
// ====================================================================

/**
 * 主题协调入口：将多个窗口提取的候选知识点合并为全局唯一的知识点列表。
 *
 * - 候选数量 ≤ LOCAL_MERGE_BATCH_SIZE：直接做一次全局合并。
 * - 候选数量 > LOCAL_MERGE_BATCH_SIZE：两级合并。
 *   1. 将候选按 LOCAL_MERGE_BATCH_SIZE 分批，逐批调用 localMerge；
 *   2. 将局部合并结果通过 topicsToCandidates 转回候选知识点；
 *   3. 对转回的候选拟做一次全局合并（globalMerge），得到最终知识点与关系。
 *
 * @param config        - 模型配置
 * @param allCandidates - 全部候选知识点（来自多个窗口）
 * @param allBlocks     - 全部 Markdown 块
 * @returns 知识点列表、主题间关系、合并决策列表
 */
export async function reconcileTopics(
  config: ModelConfig,
  allCandidates: CandidateTopic[],
  allBlocks: MarkdownBlock[],
): Promise<{
  topics: KnowledgeTopic[];
  relations: TopicRelation[];
  mergeDecisions: TopicMergeDecision[];
  mergeWarnings: string[];
}> {
  const mergeWarnings: string[] = [];
  let currentCandidates = deduplicateExactCandidates(allCandidates);

  // 无候选 → 直接返回空
  if (currentCandidates.length === 0) {
    return { topics: [], relations: [], mergeDecisions: [], mergeWarnings };
  }

  for (let round = 0; currentCandidates.length > MAX_GLOBAL_MERGE_CANDIDATES && round < MAX_COMPACTION_ROUNDS; round++) {
    const compacted: CandidateTopic[] = [];
    for (let offset = 0; offset < currentCandidates.length; offset += LOCAL_MERGE_BATCH_SIZE) {
      const batch = currentCandidates.slice(offset, offset + LOCAL_MERGE_BATCH_SIZE);
      try {
        const merged = await localMerge(config, batch, allBlocks);
        compacted.push(...topicsToCandidates(merged, `lm${round}_${offset}`));
      } catch (error) {
        if (!isRecoverableMergeError(error)) throw error;
        mergeWarnings.push(`第 ${round + 1} 轮局部合并输出异常，已保留该批 AI 候选`);
        compacted.push(...batch);
      }
    }

    const nextCandidates = deduplicateExactCandidates(compacted);
    if (nextCandidates.length >= currentCandidates.length) {
      currentCandidates = nextCandidates;
      break;
    }
    currentCandidates = nextCandidates;
  }

  if (currentCandidates.length > MAX_GLOBAL_MERGE_CANDIDATES) {
    mergeWarnings.push('候选数量仍较多，为避免超长 JSON，已保留 AI 候选供审核');
    return {
      topics: candidatesToReviewableTopics(currentCandidates, allBlocks),
      relations: [],
      mergeDecisions: [],
      mergeWarnings,
    };
  }

  try {
    const { topics, relations, decisions } = await performGlobalMerge(config, currentCandidates, allBlocks);
    return { topics, relations, mergeDecisions: decisions, mergeWarnings };
  } catch (error) {
    if (!isRecoverableMergeError(error)) throw error;
    mergeWarnings.push('全局合并 JSON 输出异常，已保留 AI 提取候选作为可审核知识结构');
    return {
      topics: candidatesToReviewableTopics(currentCandidates, allBlocks),
      relations: [],
      mergeDecisions: [],
      mergeWarnings,
    };
  }
}
