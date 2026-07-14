import type {
  MarkdownBlock,
  KnowledgeTopic,
  TeachingBlock,
  TopicRelation,
  SourceRange,
  TopicNote,
} from '../types';

// ========== 类型定义 ==========

/**
 * 校验问题 — 单条校验发现
 */
export interface ValidationIssue {
  /** 问题代码，如 ORPHAN_BLOCK、TOPIC_NO_SOURCE */
  code: string;
  /** 人类可读的问题描述 */
  message: string;
  /** 关联的知识点 ID（如适用） */
  topicId?: string;
  /** 关联的块 ID（如适用） */
  blockId?: string;
  /** 严重程度：error 或 warning */
  severity: 'error' | 'warning';
}

/**
 * 校验报告 — 知识结构校验的完整结果
 */
export interface ValidationReport {
  /** 错误列表（阻断性问题） */
  errors: ValidationIssue[];
  /** 警告列表（非阻断性问题） */
  warnings: ValidationIssue[];
  /** Markdown 块覆盖统计 */
  coverage: {
    totalBlocks: number;
    assignedBlocks: number;
    unassignedBlocks: string[];
    coverageRate: number;
  };
  /** 知识点统计 */
  topicStats: {
    totalTopics: number;
    topicsWithTeachingBlocks: number;
    avgTeachingBlocksPerTopic: number;
  };
  /** 结构质量问题摘要（人类可读字符串列表） */
  qualityIssues: string[];
}

// ========== 常量 ==========

/**
 * 泛化知识点名称列表 — 这些名称过于笼统，无法形成独立学习目标
 */
const GENERIC_TOPIC_NAMES: readonly string[] = [
  '课程内容',
  '课件内容',
  '本章内容',
  '综合内容',
  '主要内容',
  '课程概述',
  '概述',
  '总结',
  '其他内容',
  '补充内容',
  '综合知识',
  '本章知识',
  '知识总结',
];

// ========== 辅助函数 ==========

/**
 * 判断知识点名称是否过于泛化。
 *
 * 检查名称是否匹配泛化名称列表（精确匹配或包含匹配），
 * 空名称也视为泛化。
 *
 * @param name - 待检测的知识点名称
 * @returns 若名称泛化或为空则返回 true
 */
export function isGenericTopicName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  return GENERIC_TOPIC_NAMES.some(
    g => trimmed === g || trimmed.includes(g)
  );
}

/**
 * 收集所有被知识点和讲解块直接引用的块 ID。
 *
 * 遍历所有 sourceRanges，收集 startBlockId 与 endBlockId。
 * 注意：此函数仅收集范围端点，不展开中间块。
 * 如需获取范围内全部块，请使用内部函数 getAllAssignedBlockIds。
 *
 * @param topics - 知识点列表
 * @param teachingBlocks - 讲解块列表
 * @returns 被引用的块 ID 集合
 */
export function getAssignedBlockIds(
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[]
): Set<string> {
  const ids = new Set<string>();

  for (const topic of topics) {
    for (const range of topic.sourceRanges ?? []) {
      ids.add(range.startBlockId);
      ids.add(range.endBlockId);
    }
  }

  for (const tb of teachingBlocks) {
    for (const range of tb.sourceRanges ?? []) {
      ids.add(range.startBlockId);
      ids.add(range.endBlockId);
    }
  }

  return ids;
}

/**
 * 将来源范围展开为范围内全部块 ID（含端点）。
 *
 * 通过 orderIndex 在同一文档内定位起始块与结束块，
 * 收集两者之间（含）的所有块 ID。
 *
 * @param range - 来源范围
 * @param blocks - 全部 Markdown 块（用于定位与展开）
 * @returns 范围内的块 ID 列表；若端点无效则返回空数组
 */
function expandSourceRange(
  range: SourceRange,
  blocks: MarkdownBlock[]
): string[] {
  const startBlock = blocks.find(
    b => b.id === range.startBlockId && b.documentId === range.documentId
  );
  const endBlock = blocks.find(
    b => b.id === range.endBlockId && b.documentId === range.documentId
  );

  // 端点缺失时无法确定区间，返回空
  if (!startBlock || !endBlock) return [];

  const lo = Math.min(startBlock.orderIndex, endBlock.orderIndex);
  const hi = Math.max(startBlock.orderIndex, endBlock.orderIndex);

  return blocks
    .filter(
      b =>
        b.documentId === range.documentId &&
        b.orderIndex >= lo &&
        b.orderIndex <= hi
    )
    .map(b => b.id);
}

