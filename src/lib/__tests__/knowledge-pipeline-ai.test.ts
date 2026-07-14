import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runFullPipeline,
  buildMacroKnowledgeGraph,
  buildInternalKnowledgeStructures,
  deriveLearningPath,
} from '../knowledge-pipeline';
import { generateTopicId } from '../knowledge-graph';
import { makeEvidence, makeTopic, makeRelation, makeKnowledgePackage } from './helpers';
import type { ModelConfig, EvidenceAtom, CourseTopic, MacroKnowledgeRelation } from '../../types';

// ========== Shared Config ==========

const modelConfig: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

// ========== Helpers ==========

/** Create N evidence atoms with predictable IDs. */
function makeEvidences(count: number): EvidenceAtom[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvidence({
      id: `ev${i + 1}`,
      pageNumber: i + 1,
      blockIndex: i,
      content: `这是第${i + 1}条证据内容，描述了某个知识点的关键信息。`,
      type: i === 0 ? 'definition' : 'text',
    })
  );
}

/** Build a chat completion response body from a JSON-serializable content object. */
function chatBody(content: unknown) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return { choices: [{ message: { content: contentStr } }] };
}

/** Create a Response-like object. */
function makeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  };
}

/** Build a valid candidate extraction response for Stage 1 (extractTopicCandidates). */
function candidateResponse(titles: string[], evIdGroups: string[][]) {
  return {
    candidates: titles.map((title, idx) => ({
      temporaryId: `c${idx + 1}`,
      title,
      aliases: [] as string[],
      learningObjective: `掌握${title}`,
      evidenceIds: evIdGroups[idx],
      prerequisiteHints: [] as string[],
      internalItemHints: [] as string[],
      confidence: 0.9,
    })),
    warnings: [] as string[],
  };
}

/** Build a valid topic extraction response for Stage 2 (judgeTopicGranularity). */
function topicResponse(titles: string[], evIdGroups: string[][]) {
  return {
    topics: titles.map((title, idx) => ({
      topicKey: `t${idx + 1}`,
      title,
      aliases: [] as string[],
      type: 'method',
      learningGoal: `掌握${title}`,
      importance: 'core',
      evidenceIds: evIdGroups[idx],
      confidence: 0.9,
    })),
    unassignedEvidenceIds: [],
    granularityReason: '按知识点划分',
    warnings: [] as string[],
  };
}

/** Build a relation extraction response using computed topic IDs. */
function relationResponse(
  sourceTitle: string,
  targetTitle: string,
  type: 'recommended_before' | 'hard_prerequisite' = 'recommended_before'
) {
  return {
    relations: [
      {
        sourceTopicId: generateTopicId(sourceTitle),
        targetTopicId: generateTopicId(targetTitle),
        type,
        evidenceIds: [],
        reason: `${sourceTitle}是${targetTitle}的基础`,
        confidence: 0.8,
        origin: 'ai-inferred',
      },
    ],
  };
}

/** Build a content extraction (internal structure) response for a topic. */
function contentResponse(evidenceId: string, content: string) {
  return {
    items: [
      {
        itemKey: `k_${evidenceId}`,
        type: 'definition',
        content,
        evidenceIds: [evidenceId],
        confidence: 0.85,
      },
    ],
    relations: [] as unknown[],
  };
}

/** Standard 3-topic valid response data (6 evidences, 2 per topic, each < 35% coverage). */
const VALID_TITLES = ['梯度下降', '反向传播', '损失函数'];
const VALID_EV_GROUPS = [['ev1', 'ev2'], ['ev3', 'ev4'], ['ev5', 'ev6']];

// ========== Mock Setup ==========

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Configure fetch to return the given response bodies in sequence. */
function mockSequence(bodies: unknown[]) {
  let i = 0;
  fetchMock.mockImplementation(async () => {
    const body = bodies[i] ?? bodies[bodies.length - 1];
    i++;
    return makeResponse(body);
  });
}

// ========== Tests ==========

