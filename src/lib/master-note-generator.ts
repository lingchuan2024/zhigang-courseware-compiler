import type {
  ChapterNote,
  ChapterPlanItem,
  CourseMasterNote,
  FormulaCard,
  GlossaryItem,
  KnowledgeCard,
  KnowledgeComparison,
  KnowledgeTopic,
  ModelConfig,
  ParallelKnowledgeGroup,
  FormulaChain,
  TopicRelation,
  TopicSynthesis,
} from '../types';
import { callChatCompletion } from './model-v2';
import { normalizeGeneratedMarkdown } from './markdown-normalization';
import { validateGeneratedMarkdown } from './markdown-validation';
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
}

export interface MasterNoteGenerationCallbacks {
  onTopicSynthesis?: (synthesis: TopicSynthesis, current: number, total: number) => void;
  onPlan?: (plan: ChapterPlanItem[]) => void;
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

const SYNTHESIS_SYSTEM = [
  '你负责把同一个一级知识下的知识卡片综合成自然讲解。',
  '识别并列知识、比较维度和公式链；不得引入卡片之外的事实。',
  '返回 JSON：framework、parallelGroups、comparisons、formulaChains、markdown。',
].join('\n');

const CHAPTER_PLAN_SYSTEM = [
  '你负责根据课程知识网和一级知识综合规划章节。',
  '先形成具体框架；每个知识主题必须且只能被分配一次。',
  '返回 JSON：{ chapters: [{ id, title, objective, topicIds, framework }] }。',
].join('\n');

const CHAPTER_NOTE_SYSTEM = [
  '你负责生成一章完整、连贯、适合学习的课程笔记。',
  '知识较多时先给出框架；并列知识先总结共同点，再分别讲解并比较差异。',
  '复杂概念先直觉后形式化；公式说明前提、符号、推导、含义与条件。',
  '不得改变知识事实，不得伪造原文；返回 JSON：{ markdown, glossary, formulas }。',
].join('\n');

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeMarkdown(markdown: string): string {
  const normalized = normalizeGeneratedMarkdown(markdown);
  return validateGeneratedMarkdown(normalized.content, []).fixedContent.trim();
}

function parseParallelGroups(value: unknown): ParallelKnowledgeGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const data = record(item);
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const cardIds = strings(data.cardIds);
    return title && cardIds.length > 0 ? [{ title, summary, cardIds }] : [];
  });
}

function parseComparisons(value: unknown): KnowledgeComparison[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const data = record(item);
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const dimensions = strings(data.dimensions);
    const rows = Array.isArray(data.rows)
      ? data.rows.filter((row): row is string[] => Array.isArray(row) && row.every(cell => typeof cell === 'string'))
      : [];
    return title ? [{ title, dimensions, rows }] : [];
  });
}

function parseFormulaChains(value: unknown): FormulaChain[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const data = record(item);
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : '';
    const cardIds = strings(data.cardIds);
    return title ? [{ title, explanation, cardIds }] : [];
  });
}

function fallbackSynthesis(topic: KnowledgeTopic, cards: KnowledgeCard[], error?: string): TopicSynthesis {
  const markdown = [
    `## ${topic.name}`,
    topic.summary,
    ...cards.flatMap(card => [`### ${card.title}`, card.detailedNote || card.conciseSummary]),
  ].filter(Boolean).join('\n\n');
  return {
    id: `synthesis-${topic.id}`,
    topicId: topic.id,
    framework: cards.map(card => card.title),
    orderedCardIds: cards.map(card => card.id),
    parallelGroups: [],
    comparisons: [],
    formulaChains: [],
    markdown,
    cardVersions: Object.fromEntries(cards.map(card => [card.id, card.cardVersion ?? 1])),
    status: error ? 'partial' : 'completed',
    error,
  };
}

function parseSynthesis(topic: KnowledgeTopic, cards: KnowledgeCard[], response: unknown): TopicSynthesis {
  const data = record(response);
  const markdown = typeof data.markdown === 'string' ? normalizeMarkdown(data.markdown) : '';
  if (!markdown) return fallbackSynthesis(topic, cards, '一级知识综合为空，已使用知识卡片降级内容');
  return {
    id: `synthesis-${topic.id}`,
    topicId: topic.id,
    framework: strings(data.framework),
    orderedCardIds: cards.map(card => card.id),
    parallelGroups: parseParallelGroups(data.parallelGroups),
    comparisons: parseComparisons(data.comparisons),
    formulaChains: parseFormulaChains(data.formulaChains),
    markdown,
    cardVersions: Object.fromEntries(cards.map(card => [card.id, card.cardVersion ?? 1])),
    status: 'completed',
  };
}