/**
 * 收集所有被知识点和讲解块覆盖的块 ID（展开范围后的完整集合）。
 *
 * 与 getAssignedBlockIds 不同，此函数会展开每个 sourceRange，
 * 收集区间内的全部块 ID，用于精确的覆盖率计算。
 *
 * @param topics - 知识点列表
 * @param teachingBlocks - 讲解块列表
 * @param blocks - 全部 Markdown 块
 * @returns 被覆盖的块 ID 集合
 */
function getAllAssignedBlockIds(
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  blocks: MarkdownBlock[]
): Set<string> {
  const ids = new Set<string>();

  for (const topic of topics) {
    for (const range of topic.sourceRanges ?? []) {
      for (const blockId of expandSourceRange(range, blocks)) {
        ids.add(blockId);
      }
    }
  }

  for (const tb of teachingBlocks) {
    for (const range of tb.sourceRanges ?? []) {
      for (const blockId of expandSourceRange(range, blocks)) {
        ids.add(blockId);
      }
    }
  }

  return ids;
}

/**
 * 在硬前置关系（hard_prerequisite）中查找环路。
 *
 * 基于 sourceTopicId → targetTopicId 构建有向图，
 * 使用三色 DFS（白/灰/黑）检测回边，提取环路节点序列。
 * 返回的环路会经过去重（旋转到最小 ID 起始）。
 *
 * @param relations - 主题间关系列表
 * @returns 环路列表，每条环路为话题 ID 数组
 */
