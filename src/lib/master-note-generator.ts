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
): string {
  const synthesisByTopic = new Map(syntheses.map(item => [item.topicId, item]));
  const cardsById = new Map(knowledgeCards.map(item => [item.id, item]));
  const body = plan.topicIds.flatMap((topicId, topicIndex) => {
    const synthesis = synthesisByTopic.get(topicId);
    const cards = (synthesis?.orderedCardIds ?? [])
      .map(cardId => cardsById.get(cardId))
      .filter((card): card is KnowledgeCard => Boolean(card));
    const topicName = cards[0]?.topicName ?? plan.framework[topicIndex] ?? topicId;
    return [
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
    plan.objective,
    plan.framework.length > 0 ? `### 本章框架\n\n${plan.framework.map(item => `- ${item}`).join('\n')}` : '',
    ...body,
  ].filter(Boolean).join('\n\n'));
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

export async function regenerateChapterNote(
  _config: ModelConfig | null,
  input: RegenerateChapterNoteInput,
  _injectedCompleter?: MasterNoteCompleter,
): Promise<ChapterNote> {
  const sourceCardIds = input.plan.topicIds.flatMap(topicId =>
    input.syntheses.find(synthesis => synthesis.topicId === topicId)?.orderedCardIds ?? [],
  );
  return {
    ...input.plan,
    markdown: localChapterMarkdown(input.plan, input.syntheses, input.knowledgeCards),
    sourceCardIds,
    status: 'completed',
    retryCount: input.previousRetryCount + 1,
  };
}

export async function runMasterNoteGeneration(
  _config: ModelConfig | null,
  input: MasterNoteGenerationInput,
  callbacks: MasterNoteGenerationCallbacks = {},
  _injectedCompleter?: MasterNoteCompleter,
): Promise<MasterNoteGenerationResult> {
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
  const chapterNotes: ChapterNote[] = [];
  chapterPlan.forEach((plan, index) => {
    const sourceCardIds = plan.topicIds.flatMap(topicId => synthesisByTopic.get(topicId)?.orderedCardIds ?? []);
    const checkpoint = reusableChapter(plan, sourceCardIds, input.resumeChapterNotes);
    if (checkpoint) {
      chapterNotes.push(checkpoint);
      callbacks.onChapter?.(checkpoint, index + 1, chapterPlan.length);
      return;
    }
    callbacks.onChapterStart?.(plan, index + 1, chapterPlan.length);
    const syntheses = plan.topicIds
      .map(topicId => synthesisByTopic.get(topicId))
      .filter((value): value is TopicSynthesis => Boolean(value));
    const chapter: ChapterNote = {
      ...plan,
      markdown: localChapterMarkdown(plan, syntheses, input.knowledgeCards),
      sourceCardIds,
      status: 'completed',
      retryCount: input.resumeChapterNotes?.find(item => item.id === plan.id)?.retryCount ?? 0,
    };
    chapterNotes.push(chapter);
    callbacks.onChapter?.(chapter, index + 1, chapterPlan.length);
  });

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
