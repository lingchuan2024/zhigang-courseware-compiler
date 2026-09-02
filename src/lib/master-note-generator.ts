import type {
  ChapterNote,
  ChapterPlanItem,
  CourseMasterNote,
  FormulaCard,
  GlossaryItem,
  KnowledgeCard,
  KnowledgeTopic,
  ModelConfig,
  TeachingRelation,
  TopicNarrativePath,
  TopicRelation,
  TopicSynthesis,
} from '../types';
import { callChatCompletion } from './model-v2';
import { normalizeGeneratedMarkdown } from './markdown-normalization';
import { validateGeneratedMarkdown } from './markdown-validation';
import type { CompiledPrompt } from './prompt-builder';
import { assembleCourseMasterNote, planFallbackChapters } from './course-master-note';

export type MasterNoteGenerationKind = 'topic-synthesis' | 'chapter-plan' | 'chapter-note';

export interface MasterNoteGenerationRequest {
  kind: MasterNoteGenerationKind;
  subjectId: string;
  system: string;
  user: string;
}

export type MasterNoteCompleter = (request: MasterNoteGenerationRequest) => Promise<unknown>;

export interface MasterNoteGenerationInput {
  courseId: string;
  title: string;
  topics: KnowledgeTopic[];
  topicRelations: TopicRelation[];
  orderedTopicIds: string[];
  knowledgeCards: KnowledgeCard[];
  glossary: GlossaryItem[];
  formulaIndex: FormulaCard[];
  terminology: Record<string, unknown>;
  symbols: Record<string, unknown>;
  structureVersion: number;
  narrativePaths?: Record<string, TopicNarrativePath>;
  teachingRelations?: TeachingRelation[];
  /** 已落盘的章节检查点。只有结构与卡片集合仍匹配的完成章节才会被复用。 */
  resumeChapterNotes?: ChapterNote[];
}

export interface MasterNoteGenerationCallbacks {
  onTopicSynthesis?: (synthesis: TopicSynthesis, current: number, total: number) => void;
  onPlan?: (plan: ChapterPlanItem[]) => void;
  onChapterStart?: (plan: ChapterPlanItem, current: number, total: number) => void;
  onChapter?: (chapter: ChapterNote, current: number, total: number) => void;
}

export interface MasterNoteGenerationResult {
  topicSyntheses: TopicSynthesis[];
  chapterPlan: ChapterPlanItem[];
  chapterNotes: ChapterNote[];
  masterNote: CourseMasterNote;
}

export interface RegenerateChapterNoteInput {
  plan: ChapterPlanItem;
  syntheses: TopicSynthesis[];
  knowledgeCards: KnowledgeCard[];
  previousChapterSummary: string;
  terminology: Record<string, unknown>;
  symbols: Record<string, unknown>;
  previousRetryCount: number;
}

const MAX_CONCURRENT_CHAPTERS = 2;
const CHAPTER_CARD_DETAIL_BUDGET = 30_000;

const CHAPTER_NOTE_SYSTEM = [
  '你负责根据已确定的两层课程知识结构，生成一章完整、连贯、适合学习的课程笔记。',
  '章节和一级知识顺序已经固定，不得重新规划、遗漏或重复一级知识。',
  '每个一级知识内部必须遵循给定的二级卡片顺序；不能把卡片标题机械拼接。',
  '并列知识先总结共同目标和分类依据，再分别讲解、比较差异并给出选择条件。',
  '复杂概念先直觉后形式化；公式写出假设、符号、起点、连续步骤、结论和适用条件。',
  '允许补充通用教材解释、典型例子或课件省略的基础推导，但必须使用引用块：',
  '> AI 教学补充：以下内容用于补足课件省略的解释或推导，不属于课件原文。',
  '不得改变知识事实，不得伪造原文；只返回 JSON：{ markdown }。',
].join('\n');

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeMarkdown(markdown: string): string {
  const normalized = normalizeGeneratedMarkdown(markdown);
  return validateGeneratedMarkdown(normalized.content, []).fixedContent.trim();
}

