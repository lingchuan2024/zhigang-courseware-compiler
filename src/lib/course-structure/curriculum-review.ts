import type { ModelConfig } from '../../types';
import { callChatCompletion } from '../model-v2';
import type { CompiledPrompt } from '../prompt-builder';
import { constraintStableKey } from './stable-identity';
import type {
  CourseStructureIssue,
  EvidenceSpan,
  LearningTopic,
  OrderConstraint,
} from './types';

export type CurriculumOperation =
  | { type: 'merge'; topicIds: string[]; reason: string }
  | { type: 'drop'; topicIds: string[]; reason: string };

export interface CurriculumReviewResult {
  operations: CurriculumOperation[];
  constraints: OrderConstraint[];
  warnings: CourseStructureIssue[];
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function buildPrompt(
  topics: LearningTopic[],
  evidenceById: ReadonlyMap<string, EvidenceSpan>,
): CompiledPrompt {
  const system = [
    '你只审查既有课程主题，不得新增主题或改写原文证据。',
    '只允许输出 merge/drop 操作，以及 beforeTopicId 到 afterTopicId 的顺序约束。',
    '所有 topicIds 和 evidenceIds 必须来自输入。hard 只能表示真实学习依赖。',
    '只返回 JSON 对象：{"operations":[],"constraints":[]}。',
  ].join('\n');
  const dynamicInput = JSON.stringify({
    topics: topics.map(topic => ({
      id: topic.id,
      name: topic.name,
      aliases: topic.aliases,
      learningObjective: topic.learningObjective,
      scope: topic.scope,
      genre: topic.genre,
      difficulty: topic.difficulty,
      importance: topic.importance,
      evidence: topic.evidenceIds.flatMap(id => {
        const evidence = evidenceById.get(id);
        return evidence ? [{ id, quote: evidence.quote.slice(0, 160) }] : [];
      }),
    })),
  });
  return {
    system,
    stablePrefix: 'course-curriculum-review-v1',
    dynamicInput,
    promptVersion: 'course-curriculum-review-v1',
    // 同 section-compiler：GLM Responses 把内部推理计入输出预算，需覆盖推理 + JSON。
    maxOutputTokens: 8192,
    maxStructuredAttempts: 1,
    maxTransportAttempts: 1,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: dynamicInput },
    ],
  };
}

export async function reviewCurriculum(
  config: ModelConfig,
  topics: LearningTopic[],
  evidenceById: ReadonlyMap<string, EvidenceSpan>,
  timeoutMs = 120_000,
): Promise<CurriculumReviewResult> {
  const completion = await callChatCompletion<unknown>(
    config,
    buildPrompt(topics, evidenceById),
    'course-curriculum-review',
    // GLM 强制推理下 20 秒不够，与 section-compile 一致放宽到 120 秒。
    Math.max(1, Math.min(120_000, timeoutMs)),
    undefined,
    'curriculum-review',
  );
  const raw = isRecord(completion.data) ? completion.data : {};
  const topicIds = new Set(topics.map(topic => topic.id));
  const warnings: CourseStructureIssue[] = [];

  const operations: CurriculumOperation[] = [];
  const rawOperations = Array.isArray(raw.operations) ? raw.operations : [];
  rawOperations.forEach(item => {
    if (!isRecord(item)) return;
    const type = text(item.type);
    const ids = [...new Set(stringArray(item.topicIds))];
    const minimum = type === 'merge' ? 2 : 1;
    if ((type !== 'merge' && type !== 'drop') || ids.length < minimum || ids.some(id => !topicIds.has(id))) {
      warnings.push({
        code: 'UNKNOWN_TOPIC',
        severity: 'warning',
        message: '课程审查返回了未知主题操作，已忽略',
      });
      return;
    }
    operations.push({ type, topicIds: ids, reason: text(item.reason) } as CurriculumOperation);
  });

  const constraints: OrderConstraint[] = [];
  const rawConstraints = Array.isArray(raw.constraints) ? raw.constraints : [];
  rawConstraints.forEach(item => {
    if (!isRecord(item)) return;
    const beforeTopicId = text(item.beforeTopicId);
    const afterTopicId = text(item.afterTopicId);
    const evidenceIds = [...new Set(stringArray(item.evidenceIds))];
    if (!topicIds.has(beforeTopicId) || !topicIds.has(afterTopicId) || beforeTopicId === afterTopicId) {
      warnings.push({
        code: 'UNKNOWN_TOPIC',
        severity: 'warning',
        message: '课程审查返回了未知主题顺序，已忽略',
      });
      return;
    }
    if (evidenceIds.some(id => !evidenceById.has(id))) {
      warnings.push({
        code: 'INVALID_EVIDENCE',
        severity: 'warning',
        message: '课程审查返回了未知证据，已忽略该顺序',
      });
      return;
    }
    const requestedStrength = text(item.strength) === 'hard' ? 'hard' : 'soft';
    const strength = requestedStrength === 'hard' && evidenceIds.length > 0 ? 'hard' : 'soft';
    constraints.push({
      id: constraintStableKey(beforeTopicId, afterTopicId, strength),
      beforeTopicId,
      afterTopicId,
      strength,
      reason: text(item.reason),
      evidenceIds,
      source: 'inferred',
      confidence: confidence(item.confidence),
    });
  });

  return { operations, constraints, warnings };
}
