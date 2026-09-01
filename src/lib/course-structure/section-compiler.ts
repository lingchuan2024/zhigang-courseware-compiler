import type { ModelConfig } from '../../types';
import { callChatCompletion } from '../model-v2';
import type { CompiledPrompt } from '../prompt-builder';
import type { SectionBatch, SectionBatchBlock } from './section-batching';
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
  topics?: unknown;
  topicMentions?: unknown;
  units?: unknown;
  teachingUnits?: unknown;
  explicitOrders?: unknown;
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

/** 模型常把 ID 写成数字，这里统一转成字符串，避免静默丢弃整条候选。 */
function identifier(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function evidenceRoleForTeachingRole(role: TeachingRole): EvidenceRole {
  if (role === 'definition' || role === 'formula' || role === 'condition'
    || role === 'example' || role === 'comparison' || role === 'application') return role;
  if (role === 'derivation_step') return 'derivation';
  return 'statement';
}

function parseEvidence(
  value: unknown,
  blocks: readonly SectionBatchBlock[],
  fallbackRole: EvidenceRole = 'statement',
): EvidenceSpanDraft[] {
  if (!Array.isArray(value)) return [];
  const atomById = new Map(blocks.map(block => [block.atomId, block]));
  const validBlockIds = new Set(blocks.map(block => block.id));
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const blockId = text(item.blockId);
    const quote = text(item.quote) || text(item.anchor);
    const requestedRole = text(item.role) as EvidenceRole;
    const role = EVIDENCE_ROLES.has(requestedRole) ? requestedRole : fallbackRole;
    if (!validBlockIds.has(blockId) || !quote || !EVIDENCE_ROLES.has(role)) return [];
    const atomId = text(item.atomId);
    const atom = atomId ? atomById.get(atomId) : undefined;
    if (atomId && (!atom || atom.id !== blockId)) return [];
    let startOffset = typeof item.startOffset === 'number' ? Math.floor(item.startOffset) : undefined;
    let endOffset = typeof item.endOffset === 'number' ? Math.floor(item.endOffset) : undefined;
    if (atom) {
      const first = atom.content.indexOf(quote);
      const second = first < 0 ? -1 : atom.content.indexOf(quote, first + Math.max(1, quote.length));
      if (first < 0 || second >= 0) return [];
      startOffset = atom.sourceStartOffset + first;
      endOffset = startOffset + quote.length;
    }
    return [{ blockId, quote, role, startOffset, endOffset }];
  });
}