function orderedTopics(input: MasterNoteGenerationInput): KnowledgeTopic[] {
  const topicById = new Map(input.topics.map(topic => [topic.id, topic]));
  const seen = new Set<string>();
  return [...input.orderedTopicIds, ...input.topics.map(topic => topic.id)]
    .filter(id => {
      if (!topicById.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(id => topicById.get(id)!);
}

function orderedCardsForTopic(input: MasterNoteGenerationInput, topicId: string): KnowledgeCard[] {
  const rawCards = input.knowledgeCards.filter(card => card.topicId === topicId);
  const pathOrder = new Map(
    (input.narrativePaths?.[topicId]?.orderedTeachingBlockIds ?? []).map((id, order) => [id, order]),
  );
  const originalOrder = new Map(rawCards.map((card, order) => [card.id, order]));
  return [...rawCards].sort((a, b) => {
    const pathA = pathOrder.get(a.teachingBlockId);
    const pathB = pathOrder.get(b.teachingBlockId);
    if (pathA !== undefined || pathB !== undefined) {
      return (pathA ?? Number.MAX_SAFE_INTEGER) - (pathB ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.narrativeIndex !== undefined || b.narrativeIndex !== undefined) {
      return (a.narrativeIndex ?? Number.MAX_SAFE_INTEGER) - (b.narrativeIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });
}

function deterministicSynthesis(topic: KnowledgeTopic, cards: KnowledgeCard[]): TopicSynthesis {
  const sections = cards.map((card, index) => ({
    id: `section-${topic.id}-${index + 1}`,
    title: card.title,
    cardIds: [card.id],
    relationReason: index === 0 ? '二级知识网的起点' : '按二级知识网叙事顺序继续',
    markdown: card.detailedNote || card.conciseSummary,
  }));
  const markdown = [
    `## ${topic.name}`,
    topic.summary,
    ...sections.flatMap(section => [`### ${section.title}`, section.markdown]),
  ].filter(Boolean).join('\n\n');
  return {
    id: `synthesis-${topic.id}`,
    topicId: topic.id,
    framework: cards.map(card => card.title),
    orderedCardIds: cards.map(card => card.id),
    sections,
    parallelGroups: [],
    comparisons: [],
    formulaChains: [],
    markdown,
    cardVersions: Object.fromEntries(cards.map(card => [card.id, card.cardVersion ?? 1])),
    status: 'completed',
  };
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function chapterMaterials(
  plan: ChapterPlanItem,
  syntheses: TopicSynthesis[],
  knowledgeCards: KnowledgeCard[],
): Array<Record<string, unknown>> {
  const synthesisByTopic = new Map(syntheses.map(item => [item.topicId, item]));
  const cardsById = new Map(knowledgeCards.map(item => [item.id, item]));
  const chapterCardCount = plan.topicIds.reduce(
    (sum, topicId) => sum + (synthesisByTopic.get(topicId)?.orderedCardIds.length ?? 0),
    0,
  );
  const detailLimit = Math.max(600, Math.min(2_400, Math.floor(CHAPTER_CARD_DETAIL_BUDGET / Math.max(1, chapterCardCount))));

  return plan.topicIds.map(topicId => {
    const synthesis = synthesisByTopic.get(topicId);
    const cards = (synthesis?.orderedCardIds ?? [])
      .map(cardId => cardsById.get(cardId))
      .filter((card): card is KnowledgeCard => Boolean(card));
    return {
      topicId,
      topicName: cards[0]?.topicName ?? topicId,
      framework: synthesis?.framework ?? cards.map(card => card.title),
      cards: cards.map(card => ({
        id: card.id,
        title: card.title,
        type: card.teachingType,
        summary: truncate(card.conciseSummary, 500),
        detail: truncate(card.detailedNote, detailLimit),
        keyPoints: card.keyPoints,
        applicableConditions: card.applicableConditions,
        examples: card.examples,
        misconceptions: card.misconceptions,
        formulas: card.formulas?.map(formula => formula.formula) ?? [],
      })),
    };
  });
}

function chapterRequest(
  title: string,
  plan: ChapterPlanItem,
  chapterPlan: ChapterPlanItem[],
  syntheses: TopicSynthesis[],
  knowledgeCards: KnowledgeCard[],
  terminology: Record<string, unknown>,
  symbols: Record<string, unknown>,
): MasterNoteGenerationRequest {
  const chapterIndex = chapterPlan.findIndex(chapter => chapter.id === plan.id);
  const adjacent = chapterPlan
    .slice(Math.max(0, chapterIndex - 1), chapterIndex + 2)
    .map(chapter => ({ id: chapter.id, title: chapter.title, objective: chapter.objective, topicIds: chapter.topicIds }));
  return {
    kind: 'chapter-note',
    subjectId: plan.id,
    system: CHAPTER_NOTE_SYSTEM,
    user: [
      `课程：${title}`,
      `课程固定章节顺序：${JSON.stringify(chapterPlan.map(chapter => ({ id: chapter.id, title: chapter.title, topicIds: chapter.topicIds })))}`,
      `当前章节及相邻章节：${JSON.stringify(adjacent)}`,
      `当前章节：${JSON.stringify({ title: plan.title, objective: plan.objective, framework: plan.framework })}`,
      `本章有序教学材料：${JSON.stringify(chapterMaterials(plan, syntheses, knowledgeCards))}`,
      `全局术语表：${JSON.stringify(terminology)}`,
      `全局符号表：${JSON.stringify(symbols)}`,
    ].join('\n\n'),
  };
}

export function buildMasterNotePrompt(request: MasterNoteGenerationRequest): CompiledPrompt {
  return {
    system: request.system,
    stablePrefix: request.system,
    dynamicInput: request.user,
    promptVersion: `master-note-${request.kind}-v2`,
    maxOutputTokens: 8192,
    reasoningEffort: 'minimal',
    maxStructuredAttempts: 1,
    maxTransportAttempts: 1,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  };
}

function buildModelCompleter(config: ModelConfig): MasterNoteCompleter {
  return async request => {
    const { data } = await callChatCompletion<unknown>(
      config,
      buildMasterNotePrompt(request),
      'note-generation',
      90_000,
      request.subjectId,
    );
    return data;
  };
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function reusableChapter(
  plan: ChapterPlanItem,
  sourceCardIds: string[],
  checkpoints: ChapterNote[] | undefined,
): ChapterNote | null {
  const checkpoint = checkpoints?.find(chapter => chapter.id === plan.id);
  if (!checkpoint || checkpoint.status !== 'completed' || !checkpoint.markdown.trim()) return null;
  if (!sameStrings(checkpoint.topicIds, plan.topicIds)) return null;
  if (!sameStrings(checkpoint.sourceCardIds, sourceCardIds)) return null;
  return { ...checkpoint, ...plan, sourceCardIds };
}

async function generateChapter(
  complete: MasterNoteCompleter,
  request: MasterNoteGenerationRequest,
  plan: ChapterPlanItem,
  sourceCardIds: string[],
  retryCount: number,
): Promise<ChapterNote> {
  try {
    const response = record(await complete(request));
    const markdown = typeof response.markdown === 'string' ? normalizeMarkdown(response.markdown) : '';
    if (!markdown) throw new Error('模型返回的章节 Markdown 为空');
    return { ...plan, markdown, sourceCardIds, status: 'completed', retryCount };
  } catch (error) {
    return {
      ...plan,
      markdown: '',
      sourceCardIds: [],
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      retryCount,
    };
  }
}

export async function regenerateChapterNote(
  config: ModelConfig,
  input: RegenerateChapterNoteInput,
  injectedCompleter?: MasterNoteCompleter,
): Promise<ChapterNote> {
  const sourceCardIds = input.knowledgeCards
    .filter(card => input.plan.topicIds.includes(card.topicId))
    .map(card => card.id);
  const request = chapterRequest(
    '课程完整笔记',
    input.plan,
    [input.plan],
    input.syntheses,
    input.knowledgeCards,
    input.terminology,
    input.symbols,
  );
  return generateChapter(
    injectedCompleter ?? buildModelCompleter(config),
    request,
    input.plan,
    sourceCardIds,
    input.previousRetryCount + 1,
  );
}

export async function runMasterNoteGeneration(
  config: ModelConfig,
  input: MasterNoteGenerationInput,
  callbacks: MasterNoteGenerationCallbacks = {},
  injectedCompleter?: MasterNoteCompleter,
): Promise<MasterNoteGenerationResult> {
  const complete = injectedCompleter ?? buildModelCompleter(config);
  const topics = orderedTopics(input);
  const topicSyntheses = topics.map((topic, index) => {
    const synthesis = deterministicSynthesis(topic, orderedCardsForTopic(input, topic.id));
    callbacks.onTopicSynthesis?.(synthesis, index + 1, topics.length);
    return synthesis;
  });

  // 课程顺序已经由两层知识结构确定。章节只做稳定、可重复的机械分组，
  // 不再让模型重新决定顺序或章节归属。
  const chapterPlan = planFallbackChapters(topics, input.orderedTopicIds);
  callbacks.onPlan?.(chapterPlan);

  const synthesisByTopic = new Map(topicSyntheses.map(synthesis => [synthesis.topicId, synthesis]));
  const chapterNotes: ChapterNote[] = new Array(chapterPlan.length);
  const pendingIndices: number[] = [];
  let completedCount = 0;

  chapterPlan.forEach((plan, index) => {
    const sourceCardIds = plan.topicIds.flatMap(topicId => synthesisByTopic.get(topicId)?.orderedCardIds ?? []);
    const checkpoint = reusableChapter(plan, sourceCardIds, input.resumeChapterNotes);
    if (checkpoint) {
      chapterNotes[index] = checkpoint;
      completedCount += 1;
      callbacks.onChapter?.(checkpoint, completedCount, chapterPlan.length);
    } else {
      pendingIndices.push(index);
    }
  });

  for (let offset = 0; offset < pendingIndices.length; offset += MAX_CONCURRENT_CHAPTERS) {
    const batchIndices = pendingIndices.slice(offset, offset + MAX_CONCURRENT_CHAPTERS);
    batchIndices.forEach(index => callbacks.onChapterStart?.(chapterPlan[index], index + 1, chapterPlan.length));
    const batch = await Promise.all(batchIndices.map(index => {
      const plan = chapterPlan[index];
      const syntheses = plan.topicIds
        .map(topicId => synthesisByTopic.get(topicId))
        .filter((value): value is TopicSynthesis => Boolean(value));
      const sourceCardIds = syntheses.flatMap(synthesis => synthesis.orderedCardIds);
      const previousRetryCount = input.resumeChapterNotes?.find(chapter => chapter.id === plan.id)?.retryCount ?? 0;
      return generateChapter(
        complete,
        chapterRequest(input.title, plan, chapterPlan, syntheses, input.knowledgeCards, input.terminology, input.symbols),
        plan,
        sourceCardIds,
        previousRetryCount,
      );
    }));

    batch.forEach((chapter, batchIndex) => {
      chapterNotes[batchIndices[batchIndex]] = chapter;
      completedCount += 1;
      callbacks.onChapter?.(chapter, completedCount, chapterPlan.length);
    });

    if (batch.every(chapter => chapter.status === 'failed') && offset + MAX_CONCURRENT_CHAPTERS < pendingIndices.length) {
      const lastError = batch[batch.length - 1]?.error ?? '模型服务连续失败';
      const unscheduled = pendingIndices.slice(offset + MAX_CONCURRENT_CHAPTERS);
      unscheduled.forEach(index => {
        const plan = chapterPlan[index];
        const chapter: ChapterNote = {
          ...plan,
          markdown: '',
          sourceCardIds: [],
          status: 'failed',
          error: `前一批章节全部失败，已停止后续生成，避免继续等待。最后错误：${lastError}`,
          retryCount: input.resumeChapterNotes?.find(item => item.id === plan.id)?.retryCount ?? 0,
        };
        chapterNotes[index] = chapter;
        completedCount += 1;
        callbacks.onChapter?.(chapter, completedCount, chapterPlan.length);
      });
      break;
    }
  }

  const masterNote = assembleCourseMasterNote({
    courseId: input.courseId,
    title: input.title,
    outline: chapterPlan,
    chapterNotes,
    knowledgeCards: input.knowledgeCards,
    glossary: input.glossary,
    formulaIndex: input.formulaIndex,
    structureVersion: input.structureVersion,
  });

  return { topicSyntheses, chapterPlan, chapterNotes, masterNote };
}
