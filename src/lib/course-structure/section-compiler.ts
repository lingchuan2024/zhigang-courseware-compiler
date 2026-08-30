import type { ModelConfig } from '../../types';
import { callChatCompletion } from '../model-v2';
import type { CompiledPrompt } from '../prompt-builder';
import type { SectionBatch } from './section-batching';
import { SECTION_COMPILER_PROMPT_VERSION } from './section-batching';
import type {
  EvidenceRole,
  EvidenceSpanDraft,
  LearningGenre,
  OrderClaimDraft,
  SectionCompilation,
  TeachingRole,
  TeachingUnitDraft,
  TopicMentionDraft,
} from './types';

const LEARNING_GENRES = new Set<LearningGenre>([
  'concept', 'derivation', 'algorithm', 'mechanism', 'comparison', 'case',
]);
const TEACHING_ROLES = new Set<TeachingRole>([
  'motivation', 'problem', 'intuition', 'definition', 'formula', 'condition',
  'derivation_step', 'procedure_step', 'property', 'example', 'comparison',
  'misconception', 'application', 'summary',
]);
const EVIDENCE_ROLES = new Set<EvidenceRole>([
  'statement', 'definition', 'formula', 'condition', 'derivation', 'example',
  'comparison', 'application',
]);
const IMPORTANCE = new Set(['core', 'important', 'supplementary']);

type RawRecord = Record<string, unknown>;

interface RawSectionCompilation {
  topicMentions?: unknown;
  teachingUnits?: unknown;
  orderClaims?: unknown;
  unresolvedReferences?: unknown;
  confidence?: unknown;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function parseEvidence(value: unknown, validBlockIds: ReadonlySet<string>): EvidenceSpanDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const blockId = text(item.blockId);
    const quote = text(item.quote);
    const role = text(item.role) as EvidenceRole;
    if (!validBlockIds.has(blockId) || !quote || !EVIDENCE_ROLES.has(role)) return [];
    const startOffset = typeof item.startOffset === 'number' ? Math.floor(item.startOffset) : undefined;
    const endOffset = typeof item.endOffset === 'number' ? Math.floor(item.endOffset) : undefined;
    return [{ blockId, quote, role, startOffset, endOffset }];
  });
}

export function buildSectionCompilerPrompt(batch: SectionBatch): CompiledPrompt {
  const system = [
    '你是课程结构编译器，只能根据输入课件生成两层课程结构。',
    '第一层 topic 必须拥有可独立检验的学习目标；定义、公式和步骤若不是独立学习目标，应放入第二层 teachingUnits。',
    'genre、teaching role 和 evidence role 只能使用给定枚举。',
    '每个 topic 与 teaching unit 都必须引用输入中真实 blockId 和原文短句。',
    '顺序方向固定：beforeTopicLocalId 必须在 afterTopicLocalId 之前学习。',
    'hard 仅用于真实依赖；推断得到的关系必须为 soft。',
    '只返回一个 JSON 对象，不得输出解释性文字。',
  ].join('\n');
  const stablePrefix = JSON.stringify({
    learningGenres: [...LEARNING_GENRES],
    teachingRoles: [...TEACHING_ROLES],
    evidenceRoles: [...EVIDENCE_ROLES],
    schema: {
      topicMentions: 'array',
      teachingUnits: 'array',
      orderClaims: 'array',
      unresolvedReferences: 'array',
      confidence: '0..1',
    },
  });
  const dynamicInput = JSON.stringify({
    batchId: batch.id,
    documentId: batch.documentId,
    documentTitle: batch.documentTitle,
    sectionIds: batch.sectionIds,
    blocks: batch.blocks.map(block => ({
      id: block.id,
      type: block.type,
      headingPath: block.headingPath,
      content: block.content,
    })),
  });
  return {
    system,
    stablePrefix,
    dynamicInput,
    promptVersion: SECTION_COMPILER_PROMPT_VERSION,
    messages: [
      { role: 'system', content: `${system}\n\n${stablePrefix}` },
      { role: 'user', content: dynamicInput },
    ],
  };
}