export function findRelationCycles(relations: TopicRelation[]): string[][] {
  // 仅 hard_prerequisite 关系构成有向图
  const edges = new Map<string, string[]>();
  for (const r of relations) {
    if (r.type === 'hard_prerequisite') {
      if (!edges.has(r.sourceTopicId)) {
        edges.set(r.sourceTopicId, []);
      }
      edges.get(r.sourceTopicId)!.push(r.targetTopicId);
    }
  }

  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  /** 0=未访问, 1=在当前路径中(灰), 2=已完成(黑) */
  const color = new Map<string, number>();
  const path: string[] = [];

  /**
   * 将环路旋转到以最小 ID 开头，用于去重。
   */
  function normalizeCycle(cycle: string[]): string[] {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i] < cycle[minIdx]) minIdx = i;
    }
    return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
  }

  function dfs(node: string): void {
    color.set(node, 1); // 标记为灰（进入当前路径）
    path.push(node);

    for (const next of edges.get(node) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 0) {
        // 未访问，继续深入
        dfs(next);
      } else if (c === 1) {
        // 回边：发现环路
        const cycleStart = path.indexOf(next);
        const cycle = path.slice(cycleStart);
        const normalized = normalizeCycle(cycle);
        const key = normalized.join('->');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(normalized);
        }
      }
      // c === 2（黑）：已完成，跳过
    }

    path.pop();
    color.set(node, 2); // 标记为黑（完成）
  }

  // 从所有节点出发，确保覆盖不连通的子图
  const allNodes = new Set<string>();
  for (const [src, targets] of edges) {
    allNodes.add(src);
    for (const t of targets) allNodes.add(t);
  }

  for (const node of allNodes) {
    if ((color.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }

  return cycles;
}

// ========== 校验检查 ==========

/**
 * 检查 1：Markdown 覆盖检查
 *
 * 每个非空内容块必须属于某个知识点（通过 sourceRanges），
 * 或被显式标记为未分配（课程导言、导航、过渡、练习、参考等）。
 * 孤立块（未分配的非空块）报告为警告，并计算覆盖率。
 *
 * @param blocks - 全部 Markdown 块
 * @param topics - 知识点列表
 * @param teachingBlocks - 讲解块列表
 * @returns 孤立块警告与覆盖率统计
 */
export function validateBlockCoverage(
  blocks: MarkdownBlock[],
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[]
): { issues: ValidationIssue[]; coverage: ValidationReport['coverage'] } {
  const issues: ValidationIssue[] = [];
  const assignedBlockIds = getAllAssignedBlockIds(
    topics,
    teachingBlocks,
    blocks
  );

  const unassignedBlocks: string[] = [];

  for (const block of blocks) {
    if (!assignedBlockIds.has(block.id)) {
      unassignedBlocks.push(block.id);

      // 仅对非空内容块发出警告
      if (block.content.trim().length > 0) {
        const preview = block.content.slice(0, 50).replace(/\n/g, ' ');
        issues.push({
          code: 'ORPHAN_BLOCK',
          message: `内容块未被任何知识点覆盖: "${preview}…"`,
          blockId: block.id,
          severity: 'warning',
        });
      }
    }
  }

  const totalBlocks = blocks.length;
  const assignedBlocks = totalBlocks - unassignedBlocks.length;
  const coverageRate =
    totalBlocks > 0 ? assignedBlocks / totalBlocks : 0;

  return {
    issues,
    coverage: {
      totalBlocks,
      assignedBlocks,
      unassignedBlocks,
      coverageRate,
    },
  };
}

/**
 * 检查 2：知识来源检查
 *
 * 每个知识点必须至少有一个 SourceRange，
 * 且每个 SourceRange 的 startBlockId 与 endBlockId 必须引用有效的块 ID。
 * 无来源范围的知识点报告为错误，引用无效块 ID 也报告为错误。
 *
 * @param topics - 知识点列表
 * @param blocks - 全部 Markdown 块
 * @returns 校验问题列表
 */
export function validateTopicSources(
  topics: KnowledgeTopic[],
  blocks: MarkdownBlock[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validBlockIds = new Set(blocks.map(b => b.id));

  for (const topic of topics) {
    const ranges = topic.sourceRanges ?? [];

    if (ranges.length === 0) {
      issues.push({
        code: 'TOPIC_NO_SOURCE',
        message: `知识点"${topic.name}"没有来源范围（sourceRanges 为空）`,
        topicId: topic.id,
        severity: 'error',
      });
      continue;
    }

    for (const range of ranges) {
      if (!validBlockIds.has(range.startBlockId)) {
        issues.push({
          code: 'INVALID_SOURCE_BLOCK',
          message: `知识点"${topic.name}"的来源范围引用了无效的起始块: ${range.startBlockId}`,
          topicId: topic.id,
          blockId: range.startBlockId,
          severity: 'error',
        });
      }
      if (!validBlockIds.has(range.endBlockId)) {
        issues.push({
          code: 'INVALID_SOURCE_BLOCK',
          message: `知识点"${topic.name}"的来源范围引用了无效的结束块: ${range.endBlockId}`,
          topicId: topic.id,
          blockId: range.endBlockId,
          severity: 'error',
        });
      }
    }
  }

  return issues;
}

/**
 * 检查 3：讲法来源检查
 *
 * 每个讲解块必须拥有 sourceRanges，
 * 且每个 sourceRange 的 startBlockId 与 endBlockId 必须引用有效的块 ID。
 * 无来源范围的讲解块报告为错误，引用无效块 ID 也报告为错误。
 *
 * @param teachingBlocks - 讲解块列表
 * @param blocks - 全部 Markdown 块
 * @returns 校验问题列表
 */
export function validateTeachingBlockSources(
  teachingBlocks: TeachingBlock[],
  blocks: MarkdownBlock[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const validBlockIds = new Set(blocks.map(b => b.id));

  for (const tb of teachingBlocks) {
    const ranges = tb.sourceRanges ?? [];

    if (ranges.length === 0) {
      issues.push({
        code: 'TEACHING_BLOCK_NO_SOURCE',
        message: `讲解块"${tb.title}"没有来源范围（sourceRanges 为空）`,
        blockId: tb.id,
        severity: 'error',
      });
      continue;
    }

    for (const range of ranges) {
      if (!validBlockIds.has(range.startBlockId)) {
        issues.push({
          code: 'INVALID_SOURCE_BLOCK',
          message: `讲解块"${tb.title}"的来源范围引用了无效的起始块: ${range.startBlockId}`,
          blockId: tb.id,
          severity: 'error',
        });
      }
      if (!validBlockIds.has(range.endBlockId)) {
        issues.push({
          code: 'INVALID_SOURCE_BLOCK',
          message: `讲解块"${tb.title}"的来源范围引用了无效的结束块: ${range.endBlockId}`,
          blockId: tb.id,
          severity: 'error',
        });
      }
    }
  }

  return issues;
}

/**
 * 检查 4：结构质量检查
 *
 * 检查以下结构质量问题（均报告为警告）：
 * 1. 泛化知识点名称（"课程内容"、"综合知识"等）
 * 2. 重复知识点（同名或来源块重叠率 > 60%）
 * 3. 缺少讲解块的知识点
 * 4. 核心知识点缺少关键讲法类型（definition 或 formula）
 * 5. 硬前置关系环路
 *
 * @param topics - 知识点列表
 * @param teachingBlocks - 讲解块列表
 * @param relations - 主题间关系列表
 * @returns 校验问题与质量摘要
 */
export function validateStructureQuality(
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  relations: TopicRelation[]
): { issues: ValidationIssue[]; qualityIssues: string[] } {
  const issues: ValidationIssue[] = [];
  const qualityIssues: string[] = [];

  // --- 4.1 泛化知识点名称 ---
  for (const topic of topics) {
    if (isGenericTopicName(topic.name)) {
      issues.push({
        code: 'GENERIC_TOPIC_NAME',
        message: `知识点名称"${topic.name}"过于泛化，应使用更具体的名称`,
        topicId: topic.id,
        severity: 'warning',
      });
      qualityIssues.push(
        `知识点"${topic.name}"（${topic.id}）名称过于泛化`
      );
    }
  }

  // --- 4.2 重复知识点（同名或来源块重叠 > 60%）---
  // 以 startBlockId/endBlockId 集合作为来源块代理
  const topicBlockSets = new Map<string, Set<string>>();
  for (const topic of topics) {
    const blockSet = new Set<string>();
    for (const range of topic.sourceRanges ?? []) {
      blockSet.add(range.startBlockId);
      blockSet.add(range.endBlockId);
    }
    topicBlockSets.set(topic.id, blockSet);
  }

  const reportedDupPairs = new Set<string>();
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const a = topics[i];
      const b = topics[j];
      let isDuplicate = false;
      let reason = '';

      // 同名检测（忽略大小写与首尾空白）
      if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) {
        isDuplicate = true;
        reason = `名称相同"${a.name}"`;
      } else {
        // 来源块重叠率检测（Jaccard 相似度）
        const setA = topicBlockSets.get(a.id)!;
        const setB = topicBlockSets.get(b.id)!;
        if (setA.size > 0 && setB.size > 0) {
          let intersection = 0;
          for (const id of setA) {
            if (setB.has(id)) intersection++;
          }
          const unionSize = new Set([...setA, ...setB]).size;
          const overlap = unionSize > 0 ? intersection / unionSize : 0;
          if (overlap > 0.6) {
            isDuplicate = true;
            reason = `来源块重叠率 ${(overlap * 100).toFixed(0)}% 超过 60%`;
          }
        }
      }

      if (isDuplicate) {
        const pairKey = [a.id, b.id].sort().join('|');
        if (!reportedDupPairs.has(pairKey)) {
          reportedDupPairs.add(pairKey);
          issues.push({
            code: 'DUPLICATE_TOPIC',
            message: `知识点"${a.name}"与"${b.name}"可能重复（${reason}）`,
            topicId: a.id,
            severity: 'warning',
          });
          qualityIssues.push(
            `知识点"${a.name}"与"${b.name}"可能重复（${reason}）`
          );
        }
      }
    }
  }

  // --- 4.3 缺少讲解块的知识点 ---
  // 预建 topicId → 讲解块列表 索引
  const topicTeachingBlocks = new Map<string, TeachingBlock[]>();
  for (const tb of teachingBlocks) {
    if (!topicTeachingBlocks.has(tb.topicId)) {
      topicTeachingBlocks.set(tb.topicId, []);
    }
    topicTeachingBlocks.get(tb.topicId)!.push(tb);
  }

  for (const topic of topics) {
    const tbs = topicTeachingBlocks.get(topic.id) ?? [];
    if (tbs.length === 0) {
      issues.push({
        code: 'TOPIC_NO_TEACHING_BLOCKS',
        message: `知识点"${topic.name}"没有任何讲解块`,
        topicId: topic.id,
        severity: 'warning',
      });
      qualityIssues.push(
        `知识点"${topic.name}"（${topic.id}）缺少讲解块`
      );
    }
  }

  // --- 4.4 核心知识点缺少关键讲法类型 ---
  // 核心知识点应至少包含 definition 或 formula 类型的讲解块
  for (const topic of topics) {
    if (topic.importance !== 'core') continue;

    const tbs = topicTeachingBlocks.get(topic.id) ?? [];
    const hasKeyTeachingType = tbs.some(tb => {
      if (tb.type === 'definition' || tb.type === 'formula') return true;
      return (tb.secondaryTypes ?? []).some(
        t => t === 'definition' || t === 'formula'
      );
    });

    if (!hasKeyTeachingType) {
      issues.push({
        code: 'MISSING_KEY_TEACHING_TYPE',
        message: `核心知识点"${topic.name}"缺少定义或公式类讲解块`,
        topicId: topic.id,
        severity: 'warning',
      });
      qualityIssues.push(
        `核心知识点"${topic.name}"（${topic.id}）缺少 definition/formula 讲解块`
      );
    }
  }

  // --- 4.5 硬前置关系环路 ---
  const cycles = findRelationCycles(relations);
  for (const cycle of cycles) {
    issues.push({
      code: 'RELATION_CYCLE',
      message: `检测到硬前置关系环路: ${cycle.join(' → ')}`,
      severity: 'warning',
    });
    qualityIssues.push(`硬前置关系环路: ${cycle.join(' → ')}`);
  }

  return { issues, qualityIssues };
}

