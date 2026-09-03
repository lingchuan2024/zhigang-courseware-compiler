import type { MarkdownBlock, SourceDocument } from '../../types';
import { estimateTokens } from '../content-window';

export const SECTION_COMPILER_PROMPT_VERSION = 'course-section-v3';

export interface SectionBatchBlock extends MarkdownBlock {
  /** 请求内证据原子的唯一 ID；同一原文块拆分后仍保留原 block.id。 */
  atomId: string;
  /** 该原子在原始 MarkdownBlock.content 中的半开区间。 */
  sourceStartOffset: number;
  sourceEndOffset: number;
}

export interface SectionBatch {
  id: string;
  documentId: string;
  documentTitle: string;
  sectionIds: string[];
  blocks: SectionBatchBlock[];
  estimatedTokens: number;
  cacheKey: string;
}

interface SectionSlice {
  id: string;
  blocks: MarkdownBlock[];
}

function shortHash(input: string): string {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

function tokensForBlocks(blocks: MarkdownBlock[]): number {
  return blocks.reduce((total, block) => total + estimateTokens(block.content), 0);
}

function largestPrefixWithinBudget(content: string, maxTokens: number): number {
  let low = 1;
  let high = content.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (estimateTokens(content.slice(0, midpoint)) <= maxTokens) low = midpoint;
    else high = midpoint - 1;
  }
  return low;
}

function atomizeOversizedBlock(block: MarkdownBlock, maxTokens: number): SectionBatchBlock[] {
  if (estimateTokens(block.content) <= maxTokens) {
    return [{
      ...block,
      atomId: `${block.id}:atom:0`,
      sourceStartOffset: 0,
      sourceEndOffset: block.content.length,
    }];
  }
  const fragments: SectionBatchBlock[] = [];
  let remaining = block.content;
  let fragmentIndex = 0;
  let sourceStartOffset = 0;
  while (estimateTokens(remaining) > maxTokens) {
    const hardCut = largestPrefixWithinBudget(remaining, maxTokens);
    const searchFloor = Math.max(1, Math.floor(hardCut * 0.6));
    let cut = hardCut;
    for (let index = hardCut; index >= searchFloor; index -= 1) {
      if (/\s|[.?!;,。！？；，]/u.test(remaining[index - 1])) {
        cut = index;
        break;
      }
    }
    const content = remaining.slice(0, cut);
    fragments.push({
      ...block,
      atomId: `${block.id}:atom:${fragmentIndex}`,
      sourceStartOffset,
      sourceEndOffset: sourceStartOffset + content.length,
      content,
      contentHash: `${block.contentHash}__atom${fragmentIndex + 1}`,
    });
    fragmentIndex += 1;
    sourceStartOffset += content.length;
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) {
    fragments.push({
      ...block,
      atomId: `${block.id}:atom:${fragmentIndex}`,
      sourceStartOffset,
      sourceEndOffset: sourceStartOffset + remaining.length,
      content: remaining,
      contentHash: `${block.contentHash}__atom${fragmentIndex + 1}`,
    });
  }
  return fragments;
}

function deriveSections(document: SourceDocument): SectionSlice[] {
  const blocks = [...document.blocks].sort((left, right) => left.orderIndex - right.orderIndex);
  if (blocks.length === 0) return [];

  const topLevel = document.outline
    .filter(section => section.parentSectionId === undefined)
    .sort((left, right) => left.startOrder - right.startOrder);
  if (topLevel.length > 0) {
    const result: SectionSlice[] = [];
    if (blocks[0].orderIndex < topLevel[0].startOrder) {
      result.push({
        id: `sec_${document.id}_preamble`,
        blocks: blocks.filter(block => block.orderIndex < topLevel[0].startOrder),
      });
    }
    topLevel.forEach((section, index) => {
      const nextStart = topLevel[index + 1]?.startOrder ?? Number.POSITIVE_INFINITY;
      result.push({
        id: section.id,
        blocks: blocks.filter(block => block.orderIndex >= section.startOrder && block.orderIndex < nextStart),
      });
    });
    return result.filter(section => section.blocks.length > 0);
  }

  const headingIndexes = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.type === 'heading' && (block.headingLevel ?? 1) === 1);
  if (headingIndexes.length === 0) {
    return [{ id: `sec_${document.id}_root`, blocks }];
  }

  const result: SectionSlice[] = [];
  if (headingIndexes[0].index > 0) {
    result.push({ id: `sec_${document.id}_preamble`, blocks: blocks.slice(0, headingIndexes[0].index) });
  }
  headingIndexes.forEach(({ block, index }, headingIndex) => {
    const end = headingIndexes[headingIndex + 1]?.index ?? blocks.length;
    result.push({ id: `sec_${document.id}_${block.orderIndex}`, blocks: blocks.slice(index, end) });
  });
  return result;
}

function splitOversizedSection(
  section: SectionSlice,
  maxTokens: number,
  maxAtomTokens: number,
): SectionSlice[] {
  const parts: SectionSlice[] = [];
  let current: SectionBatchBlock[] = [];
  let currentTokens = 0;
  section.blocks.flatMap(block => atomizeOversizedBlock(block, maxAtomTokens)).forEach(block => {
    const blockTokens = estimateTokens(block.content);
    if (current.length > 0 && currentTokens + blockTokens > maxTokens) {
      parts.push({ id: section.id, blocks: current });
      current = [];
      currentTokens = 0;
    }
    current.push(block);
    currentTokens += blockTokens;
  });
  if (current.length > 0) parts.push({ id: section.id, blocks: current });
  return parts;
}

function toBatch(document: SourceDocument, parts: SectionSlice[], batchIndex: number): SectionBatch {
  const blocks = parts.flatMap(part => part.blocks) as SectionBatchBlock[];
  const sectionIds = [...new Set(parts.map(part => part.id))];
  const cacheMaterial = [
    SECTION_COMPILER_PROMPT_VERSION,
    document.contentHash,
    sectionIds.join(','),
    ...blocks.map(block => `${block.atomId}:${block.contentHash}`),
  ].join('|');
  return {
    id: `batch_${document.id}_${batchIndex}`,
    documentId: document.id,
    documentTitle: document.title,
    sectionIds,
    blocks,
    estimatedTokens: tokensForBlocks(blocks),
    cacheKey: `batch_${shortHash(cacheMaterial)}`,
  };
}

export function buildSectionBatches(
  documents: SourceDocument[],
  maxTokens = 6000,
  maxAtomTokens = maxTokens,
): SectionBatch[] {
  const safeLimit = Math.max(1, maxTokens);
  const safeAtomLimit = Math.max(1, Math.min(safeLimit, maxAtomTokens));
  const batches: SectionBatch[] = [];
  documents.forEach(document => {
    const parts = deriveSections(document)
      .flatMap(section => splitOversizedSection(section, safeLimit, safeAtomLimit));
    let pending: SectionSlice[] = [];
    let pendingTokens = 0;
    let documentBatchIndex = 0;

    const flush = () => {
      if (pending.length === 0) return;
      batches.push(toBatch(document, pending, documentBatchIndex));
      documentBatchIndex += 1;
      pending = [];
      pendingTokens = 0;
    };

    parts.forEach(part => {
      const partTokens = tokensForBlocks(part.blocks);
      if (pending.length > 0 && pendingTokens + partTokens > safeLimit) flush();
      pending.push(part);
      pendingTokens += partTokens;
    });
    flush();
  });
  return batches;
}
