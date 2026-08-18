import type {
  KnowledgeTopic,
  SourceDocument,
  SourceRange,
} from '../types';

// 重解析增量对齐：旧文档/新文档按"纯内容哈希"匹配（块自身的 contentHash
// 掺入了 documentId 与 orderIndex，重解析后必然变化，不能直接比较）。

function contentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (((hash << 5) - hash) + content.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export interface ReparseAlignment {
  /** 内容未变的旧块 → 新块（含 documentId 变化时的整体重映射） */
  blockRemap: Map<string, string>;
  /** 旧文档 → 新文档（按标题匹配，回退按下标） */
  documentRemap: Map<string, string>;
}

export interface ReparseDiffResult {
  alignment: ReparseAlignment;
  /** 引用内容发生变化的主题（需要重新提取） */
  staleTopicIds: string[];
  /** 引用内容完全一致、仅需重映射引用的主题 */
  intactTopicIds: string[];
  /** 被现有结构引用、但内容已变化的旧块数 */
  changedCitedBlockCount: number;
  /** 新文档中未被旧内容覆盖的全新块数（现有结构未覆盖的新增内容） */
  newUncoveredBlockCount: number;
  /** 供 UI 展示的一句话摘要 */
  summary: string;
}

function pairDocuments(oldDocs: SourceDocument[], newDocs: SourceDocument[]): Array<[SourceDocument, SourceDocument]> {
  const pairs: Array<[SourceDocument, SourceDocument]> = [];
  const remainingNew = [...newDocs];
  for (const oldDoc of oldDocs) {
    const index = remainingNew.findIndex(candidate => candidate.title === oldDoc.title);
    const matched = index >= 0 ? remainingNew.splice(index, 1)[0] : undefined;
    if (matched) pairs.push([oldDoc, matched]);
  }
  return pairs;
}

/** 对比重解析前后的源文档，判断现有知识结构中哪些主题受影响。 */
export function diffReparse(
  oldDocs: SourceDocument[],
  newDocs: SourceDocument[],
  topics: KnowledgeTopic[],
): ReparseDiffResult {
  const blockRemap = new Map<string, string>();
  const documentRemap = new Map<string, string>();

  // 新内容索引：内容哈希 → 新块（同内容多块时取首个，引用按内容寻址）
  const newContentIndex = new Map<string, string>(); // contentHash → newBlockId
  const oldContentHashes = new Set<string>();
  for (const doc of newDocs) {
    for (const block of doc.blocks) {
      const hash = contentHash(block.content);
      if (!newContentIndex.has(hash)) newContentIndex.set(hash, block.id);
    }
  }
  for (const doc of oldDocs) {
    for (const block of doc.blocks) {
      oldContentHashes.add(contentHash(block.content));
    }
  }
  const newUncoveredBlockCount = countNewUncovered(newDocs, oldContentHashes);

  const pairs = pairDocuments(oldDocs, newDocs);
  for (const [oldDoc, newDoc] of pairs) {
    documentRemap.set(oldDoc.id, newDoc.id);
    for (const block of oldDoc.blocks) {
      const matched = newContentIndex.get(contentHash(block.content));
      if (matched) blockRemap.set(block.id, matched);
    }
  }

  const docsById = new Map(oldDocs.map(doc => [doc.id, doc]));
  const staleTopicIds: string[] = [];
  const intactTopicIds: string[] = [];
  let changedCitedBlockCount = 0;

  for (const topic of topics) {
    let intact = topic.sourceRanges.length > 0;
    for (const range of topic.sourceRanges) {
      const doc = docsById.get(range.documentId);
      if (!doc) {
        intact = false;
        continue;
      }
      const ordered = [...doc.blocks].sort((a, b) => a.orderIndex - b.orderIndex);
      const startIndex = ordered.findIndex(block => block.id === range.startBlockId);
      const endIndex = ordered.findIndex(block => block.id === range.endBlockId);
      if (startIndex < 0 || endIndex < 0) {
        intact = false;
        continue;
      }
      for (const block of ordered.slice(startIndex, endIndex + 1)) {
        if (!blockRemap.has(block.id)) {
          intact = false;
          changedCitedBlockCount += 1;
        }
      }
    }
    if (intact) intactTopicIds.push(topic.id);
    else staleTopicIds.push(topic.id);
  }

  return {
    alignment: { blockRemap, documentRemap },
    staleTopicIds,
    intactTopicIds,
    changedCitedBlockCount,
    newUncoveredBlockCount,
    summary: buildSummary(staleTopicIds.length, newUncoveredBlockCount),
  };
}

function countNewUncovered(newDocs: SourceDocument[], oldContentHashes: Set<string>): number {
  let count = 0;
  for (const doc of newDocs) {
    for (const block of doc.blocks) {
      if (!oldContentHashes.has(contentHash(block.content))) count += 1;
    }
  }
  return count;
}

function buildSummary(staleCount: number, uncoveredCount: number): string {
  if (staleCount === 0 && uncoveredCount === 0) return '';
  const parts: string[] = [];
  if (staleCount > 0) parts.push(`${staleCount} 个知识点的原文有变化`);
  if (uncoveredCount > 0) parts.push(`${uncoveredCount} 个新增内容块未被现有结构覆盖`);
  return `课件已重新解析：${parts.join('，')}`;
}

/** 把一段来源引用映射到新文档的块（内容未变时引用语义不变）。 */
export function remapSourceRange(range: SourceRange, alignment: ReparseAlignment): SourceRange {
  const documentId = alignment.documentRemap.get(range.documentId) ?? range.documentId;
  const startBlockId = alignment.blockRemap.get(range.startBlockId) ?? range.startBlockId;
  const endBlockId = alignment.blockRemap.get(range.endBlockId) ?? range.endBlockId;
  return { documentId, startBlockId, endBlockId };
}

export function remapSourceRanges(ranges: SourceRange[], alignment: ReparseAlignment): SourceRange[] {
  return ranges.map(range => remapSourceRange(range, alignment));
}
