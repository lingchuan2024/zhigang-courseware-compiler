/**
 * note-generator-v2.ts
 *
 * 从 KnowledgeTopic + TeachingBlock + 源 Markdown 生成 TopicNote[]。
 * 基于 AI 生成连贯的学习笔记，支持批量生成和失败降级。
 */

import {
  ModelConfig,
  KnowledgeTopic,
  TeachingBlock,
  TopicNote,
  GlossaryItem,
  FormulaCard,
  MarkdownBlock,
  TopicNarrativePath,
} from '../types';
import { callChatCompletion } from './model-v2';
import { generateId, sanitizeText, truncateText } from './utils';
import { normalizeGeneratedMarkdown } from './markdown-normalization';
import { validateGeneratedMarkdown } from './markdown-validation';

// ========== 常量 ==========

/** 源 Markdown 内容的最大长度（字符），超出部分截断 */
const MAX_SOURCE_LENGTH = 15000;

/** 笔记生成的 API 超时时间（毫秒） */
const NOTE_GENERATION_TIMEOUT = 120000;

/** 当前笔记生成器的提示词版本 */
const PROMPT_VERSION = 'note-v2.0';

// ========== 类型定义 ==========

/**
 * AI 笔记生成的响应结构。
 * callChatCompletion 强制 JSON 输出，因此要求模型返回包含 markdown 字段的 JSON。
 */
interface NoteGenerationResponse {
  /** 笔记的完整 Markdown 内容 */
  markdown: string;
  /** 新引入的术语列表 */
  glossary?: Array<{
    term: string;
    definition: string;
    aliases?: string[];
  }>;
  /** 笔记中出现的公式列表 */
  formulas?: Array<{
    name?: string;
    latex: string;
  }>;
}

// ========== 提示词构建 ==========

/**
 * 构建笔记生成提示词（system + user）。
 *
 * System prompt 定义角色、任务和规则；User prompt 提供知识点信息、
 * 按叙事顺序排列的讲解块、原始 Markdown 内容及相关主题。
 *
 * @param topic - 当前知识主题
 * @param blocks - 该主题下的全部讲解块
 * @param narrativePath - 叙事路径（讲解块排序）
 * @param sourceBlocks - 原始 Markdown 块
 * @param allTopics - 全部知识主题（供参考上下文）
 * @returns 包含 system 和 user 提示词的对象
 */