export function buildSectionCompilerPrompt(batch: SectionBatch): CompiledPrompt {
  const system = [
    '你是轻量两层课程语义识别器，只能使用输入课件内容。',
    '第一层 topics 只保留有独立学习目标的知识点。',
    '第二层 units 表示知识点内部的问题、直觉、定义、公式、条件、步骤、示例等教学角色。',
    '每个 topic 至少有一个 unit；每个 unit 必须引用真实 blockId 和简短原文 anchor。',
    '不要复制大段原文，不要生成长摘要，不要输出通用知识图谱关系。',
    '顺序方向固定：beforeTopicLocalId 必须在 afterTopicLocalId 之前学习。',
    '严格按 responseSchema 的字段名返回一个 JSON 对象，不得输出解释性文字，不得改用其他字段名。',
  ].join('\n');
  const stablePrefix = JSON.stringify({
    learningGenres: [...LEARNING_GENRES],
    teachingRoles: [...TEACHING_ROLES],
    responseSchema: {
      topics: [{
        localId: 'string，批次内唯一，如 t1/t2',
        name: 'string，主题名',
        aliases: 'string[]',
        learningObjective: 'string，学完后能理解/解释/推导/比较/应用什么',
        genre: 'learningGenres 之一',
        difficulty: '1-5 整数',
        importance: 'core|important|supplementary',
      }],
      units: [{
        localId: 'string，批次内唯一，如 u1/u2',
        topicLocalId: 'string，所属 topics[].localId',
        role: 'teachingRoles 之一',
        title: 'string，简短标签',
        evidence: 'anchorItem[]，至少 1 条',
        required: 'boolean',
      }],
      explicitOrders: [{
        beforeTopicLocalId: 'string，topics[].localId',
        afterTopicLocalId: 'string，topics[].localId',
        reason: 'string',
        evidence: 'anchorItem[]，必须引用明示顺序的原文',
      }],
      confidence: '0..1',
      anchorItem: {
        atomId: '输入 blocks[].atomId',
        blockId: '输入 blocks[].id',
        anchor: '该 block 中真实存在的简短原文，建议 8-40 字',
      },
    },
  });
  const dynamicInput = JSON.stringify({
    batchId: batch.id,
    documentId: batch.documentId,
    documentTitle: batch.documentTitle,
    sectionIds: batch.sectionIds,
    blocks: batch.blocks.map(block => ({
      atomId: block.atomId,
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
    maxOutputTokens: 1024,
    maxStructuredAttempts: 1,
    maxTransportAttempts: 1,
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
  const timeout = 30000;
  const completion = await callChatCompletion<RawSectionCompilation>(
    config,
    buildSectionCompilerPrompt(batch),
    'course-section-compile',
    timeout,
    batch.id,
    'section-compile',
  );
  const raw = isRecord(completion.data) ? completion.data : {};
  const overallConfidence = clamp(raw.confidence, 0, 1);
  const rawTopics = Array.isArray(raw.topics)
    ? raw.topics
    : Array.isArray(raw.topicMentions) ? raw.topicMentions : [];
  const topicMentions: TopicMentionDraft[] = [];
  const namespacedTopicIds = new Map<string, string>();

  rawTopics.forEach(item => {
    if (!isRecord(item)) return;
    const localId = identifier(item.localId);
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
      scope: text(item.scope) || batch.sectionIds.join(' / '),
      genre,
      difficulty: Math.round(clamp(item.difficulty, 1, 5)),
      importance,
      evidence: parseEvidence(item.evidence, batch.blocks),
      confidence: typeof item.confidence === 'number'
        ? clamp(item.confidence, 0, 1)
        : overallConfidence,
    });
  });

  const teachingUnits: TeachingUnitDraft[] = [];
  const rawUnits = Array.isArray(raw.units)
    ? raw.units
    : Array.isArray(raw.teachingUnits) ? raw.teachingUnits : [];
  rawUnits.forEach(item => {
    if (!isRecord(item)) return;
    const localId = identifier(item.localId);
    const topicLocalId = namespacedTopicIds.get(identifier(item.topicLocalId));
    const role = text(item.role) as TeachingRole;
    if (!localId || !topicLocalId || !TEACHING_ROLES.has(role)) return;
    const title = text(item.title);
    const evidence = parseEvidence(item.evidence, batch.blocks, evidenceRoleForTeachingRole(role));
    teachingUnits.push({
      localId: `${batch.id}:${localId}`,
      topicLocalId,
      role,
      title,
      summary: text(item.summary) || title,
      evidence,
      required: item.required === true,
      confidence: typeof item.confidence === 'number'
        ? clamp(item.confidence, 0, 1)
        : overallConfidence,
    });
  });

  const evidenceByTopicId = new Map<string, EvidenceSpanDraft[]>();
  teachingUnits.forEach(unit => {
    evidenceByTopicId.set(unit.topicLocalId, [
      ...(evidenceByTopicId.get(unit.topicLocalId) ?? []),
      ...unit.evidence,
    ]);
  });
  topicMentions.forEach(topic => {
    if (topic.evidence.length === 0) topic.evidence = evidenceByTopicId.get(topic.localId) ?? [];
  });

  const orderClaims: OrderClaimDraft[] = [];
  const hasExplicitOrders = Array.isArray(raw.explicitOrders);
  const rawClaims = hasExplicitOrders
    ? raw.explicitOrders as unknown[]
    : Array.isArray(raw.orderClaims) ? raw.orderClaims : [];
  rawClaims.forEach(item => {
    if (!isRecord(item)) return;
    const beforeTopicLocalId = namespacedTopicIds.get(identifier(item.beforeTopicLocalId));
    const afterTopicLocalId = namespacedTopicIds.get(identifier(item.afterTopicLocalId));
    const source = hasExplicitOrders || text(item.source) === 'explicit' ? 'explicit' : 'inferred';
    if (!beforeTopicLocalId || !afterTopicLocalId || beforeTopicLocalId === afterTopicLocalId) return;
    const evidence = parseEvidence(item.evidence, batch.blocks);
    orderClaims.push({
      beforeTopicLocalId,
      afterTopicLocalId,
      strength: source === 'explicit' && evidence.length > 0 ? 'hard' : 'soft',
      reason: text(item.reason),
      evidence,
      source,
      confidence: typeof item.confidence === 'number'
        ? clamp(item.confidence, 0, 1)
        : overallConfidence,
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
    confidence: overallConfidence,
  };
}
