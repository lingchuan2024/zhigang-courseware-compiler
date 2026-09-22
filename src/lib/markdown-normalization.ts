// ========== Markdown Normalization ==========
// Deterministic conversion of LaTeX delimiters to KaTeX-compatible format.
// Only processes text outside of fenced code blocks and inline code.

export interface NormalizationResult {
  content: string;
  warnings: string[];
}

/**
 * Normalize generated Markdown:
 * - Convert \(...\) → $...$
 * - Convert \[...\] → $$...$$ (including multi-line)
 * - Do NOT modify fenced code blocks or inline code
 * - Must be idempotent: running twice produces the same result
 */
export function normalizeGeneratedMarkdown(content: string): NormalizationResult {
  const warnings: string[] = [];

  // Split into segments: code blocks and text (by fenced code blocks only)
  const segments = splitCodeSegments(content);

  const normalizedSegments = segments.map(seg => {
    if (seg.type === 'code') {
      return seg.text; // Leave code blocks untouched
    }
    return normalizeTextSegment(seg.text, warnings);
  });

  // Join with '\n' to preserve newlines between segments
  const normalized = normalizedSegments.join('\n');

  // Post-normalization validation
  validateNormalizedContent(normalized, warnings);

  return { content: normalized, warnings };
}

// ========== Code Segment Splitting ==========

type SegmentType = 'text' | 'code';
interface Segment {
  type: SegmentType;
  text: string;
}

/**
 * Split markdown into segments by fenced code blocks.
 * Inline code is handled separately via placeholders in normalizeTextSegment.
 */
function splitCodeSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const lines = content.split('\n');
  let inCodeFence = false;
  let fenceMarker = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      segments.push({ type: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };

  const flushCode = () => {
    if (codeLines.length > 0) {
      segments.push({ type: 'code', text: codeLines.join('\n') });
      codeLines = [];
    }
  };

  for (const line of lines) {
    // Check for code fence start/end
    const fenceMatch = line.match(/^((?:[ \t]*>[ \t]*)*[ \t]*)(```+|~~~+)/);

    if (inCodeFence) {
      // Inside code fence — accumulate all lines as code
      codeLines.push(line);
      // Check for closing fence (same marker type)
      if (fenceMatch && fenceMatch[2][0] === fenceMarker[0]) {
        flushCode();
        inCodeFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (fenceMatch) {
      // Opening fence — flush pending text first
      flushText();
      codeLines.push(line);
      inCodeFence = true;
      fenceMarker = fenceMatch[2];
      continue;
    }

    // Regular text line
    textLines.push(line);
  }

  // Handle remaining content
  if (inCodeFence) {
    // Unclosed code fence — treat accumulated lines as code
    flushCode();
  } else {
    flushText();
  }

  return segments;
}

// ========== Text Normalization ==========

/**
 * Normalize a text segment: convert \(...\) and \[...\] delimiters.
 * Inline code is protected via placeholders so it is never modified.
 */
function normalizeTextSegment(text: string, warnings: string[]): string {
  // Protect inline code by replacing with placeholders
  // Use Private Use Area chars (U+E000/E001) — not control chars, won't trigger no-control-regex
  const inlineCodeStore: string[] = [];
  const INLINE_CODE_PLACEHOLDER = (idx: number) => `\uE000IC${idx}\uE001`;

  const protectedText = text.replace(/`[^`]+`/g, (match) => {
    const index = inlineCodeStore.length;
    inlineCodeStore.push(match);
    return INLINE_CODE_PLACEHOLDER(index);
  });

  let result = protectedText;

  // 1. Convert \[...\] (including multi-line) to $$...$$
  result = convertDisplayMath(result, warnings);

  // 2. Convert \(...\) to $...$
  result = convertInlineMath(result, warnings);
  result = repairQuotedDisplayMath(result);

  // remark-math treats same-line $$...$$ as inline math; equation tags then fail.
  // Only promote standalone lines, after code spans/fences have been protected.
  let inDisplayMath = false;
  result = result.split('\n').map(line => {
    const standalone = !inDisplayMath && line.match(/^((?: {0,3}> ?)* {0,3})\$\$([^\n]+?)\$\$[ \t]*$/);
    const delimiterCount = (line.match(/\$\$/g) ?? []).length;
    if (delimiterCount % 2 !== 0) inDisplayMath = !inDisplayMath;
    if (!standalone || delimiterCount !== 2) return line;
    const [, indent, formula] = standalone;
    return `${indent}$$\n${indent}${formula.trim()}\n${indent}$$`;
  }).join('\n');

  // Restore inline code
  result = result.replace(/\uE000IC(\d+)\uE001/g, (_match, idx) => {
    const index = parseInt(idx, 10);
    return inlineCodeStore[index] ?? '';
  });

  return result;
}

/** Recover quote prefixes lost by OCR/model delimiter conversion, without changing formula text. */
function repairQuotedDisplayMath(text: string): string {
  const lines = text.split('\n');
  for (let start = 0; start < lines.length; start++) {
    const prefix = lines[start].match(/^((?: {0,3}> ?)+)\$\$[ \t]*$/)?.[1];
    if (!prefix) continue;
    let end = start + 1;
    while (end < lines.length && end - start <= 100) {
      if (/^(?: {0,3}> ?)*[ \t]*\$\$[ \t]*$/.test(lines[end])) break;
      if (/^(?: {0,3}> ?)*#{1,6}\s/.test(lines[end])) break;
      end++;
    }
    if (end >= lines.length || end - start > 100 || !/^(?: {0,3}> ?)*[ \t]*\$\$[ \t]*$/.test(lines[end])) continue;
    for (let index = start + 1; index <= end; index++) {
      if (!lines[index].startsWith(prefix)) lines[index] = prefix + lines[index].replace(/^(?: {0,3}> ?)+/, '');
    }
    start = end;
  }
  return lines.join('\n');
}

/**
 * Convert \[...\] to $$...$$
 * Handles both single-line and multi-line forms.
 */
function convertDisplayMath(text: string, _warnings: string[]): string {
  let result = text;

  // Match \[...\] including multi-line content
  // \[ can be on its own line or inline
  result = result.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_match, inner: string) => {
      const trimmed = inner.trim();
      return `$$\n${trimmed}\n$$`;
    }
  );

  return result;
}

/**
 * Convert \(...\) to $...$
 */
function convertInlineMath(text: string, _warnings: string[]): string {
  return text.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_match, inner: string) => {
      return `$${inner.trim()}$`;
    }
  );
}