export function buildNotePrompt(
  topic: KnowledgeTopic,
  blocks: TeachingBlock[],
  narrativePath: TopicNarrativePath,
  sourceBlocks: MarkdownBlock[],
  allTopics: KnowledgeTopic[],
): { system: string; user: string } {
  // ----- System Prompt -----
  const system = [
    '你是一位课程笔记撰写专家。',
    '你的任务是基于知识点结构和原始 Markdown 内容，生成连贯、清晰的学习笔记。',
    '',
    '撰写规则：',
    '1. 覆盖所有 importance 为 "required" 的讲解块；',
    '2. 按叙事路径（narrativePath）给定的顺序组织内容；',
    '3. 使用标准 Markdown 格式（标题、列表、加粗等）；',
    '4. 数学公式使用 $...$（行内）或 $$...$$（块级）格式；',
    '5. 不要添加原始素材中没有的事实或信息；',
    '6. 语言自然流畅，适合学生阅读。',
    '',
    '输出格式：返回 JSON 对象，包含以下字段：',
    '- "markdown": 笔记的完整 Markdown 内容（字符串）',
    '- "glossary": 新引入的术语列表（数组，每项含 term、definition、aliases）',
    '- "formulas": 笔记中出现的公式列表（数组，每项含 name、latex）',
  ].join('\n');

  // ----- User Prompt -----
  const parts: string[] = [];

  // 1. 知识点信息
  parts.push(`=== 知识点信息 ===
名称：${topic.name}
别名：${topic.aliases.join('、') || '无'}
摘要：${topic.summary}
学习目标：${topic.learningObjective}
知识类型：${topic.knowledgeGenre}
难度：${topic.difficulty}/5`);

  // 2. 讲解块（按叙事顺序排列）
  const blockMap = new Map<string, TeachingBlock>(blocks.map(b => [b.id, b]));
  const orderedBlocks = narrativePath.orderedTeachingBlockIds
    .map(id => blockMap.get(id))
    .filter((b): b is TeachingBlock => b !== undefined);

  if (orderedBlocks.length > 0) {
    const blockDescriptions = orderedBlocks
      .map((b, i) => {
        const importanceTag =
          b.importance === 'required'
            ? '[必须覆盖]'
            : b.importance === 'supporting'
              ? '[辅助]'
              : '[可选]';
        const detail = b.detailedExplanation || '';
        return [
          `### 讲解块 ${i + 1} ${importanceTag}`,
          `- 标题：${b.title}`,
          `- 类型：${b.type}`,
          `- 摘要：${b.summary}`,
          detail ? `- 详细说明：${detail}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    parts.push(`=== 讲解块（按叙事顺序） ===\n${blockDescriptions}`);
  }

  // 3. 原始 Markdown 内容（截断到最大长度，并做安全过滤）
  const rawSourceContent = sourceBlocks.map(b => b.content).join('\n\n');
  const sourceContent = sanitizeText(truncateText(rawSourceContent, MAX_SOURCE_LENGTH));
  parts.push(`=== 原始 Markdown 内容 ===\n${sourceContent}`);

  // 4. 相关主题（供参考）
  const relatedTopics = allTopics
    .filter(t => t.id !== topic.id)
    .slice(0, 10)
    .map(t => `- ${t.name}（${t.summary.slice(0, 60)}）`)
    .join('\n');

  if (relatedTopics) {
    parts.push(`=== 其他知识点（供参考） ===\n${relatedTopics}`);
  }

  // 5. 任务指令
  parts.push(`=== 任务 ===
请为"${topic.name}"撰写一份连贯的学习笔记。
确保覆盖所有标记为 [必须覆盖] 的讲解块，按给定的叙事顺序组织内容。
返回 JSON 格式，其中 "markdown" 字段为笔记的 Markdown 内容。`);

  const user = parts.join('\n\n');

  return { system, user };
}

// ========== 辅助函数 ==========

/**
 * 根据 KnowledgeTopic 的 sourceRanges 从全部 Markdown 块中查找来源块。
 *
 * @param topic - 知识主题
 * @param allBlocks - 全部 Markdown 块
 * @returns 主题对应的来源 Markdown 块列表
 */
function getTopicSourceBlocks(
  topic: KnowledgeTopic,
  allBlocks: MarkdownBlock[],
): MarkdownBlock[] {
  const result: MarkdownBlock[] = [];
  const seen = new Set<string>();

  for (const range of topic.sourceRanges) {
    const startBlock = allBlocks.find(b => b.id === range.startBlockId);
    const endBlock = allBlocks.find(b => b.id === range.endBlockId);

    if (!startBlock || !endBlock) {
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
 * 通过标题相似度将生成的 Markdown 章节匹配到讲解块。
 *
 * 匹配策略：
 * 1. 精确匹配（不区分大小写）
 * 2. 包含匹配（一方包含另一方）
 *
 * @param sectionTitle - 生成章节的标题
 * @param blocks - 全部讲解块
 * @returns 匹配到的讲解块列表
 */
function matchBlocksByTitle(sectionTitle: string, blocks: TeachingBlock[]): TeachingBlock[] {
  const normalizedTitle = sectionTitle.toLowerCase().trim();

  // 精确匹配
  const exact = blocks.filter(b => b.title.toLowerCase().trim() === normalizedTitle);
  if (exact.length > 0) return exact;

  // 包含匹配
  return blocks.filter(
    b =>
      b.title.toLowerCase().includes(normalizedTitle) ||
      normalizedTitle.includes(b.title.toLowerCase()),
  );
}

/**
 * 从生成的 Markdown 中构建章节绑定关系。
 *
 * 解析 Markdown 中的 `##` / `###` 标题，将每个章节匹配到对应的讲解块，
 * 并收集相关来源范围。匹配到的讲解块按叙事路径顺序排列。
 *
 * @param markdown - 生成的笔记 Markdown
 * @param teachingBlocks - 全部讲解块
 * @param narrativePath - 叙事路径（用于排序匹配到的讲解块）
 * @returns 章节绑定数组
 */
function buildSectionBindings(
  markdown: string,
  teachingBlocks: TeachingBlock[],
  narrativePath: TopicNarrativePath,
): TopicNote['sectionBindings'] {
  const lines = markdown.split('\n');
  const bindings: TopicNote['sectionBindings'] = [];

  // 构建叙事顺序查找表：blockId → 在叙事路径中的位置
  const narrativeOrder = new Map<string, number>(
    narrativePath.orderedTeachingBlockIds.map((id, idx) => [id, idx]),
  );

  /** 按叙事路径顺序排序匹配到的讲解块 */
  const sortByNarrative = (blocks: TeachingBlock[]): TeachingBlock[] =>
    [...blocks].sort(
      (a, b) =>
        (narrativeOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (narrativeOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

  let currentSectionId: string | null = null;
  let currentSectionTitle = '';

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);

    if (headingMatch) {
      // 保存上一个章节
      if (currentSectionId !== null) {
        const matchedBlocks = sortByNarrative(
          matchBlocksByTitle(currentSectionTitle, teachingBlocks),
        );
        if (matchedBlocks.length > 0) {
          bindings.push({
            generatedSectionId: currentSectionId,
            teachingBlockIds: matchedBlocks.map(b => b.id),
            sourceRanges: matchedBlocks.flatMap(b => b.sourceRanges),
          });
        }
      }

      currentSectionId = `section_${bindings.length + 1}`;
      currentSectionTitle = headingMatch[1].trim();
    }
  }

  // 处理最后一个章节
  if (currentSectionId !== null) {
    const matchedBlocks = sortByNarrative(
      matchBlocksByTitle(currentSectionTitle, teachingBlocks),
    );
    if (matchedBlocks.length > 0) {
      bindings.push({
        generatedSectionId: currentSectionId,
        teachingBlockIds: matchedBlocks.map(b => b.id),
        sourceRanges: matchedBlocks.flatMap(b => b.sourceRanges),
      });
    }
  }

  // 如果没有任何绑定匹配成功，创建一个覆盖全部讲解块的兜底绑定
  if (bindings.length === 0 && teachingBlocks.length > 0) {
    const orderedBlocks = sortByNarrative(teachingBlocks);
    bindings.push({
      generatedSectionId: 'section_all',
      teachingBlockIds: orderedBlocks.map(b => b.id),
      sourceRanges: orderedBlocks.flatMap(b => b.sourceRanges),
    });
  }

  return bindings;
}

/**
 * 从 AI 响应中提取术语表更新。
 *
 * @param glossary - AI 返回的术语列表
 * @param topicId - 当前主题 ID
 * @returns 术语表条目数组
 */
function extractGlossaryUpdates(
  glossary: NoteGenerationResponse['glossary'] | undefined,
  topicId: string,
): GlossaryItem[] {
  if (!glossary || !Array.isArray(glossary)) return [];

  return glossary
    .filter(g => g.term && g.definition)
    .map(g => ({
      term: g.term,
      definition: g.definition,
      aliases: g.aliases || [],
      topicIds: [topicId],
      topicId,
    }));
}

/**
 * 从 AI 响应中提取公式更新。
 *
 * @param formulas - AI 返回的公式列表
 * @param topicId - 当前主题 ID
 * @returns 公式卡片数组
 */
function extractFormulaUpdates(
  formulas: NoteGenerationResponse['formulas'] | undefined,
  topicId: string,
): FormulaCard[] {
  if (!formulas || !Array.isArray(formulas)) return [];

  return formulas
    .filter(f => f.latex)
    .map(
      f =>
        ({
          id: generateId('formula'),
          topicId,
          name: f.name || '',
          latex: f.latex,
          formula: f.latex,
          description: f.name || '',
          variables: {},
          sourceRanges: [],
        }) as FormulaCard,
    );
}

// ========== 主函数 ==========

/**
 * 为单个知识主题生成学习笔记。
 *
 * 流程：
 * 1. 构建提示词（system + user）
 * 2. 调用 AI 生成笔记 Markdown
 * 3. 规范化 Markdown（LaTeX 分隔符转换等）
 * 4. 校验 Markdown（代码围栏闭合、公式闭合等）
 * 5. 构建章节绑定、术语更新、公式更新
 * 6. 返回 TopicNote（version: 1）
 *
 * @param config - 模型配置
 * @param topic - 当前知识主题
 * @param teachingBlocks - 该主题下的讲解块
 * @param narrativePath - 叙事路径
 * @param sourceBlocks - 原始 Markdown 块
 * @param allTopics - 全部知识主题
 * @returns 生成的知识点笔记
 * @throws 当 AI 调用失败或响应解析失败时抛出异常
 */
export async function generateTopicNote(
  config: ModelConfig,
  topic: KnowledgeTopic,
  teachingBlocks: TeachingBlock[],
  narrativePath: TopicNarrativePath,
  sourceBlocks: MarkdownBlock[],
  allTopics: KnowledgeTopic[],
): Promise<TopicNote> {
  // 1. 构建提示词
  const { system, user } = buildNotePrompt(
    topic,
    teachingBlocks,
    narrativePath,
    sourceBlocks,
    allTopics,
  );

  // 2. 构造 CompiledPrompt 并调用 AI
  const compiled = {
    system,
    stablePrefix: '',
    dynamicInput: user,
    promptVersion: PROMPT_VERSION,
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ],
  };

  const { data } = await callChatCompletion<NoteGenerationResponse>(
    config,
    compiled,
    'note-generation',
    NOTE_GENERATION_TIMEOUT,
    topic.id,
  );

  const rawMarkdown = data?.markdown || '';

  // 3. 规范化 Markdown
  const normalized = normalizeGeneratedMarkdown(rawMarkdown);

  // 4. 校验 Markdown（本系统无引用标记，传空数组）
  const validation = validateGeneratedMarkdown(normalized.content, []);

  // 5. 构建章节绑定
  const sectionBindings = buildSectionBindings(
    validation.fixedContent,
    teachingBlocks,
    narrativePath,
  );

  // 6. 提取术语和公式更新
  const glossaryUpdates = extractGlossaryUpdates(data?.glossary, topic.id);
  const formulaUpdates = extractFormulaUpdates(data?.formulas, topic.id);

  return {
    topicId: topic.id,
    markdown: validation.fixedContent,
    sectionBindings,
    glossaryUpdates,
    formulaUpdates,
    version: 1,
  };
}

/**
 * 构建降级笔记（AI 生成失败时使用）。
 *
 * 将讲解块的摘要按顺序拼接为基本 Markdown 结构，
 * 并附上原始来源内容摘要，确保即使 AI 生成失败也有可读内容。
 *
 * @param topic - 知识主题
 * @param teachingBlocks - 讲解块列表
 * @param sourceBlocks - 原始 Markdown 块（用于补充内容）
 * @returns 基础知识点笔记
 */
export function buildFallbackNote(
  topic: KnowledgeTopic,
  teachingBlocks: TeachingBlock[],
  sourceBlocks: MarkdownBlock[],
): TopicNote {
  const lines: string[] = [];

  // 主题标题
  lines.push(`## ${topic.name}`);
  lines.push('');
  lines.push(topic.summary);
  lines.push('');

  // 学习目标
  if (topic.learningObjective) {
    lines.push(`**学习目标：** ${topic.learningObjective}`);
    lines.push('');
  }

  // 各讲解块作为章节
  for (const block of teachingBlocks) {
    lines.push(`### ${block.title}`);
    lines.push('');
    lines.push(block.summary);

    if (block.detailedExplanation) {
      lines.push('');
      lines.push(block.detailedExplanation);
    }

    lines.push('');
  }

  // 附上原始来源内容（截断防过长）
  if (sourceBlocks.length > 0) {
    lines.push('### 原始内容');
    lines.push('');
    const sourceContent = truncateText(
      sourceBlocks.map(b => b.content).join('\n\n'),
      MAX_SOURCE_LENGTH,
    );
    lines.push(sourceContent);
    lines.push('');
  }

  const markdown = lines.join('\n');

  // 章节绑定：每个讲解块对应一个章节
  const sectionBindings: TopicNote['sectionBindings'] = teachingBlocks.map((b, i) => ({
    generatedSectionId: `section_${i + 1}`,
    teachingBlockIds: [b.id],
    sourceRanges: b.sourceRanges,
  }));

  return {
    topicId: topic.id,
    markdown,
    sectionBindings,
    glossaryUpdates: [],
    formulaUpdates: [],
    version: 1,
  };
}

/**
 * 为所有知识主题批量生成学习笔记。
 *
 * 按顺序逐个生成笔记，每完成一个主题后调用 onProgress 回调。
 * 单个主题生成失败时，使用 buildFallbackNote 创建降级笔记并继续。
 *
 * @param config - 模型配置
 * @param topics - 全部知识主题
 * @param teachingBlocks - 全部讲解块
 * @param narrativePaths - 各主题的叙事路径（key 为 topicId）
 * @param allBlocks - 全部 Markdown 块
 * @param onProgress - 进度回调（current: 已完成数, total: 总数）
 * @returns 全部知识点笔记数组
 */
export async function generateAllNotes(
  config: ModelConfig,
  topics: KnowledgeTopic[],
  teachingBlocks: TeachingBlock[],
  narrativePaths: Record<string, TopicNarrativePath>,
  allBlocks: MarkdownBlock[],
  onProgress?: (current: number, total: number) => void,
): Promise<TopicNote[]> {
  const notes: TopicNote[] = [];
  const total = topics.length;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];

    try {
      // 获取该主题的讲解块
      const topicBlocks = teachingBlocks.filter(b => b.topicId === topic.id);

      // 获取该主题的叙事路径
      const narrativePath = narrativePaths[topic.id];

      // 获取该主题的来源 Markdown 块
      const sourceBlocks = getTopicSourceBlocks(topic, allBlocks);

      if (!narrativePath) {
        // 无叙事路径，使用降级笔记
        console.warn(`主题 "${topic.name}" 缺少叙事路径，使用降级笔记`);
        notes.push(buildFallbackNote(topic, topicBlocks, sourceBlocks));
      } else {
        // 正常生成笔记
        const note = await generateTopicNote(
          config,
          topic,
          topicBlocks,
          narrativePath,
          sourceBlocks,
          topics,
        );
        notes.push(note);
      }
    } catch (error) {
      // 单主题失败，创建降级笔记并继续
      console.warn(`笔记生成失败（主题: ${topic.name}）:`, error);
      const topicBlocks = teachingBlocks.filter(b => b.topicId === topic.id);
      const sourceBlocks = getTopicSourceBlocks(topic, allBlocks);
      notes.push(buildFallbackNote(topic, topicBlocks, sourceBlocks));
    }

    // 进度回调
    onProgress?.(i + 1, total);
  }

  return notes;
}
