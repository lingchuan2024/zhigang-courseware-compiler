import { CoursePage, SourceTextItem, SourceTextBlock } from '../types';

// 文件验证
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
export const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ALLOWED_TYPES = ['application/pdf', PPTX_MIME_TYPE];

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: '未选择文件' };
  }
  const extension = file.name.toLowerCase();
  if (extension.endsWith('.ppt')) {
    return { valid: false, error: '暂不支持旧版 PPT，请另存为 PPTX 后上传' };
  }
  if (
    !ALLOWED_TYPES.includes(file.type)
    && !extension.endsWith('.pdf')
    && !extension.endsWith('.pptx')
  ) {
    return { valid: false, error: '只支持 PDF 或 PPTX 文件' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `文件大小不能超过${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  return { valid: true };
}

// PDF.js 配置和加载
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib;

  const pdfjs = await import('pdfjs-dist');
  // 设置worker
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjsLib = pdfjs;
  return pdfjs;
}

/** Load the original PDF for high-resolution, on-demand page rendering. */
export async function loadPdfDocument(buffer: ArrayBuffer) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({ data: buffer }).promise;
}

// ========== 机械属性提取 ==========

interface PdfJsTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e, f] — e=x, f=y
  width: number;
  height: number;
  hasEOL?: boolean;
}

/**
 * 从 PDF.js TextItem 提取结构化 SourceTextItem。
 * 仅保留机械属性（坐标、字号、换行标记），不做任何语义判断。
 */
function extractSourceTextItem(
  item: PdfJsTextItem,
  sourceIndex: number
): SourceTextItem | null {
  const str = item.str ?? '';
  // 跳过空字符串但保留有 hasEOL 的项（用于行分割）
  if (!str && !item.hasEOL) return null;

  const x = item.transform?.[4] ?? 0;
  const y = item.transform?.[5] ?? 0;
  // 字号估算：transform[0] 是水平缩放因子，近似等于字号
  const fontSize = Math.abs(item.transform?.[0] ?? item.height ?? 12);

  return {
    text: str,
    x,
    y,
    fontSize: Math.round(fontSize * 10) / 10, // 保留1位小数
    hasEol: item.hasEOL ?? false,
    sourceIndex,
  };
}

// ========== 机械聚合规则 ==========

const MAX_LINE_GAP_RATIO = 1.8;   // 行间距超过字号 * 此比例 → 新块
const MAX_BLOCK_CHARS = 500;       // 块内最大字符数
const MIN_BLOCK_GAP_RATIO = 2.5;   // 空白间距超过字号 * 此比例 → 新块
const SENTENCE_ENDERS = /[。！？.!?；;]$/;

/**
 * 将 SourceTextItem 列表机械聚合为 SourceTextBlock。
 *
 * 聚合规则（仅使用坐标、字号、换行标记、间距、页边界）：
 * 1. hasEOL=true 触发行结束
 * 2. y 坐标变化超过行高 → 新行
 * 3. 字号显著变化 → 新块
 * 4. 空白距离过大 → 新块
 * 5. 块内字符数超限 → 强制分割
 * 6. 句子结束符后跟大写字母/新行 → 可选分割点
 *
 * 不使用关键词、文本相似度或任何语义判断。
 */
function aggregateIntoBlocks(
  items: SourceTextItem[],
  pageNumber: number
): SourceTextBlock[] {
  if (items.length === 0) return [];

  const blocks: SourceTextBlock[] = [];
  let currentItems: SourceTextItem[] = [];
  let currentText: string[] = [];
  let blockIndex = 0;

  // 辅助：完成当前块
  const flushBlock = () => {
    if (currentItems.length === 0) return;
    const text = currentText.join('').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      currentItems = [];
      currentText = [];
      return;
    }
    const fontSizes = currentItems.map(i => i.fontSize);
    const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
    const ys = currentItems.map(i => i.y);
    blocks.push({
      items: [...currentItems],
      text,
      pageNumber,
      blockIndex: blockIndex++,
      avgFontSize: Math.round(avgFontSize * 10) / 10,
      yStart: Math.max(...ys),
      yEnd: Math.min(...ys),
    });
    currentItems = [];
    currentText = [];
  };

  let prevItem: SourceTextItem | null = null;
  let prevLineY: number | null = null;

  for (const item of items) {
    // 空字符串但有 hasEOL → 仅用于行结束标记
    if (!item.text && item.hasEol) {
      if (currentItems.length > 0) {
        currentText.push('\n');
      }
      prevLineY = item.y;
      prevItem = item;
      continue;
    }

    // 空字符串跳过
    if (!item.text) continue;

    // 判断是否需要开始新块
    if (prevItem && currentItems.length > 0) {
      const shouldBreak = shouldStartNewBlock(item, prevItem, prevLineY, currentText.join(''));
      if (shouldBreak) {
        flushBlock();
      }
    }

    // 添加到当前块
    currentItems.push(item);
    currentText.push(item.text);

    // hasEOL → 添加换行
    if (item.hasEol) {
      currentText.push('\n');
      prevLineY = item.y;
    }

    // 块内字符数超限 → 强制分割
    const currentLength = currentText.join('').length;
    if (currentLength >= MAX_BLOCK_CHARS) {
      // 在句子结束符后分割
      const fullText = currentText.join('');
      const lastSentenceEnd = Math.max(
        fullText.lastIndexOf('。'),
        fullText.lastIndexOf('？'),
        fullText.lastIndexOf('！'),
        fullText.lastIndexOf('.'),
        fullText.lastIndexOf('!'),
        fullText.lastIndexOf('?'),
        fullText.lastIndexOf(';'),
        fullText.lastIndexOf('；'),
      );
      if (lastSentenceEnd > MAX_BLOCK_CHARS * 0.5) {
        // 在句子结束符后分割
        const before = fullText.substring(0, lastSentenceEnd + 1);
        const after = fullText.substring(lastSentenceEnd + 1);
        // 重新构建当前块
        currentText = [before.trim()];
        // 完成当前块
        const fontSizes = currentItems.map(i => i.fontSize);
        const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
        const ys = currentItems.map(i => i.y);
        blocks.push({
          items: [...currentItems],
          text: before.trim(),
          pageNumber,
          blockIndex: blockIndex++,
          avgFontSize: Math.round(avgFontSize * 10) / 10,
          yStart: Math.max(...ys),
          yEnd: Math.min(...ys),
        });
        currentItems = [];
        // 将剩余部分作为新块的开始
        if (after.trim()) {
          currentText = [after.trim()];
          currentItems.push(item); // 至少保留当前 item
        } else {
          currentText = [];
        }
      } else {
        flushBlock();
      }
    }

    prevItem = item;
  }

  flushBlock();

  // 重新编号 blockIndex 确保连续
  blocks.forEach((b, i) => { b.blockIndex = i; });

  return blocks;
}

/**
 * 判断是否应该开始新块。
 * 仅基于机械属性：坐标变化、字号变化、间距、换行。
 */
function shouldStartNewBlock(
  current: SourceTextItem,
  prev: SourceTextItem,
  prevLineY: number | null,
  currentBlockText: string,
): boolean {
  // 1. y 坐标变化 → 新行/新块
  const yDiff = Math.abs(current.y - prev.y);
  const refFontSize = Math.max(current.fontSize, prev.fontSize, 10);

  // 大的 y 跳跃 → 新块
  if (yDiff > refFontSize * MIN_BLOCK_GAP_RATIO) {
    return true;
  }

  // 2. 字号显著变化（超过30%）→ 新块
  const fontRatio = Math.abs(current.fontSize - prev.fontSize) / Math.max(prev.fontSize, 1);
  if (fontRatio > 0.3) {
    return true;
  }

  // 3. x 坐标回退到行首 + 有 y 变化 → 新行（不一定新块）
  // 如果 y 变化超过正常行距 → 新块
  if (prevLineY !== null && Math.abs(current.y - prevLineY) > refFontSize * MAX_LINE_GAP_RATIO) {
    return true;
  }

  // 4. 块内字符数已经较多，遇到句子结束 → 可选分割
  if (currentBlockText.length > 200 && SENTENCE_ENDERS.test(currentBlockText.trimEnd())) {
    // 只在下一个 item 是新行开始时分割
    if (current.hasEol || Math.abs(current.y - prev.y) > refFontSize * 0.5) {
      return true;
    }
  }

  return false;
}

// ========== 主解析函数 ==========

/**
 * 解析PDF，保留版面结构。
 *
 * 输出：CoursePage[]，每页包含：
 * - text: 兼容旧逻辑的合并文本
 * - blocks: 结构化文本块（SourceTextBlock[]）
 */
export async function parsePdf(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<CoursePage[]> {
  const pdfjs = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: CoursePage[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    onProgress?.(pageNum, numPages);

    const page = await pdf.getPage(pageNum);

    let text = '';
    let blocks: SourceTextBlock[] | undefined;
    let warning: string | undefined;

    try {
      const textContent = await page.getTextContent();

      // 提取 SourceTextItem
      const sourceItems: SourceTextItem[] = [];
      let itemIndex = 0;
      for (const rawItem of textContent.items) {
        if ('str' in rawItem) {
          const item = extractSourceTextItem(
            rawItem as PdfJsTextItem,
            itemIndex++
          );
          if (item) {
            sourceItems.push(item);
          }
        }
      }

      // 机械聚合为 SourceTextBlock
      blocks = aggregateIntoBlocks(sourceItems, pageNum);

      // 兼容旧逻辑：合并所有 block 文本
      text = blocks
        .map(b => b.text)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!text) {
        warning = '本页未检测到文本内容，可能是扫描版PDF';
      }
    } catch {
      warning = '文本提取失败';
    }

    // 生成低分辨率预览
    let preview: string | undefined;
    try {
      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        preview = canvas.toDataURL('image/jpeg', 0.6);
      }
    } catch {
      // 预览生成失败不影响主流程
    }

    pages.push({
      pageNumber: pageNum,
      text,
      blocks: blocks && blocks.length > 0 ? blocks : undefined,
      preview,
      warning,
    });
  }

  return pages;
}