/**
 * 检查 5：笔记覆盖检查
 *
 * 每条笔记必须覆盖其知识点下所有 importance 为 'required' 的讲解块。
 * 通过 sectionBindings 中的 teachingBlockIds 检查覆盖情况，
 * 缺失必要讲解块的笔记报告为警告。
 *
 * @param notes - 知识点笔记列表
 * @param teachingBlocks - 讲解块列表
 * @returns 校验问题列表
 */
export function validateNoteCoverage(
  notes: TopicNote[],
  teachingBlocks: TeachingBlock[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const note of notes) {
    // 查找该知识点下所有必要讲解块
    const requiredBlocks = teachingBlocks.filter(
      tb => tb.topicId === note.topicId && tb.importance === 'required'
    );

    if (requiredBlocks.length === 0) continue;

    // 收集笔记中通过 sectionBindings 引用的全部讲解块 ID
    const referencedBlockIds = new Set<string>();
    for (const binding of note.sectionBindings ?? []) {
      for (const tbId of binding.teachingBlockIds) {
        referencedBlockIds.add(tbId);
      }
    }

    // 找出未被覆盖的必要讲解块
    for (const tb of requiredBlocks) {
      if (!referencedBlockIds.has(tb.id)) {
        issues.push({
          code: 'NOTE_MISSING_REQUIRED_BLOCK',
          message: `笔记未覆盖必要讲解块"${tb.title}"（${tb.id}）`,
          topicId: note.topicId,
          blockId: tb.id,
          severity: 'warning',
        });
      }
    }
  }

  return issues;
}

