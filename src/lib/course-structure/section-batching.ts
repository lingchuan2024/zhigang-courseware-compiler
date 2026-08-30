import type { MarkdownBlock, SourceDocument } from '../../types';
import { estimateTokens } from '../content-window';

export const SECTION_COMPILER_PROMPT_VERSION = 'course-section-v1';

export interface SectionBatch {
  id: string;
  documentId: string;
  documentTitle: string;
  sectionIds: string[];
  blocks: MarkdownBlock[];
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

function splitOversizedSection(section: SectionSlice, maxTokens: number): SectionSlice[] {
  const parts: SectionSlice[] = [];
  let current: MarkdownBlock[] = [];
  let currentTokens = 0;
  section.blocks.forEach(block => {
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
  const blocks = parts.flatMap(part => part.blocks);
  const sectionIds = [...new Set(parts.map(part => part.id))];
  const cacheMaterial = [
    SECTION_COMPILER_PROMPT_VERSION,
    document.contentHash,
    sectionIds.join(','),
    ...blocks.map(block => `${block.id}:${block.contentHash}`),
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
): SectionBatch[] {
  const safeLimit = Math.max(1, maxTokens);
  const batches: SectionBatch[] = [];
  documents.forEach(document => {
    const parts = deriveSections(document)
      .flatMap(section => splitOversizedSection(section, safeLimit));
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
