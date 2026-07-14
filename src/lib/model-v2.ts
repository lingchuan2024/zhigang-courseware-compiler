import {
  ModelConfig,
  EvidenceAtom,
  CourseTopic,
  MacroKnowledgeRelation,
  KnowledgePackage,
  UnitContentItem,
  MicroKnowledgeRelation,
  NaturalKnowledgeNote,
  CourseGenerationMemory,
  UnitContentType,
  MicroRelationType,
  TopicCandidate,
} from '../types';
import { generateId } from './utils';
import {
  NormalizedTopic,
  NormalizedRelation,
  normalizeTopics,
  normalizeRelations,
} from './knowledge-graph';
import {
  type CompiledPrompt,
  buildTopicExtractionPrompt,
  buildTopicRepairPrompt,
  buildRelationExtractionPrompt,
  buildInternalStructurePrompt,
  buildNoteGenerationPrompt,
  buildTopicMergePrompt,
  buildTopicCandidateExtractionPrompt,
  buildTopicGranularityPrompt,
  buildTopicQualityRepairPrompt,
  buildTargetedRepairPrompt,
} from './prompt-builder';
import {
  type ModelTaskType,
  type CompletionResult,
  extractUsage,
  recordUsage,
} from './model-usage';
import { normalizeGeneratedMarkdown } from './markdown-normalization';
import { validateGeneratedMarkdown } from './markdown-validation';
import { compileEvidenceCitations } from './evidence-citation-compiler';
import { ExtractionError, ExtractionStage, inferErrorCode } from './extraction-errors';

// ========== 运行时枚举校验 ==========

const VALID_UNIT_CONTENT_TYPES: Set<UnitContentType> = new Set([
  'motivation', 'problem', 'prerequisite', 'assumption', 'intuition',
  'definition', 'formula', 'derivation', 'procedure', 'example',
  'chart', 'comparison', 'condition', 'limitation', 'misconception', 'conclusion',
]);

const VALID_MICRO_RELATION_TYPES: Set<MicroRelationType> = new Set([
  'explains', 'defines', 'derived_from', 'step_before', 'example_of',
  'illustrates', 'supports', 'contrasts_with', 'qualifies',
]);

