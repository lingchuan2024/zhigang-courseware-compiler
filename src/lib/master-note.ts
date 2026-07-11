import {
  KnowledgePackage,
  CourseTopic,
  EvidenceAtom,
  RecommendedLearningPath,
  CourseGenerationMemory,
  AssembledMasterNote,
  MasterNoteChapter,
  OrderMode,
  ViewType,
  UnitContentItem,
  UnitContentType,
  SymbolConflict,
  Citation,
} from '../types';
import { generateId } from './utils';

// ========== Type Definitions for Internal Use ==========

interface TopicNoteEntry {
  topicId: string;
  title: string;
  contentMarkdown: string;
  shortSummary: string;
  warnings: string[];
  pageRange: string;
  chapterId?: string;
  renamedCitations: Citation[];
}

// ========== Helpers ==========

/**
 * Determine the order of topics based on orderMode and learningPath.
 */
function determineTopicOrder(
  topics: CourseTopic[],
  learningPath: RecommendedLearningPath | null,
  orderMode: OrderMode
): string[] {
  if (orderMode === 'ai-recommended' && learningPath && learningPath.topicIds.length > 0) {
    // Use learning path order, then append any topics not in the path
    const ordered = [...learningPath.topicIds];
    for (const t of topics) {
      if (!ordered.includes(t.id)) ordered.push(t.id);
    }
    return ordered;
  }

  // Default: sort by originalOrder
  return [...topics].sort((a, b) => a.originalOrder - b.originalOrder).map(t => t.id);
}

/**
 * Group topic IDs by chapter.
 * Topics with the same chapterId are grouped together.
 * Topics without a chapterId each form their own group.
 */
function groupByChapter(
  orderedTopicIds: string[],
  topicMap: Map<string, CourseTopic>
): { chapterId: string; topicIds: string[] }[] {
  const groups: { chapterId: string; topicIds: string[] }[] = [];
  const groupMap = new Map<string, number>();

  for (const topicId of orderedTopicIds) {
    const topic = topicMap.get(topicId);
    const chapterId = topic?.chapterId || `auto_${topicId}`;

    if (groupMap.has(chapterId)) {
      const idx = groupMap.get(chapterId)!;
      groups[idx].topicIds.push(topicId);
    } else {
      groupMap.set(chapterId, groups.length);
      groups.push({ chapterId, topicIds: [topicId] });
    }
  }

  return groups;
}

/**
 * Generate a deterministic chapter introduction from topic titles.
 */
function generateChapterIntroduction(
  topicIds: string[],
  topicMap: Map<string, CourseTopic>
): string {
  const titles = topicIds
    .map(id => topicMap.get(id)?.title)
    .filter(Boolean) as string[];
  if (titles.length === 0) return '';
  return `本章涵盖以下知识点：${titles.join('、')}。`;
}

/**
 * Generate a deterministic chapter summary from topic summaries.
 */
function generateChapterSummary(
  topicIds: string[],
  summaries: Map<string, string>
): string {
  const validSummaries = topicIds
    .map(id => summaries.get(id))
    .filter(Boolean) as string[];
  if (validSummaries.length === 0) return '本章无摘要信息。';
  return validSummaries.join(' ');
}

/**
 * Generate a lightweight transition between two topics.
 */
function generateTransition(
  fromTopic: CourseTopic | undefined,
  toTopic: CourseTopic | undefined
): string {
  if (!fromTopic || !toTopic) return '';
  return `从"${fromTopic.title}"过渡到"${toTopic.title}"。`;
}

/**
 * Format page range from a list of page numbers.
 */
function formatPageRange(pages: number[]): string {
  if (pages.length === 0) return '未知页码';
  const sorted = [...pages].sort((a, b) => a - b);
  if (sorted.length === 1) return `P${sorted[0]}`;
  return `P${sorted[0]}-P${sorted[sorted.length - 1]}`;
}

/**
 * Rename citation markers globally: t{topicIndex}-cite-{citeIndex}
 */
