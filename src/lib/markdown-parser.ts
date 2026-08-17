// ========== Markdown 解析器 ==========
// 将 Markdown 文本解析为结构化块（MarkdownBlock[]）和章节（MarkdownSection[]）
// 基于 MinerU Markdown 输出格式，支持公式、代码、表格、图片等块级元素

import type {
  MarkdownBlock,
  MarkdownBlockType,
  MarkdownSection,
  SourceDocument,
} from '../types';
import { generateId } from './utils';
import { normalizeMinerUMarkdown } from './source-markdown-normalizer';

// ========== 常量 ==========

/** 短段落合并阈值（字符数），小于此值的连续段落将被合并 */
const SHORT_PARAGRAPH_THRESHOLD = 30;

/** 块 ID 中 contentHash 的截取长度 */
const CONTENT_HASH_SHORT_LENGTH = 8;

// ========== 内部类型 ==========

/**
 * 原始块 — 分割后的中间表示
 * 在最终构建 MarkdownBlock 之前用于分类和合并
 */
interface RawBlock {
  /** 原始行（保留换行） */
  lines: string[];
  /** 推断的块类型 */
  type: MarkdownBlockType;
  /** 合并后的文本内容（lines.join('\n').trim()） */
  content: string;
}

// ========== 内容指纹 ==========

/**
 * djb2 哈希算法（内部使用）
 * @param input 输入字符串
 * @returns 无符号十六进制哈希字符串
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * 计算内容指纹（djb2 算法）
 *
 * 基于 documentId + orderIndex + 归一化内容生成稳定哈希。
 * 归一化方式：去除首尾空白，将连续空白折叠为单个空格。
 *
 * @param documentId 文档 ID
 * @param orderIndex 块在文档内的顺序索引
 * @param content 块原始内容
 * @returns 十六进制哈希字符串
 */
export function computeContentHash(
  documentId: string,
  orderIndex: number,
  content: string
): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return djb2Hex(`${documentId}|${orderIndex}|${normalized}`);
}

// ========== 块类型检测 ==========

/**
 * 判断一行是否为代码围栏标记（``` 或 ~~~）
 * @param trimmed 已去除首尾空白的行
 * @returns 是否为代码围栏
 */