// 通用JSON解析（处理代码围栏）
function parseJsonFromResponse(text: string): unknown {
  let cleaned = text.trim();
  // 去除markdown代码围栏
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  // 尝试找到第一个{或[
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = cleaned.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ========== 通用API调用（保留usage） ==========

/**
 * Call chat completion API and return parsed data + usage info.
 * Records usage for cache statistics.
 *
 * 不再吞掉异常 — 网络错误、超时、HTTP 错误、JSON 解析失败
 * 都会抛出 ExtractionError，由调用方决定如何处理。
 */
export async function callChatCompletion<T>(
  config: ModelConfig,
  compiled: CompiledPrompt,
  taskType: ModelTaskType,
  timeout: number = 90000,
  topicId?: string,
  stage?: ExtractionStage,
): Promise<CompletionResult<T>> {
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = endpoint.endsWith('/chat/completions')
    ? endpoint
    : `${endpoint}/chat/completions`;

  const startedAt = Date.now();
  const maxStructuredAttempts = 2;
  let lastStructuredError: ExtractionError | null = null;

  for (let attempt = 0; attempt < maxStructuredAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: compiled.messages,
          temperature: 0.2,
          max_tokens: 8192,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new ExtractionError(
        inferErrorCode(e),
        stage || 'unknown' as ExtractionStage,
        e instanceof Error ? e.message : String(e),
        { cause: e },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ExtractionError(
        response.status === 429 ? 'api-rate-limit' : 'api-http-error',
        stage || 'unknown' as ExtractionStage,
        `API ${response.status}: ${response.statusText}${body ? ` — ${body.substring(0, 200)}` : ''}`,
      );
    }

    const rawData = await response.json();
    const choice = rawData.choices?.[0];
    const rawContent: string = choice?.message?.content || '';
    const wasTruncated = choice?.finish_reason === 'length';
    const parsed = rawContent ? parseJsonFromResponse(rawContent) : null;

    if (!wasTruncated && parsed !== null) {
      const usage = extractUsage(
        rawData,
        config.model,
        taskType,
        compiled.promptVersion,
        Date.now() - startedAt,
        topicId,
      );
      recordUsage(usage);
      return { data: parsed as T, usage };
    }

    const code = wasTruncated || !rawContent ? 'response-truncated' : 'json-parse-failed';
    const message = !rawContent
      ? 'API 返回的 choices[0].message.content 为空'
      : wasTruncated
        ? `模型输出达到长度上限，JSON 未完成（前 200 字符：${rawContent.substring(0, 200)}）`
        : `模型输出不是合法 JSON（前 200 字符：${rawContent.substring(0, 200)}）`;
    lastStructuredError = new ExtractionError(
      code,
      stage || 'unknown' as ExtractionStage,
      message,
      { rawResponse: rawContent.substring(0, 500) },
    );
  }

  throw lastStructuredError ?? new ExtractionError(
    'json-parse-failed',
    stage || 'unknown' as ExtractionStage,
    '模型未返回可解析的 JSON',
  );
}

// ========== 阶段1：粗粒度主题提取 ==========

/** AI 主题提取的原始输出（未经校验） */
export interface RawTopicExtractionResult {
  topics: Array<{
    topicKey?: string;
    title: string;
    aliases?: string[];
    type: string;
    learningGoal?: string;
    importance?: string;
    evidenceIds: string[];
    confidence?: number;
  }>;
  unassignedEvidenceIds?: string[];
  granularityReason?: string;
  warnings?: string[];
}

/**
 * 主题提取结果（包含额外元数据）
 */
export interface TopicExtractionResult {
  topics: CourseTopic[];
  usedModel: boolean;
  unassignedEvidenceIds: string[];
  granularityReason: string;
  warnings: string[];
  raw: RawTopicExtractionResult | null;
}

export async function extractTopics(
  config: ModelConfig | null,
  evidences: EvidenceAtom[]
): Promise<TopicExtractionResult> {
  const emptyResult: TopicExtractionResult = {
    topics: [],
    usedModel: false,
    unassignedEvidenceIds: [],
    granularityReason: '',
    warnings: [],
    raw: null,
  };

  if (!config?.apiKey) {
    return emptyResult;
  }

  try {
    const compiled = buildTopicExtractionPrompt(evidences);
    const { data } = await callChatCompletion<RawTopicExtractionResult>(
      config,
      compiled,
      'topic-extraction'
    );

    if (!data?.topics || !Array.isArray(data.topics)) {
      return emptyResult;
    }

    const topics = normalizeTopics(data.topics as NormalizedTopic[], evidences);
    return {
      topics,
      usedModel: topics.length > 0,
      unassignedEvidenceIds: data.unassignedEvidenceIds || [],
      granularityReason: data.granularityReason || '',
      warnings: data.warnings || [],
      raw: data,
    };
  } catch (error) {
    console.warn('Topic extraction failed:', error);
    return emptyResult;
  }
}

/**
 * 带修复反馈的主题提取。
 * 在校验失败后，将错误信息反馈给AI，请求修复。
 */
export async function extractTopicsWithFeedback(
  config: ModelConfig,
  evidences: EvidenceAtom[],
  feedback: string,
  previousResult?: RawTopicExtractionResult | null
): Promise<TopicExtractionResult> {
  const emptyResult: TopicExtractionResult = {
    topics: [],
    usedModel: false,
    unassignedEvidenceIds: [],
    granularityReason: '',
    warnings: [],
    raw: null,
  };

  try {
    const compiled = buildTopicRepairPrompt(evidences, feedback, previousResult);
    const { data } = await callChatCompletion<RawTopicExtractionResult>(
      config,
      compiled,
      'topic-repair'
    );

    if (!data?.topics || !Array.isArray(data.topics)) {
      return emptyResult;
    }

    const topics = normalizeTopics(data.topics as NormalizedTopic[], evidences);
    return {
      topics,
      usedModel: topics.length > 0,
      unassignedEvidenceIds: data.unassignedEvidenceIds || [],
      granularityReason: data.granularityReason || '',
      warnings: data.warnings || [],
      raw: data,
    };
  } catch (error) {
    console.warn('Topic extraction with feedback failed:', error);
    return emptyResult;
  }
}

// ========== 阶段2：宏观关系提取 ==========

export async function extractRelations(
  config: ModelConfig | null,
  topics: CourseTopic[],
  evidences: EvidenceAtom[]
): Promise<{ relations: MacroKnowledgeRelation[]; usedModel: boolean }> {
  if (!config?.apiKey || topics.length < 2) {
    return { relations: [], usedModel: false };
  }

  try {
    const compiled = buildRelationExtractionPrompt(topics, evidences);
    const { data } = await callChatCompletion<{ relations?: NormalizedRelation[] }>(
      config,
      compiled,
      'relation-extraction'
    );

    if (!data?.relations || !Array.isArray(data.relations)) {
      return { relations: [], usedModel: false };
    }

    const relations = normalizeRelations(data.relations, topics, evidences);
    return { relations, usedModel: relations.length > 0 };
  } catch (error) {
    console.warn('Relation extraction failed:', error);
    return { relations: [], usedModel: false };
  }
}

// ========== 阶段3：细粒度内容提取（单知识点） ==========

export async function extractTopicContent(
  config: ModelConfig | null,
  kp: KnowledgePackage,
  allTopics: CourseTopic[]
): Promise<{
  items: Partial<UnitContentItem>[];
  relations: MicroKnowledgeRelation[];
  usedModel: boolean;
}> {
  if (!config?.apiKey) {
    return { items: [], relations: [], usedModel: false };
  }

  // 获取该知识点的有效evidenceId集合用于校验
  const validEvIds = new Set(kp.source.evidenceIds);

  try {
    const compiled = buildInternalStructurePrompt(kp, allTopics);
    const { data } = await callChatCompletion<{
      items?: Array<{
        itemKey?: string;
        type: string;
        title?: string;
        content: string;
        evidenceIds?: string[];
        confidence?: number;
      }>;
      relations?: Array<{
        sourceItemKey?: string;
        targetItemKey?: string;
        type: string;
        evidenceIds?: string[];
        reason?: string;
        confidence?: number;
      }>;
    }>(config, compiled, 'internal-structure', 60000, kp.topic.id);

    if (!data?.items || !Array.isArray(data.items)) {
      return { items: [], relations: [], usedModel: false };
    }

    // 校验和处理items
    const keyToItemId = new Map<string, string>();
    const items: Partial<UnitContentItem>[] = [];

    for (const i of data.items) {
      // 类型运行时校验
      if (!i.type || !VALID_UNIT_CONTENT_TYPES.has(i.type as UnitContentType)) continue;
      const content = (i.content || '').trim();
      if (!content) continue;

      // confidence范围校验
      const conf = Math.max(0, Math.min(1, i.confidence || 0.5));

      // evidenceId过滤：只保留该知识点真实拥有的证据
      const evidenceIds = (i.evidenceIds || []).filter((id: string) => validEvIds.has(id));

      const itemId = generateId('item');
      const itemKey = i.itemKey?.trim() || `auto_${items.length}`;
      keyToItemId.set(itemKey, itemId);

      items.push({
        id: itemId,
        topicId: kp.topic.id,
        type: i.type as UnitContentType,
        title: i.title?.trim(),
        content,
        evidenceIds,
        confidence: conf,
      });
    }

    if (items.length === 0) {
      return { items: [], relations: [], usedModel: false };
    }

    // 处理relations：使用itemKey匹配，无法匹配则丢弃
    const relations: MicroKnowledgeRelation[] = [];
    for (const r of data.relations || []) {
      // 关系类型运行时校验
      if (!r.type || !VALID_MICRO_RELATION_TYPES.has(r.type as MicroRelationType)) continue;
      if (!r.sourceItemKey || !r.targetItemKey) continue;

      const sourceId = keyToItemId.get(r.sourceItemKey);
      const targetId = keyToItemId.get(r.targetItemKey);
      // 匹配失败直接丢弃，不能猜测
      if (!sourceId || !targetId) continue;
      if (sourceId === targetId) continue;

      // evidenceId过滤
      const evidenceIds = (r.evidenceIds || []).filter((id: string) => validEvIds.has(id));
      const conf = Math.max(0, Math.min(1, r.confidence || 0.5));

      relations.push({
        id: generateId('mrel'),
        sourceItemId: sourceId,
        targetItemId: targetId,
        topicId: kp.topic.id,
        type: r.type as MicroRelationType,
        evidenceIds,
        reason: r.reason || '',
        confidence: conf,
      });
    }

    return { items, relations, usedModel: true };
  } catch (error) {
    console.warn(`Content extraction failed for ${kp.topic.title}:`, error);
    return { items: [], relations: [], usedModel: false };
  }
}

// ========== 阶段4：自然笔记生成 ==========

export async function generateTopicNote(
  config: ModelConfig | null,
  kp: KnowledgePackage,
  memory: CourseGenerationMemory,
  orderedTopics: CourseTopic[],
  previousNoteSummary?: string,
  courseName?: string
): Promise<{ note: NaturalKnowledgeNote | null; usedModel: boolean }> {
  if (!config?.apiKey) {
    return { note: null, usedModel: false };
  }

  try {
    const compiled = buildNoteGenerationPrompt(
      kp,
      memory,
      orderedTopics,
      courseName || kp.topic.title,
      previousNoteSummary
    );

    const { data } = await callChatCompletion<{
      title?: string;
      contentMarkdown?: string;
      shortSummary?: string;
      terminologyUpdates?: Record<string, string>;
      symbolUpdates?: Record<string, string>;
      continuityMemory?: string;
      warnings?: string[];
    }>(config, compiled, 'note-generation', 120000, kp.topic.id);

    if (!data?.contentMarkdown) {
      return { note: null, usedModel: false };
    }

    // === Markdown 规范化 ===
    const normalized = normalizeGeneratedMarkdown(data.contentMarkdown);

    // === 引用编译：[[evidence:ev-1,ev-2]] → [cite-N] ===
    const knownEvidenceIds = new Set(kp.source.evidenceIds);
    const citationResult = compileEvidenceCitations(normalized.content, knownEvidenceIds);

    // === Markdown 校验 ===
    const validation = validateGeneratedMarkdown(citationResult.markdown, citationResult.citations);

    // === 合并警告 ===
    const allWarnings = [
      ...(data.warnings ?? []),
      ...normalized.warnings,
      ...citationResult.warnings,
      ...validation.warnings,
    ];

    const note: NaturalKnowledgeNote = {
      id: generateId('note'),
      topicId: kp.topic.id,
      title: data.title || kp.topic.title,
      contentMarkdown: validation.fixedContent,
      shortSummary: data.shortSummary || kp.topic.learningGoal,
      citations: citationResult.citations,
      terminologyUpdates: data.terminologyUpdates || {},
      symbolUpdates: data.symbolUpdates || {},
      continuityMemory: data.continuityMemory || '',
      warnings: allWarnings,
    };

    return { note, usedModel: true };
  } catch (error) {
    console.warn(`Note generation failed for ${kp.topic.title}:`, error);
    return { note: null, usedModel: false };
  }
}

// ========== Topic Merge (for Map-Reduce batching) ==========

export async function mergeTopicsWithAI(
  config: ModelConfig,
  windowResults: Array<{ windowIndex: number; topics: CourseTopic[] }>,
  allEvidenceIds: Set<string>
): Promise<TopicExtractionResult> {
  const compiled = buildTopicMergePrompt(windowResults, allEvidenceIds);
  const { data } = await callChatCompletion<RawTopicExtractionResult>(
    config,
    compiled,
    'topic-merge'
  );

  if (!data?.topics || !Array.isArray(data.topics)) {
    return {
      topics: [],
      usedModel: false,
      unassignedEvidenceIds: [],
      granularityReason: '',
      warnings: [],
      raw: data,
    };
  }

  // Reconstruct evidences from allEvidenceIds for normalization
  const allEvidences: EvidenceAtom[] = [...allEvidenceIds].map((id, i) => ({
    id,
    documentId: '',
    pageNumber: 0,
    blockIndex: i,
    type: 'text' as const,
    content: '',
    confidence: 1,
    contentHash: '',
  }));

  const topics = normalizeTopics(data.topics as NormalizedTopic[], allEvidences);
  return {
    topics,
    usedModel: topics.length > 0,
    unassignedEvidenceIds: data.unassignedEvidenceIds || [],
    granularityReason: data.granularityReason || 'Map-Reduce合并',
    warnings: data.warnings || [],
    raw: data,
  };
}

// ========== Two-Stage Topic Extraction (v4) ==========

/** 第一阶段：候选知识点提取的原始输出 */
export interface RawCandidateExtractionResult {
  candidates?: Array<{
    temporaryId?: string;
    title: string;
    aliases?: string[];
    learningObjective?: string;
    evidenceIds: string[];
    prerequisiteHints?: string[];
    internalItemHints?: string[];
    confidence?: number;
  }>;
  warnings?: string[];
}

/** 第一阶段：候选知识点提取结果 */
export interface CandidateExtractionResult {
  candidates: TopicCandidate[];
  usedModel: boolean;
  warnings: string[];
  raw: RawCandidateExtractionResult | null;
}

/**
 * 第一阶段 AI 提取：从证据中提取候选知识点。
 * 不依赖课件标题，从内容语义识别。
 *
 * 不再吞掉异常 — 网络错误、JSON 解析失败等会抛出 ExtractionError。
 * 只有 Evidence ID 校验后全部被过滤才返回空结果（附带警告）。
 */
export async function extractTopicCandidates(
  config: ModelConfig | null,
  evidences: EvidenceAtom[]
): Promise<CandidateExtractionResult> {
  const empty: CandidateExtractionResult = {
    candidates: [],
    usedModel: false,
    warnings: [],
    raw: null,
  };

  if (!config?.apiKey) return empty;

  const compiled = buildTopicCandidateExtractionPrompt(evidences);
  const { data } = await callChatCompletion<RawCandidateExtractionResult>(
    config,
    compiled,
    'topic-candidate-extraction',
    90000,
    undefined,
    'candidate-extraction',
  );

  if (!data?.candidates || !Array.isArray(data.candidates)) {
    throw new ExtractionError(
      'json-schema-mismatch',
      'candidate-extraction',
      '模型返回结构缺少 candidates 数组',
    );
  }

  const validEvidenceIds = new Set(evidences.map(e => e.id));
  const candidates: TopicCandidate[] = [];
  let totalFiltered = 0;

  for (let i = 0; i < data.candidates.length; i++) {
    const c = data.candidates[i];
    if (!c.title || !c.title.trim()) continue;
    if (!c.evidenceIds || c.evidenceIds.length === 0) continue;

    // 过滤真实 evidenceId
    const realEvIds = c.evidenceIds.filter((id: string) => validEvidenceIds.has(id));
    totalFiltered += c.evidenceIds.length - realEvIds.length;
    if (realEvIds.length === 0) continue;

    candidates.push({
      temporaryId: c.temporaryId?.trim() || `c${i + 1}`,
      title: c.title.trim(),
      aliases: c.aliases || [],
      learningObjective: c.learningObjective?.trim() || '',
      evidenceIds: realEvIds,
      prerequisiteHints: c.prerequisiteHints || [],
      internalItemHints: c.internalItemHints || [],
      confidence: Math.max(0, Math.min(1, c.confidence || 0.5)),
    });
  }

  if (candidates.length === 0 && data.candidates.length > 0) {
    // 模型返回了候选但全部被 Evidence ID 过滤
    throw new ExtractionError(
      'evidence-filtered',
      'candidate-extraction',
      `模型返回了 ${data.candidates.length} 个候选，但全部因 Evidence ID 不匹配被过滤`,
    );
  }

  return {
    candidates,
    usedModel: candidates.length > 0,
    warnings: data.warnings || [],
    raw: data,
  };
}

/** 第二阶段：粒度判定的原始输出 */
export interface RawGranularityResult {
  decisions?: Array<{
    candidateId: string;
    action: string;
    reason?: string;
    resultingTopicIds?: string[];
    evidenceIds?: string[];
  }>;
  topics?: Array<{
    topicKey?: string;
    title: string;
    aliases?: string[];
    type: string;
    learningGoal?: string;
    importance?: string;
    evidenceIds: string[];
    confidence?: number;
  }>;
  unassignedEvidenceIds?: string[];
  granularityReason?: string;
  warnings?: string[];
}

/**
 * 第二阶段 AI 提取：全局合并与粒度判定。
 * 将候选知识点交给 AI 做全局整理。
 *
 * 不再吞掉异常 — 错误会以 ExtractionError 抛出。
 */
export async function judgeTopicGranularity(
  config: ModelConfig,
  candidates: TopicCandidate[],
  evidenceSource: Set<string> | EvidenceAtom[]
): Promise<TopicExtractionResult> {
  const empty: TopicExtractionResult = {
    topics: [],
    usedModel: false,
    unassignedEvidenceIds: [],
    granularityReason: '',
    warnings: [],
    raw: null,
  };

  if (candidates.length === 0) return empty;

  const allEvidenceIds = new Set(
    Array.isArray(evidenceSource)
      ? evidenceSource.map(evidence => evidence.id)
      : evidenceSource,
  );
  const compiled = buildTopicGranularityPrompt(candidates, allEvidenceIds);
  const { data } = await callChatCompletion<RawGranularityResult>(
    config,
    compiled,
    'topic-granularity-judgment',
    90000,
    undefined,
    'global-merge',
  );

  if (!data?.topics || !Array.isArray(data.topics)) {
    throw new ExtractionError(
      'json-schema-mismatch',
      'global-merge',
      '模型返回结构缺少 topics 数组',
    );
  }

  if (data.topics.length === 0) {
    throw new ExtractionError(
      'model-returned-empty',
      'global-merge',
      '模型返回了空的 topics 数组',
    );
  }

  // 使用真实 Evidence 保留页码；仅旧调用只传 ID 时才构造兼容占位数据。
  const allEvidences: EvidenceAtom[] = Array.isArray(evidenceSource)
    ? evidenceSource
    : [...allEvidenceIds].map((id, i) => ({
        id,
        documentId: '',
        pageNumber: 0,
        blockIndex: i,
        type: 'text' as const,
        content: '',
        confidence: 1,
        contentHash: '',
      }));

  const topics = normalizeTopics(data.topics as NormalizedTopic[], allEvidences);
  return {
    topics,
    usedModel: topics.length > 0,
    unassignedEvidenceIds: data.unassignedEvidenceIds || [],
    granularityReason: data.granularityReason || '两阶段全局整理',
    warnings: data.warnings || [],
    raw: data as unknown as RawTopicExtractionResult,
  };
}

/**
 * 第三阶段 AI 提取：质量修复。
 * 根据质量检测报告修复知识点提取结果。
 *
 * 不再吞掉异常 — 错误会以 ExtractionError 抛出。
 */
export async function repairTopicsWithQuality(
  config: ModelConfig,
  evidences: EvidenceAtom[],
  currentTopics: CourseTopic[],
  qualityFeedback: string
): Promise<TopicExtractionResult> {
  const compiled = buildTopicQualityRepairPrompt(
    evidences,
    currentTopics.map(t => ({
      title: t.title,
      evidenceIds: t.evidenceIds,
      learningGoal: t.learningGoal,
      importance: t.importance,
    })),
    qualityFeedback
  );
  const { data } = await callChatCompletion<RawTopicExtractionResult>(
    config,
    compiled,
    'topic-quality-repair',
    90000,
    undefined,
    'targeted-repair',
  );

  if (!data?.topics || !Array.isArray(data.topics)) {
    throw new ExtractionError(
      'json-schema-mismatch',
      'targeted-repair',
      '修复返回结构缺少 topics 数组',
    );
  }

  const topics = normalizeTopics(data.topics as NormalizedTopic[], evidences);
  return {
    topics,
    usedModel: topics.length > 0,
    unassignedEvidenceIds: data.unassignedEvidenceIds || [],
    granularityReason: data.granularityReason || '质量修复',
    warnings: data.warnings || [],
    raw: data,
  };
}

/**
 * 定向修复 — 只发送有问题的知识点和它们的证据，
 * 不重发整份课件。返回修复后的知识点列表（仅包含被修复的）。
 *
 * 不再吞掉异常 — 错误会以 ExtractionError 抛出。
 */
export async function repairTopicsTargeted(
  config: ModelConfig,
  targetEvidences: EvidenceAtom[],
  problematicTopics: CourseTopic[],
  qualityFeedback: string
): Promise<TopicExtractionResult> {
  const compiled = buildTargetedRepairPrompt(
    targetEvidences,
    problematicTopics.map(t => ({
      title: t.title,
      evidenceIds: t.evidenceIds,
      learningGoal: t.learningGoal,
      importance: t.importance,
    })),
    qualityFeedback
  );
  const { data } = await callChatCompletion<RawTopicExtractionResult>(
    config,
    compiled,
    'topic-quality-repair',
    90000,
    undefined,
    'targeted-repair',
  );

  if (!data?.topics || !Array.isArray(data.topics)) {
    throw new ExtractionError(
      'json-schema-mismatch',
      'targeted-repair',
      '定向修复返回结构缺少 topics 数组',
    );
  }

  const topics = normalizeTopics(data.topics as NormalizedTopic[], targetEvidences);
  return {
    topics,
    usedModel: topics.length > 0,
    unassignedEvidenceIds: data.unassignedEvidenceIds || [],
    granularityReason: data.granularityReason || '定向修复',
    warnings: data.warnings || [],
    raw: data,
  };
}

// 保持旧接口兼容
export { validateModelConfig } from './model';