function renameCitations(
  content: string,
  citations: Citation[],
  topicIndex: number
): { content: string; citations: Citation[] } {
  const prefix = `t${topicIndex + 1}`;
  const renamedCitations: Citation[] = [];
  let newContent = content;

  // Build a mapping from old marker to new marker
  const markerMap = new Map<string, string>();
  let citeIdx = 0;

  for (const cite of citations) {
    citeIdx++;
    const newMarker = `${prefix}-cite-${citeIdx}`;
    markerMap.set(cite.marker, newMarker);
    renamedCitations.push({
      ...cite,
      marker: newMarker,
    });
  }

  // Replace markers in content (longest first to avoid partial matches)
  const sortedMarkers = [...markerMap.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [oldMarker, newMarker] of sortedMarkers) {
    const escaped = oldMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    newContent = newContent.replace(
      new RegExp(`\\[${escaped}\\]`, 'g'),
      `[${newMarker}]`
    );
  }

  return { content: newContent, citations: renamedCitations };
}

/**
 * Collect symbol conflicts from memory.
 */
function collectSymbolConflicts(
  memory: CourseGenerationMemory
): SymbolConflict[] {
  const conflicts: SymbolConflict[] = [];
  for (const [, entry] of Object.entries(memory.symbols)) {
    if (entry.conflicts) {
      conflicts.push(...entry.conflicts);
    }
  }
  return conflicts;
}

/**
 * Collect terminology aliases from memory.
 */
function collectTerminologyAliases(
  memory: CourseGenerationMemory
): Array<{ term: string; aliases: string[] }> {
  const result: Array<{ term: string; aliases: string[] }> = [];
  for (const [, entry] of Object.entries(memory.terminology)) {
    if (entry.aliases.length > 0) {
      result.push({
        term: entry.preferredName,
        aliases: [...entry.aliases],
      });
    }
  }
  return result;
}

// ========== Exam View Structured Projection ==========

/** Content types to include in exam view, in display order. */
const EXAM_VIEW_TYPES: { type: UnitContentType; heading: string }[] = [
  { type: 'definition', heading: '### 核心定义' },
  { type: 'formula', heading: '### 关键公式' },
  { type: 'derivation', heading: '### 推导过程' },
  { type: 'procedure', heading: '### 操作步骤' },
  { type: 'assumption', heading: '### 基本假设' },
  { type: 'condition', heading: '### 适用条件' },
  { type: 'conclusion', heading: '### 重要结论' },
  { type: 'comparison', heading: '### 对比分析' },
];

/**
 * Generate exam view markdown using structured projection based on
 * UnitContentItem.type. NOT line-by-line regex on note content.
 */
function generateExamView(
  kp: KnowledgePackage,
  topicIndex: number
): string {
  const items = kp.internalStructure.items;
  const orderedItemIds = kp.internalStructure.orderedItemIds;

  // Build ordered item list
  const itemMap = new Map(items.map(i => [i.id, i]));
  const orderedItems: UnitContentItem[] = orderedItemIds
    .map(id => itemMap.get(id))
    .filter((i): i is UnitContentItem => i !== undefined);

  const lines: string[] = [];

  for (const { type, heading } of EXAM_VIEW_TYPES) {
    const typeItems = orderedItems.filter(i => i.type === type);
    if (typeItems.length === 0) continue;

    lines.push(heading);
    for (const item of typeItems) {
      // Truncate long content for exam view
      const content = item.content.length > 300
        ? item.content.substring(0, 300) + '...'
        : item.content;
      lines.push(`- ${content}`);
    }
    lines.push('');
  }

  // Add a citations note if there are renamed citations
  const citeCount = items.reduce((sum, i) => sum + i.evidenceIds.length, 0);
  if (citeCount > 0) {
    lines.push(`> 本节引用标记前缀: t${topicIndex + 1}-cite-*`);
  }

  return lines.join('\n');
}

// ========== Main Functions ==========

/**
 * Assemble the master note from packages, topics, and learning path.
 *
 * - Uses RecommendedLearningPath for ordering (not just recommendedOrder field).
 * - Groups by chapterId.
 * - Inserts chapter introductions and lightweight transitions.
 * - Marks repeated reviews.
 * - Summarizes symbol conflicts and terminology aliases.
 * - Global citation marker renaming (t1-cite-1, t2-cite-1, etc.).
 */