describe('runFullPipeline', () => {
  // ---------- No model ----------

  it('returns model-required when no model config is provided', async () => {
    const evidences = makeEvidences(6);
    const result = await runFullPipeline(evidences, null);

    expect(result.status).toBe('model-required');
    expect(result.topics).toEqual([]);
    expect(result.packages).toEqual([]);
    expect(result.qualityReport).toBeNull();
    // learningPath is an empty path object (not null) when no topics
    expect(result.learningPath.topicIds).toEqual([]);
    expect(result.learningPath.steps).toEqual([]);
    expect(result.learningPath.warnings.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns model-required when config has empty apiKey', async () => {
    const evidences = makeEvidences(6);
    const result = await runFullPipeline(evidences, {
      endpoint: 'x',
      model: 'y',
      apiKey: '',
    });

    expect(result.status).toBe('model-required');
    expect(result.qualityReport).toBeNull();
  });

  // ---------- With model and mocked fetch ----------

  it('runs successfully with model and mocked fetch', async () => {
    const evidences = makeEvidences(6);

    // Fetch sequence (two-phase extraction + content):
    //   1. extractTopicCandidates (Stage 1)
    //   2. judgeTopicGranularity  (Stage 2)
    //   3. extractRelations       (Stage 3, quality passed)
    //   4. extractTopicContent for topic 0 (梯度下降)
    //   5. extractTopicContent for topic 1 (反向传播)
    //   6. extractTopicContent for topic 2 (损失函数)
    mockSequence([
      chatBody(candidateResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(topicResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(relationResponse('梯度下降', '反向传播')),
      chatBody(contentResponse('ev1', '梯度下降是一种迭代优化算法，用于最小化损失函数')),
      chatBody(contentResponse('ev3', '反向传播算法用于计算神经网络中的梯度')),
      chatBody(contentResponse('ev5', '损失函数衡量模型预测与真实值之间的差异')),
    ]);

    const result = await runFullPipeline(evidences, modelConfig);

    expect(result.status).toBe('ready');
    expect(result.topics.length).toBe(3);
    expect(result.packages.length).toBe(3);
    expect(result.qualityReport).not.toBeNull();
    expect(result.qualityReport?.needsRepair).toBe(false);
    expect(result.learningPath).not.toBeNull();
    expect(result.learningPath!.topicIds.length).toBe(3);

    // Topics should be ordered with 梯度下降 before 反向传播 (prerequisite relation)
    const titles = result.topics.map(t => t.title);
    expect(titles.indexOf('梯度下降')).toBeLessThan(titles.indexOf('反向传播'));

    // Packages should correspond to topics
    expect(result.packages[0].topic.id).toBe(result.topics[0].id);
    expect(result.packages[1].topic.id).toBe(result.topics[1].id);
    expect(result.packages[2].topic.id).toBe(result.topics[2].id);

    // Internal structures should use AI
    expect(result.packages[0].internalStructure.source).toBe('ai');
    expect(result.packages[1].internalStructure.source).toBe('ai');
    expect(result.packages[2].internalStructure.source).toBe('ai');

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('does not generate "课程内容" topic', async () => {
    const evidences = makeEvidences(6);
    mockSequence([
      chatBody(candidateResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(topicResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(relationResponse('梯度下降', '反向传播')),
      chatBody(contentResponse('ev1', '梯度下降定义')),
      chatBody(contentResponse('ev3', '反向传播定义')),
      chatBody(contentResponse('ev5', '损失函数定义')),
    ]);

    const result = await runFullPipeline(evidences, modelConfig);

    expect(result.topics.some(t => t.title === '课程内容')).toBe(false);
    expect(result.topics.some(t => t.title.includes('课程内容'))).toBe(false);
    expect(result.topics.some(t => t.title.includes('课件内容'))).toBe(false);
    expect(result.topics.some(t => t.title.includes('学习内容'))).toBe(false);
  });

  it('invokes onStageChange callback through pipeline stages', async () => {
    const evidences = makeEvidences(6);
    mockSequence([
      chatBody(candidateResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(topicResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(relationResponse('梯度下降', '反向传播')),
      chatBody(contentResponse('ev1', '梯度下降定义')),
      chatBody(contentResponse('ev3', '反向传播定义')),
      chatBody(contentResponse('ev5', '损失函数定义')),
    ]);

    const stages: string[] = [];
    await runFullPipeline(evidences, modelConfig, {
      onStatusChange: (s) => stages.push(s),
    });

    // Pipeline emits statuses from topic extraction, relation extraction,
    // and internal structure extraction
    expect(stages).toContain('extracting-topics');
    expect(stages).toContain('extracting-relations');
    expect(stages).toContain('extracting-internal-structures');
  });
});

describe('buildMacroKnowledgeGraph', () => {
  it('returns model-required when no model config is provided', async () => {
    const evidences = makeEvidences(6);
    const result = await buildMacroKnowledgeGraph(evidences, null);

    expect(result.status).toBe('model-required');
    expect(result.source).toBe('failed');
    expect(result.topics).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.qualityReport).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts topics and relations with model', async () => {
    const evidences = makeEvidences(6);
    // Fetch sequence:
    //   1. extractTopicCandidates (Stage 1)
    //   2. judgeTopicGranularity  (Stage 2)
    //   3. extractRelations       (Stage 3, quality passed)
    mockSequence([
      chatBody(candidateResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(topicResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(relationResponse('梯度下降', '反向传播', 'hard_prerequisite')),
    ]);

    const result = await buildMacroKnowledgeGraph(evidences, modelConfig);

    expect(result.status).toBe('ready');
    expect(result.source).toBe('ai');
    expect(result.topics.length).toBe(3);
    expect(result.relations.length).toBe(1);
    expect(result.relations[0].type).toBe('hard_prerequisite');
    expect(result.qualityReport).not.toBeNull();
    expect(result.qualityReport?.needsRepair).toBe(false);

    // Relation should reference actual topic IDs
    const topicIds = result.topics.map(t => t.id);
    expect(topicIds).toContain(result.relations[0].sourceTopicId);
    expect(topicIds).toContain(result.relations[0].targetTopicId);
  });

  it('does not generate generic "课程内容" topic', async () => {
    const evidences = makeEvidences(6);
    mockSequence([
      chatBody(candidateResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(topicResponse(VALID_TITLES, VALID_EV_GROUPS)),
      chatBody(relationResponse('梯度下降', '反向传播')),
    ]);

    const result = await buildMacroKnowledgeGraph(evidences, modelConfig);

    expect(result.topics.some(t => t.title === '课程内容')).toBe(false);
  });
});

describe('buildInternalKnowledgeStructures', () => {
  // ---------- No model (local fallback) ----------

  it('creates packages with local structure when no model is provided', async () => {
    const evidences = makeEvidences(4);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1', 'ev2'] }),
      makeTopic({ id: 't2', title: '反向传播', evidenceIds: ['ev3', 'ev4'] }),
    ];

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, null);

    expect(packages.length).toBe(2);
    expect(packages[0].topic.id).toBe('t1');
    expect(packages[1].topic.id).toBe('t2');

    // All packages should use local structure
    expect(packages[0].internalStructure.source).toBe('local');
    expect(packages[1].internalStructure.source).toBe('local');

    // Local structure should still have content items
    expect(packages[0].internalStructure.items.length).toBeGreaterThan(0);
    expect(packages[1].internalStructure.items.length).toBeGreaterThan(0);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------- With model (AI extraction) ----------

  it('creates packages with AI structure when model is provided', async () => {
    const evidences = makeEvidences(4);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1', 'ev2'] }),
      makeTopic({ id: 't2', title: '反向传播', evidenceIds: ['ev3', 'ev4'] }),
    ];

    mockSequence([
      chatBody(contentResponse('ev1', '梯度下降是一种迭代优化算法')),
      chatBody(contentResponse('ev3', '反向传播用于计算梯度')),
    ]);

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, modelConfig);

    expect(packages.length).toBe(2);
    expect(packages[0].topic.id).toBe('t1');
    expect(packages[1].topic.id).toBe('t2');

    // AI structure should be used
    expect(packages[0].internalStructure.source).toBe('ai');
    expect(packages[1].internalStructure.source).toBe('ai');

    // AI items should be present
    expect(packages[0].internalStructure.items.length).toBeGreaterThan(0);
    expect(packages[1].internalStructure.items.length).toBeGreaterThan(0);

    // The AI content should be present in items
    const item0 = packages[0].internalStructure.items[0];
    expect(item0.content).toContain('梯度下降');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to local structure when AI returns no items', async () => {
    const evidences = makeEvidences(4);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1', 'ev2'] }),
    ];

    mockSequence([
      chatBody({ items: [], relations: [] }),
    ]);

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, modelConfig);

    expect(packages.length).toBe(1);
    expect(packages[0].internalStructure.source).toBe('ai-fallback');
    expect(packages[0].internalStructure.items.length).toBeGreaterThan(0);
  });

  it('handles mixed success: AI for one topic, fallback for another', async () => {
    const evidences = makeEvidences(4);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1', 'ev2'] }),
      makeTopic({ id: 't2', title: '反向传播', evidenceIds: ['ev3', 'ev4'] }),
    ];

    mockSequence([
      chatBody(contentResponse('ev1', '梯度下降定义')), // topic 0: AI success
      chatBody({ items: [], relations: [] }),            // topic 1: AI returns nothing
    ]);

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, modelConfig);

    expect(packages.length).toBe(2);
    expect(packages[0].internalStructure.source).toBe('ai');
    expect(packages[1].internalStructure.source).toBe('ai-fallback');
  });

  it('handles fetch errors gracefully per topic', async () => {
    const evidences = makeEvidences(4);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '梯度下降', evidenceIds: ['ev1', 'ev2'] }),
      makeTopic({ id: 't2', title: '反向传播', evidenceIds: ['ev3', 'ev4'] }),
    ];

    // First fetch throws, second succeeds
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error('Network error');
      return makeResponse(chatBody(contentResponse('ev3', '反向传播定义')));
    });

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, modelConfig);

    expect(packages.length).toBe(2);
    // First topic: fetch failed → fallback
    expect(packages[0].internalStructure.source).toBe('ai-fallback');
    // Second topic: fetch succeeded → AI
    expect(packages[1].internalStructure.source).toBe('ai');
  });

  it('creates one package per topic', async () => {
    const evidences = makeEvidences(6);
    const topics: CourseTopic[] = [
      makeTopic({ id: 't1', title: '主题A', evidenceIds: ['ev1', 'ev2'] }),
      makeTopic({ id: 't2', title: '主题B', evidenceIds: ['ev3', 'ev4'] }),
      makeTopic({ id: 't3', title: '主题C', evidenceIds: ['ev5', 'ev6'] }),
    ];

    const packages = await buildInternalKnowledgeStructures(topics, [], evidences, null);

    expect(packages.length).toBe(3);
    expect(packages.map(p => p.topic.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('deriveLearningPath', () => {
  it('derives a learning path from topics and relations', () => {
    const topics: CourseTopic[] = [
      makeTopic({ id: 'a', title: '主题A', originalOrder: 0, originalPageNumbers: [1] }),
      makeTopic({ id: 'b', title: '主题B', originalOrder: 1, originalPageNumbers: [2] }),
    ];
    const relations: MacroKnowledgeRelation[] = [
      makeRelation({
        id: 'r1',
        sourceTopicId: 'a',
        targetTopicId: 'b',
        type: 'hard_prerequisite',
      }),
    ];
    const packages = [
      makeKnowledgePackage({ topic: topics[0] }),
      makeKnowledgePackage({ topic: topics[1] }),
    ];

    const path = deriveLearningPath(topics, relations, packages);

    expect(path).not.toBeNull();
    expect(path!.topicIds.length).toBe(2);
    expect(path!.topicIds).toContain('a');
    expect(path!.topicIds).toContain('b');
    // 'a' is a prerequisite of 'b', so it should come first
    expect(path!.topicIds.indexOf('a')).toBeLessThan(path!.topicIds.indexOf('b'));
    expect(path!.steps.length).toBe(2);
  });

  it('warns when some topics lack corresponding packages', () => {
    const topics: CourseTopic[] = [
      makeTopic({ id: 'a', title: '主题A' }),
      makeTopic({ id: 'b', title: '主题B' }),
    ];
    // Only topic 'a' has a package
    const packages = [makeKnowledgePackage({ topic: topics[0] })];

    const path = deriveLearningPath(topics, [], packages);

    expect(path).not.toBeNull();
    expect(path!.warnings.length).toBeGreaterThan(0);
    expect(path!.warnings.some(w => w.includes('缺少') || w.includes('缺失') || w.includes('missing'))).toBe(true);
  });

  it('derives path with multiple prerequisite chains', () => {
    const topics: CourseTopic[] = [
      makeTopic({ id: 'a', title: '基础', originalOrder: 0, originalPageNumbers: [1] }),
      makeTopic({ id: 'b', title: '中级', originalOrder: 1, originalPageNumbers: [2] }),
      makeTopic({ id: 'c', title: '高级', originalOrder: 2, originalPageNumbers: [3] }),
    ];
    const relations: MacroKnowledgeRelation[] = [
      makeRelation({ id: 'r1', sourceTopicId: 'a', targetTopicId: 'b', type: 'hard_prerequisite' }),
      makeRelation({ id: 'r2', sourceTopicId: 'b', targetTopicId: 'c', type: 'hard_prerequisite' }),
    ];
    const packages = topics.map(t => makeKnowledgePackage({ topic: t }));

    const path = deriveLearningPath(topics, relations, packages);

    expect(path!.topicIds.length).toBe(3);
    // Chain: a → b → c
    expect(path!.topicIds.indexOf('a')).toBeLessThan(path!.topicIds.indexOf('b'));
    expect(path!.topicIds.indexOf('b')).toBeLessThan(path!.topicIds.indexOf('c'));
  });

  it('handles topics with no relations (uses original order)', () => {
    const topics: CourseTopic[] = [
      makeTopic({ id: 'x', title: '主题X', originalOrder: 0, originalPageNumbers: [1] }),
      makeTopic({ id: 'y', title: '主题Y', originalOrder: 1, originalPageNumbers: [2] }),
    ];
    const packages = topics.map(t => makeKnowledgePackage({ topic: t }));

    const path = deriveLearningPath(topics, [], packages);

    expect(path!.topicIds.length).toBe(2);
    // With no relations, original order is preserved
    expect(path!.topicIds[0]).toBe('x');
    expect(path!.topicIds[1]).toBe('y');
  });
});
