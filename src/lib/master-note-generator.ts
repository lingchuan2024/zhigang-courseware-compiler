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

const CHAPTER_NOTE_SYSTEM = [
  '你只负责为已经确定内容的课程章节生成简短导语和知识主题之间的过渡语，不负责生成整章正文。',
  '章节和一级知识顺序已经固定，不得重新规划、遗漏或重复一级知识。',
  'overview 不超过 300 个中文字符，只说明本章目标、主线和各主题关系。',
  'transitions 是以 topicId 为键的对象，每条不超过 100 个中文字符；只写承上启下的话，不复述知识正文。',
  '不得补充新的知识事实，不得输出 Markdown 正文；只返回 JSON：{ overview, transitions }。',
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

function chapterEnhancementMaterials(
  plan: ChapterPlanItem,
  syntheses: TopicSynthesis[],
  knowledgeCards: KnowledgeCard[],
): Array<Record<string, unknown>> {
  const synthesisByTopic = new Map(syntheses.map(item => [item.topicId, item]));
  const cardsById = new Map(knowledgeCards.map(item => [item.id, item]));

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
        summary: card.conciseSummary.slice(0, 300),
      })),
    };
  });
}

interface ChapterEnhancement {
  overview: string;
  transitions: Record<string, string>;
}

function parseChapterEnhancement(value: unknown, topicIds: string[]): ChapterEnhancement | null {
  const data = record(value);
  const overview = typeof data.overview === 'string' ? data.overview.trim() : '';
  const transitions = Array.isArray(data.transitions)
    ? Object.fromEntries(data.transitions.flatMap((transition, index) =>
        typeof transition === 'string' && transition.trim() && topicIds[index]
          ? [[topicIds[index], transition.trim()]]
          : [],
      ))
    : Object.fromEntries(
        Object.entries(record(data.transitions))
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
          .map(([topicId, transition]) => [topicId, transition.trim()]),
      );
  return overview || Object.keys(transitions).length > 0 ? { overview, transitions } : null;
}

function listSection(title: string, values: string[] | undefined): string[] {
  const items = values?.map(value => value.trim()).filter(Boolean) ?? [];
  return items.length > 0 ? [`**${title}**`, ...items.map(value => `- ${value}`)] : [];
}

function formulaSections(card: KnowledgeCard): string[] {
  return (card.formulas ?? []).flatMap(formula => [
    formula.description ? `**公式：${formula.description}**` : '**公式**',
    formula.formula,
  ]).filter(Boolean);
}

function localChapterMarkdown(
  plan: ChapterPlanItem,
  syntheses: TopicSynthesis[],
  knowledgeCards: KnowledgeCard[],
  enhancement?: ChapterEnhancement | null,
): string {
  const synthesisByTopic = new Map(syntheses.map(item => [item.topicId, item]));
  const cardsById = new Map(knowledgeCards.map(item => [item.id, item]));
  const body = plan.topicIds.flatMap((topicId, topicIndex) => {
    const synthesis = synthesisByTopic.get(topicId);
    const cards = (synthesis?.orderedCardIds ?? [])
      .map(cardId => cardsById.get(cardId))
      .filter((card): card is KnowledgeCard => Boolean(card));
    const topicName = cards[0]?.topicName ?? plan.framework[topicIndex] ?? topicId;
    const transition = enhancement?.transitions[topicId];
    return [
      transition ? `> ${transition}` : '',
      `### ${topicName}`,
      synthesis?.framework.length
        ? `**本节路径：** ${synthesis.framework.join(' → ')}`
        : '',
      ...cards.flatMap(card => [
        `#### ${card.title}`,
        card.detailedNote || card.conciseSummary,
        ...listSection('要点', card.keyPoints),
        ...listSection('适用条件', card.applicableConditions),
        ...formulaSections(card),
        ...listSection('例子', card.examples),
        ...listSection('常见误区', card.misconceptions),
      ]),
    ];
  });
  return normalizeMarkdown([
    `## ${plan.title}`,
    enhancement?.overview || plan.objective,
    plan.framework.length > 0 ? `### 本章框架\n\n${plan.framework.map(item => `- ${item}`).join('\n')}` : '',
    ...body,
  ].filter(Boolean).join('\n\n'));
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
      `本章主题摘要：${JSON.stringify(chapterEnhancementMaterials(plan, syntheses, knowledgeCards))}`,
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
    promptVersion: `master-note-${request.kind}-v3`,
    maxOutputTokens: 1536,
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
      30_000,
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
  syntheses: TopicSynthesis[],
  knowledgeCards: KnowledgeCard[],
  sourceCardIds: string[],
  retryCount: number,
): Promise<ChapterNote> {
  let enhancement: ChapterEnhancement | null = null;
  let enhancementError: string | undefined;
  try {
    enhancement = parseChapterEnhancement(await complete(request), plan.topicIds);
    if (!enhancement) enhancementError = 'AI 章节衔接为空，已使用本地完整正文';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    enhancementError = `AI 章节衔接失败，已使用本地完整正文：${message}`;
  }
  return {
    ...plan,
    markdown: localChapterMarkdown(plan, syntheses, knowledgeCards, enhancement),
    sourceCardIds,
    status: 'completed',
    error: enhancementError,
    retryCount,
  };
}

export async function regenerateChapterNote(
  config: ModelConfig,
  input: RegenerateChapterNoteInput,
  injectedCompleter?: MasterNoteCompleter,
): Promise<ChapterNote> {
  const sourceCardIds = input.plan.topicIds.flatMap(topicId =>
    input.syntheses.find(synthesis => synthesis.topicId === topicId)?.orderedCardIds ?? [],
  );
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
    input.syntheses,
    input.knowledgeCards,
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
        syntheses,
        input.knowledgeCards,
        sourceCardIds,
        previousRetryCount,
      );
    }));

    batch.forEach((chapter, batchIndex) => {
      chapterNotes[batchIndices[batchIndex]] = chapter;
      completedCount += 1;
      callbacks.onChapter?.(chapter, completedCount, chapterPlan.length);
    });

    if (batch.every(chapter => Boolean(chapter.error)) && offset + MAX_CONCURRENT_CHAPTERS < pendingIndices.length) {
      const lastError = batch[batch.length - 1]?.error ?? 'AI 章节衔接连续失败';
      const unscheduled = pendingIndices.slice(offset + MAX_CONCURRENT_CHAPTERS);
      unscheduled.forEach(index => {
        const plan = chapterPlan[index];
        const syntheses = plan.topicIds
          .map(topicId => synthesisByTopic.get(topicId))
          .filter((value): value is TopicSynthesis => Boolean(value));
        const sourceCardIds = syntheses.flatMap(synthesis => synthesis.orderedCardIds);
        const chapter: ChapterNote = {
          ...plan,
          markdown: localChapterMarkdown(plan, syntheses, input.knowledgeCards),
          sourceCardIds,
          status: 'completed',
          error: `前一批 AI 章节衔接全部失败，已停止后续 AI 增强并使用本地完整正文。最后错误：${lastError}`,
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
