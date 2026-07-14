import { MarkdownBlock, SourceRange } from '../types';
import { clamp } from './utils';

// ========== 配置常量 ==========

/** 每个窗口的目标 token 数（约 4000-8000 tokens） */
const TARGET_TOKENS_PER_WINDOW = 6000;

/** 每个窗口的最大块数 */
const MAX_BLOCKS_PER_WINDOW = 60;

/** 每个窗口的最小块数（最后一个窗口除外） */
const MIN_BLOCKS_PER_WINDOW = 15;

/** 窗口间重叠比例（10%-20%） */
const OVERLAP_RATIO = 0.15;

/** 每个 token 的字符数估算（中英文混合粗略估计） */
const CHARS_PER_TOKEN = 1.5;

// ========== 类型定义 ==========

/**
 * 内容窗口 — 将 MarkdownBlock 数组切分为可重叠的 AI 处理单元。
 */
export interface ContentWindow {
  /** 窗口唯一标识（win_0, win_1, ...） */
  windowId: string;
  /** 窗口包含的 Markdown 块 */
  blocks: MarkdownBlock[];
  /** 起始块索引（在原始块数组中的位置） */
  startIndex: number;
  /** 结束块索引（在原始块数组中的位置，包含） */
  endIndex: number;
  /** 与前一个窗口重叠的块数 */
  overlapWithPrevious: number;
}

// ========== 辅助函数 ==========

/**
 * 判断一个块是否不适合作为窗口的末尾块。
 *
 * 公式块、代码块、表格块、列表块通常需要后续上下文才能完整理解，
 * 不应作为窗口的最后一块被截断。
 *
 * @param block - 待检查的块
 * @returns 如果该块不适合作为末尾块则返回 true
 */
function isUnsafeEndBlock(block: MarkdownBlock): boolean {
  return (
    block.type === 'formula' ||
    block.type === 'code' ||
    block.type === 'table' ||
    block.type === 'list'
  );
}

/**
 * 计算从 startIndex 开始、达到目标 token 数时的结束索引。
 *
 * 使用简单字符估算：chars / CHARS_PER_TOKEN。
 * 结果被限制在 [startIndex + MIN_BLOCKS_PER_WINDOW - 1, startIndex + MAX_BLOCKS_PER_WINDOW - 1] 范围内。
 *
 * @param blocks - 全部块数组
 * @param startIndex - 当前窗口的起始索引
 * @returns 目标结束索引
 */
function findTargetEndIndex(
  blocks: MarkdownBlock[],
  startIndex: number,
): number {
  const targetChars = TARGET_TOKENS_PER_WINDOW * CHARS_PER_TOKEN;
  const maxEnd = Math.min(
    startIndex + MAX_BLOCKS_PER_WINDOW - 1,
    blocks.length - 1,
  );
  const minEnd = Math.min(
    startIndex + MIN_BLOCKS_PER_WINDOW - 1,
    blocks.length - 1,
  );

  let charCount = 0;
  let targetEnd = minEnd;

  for (let i = startIndex; i <= maxEnd; i++) {
    charCount += blocks[i].content.length;
    targetEnd = i;

    // 达到目标字符数（对应目标 token 数），停止
    if (charCount >= targetChars) {
      break;
    }
  }

  return clamp(targetEnd, minEnd, maxEnd);
}

/**
 * 从目标结束位置开始，寻找最佳的窗口切分点。
 *
 * 切分策略（优先级从高到低）：
 * 1. 在标题边界切分 — 标题作为下一个窗口的开头，当前窗口在标题前一个块结束
 * 2. 在段落边界切分 — 当前窗口以段落结尾
 * 3. 在任何安全位置切分 — 非 formula/code/table/list
 * 4. 强制在 MAX_BLOCKS_PER_WINDOW 处切分
 *
 * 切分时不会在 formula/code/table/list 块之后断开，
 * 以避免这些需要上下文的块被截断。
 *
 * @param blocks - 全部块数组
 * @param startIndex - 当前窗口的起始索引
 * @param targetEnd - 目标结束索引（基于 token 估算）
 * @returns 切分点索引（当前窗口的结束索引，包含）
 */
function findCutPoint(
  blocks: MarkdownBlock[],
  startIndex: number,
  targetEnd: number,
): number {
  const maxEnd = Math.min(
    startIndex + MAX_BLOCKS_PER_WINDOW - 1,
    blocks.length - 1,
  );
  const minEnd = Math.min(
    startIndex + MIN_BLOCKS_PER_WINDOW - 1,
    blocks.length - 1,
  );
  const searchStart = Math.max(targetEnd, minEnd);

  // 1. 向前扫描最多 5 个块，寻找标题边界
  //    标题作为下一个窗口的开头，当前窗口在标题前一个块结束
  const headingSearchLimit = Math.min(searchStart + 5, blocks.length - 1);
  for (let h = searchStart; h <= headingSearchLimit; h++) {
    if (blocks[h].type === 'heading') {
      const endIndex = h - 1;
      // 确保 endIndex 在有效范围内，且不是不安全的末尾块
      if (
        endIndex >= minEnd &&
        endIndex <= maxEnd &&
        !isUnsafeEndBlock(blocks[endIndex])
      ) {
        return endIndex;
      }
    }
  }

  // 2. 没有找到标题边界，在 5 块范围内寻找段落边界
  const paragraphSearchLimit = Math.min(searchStart + 5, maxEnd);
  for (let i = searchStart; i <= paragraphSearchLimit; i++) {
    if (blocks[i].type === 'paragraph') {
      return i;
    }
  }

  // 3. 寻找任何安全的结束位置（非 formula/code/table/list）
  for (let i = searchStart; i <= maxEnd; i++) {
    if (!isUnsafeEndBlock(blocks[i])) {
      return i;
    }
  }

  // 4. 强制在最大块数处切分
  return maxEnd;
}

