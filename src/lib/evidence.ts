import { EvidenceAtom, EvidenceType, CoursePage, SourceTextBlock } from '../types';
import { sanitizeText } from './utils';

// ========== 内容指纹 ==========

export function computeContentHash(
  documentId: string,
  pageNumber: number,
  blockIndex: number,
  _type: EvidenceType,
  content: string
): string {
  // 稳定ID：基于 documentId + pageNumber + blockIndex + normalizedContent
  // 不包含 type，因为 type 可能因检测算法变化而改变
  const normalized = content.trim().replace(/\s+/g, ' ').slice(0, 300);
  const raw = `${documentId}|${pageNumber}|${blockIndex}|${normalized}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `h${Math.abs(hash).toString(36)}`;
}

// 生成稳定的 Evidence ID
export function generateStableEvidenceId(
  documentId: string,
  pageNumber: number,
  blockIndex: number,
  contentHash: string
): string {
  return `ev_${documentId}_${pageNumber}_${blockIndex}_${contentHash}`;
}

// ========== 行级分类 ==========

export type LineType = 'heading' | 'formula' | 'list-item' | 'numbered-step' | 'text' | 'empty';

const HEADING_PATTERNS: RegExp[] = [
  // 阿拉伯数字编号: 1. 标题 / 1、标题 / 1）标题 / 2.3 标题
  /^\s*\d+(?:\.\d+)*\s*[.、)）]\s*\S/,
  // 中文数字: 一、标题 / （一）标题
  /^\s*[一二三四五六七八九十百千]+[、.）)]\s*\S/,
  /^\s*[（(][一二三四五六七八九十百千]+[)）]\s*\S/,
  // 章节标记: 第1章 / 第一章 / 第1节 / 第一节
  /^\s*第\s*\d+\s*[章节节课讲]\s/,
  /^\s*第\s*[一二三四五六七八九十百千]+\s*[章节节课讲]\s/,
  // 英文: Chapter 1 / Section 2.3
  /^\s*(?:Chapter|Section|Part|Lecture|Lesson)\s+\d+(\.\d+)?\b/i,
];

// 必须是短行才可能是标题
const MAX_HEADING_LENGTH = 60;
const MIN_HEADING_CONTENT = 2;

export function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_HEADING_LENGTH) return false;

  // 不能包含多个句子结束符（说明是正文段落）
  const sentenceEnders = (trimmed.match(/[。！？.!?；;]/g) || []).length;
  if (sentenceEnders >= 2) return false;

  // 不能以公式符号开头或包含大量公式
  if (/^[=+\-*/^√∑∏∫≤≥≠≈≡{}()[\]]/.test(trimmed)) return false;

  // 检查标题模式
  for (const pattern of HEADING_PATTERNS) {
    if (pattern.test(trimmed)) {
      // 去掉编号后必须有实际内容（使用有序的前缀模式，而非贪婪字符类）
      const content = stripHeadingPrefix(trimmed);
      if (content.length >= MIN_HEADING_CONTENT) {
        // 纯数字内容（如去掉"3."后只剩"14"）不是有效标题
        if (/^\d+(\.\d+)*$/.test(content)) return false;
        return true;
      }
    }
  }

  return false;
}

// 按顺序去除各类编号前缀，返回剩余内容
export function stripHeadingPrefix(line: string): string {
  let s = line.trim();
  // 英文标题前缀: Chapter 1, Section 2.3, Lecture 5 等
  s = s.replace(/^(?:Chapter|Section|Part|Lecture|Lesson)\s+\d+(\.\d+)?[.:、]?\s*/i, '');
  // 中文章节标记: 第1章 / 第一章 / 第2节 / 第三节 等（带编号）
  s = s.replace(/^第\s*(?:\d+|[一二三四五六七八九十百千]+)\s*[章节节课讲]\s*/, '');
  // 中文数字编号: 一、 / （一） / 二) 等
  s = s.replace(/^[（(]?\s*[一二三四五六七八九十百千]+\s*[、.）)]\s*/, '');
  // 阿拉伯数字编号: 1. / 1、 / 1） / 2.3 / 2.3.4 等
  s = s.replace(/^\d+(?:\.\d+)*\s*[.、)）]\s*/, '');
  return s.trim();
}

export function isFormulaLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;

  // 公式特征：包含数学符号密度高
  const mathChars = (trimmed.match(/[=+\-*/^√∑∏∫≤≥≠≈≡∂∇εσλμθβαγπΩΣΠ∈∉⊂⊃∪∩→←↔⇒⇐⇔∞∝∠⊥∥∼≅≈≠≤≥]/g) || []).length;
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length;
  const total = trimmed.length;

  // 有LaTeX
  if (/\\(frac|sum|int|sqrt|prod|alpha|beta|gamma|sigma|lambda|theta|partial|nabla|infty)/.test(trimmed)) return true;
  // 有$...$
  if (/\$[^$]+\$/.test(trimmed)) return true;
  // 数学符号占比高
  if (total > 5 && mathChars / total > 0.15 && letters > 0) return true;
  // 典型模式：变量=表达式
  if (/^[A-Za-z][\w\s]*\s*=\s*\S/.test(trimmed) && trimmed.length < 100) return true;

  return false;
}

export function isListItem(line: string): boolean {
  const trimmed = line.trim();
  return /^\s*[-*•·]\s+\S/.test(trimmed);
}

export function isNumberedStep(line: string): boolean {
  const trimmed = line.trim();
  // 步骤：1) 内容 / (1) 内容，但要与标题区分（标题后面不跟长内容）
  if (/^\s*\d+[)）]\s+\S/.test(trimmed) && trimmed.length > 10) return true;
  if (/^\s*[（(]\d+[)）]\s+\S/.test(trimmed) && trimmed.length > 10) return true;
  return false;
}

export function classifyLine(line: string): LineType {
  const trimmed = line.trim();
  if (trimmed.length === 0) return 'empty';
  if (isHeadingLine(line)) return 'heading';
  if (isFormulaLine(line)) return 'formula';
  if (isListItem(line)) return 'list-item';
  if (isNumberedStep(line)) return 'numbered-step';
  return 'text';
}

// ========== 页面切分 ==========

export interface Chunk {
  text: string;
  lines: string[];
  type: 'heading' | 'formula' | 'list' | 'text';
}

const MAX_CHUNK_LENGTH = 400;

export function splitPageIntoEvidenceChunks(pageText: string): Chunk[] {
  if (!pageText || !pageText.trim()) return [];

  // 统一换行符
  const normalized = pageText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').map(l => l.replace(/\s+$/, ''));

  const chunks: Chunk[] = [];
  let textBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length > 0) {
      const text = textBuffer.join('\n').trim();
      if (text) {
        chunks.push({
          text,
          lines: [...textBuffer],
          type: 'text',
        });
      }
      textBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      const text = listBuffer.join('\n').trim();
      if (text) {
        chunks.push({
          text,
          lines: [...listBuffer],
          type: 'list',
        });
      }
      listBuffer = [];
    }
  };

  for (const line of lines) {
    const lineType = classifyLine(line);
    const trimmed = line.trim();

    if (lineType === 'empty') {
      flushText();
      flushList();
      continue;
    }

    if (lineType === 'heading') {
      flushText();
      flushList();
      chunks.push({
        text: trimmed,
        lines: [trimmed],
        type: 'heading',
      });
      continue;
    }

    if (lineType === 'formula') {
      flushText();
      flushList();
      chunks.push({
        text: trimmed,
        lines: [trimmed],
        type: 'formula',
      });
      continue;
    }

    if (lineType === 'list-item' || lineType === 'numbered-step') {
      flushText();
      listBuffer.push(trimmed);
      continue;
    }

    // 普通文本
    flushList();

    // 检查是否需要拆分
    const currentLength = textBuffer.join('\n').length;
    if (currentLength + trimmed.length + 1 > MAX_CHUNK_LENGTH && textBuffer.length > 0) {
      flushText();
    }
    textBuffer.push(trimmed);
  }

  flushText();
  flushList();

  return chunks;
}

// ========== 类型检测（针对整个chunk） ==========

function detectChunkType(chunk: Chunk): { type: EvidenceType; confidence: number } {
  const text = chunk.text.trim();

  // 标题块
  if (chunk.type === 'heading') {
    const contentLength = stripHeadingPrefix(text).length;
    if (contentLength >= MIN_HEADING_CONTENT && text.length <= MAX_HEADING_LENGTH) {
      return { type: 'title', confidence: 0.85 };
    }
  }

  // 公式块
  if (chunk.type === 'formula') {
    return { type: 'formula', confidence: 0.8 };
  }

  // 列表块
  if (chunk.type === 'list') {
    // 检查是否是步骤
    if (/步骤|方法|流程|算法|首先|其次|然后|最后/.test(text)) {
      return { type: 'procedure', confidence: 0.6 };
    }
    // 检查是否是总结列表
    if (/总结|小结|要点|总结|结论/.test(text)) {
      return { type: 'text', confidence: 0.5 };
    }
    return { type: 'text', confidence: 0.4 };
  }

  // 文本块：基于内容特征判断
  const typeScore: Record<Exclude<EvidenceType, 'title' | 'formula'>, number> = {
    definition: 0,
    derivation: 0,
    conclusion: 0,
    example: 0,
    procedure: 0,
    comparison: 0,
    chart: 0,
    assumption: 0,
    condition: 0,
    text: 0.3,
  };

  // 定义特征
  if (/定义[：:]|是指|称为|叫做|所谓|概念|含义|即\s*[^\n]{5,}/.test(text)) {
    typeScore.definition += 0.5;
  }
  if (/[A-Z][\w\s]+是[^\n]{5,}/.test(text)) {
    typeScore.definition += 0.3;
  }

  // 例子特征
  if (/例如|比如|举例|示例|例子|实例|case|example|e\.g\./i.test(text)) {
    typeScore.example += 0.6;
  }
  if (/^\s*例\s*\d+[：:.)]/.test(text)) {
    typeScore.example += 0.4;
  }

  // 步骤特征
  if (/步骤|流程|方法|算法|过程|procedure|algorithm/i.test(text)) {
    typeScore.procedure += 0.4;
  }
  // 顺序连接词：多个同时出现更可能是步骤
  const sequentialMatches = (text.match(/首先|其次|然后|接着|最后|第[一二三四五六七八九十\d]+步/g) || []).length;
  if (sequentialMatches > 0) {
    typeScore.procedure += 0.2 + sequentialMatches * 0.15;
  }

  // 对比特征
  if (/区别|不同|相比|对比|比较|vs\.?|versus|compared|difference/i.test(text)) {
    typeScore.comparison += 0.5;
  }
  if (/一方面|另一方面|既.*又|不仅.*而且/.test(text)) {
    typeScore.comparison += 0.3;
  }

  // 推导特征
  if (/推导|证明|可得|因此|所以|由此|故|由上式|代入|化简|展开/i.test(text)) {
    typeScore.derivation += 0.5;
  }
  if (/令|设|取|将.*代入|由.*得|解得/i.test(text)) {
    typeScore.derivation += 0.3;
  }

  // 结论特征
  if (/结论|综上|总结|小结|因此.*最终|最终|最终结果|证毕|QED/i.test(text)) {
    typeScore.conclusion += 0.6;
  }

  // 假设特征
  if (/假设|假定|设.*为|假设.*独立|假设.*同分布|i\.i\.d|iid/i.test(text)) {
    typeScore.assumption += 0.6;
  }

  // 条件特征
  if (/条件|当且仅当|充要条件|充分条件|必要条件|前提|适用于|适用范围/i.test(text)) {
    typeScore.condition += 0.5;
  }

  // 图表特征
  if (/图\s*\d|表\s*\d|如图|如表|见图|见表|chart|graph|plot|figure/i.test(text)) {
    typeScore.chart += 0.5;
  }

  // 短文本可能是子标题
  if (text.length < 40 && !/[。！？.!?]/.test(text)) {
    // 检查是否像标题
    if (isHeadingLine(text)) {
      return { type: 'title', confidence: 0.6 };
    }
  }

  // 找最高分
  let bestType: EvidenceType = 'text';
  let bestScore = typeScore.text;
  for (const [t, s] of Object.entries(typeScore) as [EvidenceType, number][]) {
    if (s > bestScore) {
      bestScore = s;
      bestType = t;
    }
  }

  return { type: bestType, confidence: Math.min(bestScore + 0.2, 1) };
}

// ========== 基于SourceTextBlock的细粒度切分 ==========

const MIN_EVIDENCE_CHARS = 30;
const MAX_EVIDENCE_CHARS = 300;
const TARGET_EVIDENCE_CHARS = 200;

/**
 * 将 SourceTextBlock 进一步切分为细粒度的 Chunk。
 * 规则：
 * - block 文本 < MAX_EVIDENCE_CHARS → 整块作为一个 chunk
 * - block 文本 > MAX_EVIDENCE_CHARS → 按句子/换行分割
 * - 不跨 block 合并
 */
function splitBlockIntoChunks(block: SourceTextBlock): Chunk[] {
  const text = block.text.trim();
  if (!text) return [];

  // 如果块文本在合理范围内，直接使用
  if (text.length <= MAX_EVIDENCE_CHARS) {
    const chunk: Chunk = {
      text,
      lines: text.split('\n'),
      type: 'text', // 会通过 detectChunkType 重新检测
    };
    // 使用机械属性辅助类型检测
    if (block.items.length === 1 && text.length < 60) {
      // 单行短文本，可能是标题
      chunk.type = 'heading';
    }
    return [chunk];
  }

  // 超长块：按换行分割，然后合并到目标长度
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // 空行 → flush
      if (bufferLength >= MIN_EVIDENCE_CHARS) {
        chunks.push({
          text: buffer.join('\n').trim(),
          lines: [...buffer],
          type: 'text',
        });
      }
      buffer = [];
      bufferLength = 0;
      continue;
    }

    // 单行就超长 → 按句子分割
    if (trimmed.length > MAX_EVIDENCE_CHARS) {
      // 先 flush 当前缓冲
      if (bufferLength >= MIN_EVIDENCE_CHARS) {
        chunks.push({
          text: buffer.join('\n').trim(),
          lines: [...buffer],
          type: 'text',
        });
        buffer = [];
        bufferLength = 0;
      }

      // 按句子分割超长行
      const sentences = splitBySentences(trimmed);
      for (const sentence of sentences) {
        if (sentence.trim()) {
          chunks.push({
            text: sentence.trim(),
            lines: [sentence.trim()],
            type: 'text',
          });
        }
      }
      continue;
    }

    // 添加到缓冲
    buffer.push(trimmed);
    bufferLength += trimmed.length + 1;

    // 达到目标长度 → flush
    if (bufferLength >= TARGET_EVIDENCE_CHARS) {
      chunks.push({
        text: buffer.join('\n').trim(),
        lines: [...buffer],
        type: 'text',
      });
      buffer = [];
      bufferLength = 0;
    }
  }

  // flush 剩余
  if (bufferLength >= MIN_EVIDENCE_CHARS) {
    chunks.push({
      text: buffer.join('\n').trim(),
      lines: [...buffer],
      type: 'text',
    });
  } else if (buffer.length > 0 && chunks.length > 0) {
    // 太短的尾部合并到前一个 chunk
    const lastChunk = chunks[chunks.length - 1];
    lastChunk.text = lastChunk.text + '\n' + buffer.join('\n').trim();
    lastChunk.lines = [...lastChunk.lines, ...buffer];
  } else if (buffer.length > 0) {
    // 没有前一个 chunk，直接输出
    chunks.push({
      text: buffer.join('\n').trim(),
      lines: [...buffer],
      type: 'text',
    });
  }

  return chunks;
}

/**
 * 按句子结束符分割文本。
 */
function splitBySentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (const char of text) {
    current += char;
    if (/[。！？.!?；;]$/.test(current)) {
      // 检查下一个字符是否是新句子开始（大写字母/数字/中文）
      sentences.push(current);
      current = '';
    }
  }

  if (current.trim()) {
    sentences.push(current);
  }

  return sentences;
}

// ========== 公共API（保持向后兼容） ==========

export function detectEvidenceType(text: string): { type: EvidenceType; confidence: number } {
  // 先尝试按行切分后判断
  const chunks = splitPageIntoEvidenceChunks(text);
  if (chunks.length === 1) {
    return detectChunkType(chunks[0]);
  }
  // 多块时，找最显著的类型
  if (chunks.some(c => c.type === 'heading')) {
    const headingChunk = chunks.find(c => c.type === 'heading')!;
    return detectChunkType(headingChunk);
  }
  if (chunks.some(c => c.type === 'formula')) {
    return { type: 'formula', confidence: 0.6 };
  }
  return { type: 'text', confidence: 0.4 };
}

export function splitIntoChunks(text: string): string[] {
  const chunks = splitPageIntoEvidenceChunks(text);
  return chunks.map(c => c.text);
}

// 从页面生成EvidenceAtom
export function generateEvidencesFromPage(page: CoursePage, documentId: string = 'unknown'): EvidenceAtom[] {
  const evidences: EvidenceAtom[] = [];

  // 优先使用结构化 blocks（新版 pdf.ts 产出）
  if (page.blocks && page.blocks.length > 0) {
    let blockIndex = 0;
    for (const block of page.blocks) {
      const chunks = splitBlockIntoChunks(block);
      for (const chunk of chunks) {
        const content = sanitizeText(chunk.text);
        if (!content) continue;

        const { type, confidence } = detectChunkType(chunk);
        const contentHash = computeContentHash(documentId, page.pageNumber, blockIndex, type, content);
        const id = generateStableEvidenceId(documentId, page.pageNumber, blockIndex, contentHash);
        evidences.push({
          id,
          documentId,
          pageNumber: page.pageNumber,
          blockIndex,
          type,
          content,
          confidence,
          contentHash,
        });
        blockIndex++;
      }
    }
    return evidences;
  }

  // 回退：使用 page.text（旧版兼容，或手动编辑后的页面）
  const chunks = splitPageIntoEvidenceChunks(page.text);
  chunks.forEach((chunk, blockIndex) => {
    const content = sanitizeText(chunk.text);
    if (!content) return;

    const { type, confidence } = detectChunkType(chunk);
    const contentHash = computeContentHash(documentId, page.pageNumber, blockIndex, type, content);
    const id = generateStableEvidenceId(documentId, page.pageNumber, blockIndex, contentHash);
    evidences.push({
      id,
      documentId,
      pageNumber: page.pageNumber,
      blockIndex,
      type,
      content,
      confidence,
      contentHash,
    });
  });

  return evidences;
}

// 从所有页面生成证据
export function generateEvidences(pages: CoursePage[], documentId: string = 'unknown'): EvidenceAtom[] {
  const allEvidences: EvidenceAtom[] = [];

  for (const page of pages) {
    const pageEvidences = generateEvidencesFromPage(page, documentId);
    allEvidences.push(...pageEvidences);
  }

  return allEvidences;
}

// 重新生成指定页面的证据（编辑后）
export function regeneratePageEvidences(
  pages: CoursePage[],
  pageNumber: number,
  existingEvidences: EvidenceAtom[],
  documentId: string = 'unknown'
): EvidenceAtom[] {
  const otherEvidences = existingEvidences.filter(e => e.pageNumber !== pageNumber);
  const page = pages.find(p => p.pageNumber === pageNumber);
  if (!page) return existingEvidences;
  const newEvidences = generateEvidencesFromPage(page, documentId);
  return [...otherEvidences, ...newEvidences];
}

export function getEvidenceById(evidences: EvidenceAtom[], id: string): EvidenceAtom | undefined {
  return evidences.find(e => e.id === id);
}

export function getEvidencesByPage(evidences: EvidenceAtom[], pageNumber: number): EvidenceAtom[] {
  return evidences.filter(e => e.pageNumber === pageNumber);
}

export function validateEvidenceIds(evidences: EvidenceAtom[], ids: string[]): string[] {
  const validIds = new Set(evidences.map(e => e.id));
  return ids.filter(id => validIds.has(id));
}