function isCodeFenceLine(trimmed: string): boolean {
  return /^(`{3,}|~{3,})/.test(trimmed);
}

/**
 * 根据块内容推断 Markdown 块类型
 *
 * 检测顺序：heading → code → formula → table → image → quote → list → paragraph
 *
 * @param lines 块内所有行
 * @returns 推断的块类型
 */
function classifyBlock(lines: string[]): MarkdownBlockType {
  const firstLine = lines[0]?.trim() ?? '';

  // 标题：# 到 ######
  if (/^#{1,6}\s/.test(firstLine)) {
    return 'heading';
  }

  // 代码块：以 ``` 或 ~~~ 开头
  if (isCodeFenceLine(firstLine)) {
    return 'code';
  }

  // 公式块：以 $$ 或 \[ 开头
  if (firstLine.startsWith('$$') || firstLine.startsWith('\\[')) {
    return 'formula';
  }

  // GFM 表格：以 | 开头
  if (firstLine.startsWith('|')) {
    return 'table';
  }

  // 图片：![alt](url)
  if (/^!\[.*\]\(.+\)/.test(firstLine)) {
    return 'image';
  }

  // 引用：以 > 开头
  if (firstLine.startsWith('>')) {
    return 'quote';
  }

  // 列表：- / * / + / 1.
  if (/^[-*+]\s/.test(firstLine) || /^\d+\.\s/.test(firstLine)) {
    return 'list';
  }

  return 'paragraph';
}

/**
 * 从标题块内容中提取标题级别和标题文本
 *
 * 支持标准 Markdown 标题语法（`# Title`）和闭合式标题（`## Title ##`）。
 *
 * @param content 标题块的原始内容
 * @returns 包含 level（1-6）和 title 的对象
 */
function extractHeadingInfo(content: string): { level: number; title: string } {
  const match = content.match(/^(#{1,6})\s+(.*)$/);
  if (match) {
    const level = match[1].length;
    // 去除尾部闭合的 # 号（如 "标题 ##" → "标题"）
    const title = match[2].replace(/\s+#+\s*$/, '').trim();
    return { level, title };
  }
  return { level: 1, title: content.trim() };
}

/**
 * 从内容中提取所有图片 URL
 * @param content 块内容
 * @returns 图片 URL 数组
 */
function extractImageUrls(content: string): string[] {
  const urls: string[] = [];
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// ========== 原始块分割 ==========

/**
 * 将 Markdown 文本按空行分割为原始块
 *
 * 规则：
 * - 以空行作为块分隔符
 * - 不会在 ```...``` 代码块内部分割
 * - 不会在 $$...$$ 或 \[...\] 公式块内部分割
 * - 跳过空白块
 *
 * @param markdown Markdown 文本
 * @returns 原始块数组（已分类）
 */
function splitIntoRawBlocks(markdown: string): RawBlock[] {
  // 统一换行符
  const text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const blocks: RawBlock[] = [];
  let currentLines: string[] = [];

  // 状态追踪
  let inCodeFence = false;
  let codeFenceMarker = '';
  let inMathBlock = false;
  let mathDelimiter: '$$' | '\\[' = '$$';

  /**
   * 将当前累积的行刷新为一个块
   */
  const flushCurrent = (): void => {
    if (currentLines.length === 0) return;

    const content = currentLines.join('\n').trim();
    if (content.length > 0) {
      const type = classifyBlock(currentLines);
      blocks.push({ lines: [...currentLines], type, content });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // --- 代码围栏处理 ---
    if (isCodeFenceLine(trimmed)) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = trimmed.charAt(0);
      } else if (trimmed.charAt(0) === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = '';
      }
      currentLines.push(line);
      continue;
    }

    if (inCodeFence) {
      // 代码块内的所有行（包括空行）都直接累积
      currentLines.push(line);
      continue;
    }

    // --- 空行处理 ---
    if (trimmed === '') {
      if (inMathBlock) {
        // 公式块内的空行不触发分割
        currentLines.push(line);
      } else {
        flushCurrent();
      }
      continue;
    }

    // --- 公式块状态更新 ---
    // 用于判断空行是否在公式块内部（已在上方处理）
    if (!inMathBlock) {
      // 检查是否进入公式块
      const ddCount = (trimmed.match(/\$\$/g) || []).length;
      if (ddCount % 2 === 1) {
        // 奇数个 $$ → 进入公式块
        inMathBlock = true;
        mathDelimiter = '$$';
      } else if (/\\\[/.test(trimmed) && !/\\\]/.test(trimmed)) {
        // \[ 无匹配 \] → 进入公式块
        inMathBlock = true;
        mathDelimiter = '\\[';
      }
    } else {
      // 检查是否退出公式块
      if (mathDelimiter === '$$') {
        const ddCount = (trimmed.match(/\$\$/g) || []).length;
        if (ddCount >= 1) {
          // 第一个 $$ 闭合公式块；剩余偶数个则平衡，奇数个则重新进入
          if ((ddCount - 1) % 2 === 0) {
            inMathBlock = false;
          }
          // 奇数个剩余 → 保持 inMathBlock = true
        }
      } else {
        // mathDelimiter === '\\['
        if (/\\\]/.test(trimmed)) {
          inMathBlock = false;
        }
      }
    }

    currentLines.push(line);
  }

  // 刷新最后一个块
  flushCurrent();

  return blocks;
}

// ========== 短段落合并 ==========

/**
 * 合并连续的短段落（内容长度 < 30 字符）为单个块
 *
 * 当两个相邻的 paragraph 块内容都短于阈值时，合并为一个块。
 * 合并后的内容以空行分隔两个原始段落。
 *
 * @param blocks 原始块数组
 * @returns 合并后的块数组
 */
function mergeShortParagraphs(blocks: RawBlock[]): RawBlock[] {
  const result: RawBlock[] = [];

  for (const block of blocks) {
    const lastBlock = result[result.length - 1];

    if (
      lastBlock !== undefined &&
      lastBlock.type === 'paragraph' &&
      block.type === 'paragraph' &&
      lastBlock.content.length < SHORT_PARAGRAPH_THRESHOLD &&
      block.content.length < SHORT_PARAGRAPH_THRESHOLD
    ) {
      // 合并：用空行分隔两个段落
      const mergedLines = [...lastBlock.lines, '', ...block.lines];
      lastBlock.lines = mergedLines;
      lastBlock.content = mergedLines.join('\n').trim();
    } else {
      result.push(block);
    }
  }

  return result;
}

// ========== 核心导出函数 ==========

/**
 * 将 Markdown 文本解析为结构化块数组
 *
 * 处理流程：
 * 1. 按空行分割为原始块（尊重代码块和公式块的完整性）
 * 2. 合并连续短段落
 * 3. 为每个块生成稳定 ID、内容指纹、标题路径
 *
 * @param markdown Markdown 文本
 * @param documentId 所属文档 ID
 * @returns 结构化块数组
 */
export function parseMarkdownToBlocks(
  markdown: string,
  documentId: string
): MarkdownBlock[] {
  // 1. 分割为原始块
  const rawBlocks = splitIntoRawBlocks(markdown);

  // 2. 合并连续短段落
  const mergedBlocks = mergeShortParagraphs(rawBlocks);

  // 3. 构建 MarkdownBlock 数组
  const blocks: MarkdownBlock[] = [];
  const headingStack: Array<{ level: number; title: string }> = [];

  for (let i = 0; i < mergedBlocks.length; i++) {
    const raw = mergedBlocks[i];

    // 更新标题路径栈
    if (raw.type === 'heading') {
      const { level, title } = extractHeadingInfo(raw.content);
      // 弹出级别 >= 当前级别的标题（同级或更深的标题已结束）
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
    }

    const headingPath = headingStack.map(h => h.title);
    const orderIndex = i;
    const contentHash = computeContentHash(documentId, orderIndex, raw.content);
    const contentHashShort = contentHash.substring(0, CONTENT_HASH_SHORT_LENGTH);
    const blockId = `blk_${documentId}_${orderIndex}_${contentHashShort}`;

    const block: MarkdownBlock = {
      id: blockId,
      documentId,
      type: raw.type,
      content: raw.content,
      headingPath,
      orderIndex,
      contentHash,
    };

    // 标题级别（仅 heading 类型）
    if (raw.type === 'heading') {
      block.headingLevel = extractHeadingInfo(raw.content).level;
    }

    // 图片资源引用
    if (raw.type === 'image') {
      const urls = extractImageUrls(raw.content);
      if (urls.length > 0) {
        block.assetRefs = urls;
      }
    }

    blocks.push(block);
  }

  return blocks;
}

/**
 * 从标题块构建层级章节大纲
 *
 * 根据标题块（heading）的级别构建树形章节结构。
 * 每个章节包含从该标题到下一个同级或更高级别标题之间的所有块。
 *
 * 规则：
 * - 顶级章节（level 1）没有父章节
 * - 如果文档中没有任何标题，创建一个包含所有块的根章节
 * - 父章节的 blockIds 包含其所有子章节的块
 *
 * @param blocks 已解析的块数组
 * @param documentId 所属文档 ID
 * @returns 章节大纲数组
 */
export function buildSectionOutline(
  blocks: MarkdownBlock[],
  documentId: string
): MarkdownSection[] {
  const headingBlocks = blocks.filter(b => b.type === 'heading');

  // 无标题：创建单一根章节
  if (headingBlocks.length === 0) {
    if (blocks.length === 0) {
      return [];
    }

    const rootSection: MarkdownSection = {
      id: `sec_${documentId}_root`,
      title: '(根)',
      level: 0,
      blockIds: blocks.map(b => b.id),
      childSectionIds: [],
      startOrder: blocks[0].orderIndex,
      endOrder: blocks[blocks.length - 1].orderIndex,
    };
    return [rootSection];
  }

  const sections: MarkdownSection[] = [];
  // 栈中保存当前打开的章节（从顶层到当前最深层的路径）
  const stack: MarkdownSection[] = [];

  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = block.headingLevel ?? 1;
      const title = extractHeadingInfo(block.content).title;

      // 弹出栈中级别 >= 当前级别的章节（这些章节已结束）
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      // 创建新章节
      const section: MarkdownSection = {
        id: `sec_${documentId}_${block.orderIndex}`,
        title,
        level,
        blockIds: [block.id],
        childSectionIds: [],
        parentSectionId: stack.length > 0 ? stack[stack.length - 1].id : undefined,
        startOrder: block.orderIndex,
        endOrder: block.orderIndex,
      };

      // 注册为父章节的子章节
      if (stack.length > 0) {
        stack[stack.length - 1].childSectionIds.push(section.id);
      }

      // 将此标题块添加到所有祖先章节的 blockIds
      for (const ancestor of stack) {
        ancestor.blockIds.push(block.id);
        ancestor.endOrder = block.orderIndex;
      }

      sections.push(section);
      stack.push(section);
    } else {
      // 非标题块：添加到所有打开的章节
      for (const openSection of stack) {
        openSection.blockIds.push(block.id);
        openSection.endOrder = block.orderIndex;
      }
    }
  }

  return sections;
}

/**
 * 创建源文档 — 从原始 Markdown 构建完整的文档表示
 *
 * 处理流程：
 * 1. 调用 normalizeMinerUMarkdown 归一化 Markdown
 * 2. 生成文档 ID（doc_{timestamp}_{random}）
 * 3. 解析为结构化块
 * 4. 构建章节大纲
 * 5. 计算全文内容指纹
 *
 * @param markdown 原始 Markdown 文本（MinerU 输出）
 * @param courseId 所属课程 ID
 * @param title 文档标题
 * @returns 完整的源文档对象
 */
export function createSourceDocument(
  markdown: string,
  courseId: string,
  title: string
): SourceDocument {
  // 1. 归一化 Markdown
  const normalizedMarkdown = normalizeMinerUMarkdown(markdown);

  // 2. 生成文档 ID
  const documentId = generateId('doc');

  // 3. 解析为结构化块
  const blocks = parseMarkdownToBlocks(normalizedMarkdown, documentId);

  // 4. 构建章节大纲
  const outline = buildSectionOutline(blocks, documentId);

  // 5. 计算全文内容指纹（仅基于内容，不含 documentId）
  const contentHash = djb2Hex(normalizedMarkdown);

  // 6. 时间戳
  const now = new Date().toISOString();

  return {
    id: documentId,
    courseId,
    title,
    markdown: normalizedMarkdown,
    blocks,
    outline,
    contentHash,
    createdAt: now,
    updatedAt: now,
  };
}
