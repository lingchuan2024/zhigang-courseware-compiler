import type { MarkdownBlock, SourceDocument, SourceRange } from '../types';

export interface ResolvedSourceRange {
  range: SourceRange;
  documentTitle: string;
  headingPath: string[];
  blocks: MarkdownBlock[];
  markdown: string;
  missingReason?: string;
}

function missing(range: SourceRange, documentTitle: string, reason: string): ResolvedSourceRange {
  return {
    range,
    documentTitle,
    headingPath: [],
    blocks: [],
    markdown: '',
    missingReason: reason,
  };
}

export function resolveSourceRanges(
  ranges: SourceRange[],
  documents: SourceDocument[],
): ResolvedSourceRange[] {
  const documentsById = new Map(documents.map(document => [document.id, document]));

  return ranges.map(range => {
    const document = documentsById.get(range.documentId);
    if (!document) {
      return missing(range, range.documentId, `找不到来源文档 ${range.documentId}`);
    }

    const orderedBlocks = [...document.blocks].sort((a, b) => a.orderIndex - b.orderIndex);
    const startIndex = orderedBlocks.findIndex(block => block.id === range.startBlockId);
    const endIndex = orderedBlocks.findIndex(block => block.id === range.endBlockId);
    if (startIndex < 0 || endIndex < 0) {
      const missingIds = [
        startIndex < 0 ? range.startBlockId : '',
        endIndex < 0 ? range.endBlockId : '',
      ].filter(Boolean);
      return missing(range, document.title, `找不到原文块 ${missingIds.join('、')}`);
    }
    if (startIndex > endIndex) {
      return missing(range, document.title, `来源范围顺序无效：${range.startBlockId} → ${range.endBlockId}`);
    }

    const blocks = orderedBlocks.slice(startIndex, endIndex + 1);
    return {
      range,
      documentTitle: document.title,
      headingPath: blocks[0]?.headingPath ?? [],
      blocks,
      markdown: blocks.map(block => block.content).join('\n\n'),
    };
  });
}