export function assembleMasterNote(
  packages: KnowledgePackage[],
  topics: CourseTopic[],
  learningPath: RecommendedLearningPath | null,
  orderMode: OrderMode,
  documentTitle: string,
  memory: CourseGenerationMemory
): AssembledMasterNote {
  const topicMap = new Map(topics.map(t => [t.id, t]));
  const packageMap = new Map(packages.map(p => [p.topic.id, p]));

  // Determine topic order
  const orderedTopicIds = determineTopicOrder(topics, learningPath, orderMode);

  // Group by chapter
  const chapterGroups = groupByChapter(orderedTopicIds, topicMap);

  // Build topic notes with renamed citations
  const topicNotes: TopicNoteEntry[] = [];
  const allCitationsMap = new Map<string, string[]>();
  const summariesMap = new Map<string, string>();

  for (let i = 0; i < orderedTopicIds.length; i++) {
    const topicId = orderedTopicIds[i];
    const topic = topicMap.get(topicId);
    const kp = packageMap.get(topicId);

    if (!topic || !kp) continue;

    // Get note content
    const note = kp.note;
    const contentMarkdown = note?.contentMarkdown || '';
    const shortSummary = note?.shortSummary || '';
    const warnings = note?.warnings || [];
    const citations = note?.citations || [];

    summariesMap.set(topicId, shortSummary);

    // Collect page range
    const pages = topic.originalPageNumbers;

    // Rename citations globally
    const { content: renamedContent, citations: renamedCitations } =
      renameCitations(contentMarkdown, citations, i);

    // Build allCitations map
    for (const cite of renamedCitations) {
      const evIds = allCitationsMap.get(cite.marker) || [];
      allCitationsMap.set(cite.marker, [...evIds, ...cite.evidenceIds]);
    }

    // Find chapter ID
    const chapterId = topic.chapterId;

    topicNotes.push({
      topicId,
      title: topic.title,
      contentMarkdown: renamedContent,
      shortSummary,
      warnings,
      pageRange: formatPageRange(pages),
      chapterId,
      renamedCitations,
    });
  }

  // Build chapters
  const chapters: MasterNoteChapter[] = chapterGroups.map((group, chapterIdx) => {
    const chapterTopics = group.topicIds
      .map(id => topicMap.get(id))
      .filter((t): t is CourseTopic => t !== undefined);

    const chapterTitle = group.chapterId.startsWith('auto_')
      ? `第${chapterIdx + 1}节`
      : `第${chapterIdx + 1}章`;

    const introduction = generateChapterIntroduction(group.topicIds, topicMap);

    // Generate transitions between consecutive topics in the chapter
    const transitions: string[] = [];
    for (let j = 0; j < chapterTopics.length - 1; j++) {
      transitions.push(
        generateTransition(chapterTopics[j], chapterTopics[j + 1])
      );
    }

    const summary = generateChapterSummary(group.topicIds, summariesMap);

    return {
      id: generateId('chapter'),
      title: chapterTitle,
      topicIds: group.topicIds,
      introduction,
      transitions,
      summary,
      warnings: [],
    };
  });

  // Collect symbol conflicts and terminology aliases
  const symbolConflicts = collectSymbolConflicts(memory);
  const terminologyAliases = collectTerminologyAliases(memory);

  return {
    title: documentTitle,
    chapters,
    topicNotes: topicNotes.map(tn => ({
      topicId: tn.topicId,
      title: tn.title,
      contentMarkdown: tn.contentMarkdown,
      shortSummary: tn.shortSummary,
      warnings: tn.warnings,
      pageRange: tn.pageRange,
      chapterId: tn.chapterId,
    })),
    allCitations: allCitationsMap,
    symbolConflicts,
    terminologyAliases,
  };
}

/**
 * Export packages to markdown with view-specific formatting.
 *
 * - Uses RecommendedLearningPath for ordering.
 * - For exam view: uses structured projection based on UnitContentItem.type,
 *   NOT line-by-line regex.
 * - Does NOT rewrite note content or remove citations.
 */