export async function compileSectionBatch(
  config: ModelConfig,
  batch: SectionBatch,
): Promise<SectionCompilation> {
  const completion = await callChatCompletion<RawSectionCompilation>(
    config,
    buildSectionCompilerPrompt(batch),
    'course-section-compile',
    120000,
    batch.id,
    'section-compile',
  );
  const raw = isRecord(completion.data) ? completion.data : {};
  const validBlockIds = new Set(batch.blocks.map(block => block.id));
  const rawTopics = Array.isArray(raw.topicMentions) ? raw.topicMentions : [];
  const topicMentions: TopicMentionDraft[] = [];
  const namespacedTopicIds = new Map<string, string>();

  rawTopics.forEach(item => {
    if (!isRecord(item)) return;
    const localId = text(item.localId);
    const genre = text(item.genre) as LearningGenre;
    const importance = text(item.importance) as TopicMentionDraft['importance'];
    const name = text(item.name);
    if (!localId || !name || !LEARNING_GENRES.has(genre) || !IMPORTANCE.has(importance)) return;
    const namespacedId = `${batch.id}:${localId}`;
    namespacedTopicIds.set(localId, namespacedId);
    topicMentions.push({
      localId: namespacedId,
      name,
      aliases: Array.isArray(item.aliases) ? item.aliases.map(text).filter(Boolean) : [],
      learningObjective: text(item.learningObjective),
      scope: text(item.scope),
      genre,
      difficulty: Math.round(clamp(item.difficulty, 1, 5)),
      importance,
      evidence: parseEvidence(item.evidence, validBlockIds),
      confidence: clamp(item.confidence, 0, 1),
    });
  });

  const teachingUnits: TeachingUnitDraft[] = [];
  const rawUnits = Array.isArray(raw.teachingUnits) ? raw.teachingUnits : [];
  rawUnits.forEach(item => {
    if (!isRecord(item)) return;
    const localId = text(item.localId);
    const topicLocalId = namespacedTopicIds.get(text(item.topicLocalId));
    const role = text(item.role) as TeachingRole;
    if (!localId || !topicLocalId || !TEACHING_ROLES.has(role)) return;
    teachingUnits.push({
      localId: `${batch.id}:${localId}`,
      topicLocalId,
      role,
      title: text(item.title),
      summary: text(item.summary),
      evidence: parseEvidence(item.evidence, validBlockIds),
      required: item.required === true,
      confidence: clamp(item.confidence, 0, 1),
    });
  });

  const orderClaims: OrderClaimDraft[] = [];
  const rawClaims = Array.isArray(raw.orderClaims) ? raw.orderClaims : [];
  rawClaims.forEach(item => {
    if (!isRecord(item)) return;
    const beforeTopicLocalId = namespacedTopicIds.get(text(item.beforeTopicLocalId));
    const afterTopicLocalId = namespacedTopicIds.get(text(item.afterTopicLocalId));
    const source = text(item.source) === 'explicit' ? 'explicit' : 'inferred';
    if (!beforeTopicLocalId || !afterTopicLocalId || beforeTopicLocalId === afterTopicLocalId) return;
    orderClaims.push({
      beforeTopicLocalId,
      afterTopicLocalId,
      strength: source === 'inferred' ? 'soft' : text(item.strength) === 'hard' ? 'hard' : 'soft',
      reason: text(item.reason),
      evidence: parseEvidence(item.evidence, validBlockIds),
      source,
      confidence: clamp(item.confidence, 0, 1),
    });
  });

  return {
    batchId: batch.id,
    sectionIds: batch.sectionIds,
    topicMentions,
    teachingUnits,
    orderClaims,
    unresolvedReferences: Array.isArray(raw.unresolvedReferences)
      ? raw.unresolvedReferences.map(text).filter(Boolean)
      : [],
    confidence: clamp(raw.confidence, 0, 1),
  };
}
