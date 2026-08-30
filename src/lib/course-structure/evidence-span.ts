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
    if (positions.length !== 1) {
      return {
        issue: invalidEvidence(
          draft,
          positions.length === 0 ? '无法在原文中定位证据引用' : '证据引用在原文中出现多次，无法唯一定位',
        ),
      };
    }
    startOffset = positions[0];
    endOffset = startOffset + quote.length;
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
