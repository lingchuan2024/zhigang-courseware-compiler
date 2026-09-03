import type { MarkdownBlock } from '../../types';
import { evidenceStableKey, normalizeStableText } from './stable-identity';
import type {
  CourseStructureIssue,
  EvidenceSpan,
  EvidenceSpanDraft,
} from './types';

function invalidEvidence(draft: EvidenceSpanDraft, message: string): CourseStructureIssue {
  return {
    code: 'INVALID_EVIDENCE',
    severity: 'warning',
    message,
    blockId: draft.blockId,
  };
}

function allOccurrences(content: string, quote: string): number[] {
  const indexes: number[] = [];
  for (let from = 0;;) {
    const index = content.indexOf(quote, from);
    if (index < 0) return indexes;
    indexes.push(index);
    from = index + Math.max(1, quote.length);
  }
}

interface IndexedNormalizedText {
  text: string;
  starts: number[];
  ends: number[];
}

function indexedNormalizedText(value: string): IndexedNormalizedText {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingWhitespaceStart: number | undefined;
  let pendingWhitespaceEnd: number | undefined;

  for (let offset = 0; offset < value.length;) {
    const point = value.codePointAt(offset);
    if (point === undefined) break;
    const raw = String.fromCodePoint(point);
    const end = offset + raw.length;
    const normalized = raw.normalize('NFKC').toLocaleLowerCase();
    if (/^\s+$/u.test(normalized)) {
      if (text.length > 0 && pendingWhitespaceStart === undefined) pendingWhitespaceStart = offset;
      pendingWhitespaceEnd = end;
      offset = end;
      continue;
    }
    if (pendingWhitespaceStart !== undefined && text.length > 0) {
      text += ' ';
      starts.push(pendingWhitespaceStart);
      ends.push(pendingWhitespaceEnd ?? pendingWhitespaceStart + 1);
    }
    pendingWhitespaceStart = undefined;
    pendingWhitespaceEnd = undefined;
    for (const character of normalized) {
      text += character;
      starts.push(offset);
      ends.push(end);
    }
    offset = end;
  }

  return { text, starts, ends };
}

/** 在保留原文 UTF-16 偏移量的前提下，容忍模型折叠换行和连续空格。 */
export function locateUniqueNormalizedQuote(
  content: string,
  quote: string,
): { startOffset: number; endOffset: number } | undefined {
  const source = indexedNormalizedText(content);
  const needle = indexedNormalizedText(quote).text;
  if (!needle) return undefined;
  const positions = allOccurrences(source.text, needle);
  if (positions.length !== 1) return undefined;
  const normalizedStart = positions[0];
  const normalizedEnd = normalizedStart + needle.length - 1;
  return {
    startOffset: source.starts[normalizedStart],
    endOffset: source.ends[normalizedEnd],
  };
}

export function resolveEvidenceSpan(
  draft: EvidenceSpanDraft,
  block: MarkdownBlock,
): { span?: EvidenceSpan; issue?: CourseStructureIssue } {
  if (draft.blockId !== block.id) {
    return { issue: invalidEvidence(draft, `证据引用了错误的内容块：${draft.blockId}`) };
  }

  const quote = draft.quote.trim();
  if (!quote) {
    return { issue: invalidEvidence(draft, '证据引用不能为空') };
  }

  let startOffset: number | undefined;
  let endOffset: number | undefined;
  if (
    Number.isInteger(draft.startOffset)
    && Number.isInteger(draft.endOffset)
    && (draft.startOffset ?? -1) >= 0
    && (draft.endOffset ?? 0) > (draft.startOffset ?? -1)
    && (draft.endOffset ?? 0) <= block.content.length
  ) {
    const supplied = block.content.slice(draft.startOffset, draft.endOffset);
    if (normalizeStableText(supplied) === normalizeStableText(quote)) {
      startOffset = draft.startOffset;
      endOffset = draft.endOffset;
    }
  }

  if (startOffset === undefined || endOffset === undefined) {
    const positions = allOccurrences(block.content, quote);
    if (positions.length === 1) {
      startOffset = positions[0];
      endOffset = startOffset + quote.length;
    } else {
      const normalized = positions.length === 0
        ? locateUniqueNormalizedQuote(block.content, quote)
        : undefined;
      if (normalized) {
        startOffset = normalized.startOffset;
        endOffset = normalized.endOffset;
      } else {
      return {
        issue: invalidEvidence(
          draft,
          positions.length === 0 ? '无法在原文中定位证据引用' : '证据引用在原文中出现多次，无法唯一定位',
        ),
      };
      }
    }
  }

  const sourceQuote = block.content.slice(startOffset, endOffset);
  const stableKey = evidenceStableKey(
    block.documentId,
    block.contentHash,
    startOffset,
    endOffset,
    sourceQuote,
  );

  return {
    span: {
      id: stableKey,
      stableKey,
      documentId: block.documentId,
      blockId: block.id,
      startOffset,
      endOffset,
      quote: sourceQuote,
      role: draft.role,
      contentHash: block.contentHash,
    },
  };
}