function validChapterPlan(
  value: unknown,
  topics: KnowledgeTopic[],
): ChapterPlanItem[] | null {
  const data = record(value);
  if (!Array.isArray(data.chapters)) return null;
  const validTopicIds = new Set(topics.map(topic => topic.id));
  const assigned = new Set<string>();
  const chapters: ChapterPlanItem[] = [];

  for (let index = 0; index < data.chapters.length; index++) {
    const item = record(data.chapters[index]);
    const topicIds = strings(item.topicIds).filter(id => validTopicIds.has(id) && !assigned.has(id));
    if (topicIds.length === 0) continue;
    topicIds.forEach(id => assigned.add(id));
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `第 ${index + 1} 章`;
    chapters.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `chapter-${index + 1}`,
      title,
      objective: typeof item.objective === 'string' ? item.objective.trim() : '',
      topicIds,
      framework: strings(item.framework),
    });
  }
  return assigned.size === topics.length && chapters.length > 0 ? chapters : null;
}

function buildModelCompleter(config: ModelConfig): MasterNoteCompleter {
  return async request => {
    const compiled = {
      system: request.system,
      stablePrefix: request.system,
      dynamicInput: request.user,
      promptVersion: `master-note-${request.kind}-v1`,
      messages: [
        { role: 'system' as const, content: request.system },
        { role: 'user' as const, content: request.user },
      ],
    };
    const { data } = await callChatCompletion<unknown>(
      config,
      compiled,
      'note-generation',
      120000,
      request.subjectId,
    );
    return data;
  };
}

export async function regenerateChapterNote(
  config: ModelConfig,
  input: RegenerateChapterNoteInput,
  injectedCompleter?: MasterNoteCompleter,
): Promise<ChapterNote> {
  const complete = injectedCompleter ?? buildModelCompleter(config);
  const sourceCardIds = input.knowledgeCards
    .filter(card => input.plan.topicIds.includes(card.topicId))
    .map(card => card.id);
  const request: MasterNoteGenerationRequest = {
    kind: 'chapter-note',
    subjectId: input.plan.id,
    system: CHAPTER_NOTE_SYSTEM,
    user: [
      `章节：${input.plan.title}`,
      `章节目标：${input.plan.objective}`,
      `章节框架：${JSON.stringify(input.plan.framework)}`,
      `本章一级知识综合：${JSON.stringify(input.syntheses.map(synthesis => ({
        topicId: synthesis.topicId,
        framework: synthesis.framework,
        parallelGroups: synthesis.parallelGroups,
        comparisons: synthesis.comparisons,
        formulaChains: synthesis.formulaChains,
        markdown: synthesis.markdown,
      })))}`,
      `上一章摘要：${input.previousChapterSummary || '无'}`,
      `全局术语表：${JSON.stringify(input.terminology)}`,
      `全局符号表：${JSON.stringify(input.symbols)}`,
    ].join('\n\n'),
  };
  try {
    const response = record(await complete(request));
    const markdown = typeof response.markdown === 'string' ? normalizeMarkdown(response.markdown) : '';
    if (!markdown) throw new Error('模型返回的章节 Markdown 为空');
    return {
      ...input.plan,
      markdown,
      sourceCardIds,
      status: 'completed',
      retryCount: input.previousRetryCount + 1,
    };
  } catch (error) {
    return {
      ...input.plan,
      markdown: '',
      sourceCardIds: [],
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      retryCount: input.previousRetryCount + 1,
    };
  }
}