// ========== Validation ==========

function validateNormalizedContent(content: string, warnings: string[]): void {
  // Check for remaining \[ or \] (unmatched)
  const remainingDisplayOpen = (content.match(/\\\[/g) || []).length;
  const remainingDisplayClose = (content.match(/\\\]/g) || []).length;
  if (remainingDisplayOpen > 0 || remainingDisplayClose > 0) {
    warnings.push(`检测到未闭合的 \\[ 或 \\]（开: ${remainingDisplayOpen}, 闭: ${remainingDisplayClose}）`);
  }

  // Check for remaining \( or \) (unmatched)
  const remainingInlineOpen = (content.match(/\\\(/g) || []).length;
  const remainingInlineClose = (content.match(/\\\)/g) || []).length;
  if (remainingInlineOpen > 0 || remainingInlineClose > 0) {
    warnings.push(`检测到未闭合的 \\( 或 \\)（开: ${remainingInlineOpen}, 闭: ${remainingInlineClose}）`);
  }

  // Check for unmatched $$ (odd count)
  const dollarDollarCount = (content.match(/\$\$/g) || []).length;
  if (dollarDollarCount % 2 !== 0) {
    warnings.push('检测到未闭合的 $$ 块级公式分隔符');
  }

  // Check for unmatched single $ (excluding $$)
  const withoutDoubleDollar = content.replace(/\$\$/g, '');
  const singleDollarCount = (withoutDoubleDollar.match(/\$/g) || []).length;
  if (singleDollarCount % 2 !== 0) {
    warnings.push('检测到未闭合的 $ 行内公式分隔符');
  }
}