// ========== 主入口 ==========

/**
 * 运行全部校验检查，返回合并后的校验报告。
 *
 * 依次执行五项检查：
 * 1. Markdown 覆盖检查（警告）
 * 2. 知识来源检查（错误）
 * 3. 讲法来源检查（错误）
 * 4. 结构质量检查（警告）
 * 5. 笔记覆盖检查（警告）
 *
 * 根据各问题的 severity 分别归入 errors 或 warnings，
 * 并汇总覆盖率统计、知识点统计与质量摘要。
 *
 * @param blocks - 全部 Markdown 块
 * @param topics - 知识点列表
 * @param teachingBlocks - 讲解块列表
 * @param relations - 主题间关系列表
 * @param notes - 知识点笔记列表
 * @returns 完整校验报告
 */
export function validateKnowledgeStructure(
  blocks: MarkdownBlock[],
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  relations: TopicRelation[],
  notes: TopicNote[]
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const qualityIssues: string[] = [];

  // 检查 1：Markdown 覆盖检查
  const coverageResult = validateBlockCoverage(blocks, topics, teachingBlocks);
  warnings.push(...coverageResult.issues);

  // 检查 2：知识来源检查
  const topicSourceIssues = validateTopicSources(topics, blocks);
  for (const issue of topicSourceIssues) {
    if (issue.severity === 'error') {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  // 检查 3：讲法来源检查
  const tbSourceIssues = validateTeachingBlockSources(teachingBlocks, blocks);
  for (const issue of tbSourceIssues) {
    if (issue.severity === 'error') {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  // 检查 4：结构质量检查
  const qualityResult = validateStructureQuality(
    topics,
    teachingBlocks,
    relations
  );
  warnings.push(...qualityResult.issues);
  qualityIssues.push(...qualityResult.qualityIssues);

  // 检查 5：笔记覆盖检查
  const noteIssues = validateNoteCoverage(notes, teachingBlocks);
  warnings.push(...noteIssues);

  // 汇总知识点统计
  const topicTeachingBlockCount = new Map<string, number>();
  for (const tb of teachingBlocks) {
    topicTeachingBlockCount.set(
      tb.topicId,
      (topicTeachingBlockCount.get(tb.topicId) ?? 0) + 1
    );
  }

  const topicsWithTeachingBlocks = topics.filter(
    t => (topicTeachingBlockCount.get(t.id) ?? 0) > 0
  ).length;

  const avgTeachingBlocksPerTopic =
    topics.length > 0 ? teachingBlocks.length / topics.length : 0;

  return {
    errors,
    warnings,
    coverage: coverageResult.coverage,
    topicStats: {
      totalTopics: topics.length,
      topicsWithTeachingBlocks,
      avgTeachingBlocksPerTopic,
    },
    qualityIssues,
  };
}