export async function runMasterNoteGeneration(
  config: ModelConfig,
  input: MasterNoteGenerationInput,
  callbacks: MasterNoteGenerationCallbacks = {},
  injectedCompleter?: MasterNoteCompleter,
): Promise<MasterNoteGenerationResult> {
  const complete = injectedCompleter ?? buildModelCompleter(config);
  const topicById = new Map(input.topics.map(topic => [topic.id, topic]));
  const seen = new Set<string>();
  const orderedTopics = [...input.orderedTopicIds, ...input.topics.map(topic => topic.id)]
    .filter(id => {
      if (!topicById.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(id => topicById.get(id)!);
  const topicSyntheses: TopicSynthesis[] = [];

  for (let index = 0; index < orderedTopics.length; index++) {
    const topic = orderedTopics[index];
    const cards = input.knowledgeCards.filter(card => card.topicId === topic.id);
    const request: MasterNoteGenerationRequest = {
      kind: 'topic-synthesis',
      subjectId: topic.id,
      system: SYNTHESIS_SYSTEM,
      user: [
        `一级知识：${topic.name}`,
        `摘要：${topic.summary}`,
        `学习目标：${topic.learningObjective}`,
        '以下为该一级知识的全部知识卡片：',
        JSON.stringify(cards.map(card => ({
          id: card.id,
          title: card.title,
          type: card.teachingType,
          summary: card.conciseSummary,
          detail: card.detailedNote,
          formulae: card.formulas?.map(formula => formula.formula) ?? [],
        }))),
      ].join('\n\n'),
    };
    let synthesis: TopicSynthesis;
    try {
      synthesis = parseSynthesis(topic, cards, await complete(request));
    } catch (error) {
      synthesis = fallbackSynthesis(topic, cards, error instanceof Error ? error.message : String(error));
    }
    topicSyntheses.push(synthesis);
    callbacks.onTopicSynthesis?.(synthesis, index + 1, orderedTopics.length);
  }

  const planRequest: MasterNoteGenerationRequest = {
    kind: 'chapter-plan',
    subjectId: input.courseId,
    system: CHAPTER_PLAN_SYSTEM,
    user: [
      `课程：${input.title}`,
      `稳定遍历顺序：${input.orderedTopicIds.join(' → ')}`,
      `知识关系：${JSON.stringify(input.topicRelations.map(relation => ({
        source: relation.sourceTopicId,
        target: relation.targetTopicId,
        type: relation.type,
        reason: relation.reason,
      })))}`,
      `一级知识综合：${JSON.stringify(topicSyntheses.map(synthesis => ({
        topicId: synthesis.topicId,
        framework: synthesis.framework,
        summary: synthesis.markdown.slice(0, 1200),
      })))}`,
    ].join('\n\n'),
  };
  let chapterPlan: ChapterPlanItem[];
  try {
    chapterPlan = validChapterPlan(await complete(planRequest), orderedTopics)
      ?? planFallbackChapters(orderedTopics, input.orderedTopicIds);
  } catch {
    chapterPlan = planFallbackChapters(orderedTopics, input.orderedTopicIds);
  }
  callbacks.onPlan?.(chapterPlan);

  const synthesisByTopic = new Map(topicSyntheses.map(synthesis => [synthesis.topicId, synthesis]));
  const chapterNotes: ChapterNote[] = [];
  let previousChapterSummary = '';

  for (let index = 0; index < chapterPlan.length; index++) {
    const plan = chapterPlan[index];
    const syntheses = plan.topicIds
      .map(topicId => synthesisByTopic.get(topicId))
      .filter((value): value is TopicSynthesis => Boolean(value));
    const sourceCardIds = input.knowledgeCards
      .filter(card => plan.topicIds.includes(card.topicId))
      .map(card => card.id);
    const request: MasterNoteGenerationRequest = {
      kind: 'chapter-note',
      subjectId: plan.id,
      system: CHAPTER_NOTE_SYSTEM,
      user: [
        `章节：${plan.title}`,
        `章节目标：${plan.objective}`,
        `章节框架：${JSON.stringify(plan.framework)}`,
        `本章一级知识综合：${JSON.stringify(syntheses.map(synthesis => ({
          topicId: synthesis.topicId,
          framework: synthesis.framework,
          parallelGroups: synthesis.parallelGroups,
          comparisons: synthesis.comparisons,
          formulaChains: synthesis.formulaChains,
          markdown: synthesis.markdown,
        })))}`,
        `上一章摘要：${previousChapterSummary || '无'}`,
        `全局术语表：${JSON.stringify(input.terminology)}`,
        `全局符号表：${JSON.stringify(input.symbols)}`,
      ].join('\n\n'),
    };
    let chapter: ChapterNote;
    try {
      const response = record(await complete(request));
      const markdown = typeof response.markdown === 'string' ? normalizeMarkdown(response.markdown) : '';
      if (!markdown) throw new Error('模型返回的章节 Markdown 为空');
      chapter = {
        ...plan,
        markdown,
        sourceCardIds,
        status: 'completed',
        retryCount: 0,
      };
      previousChapterSummary = markdown.slice(0, 800);
    } catch (error) {
      chapter = {
        ...plan,
        markdown: '',
        sourceCardIds: [],
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryCount: 0,
      };
    }
    chapterNotes.push(chapter);
    callbacks.onChapter?.(chapter, index + 1, chapterPlan.length);
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
