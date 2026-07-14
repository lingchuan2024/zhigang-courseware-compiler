import type {
  ChapterNote,
  ChapterPlanItem,
  CourseMasterNote,
  FormulaCard,
  GlossaryItem,
  KnowledgeCard,
  KnowledgeTopic,
} from '../types';

export interface AssembleCourseMasterNoteInput {
  courseId: string;
  title: string;
  outline: ChapterPlanItem[];
  chapterNotes: ChapterNote[];
  knowledgeCards: KnowledgeCard[];
  glossary: GlossaryItem[];
  formulaIndex: FormulaCard[];
  structureVersion: number;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function dedupeAdjacentMarkdown(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  return paragraphs.filter((paragraph, index) => index === 0 || paragraph !== paragraphs[index - 1]).join('\n\n');
}

export function planFallbackChapters(
  topics: KnowledgeTopic[],
  orderedTopicIds: string[],
  maxTopicsPerChapter = 4,
): ChapterPlanItem[] {
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  const seen = new Set<string>();
  const ordered = [...orderedTopicIds, ...topics.map(topic => topic.id)]
    .filter(id => {
      if (!byId.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(id => byId.get(id)!);
  const size = Math.max(1, maxTopicsPerChapter);
  const chapters: ChapterPlanItem[] = [];

  for (let start = 0; start < ordered.length; start += size) {
    const group = ordered.slice(start, start + size);
    const chapterNumber = chapters.length + 1;
    const title = group.length === 1
      ? group[0].name
      : `${group[0].name}与${group[group.length - 1].name}`;
    chapters.push({
      id: `chapter-${chapterNumber}`,
      title,
      objective: group.map(topic => topic.learningObjective).filter(Boolean).join('；'),
      topicIds: group.map(topic => topic.id),
      framework: group.map(topic => topic.name),
    });
  }

  return chapters;
}

export function assembleCourseMasterNote(input: AssembleCourseMasterNoteInput): CourseMasterNote {
  const noteById = new Map(input.chapterNotes.map(note => [note.id, note]));
  const chapters = input.outline.map(plan => noteById.get(plan.id) ?? {
    ...plan,
    markdown: '',
    sourceCardIds: [],
    status: 'pending' as const,
    retryCount: 0,
  });
  const usableChapters = chapters.filter(
    chapter => chapter.status === 'completed' && chapter.markdown.trim().length > 0,
  );
  const allCompleted = input.outline.length > 0 && usableChapters.length === input.outline.length;
  const hasUsableContent = usableChapters.length > 0;
  const hasFailure = chapters.some(chapter => chapter.status === 'failed');
  const status: CourseMasterNote['status'] = allCompleted
    ? 'completed'
    : hasUsableContent ? 'partial'
      : hasFailure ? 'failed'
        : 'pending';

  const totalCardIds = unique(input.knowledgeCards.map(card => card.id));
  const coveredSet = new Set(usableChapters.flatMap(chapter => chapter.sourceCardIds));
  const coveredCardIds = totalCardIds.filter(id => coveredSet.has(id));
  const missingCardIds = totalCardIds.filter(id => !coveredSet.has(id));
  const framework = input.outline.flatMap((chapter, index) => [
    `${index + 1}. **${chapter.title}**${chapter.objective ? `：${chapter.objective}` : ''}`,
    ...chapter.framework.map(item => `   - ${item}`),
  ]).join('\n');
  const overview = input.outline.length > 0
    ? [
        '## 课程概述',
        `本课程围绕${input.outline.map(chapter => `“${chapter.title}”`).join('、')}展开。`,
        `建议按照下列课程框架依次学习：先明确每章要解决的问题，再沿知识关系理解概念、方法与公式之间的联系。`,
      ].join('\n\n')
    : '';
  const body = chapters
    .map(chapter => chapter.status === 'completed' && chapter.markdown.trim()
      ? dedupeAdjacentMarkdown(chapter.markdown)
      : `## ${chapter.title}\n\n> 本章生成失败：${chapter.error ?? '尚未生成'}\n\n请使用“重新生成本章”补全此处。`)
    .join('\n\n---\n\n');
  const markdown = [
    `# ${input.title}`,
    overview,
    input.outline.length > 0 ? `## 课程框架\n\n${framework}` : '',
    body,
  ].filter(Boolean).join('\n\n');
  const errors = chapters
    .filter(chapter => chapter.status === 'failed' && chapter.error)
    .map(chapter => `${chapter.title}：${chapter.error}`);

  return {
    id: `master-${input.courseId}`,
    title: input.title,
    outline: input.outline,
    chapters,
    glossary: input.glossary,
    formulaIndex: input.formulaIndex,
    markdown,
    coverage: { totalCardIds, coveredCardIds, missingCardIds },
    status,
    generatedFromStructureVersion: input.structureVersion,
    error: errors.length > 0 ? errors.join('；') : undefined,
  };
}

export function isCompletedMasterNote(
  note: CourseMasterNote | null | undefined,
  structureVersion: number,
): boolean {
  return Boolean(
    note &&
    note.status === 'completed' &&
    note.markdown.trim().length > 0 &&
    note.generatedFromStructureVersion === structureVersion,
  );
}