export function exportToMarkdownV2(
  packages: KnowledgePackage[],
  topics: CourseTopic[],
  evidences: EvidenceAtom[],
  viewType: ViewType,
  orderMode: OrderMode,
  documentTitle: string,
  learningPath?: RecommendedLearningPath | null,
  memory?: CourseGenerationMemory
): string {
  const topicMap = new Map(topics.map(t => [t.id, t]));
  const packageMap = new Map(packages.map(p => [p.topic.id, p]));

  // Determine topic order
  const orderedTopicIds = determineTopicOrder(
    topics,
    learningPath || null,
    orderMode
  );

  // Group by chapter
  const chapterGroups = groupByChapter(orderedTopicIds, topicMap);

  const lines: string[] = [];
  lines.push(`# ${documentTitle}`);
  lines.push('');

  // Build a set of seen topics for review marking
  const seenTopics = new Set<string>();

  // Evidences are used for citation resolution context
  const evidenceById = new Map(evidences.map(e => [e.id, e]));
  const totalEvidenceCount = evidenceById.size;

  let chapterIdx = 0;
  for (const group of chapterGroups) {
    const chapterTitle = group.chapterId.startsWith('auto_')
      ? `## 第${chapterIdx + 1}节`
      : `## 第${chapterIdx + 1}章`;
    lines.push(chapterTitle);

    // Chapter introduction
    const intro = generateChapterIntroduction(group.topicIds, topicMap);
    if (intro) {
      lines.push('');
      lines.push(intro);
    }

    // Topic notes
    for (let j = 0; j < group.topicIds.length; j++) {
      const topicId = group.topicIds[j];
      const topic = topicMap.get(topicId);
      const kp = packageMap.get(topicId);

      if (!topic || !kp) continue;

      lines.push('');
      lines.push(`### ${topic.title}`);

      // Mark repeated review
      if (seenTopics.has(topicId)) {
        lines.push('');
        lines.push('> **复习回顾**');
      }
      seenTopics.add(topicId);

      if (viewType === 'exam') {
        // Exam view: structured projection based on UnitContentItem.type
        const examContent = generateExamView(kp, orderedTopicIds.indexOf(topicId));
        if (examContent) {
          lines.push('');
          lines.push(examContent);
        }
      } else {
        // first-study and review: output note content as-is
        const note = kp.note;
        if (note && note.contentMarkdown) {
          lines.push('');
          lines.push(note.contentMarkdown);
        } else {
          // Fallback: output local items content
          lines.push('');
          const items = kp.internalStructure.items;
          for (const item of items) {
            lines.push(`**${item.type}**: ${item.content}`);
            lines.push('');
          }
        }
      }

      // Insert transition (except for last topic in chapter)
      if (j < group.topicIds.length - 1) {
        const nextTopic = topicMap.get(group.topicIds[j + 1]);
        const transition = generateTransition(topic, nextTopic);
        if (transition) {
          lines.push('');
          lines.push(`*${transition}*`);
        }
      }
    }

    // Chapter summary
    const summariesMap = new Map<string, string>();
    for (const tid of group.topicIds) {
      const kp = packageMap.get(tid);
      if (kp?.note?.shortSummary) {
        summariesMap.set(tid, kp.note.shortSummary);
      }
    }
    const summary = generateChapterSummary(group.topicIds, summariesMap);
    if (summary) {
      lines.push('');
      lines.push(`**本章小结**：${summary}`);
    }

    lines.push('');
    chapterIdx++;
  }

  // Summarize symbol conflicts and terminology aliases
  if (memory) {
    const conflicts = collectSymbolConflicts(memory);
    if (conflicts.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## 符号冲突汇总');
      lines.push('');
      for (const c of conflicts) {
        lines.push(`- 主题 ${c.topicId}：含义"${c.meaning}"（证据: ${c.evidenceIds.join(', ')}）`);
      }
      lines.push('');
    }

    const aliases = collectTerminologyAliases(memory);
    if (aliases.length > 0) {
      lines.push('## 术语别名汇总');
      lines.push('');
      for (const a of aliases) {
        lines.push(`- ${a.term}（别名: ${a.aliases.join(', ')}）`);
      }
      lines.push('');
    }
  }

  // Evidences provide context for citation resolution
  if (totalEvidenceCount === 0) {
    lines.push('');
    lines.push('> 注意：未提供证据数据，引用信息可能不完整。');
  }

  return lines.join('\n');
}