// ========== 导出函数 ==========

/**
 * 估算文本的 token 数。
 *
 * 估算规则：
 * - CJK 字符（中日韩统一表意文字、平假名、片假名、全角字符等）：每个字符计 1 token
 * - ASCII 字符：每 2 个字符计 1 token
 * - 其他字符：按 CHARS_PER_TOKEN 估算
 *
 * @param text - 待估算的文本
 * @returns 估算的 token 数（至少为 1）
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 1;

  let cjkCount = 0;
  let asciiCount = 0;
  let otherCount = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;

    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x3000 && code <= 0x30ff) || // CJK 符号、平假名、片假名
      (code >= 0xff00 && code <= 0xffef) // 全角字符
    ) {
      cjkCount++;
    } else if (code < 128) {
      asciiCount++;
    } else {
      otherCount++;
    }
  }

  const tokens =
    cjkCount +
    Math.ceil(asciiCount / 2) +
    Math.ceil(otherCount / CHARS_PER_TOKEN);

  return Math.max(1, tokens);
}

/**
 * 将 MarkdownBlock 数组切分为可重叠的内容窗口。
 *
 * 切分规则：
 * - 每个窗口目标约 TARGET_TOKENS_PER_WINDOW tokens
 * - 每个窗口最多 MAX_BLOCKS_PER_WINDOW 个块
 * - 每个窗口至少 MIN_BLOCKS_PER_WINDOW 个块（最后一个窗口除外）
 * - 相邻窗口重叠约 OVERLAP_RATIO（窗口大小的 10%-20%）
 * - 不在 formula/code/table/list 块之后切分
 * - 优先在标题边界切分，其次在段落边界
 *
 * @param blocks - 待切分的 Markdown 块数组
 * @returns 内容窗口数组
 */
export function splitIntoWindows(
  blocks: MarkdownBlock[],
): ContentWindow[] {
  // 空数组直接返回
  if (blocks.length === 0) return [];

  // 块数不超过最大值，返回单个窗口
  if (blocks.length <= MAX_BLOCKS_PER_WINDOW) {
    return [
      {
        windowId: 'win_0',
        blocks: [...blocks],
        startIndex: 0,
        endIndex: blocks.length - 1,
        overlapWithPrevious: 0,
      },
    ];
  }

  const windows: ContentWindow[] = [];
  let windowIndex = 0;
  let currentStart = 0;
  let prevEndIndex = -1;

  while (currentStart < blocks.length) {
    // 检查剩余块是否可以放入一个窗口
    const remaining = blocks.length - currentStart;
    if (remaining <= MAX_BLOCKS_PER_WINDOW) {
      const endIndex = blocks.length - 1;
      const overlap =
        prevEndIndex >= 0
          ? Math.max(0, prevEndIndex - currentStart + 1)
          : 0;
      windows.push({
        windowId: `win_${windowIndex}`,
        blocks: blocks.slice(currentStart, endIndex + 1),
        startIndex: currentStart,
        endIndex,
        overlapWithPrevious: overlap,
      });
      break;
    }

    // 计算目标结束位置
    const targetEnd = findTargetEndIndex(blocks, currentStart);

    // 寻找最佳切分点
    const endIndex = findCutPoint(blocks, currentStart, targetEnd);

    // 计算与前一个窗口的重叠
    const overlap =
      windowIndex === 0
        ? 0
        : Math.max(0, prevEndIndex - currentStart + 1);

    // 创建窗口
    windows.push({
      windowId: `win_${windowIndex}`,
      blocks: blocks.slice(currentStart, endIndex + 1),
      startIndex: currentStart,
      endIndex,
      overlapWithPrevious: overlap,
    });

    // 计算下一个窗口的起始位置（含重叠）
    const windowSize = endIndex - currentStart + 1;
    const overlapSize = Math.round(windowSize * OVERLAP_RATIO);
    let nextStart = endIndex - overlapSize + 1;

    // 确保前进，避免无限循环
    if (nextStart <= currentStart) {
      nextStart = currentStart + 1;
    }

    prevEndIndex = endIndex;
    currentStart = nextStart;
    windowIndex++;
  }

  return windows;
}

/**
 * 根据块数组的索引范围创建 SourceRange。
 *
 * documentId 取自范围内首个块（所有块应属于同一文档）。
 *
 * @param blocks - 全部块数组
 * @param startIndex - 起始块索引
 * @param endIndex - 结束块索引（包含）
 * @returns 对应的 SourceRange
 */
export function getBlockContentRange(
  blocks: MarkdownBlock[],
  startIndex: number,
  endIndex: number,
): SourceRange {
  return {
    documentId: blocks[startIndex].documentId,
    startBlockId: blocks[startIndex].id,
    endBlockId: blocks[endIndex].id,
  };
}

/**
 * 获取窗口的完整文本内容。
 *
 * 将窗口中所有块的内容用双换行符连接。
 *
 * @param window - 内容窗口
 * @returns 拼接后的文本
 */
export function getWindowText(window: ContentWindow): string {
  return window.blocks.map(b => b.content).join('\n\n');
}
