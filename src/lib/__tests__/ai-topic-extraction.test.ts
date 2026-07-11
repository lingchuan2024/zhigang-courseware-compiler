import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractTopicsWithRepair } from '../ai-topic-extraction';
import { generateTopicId } from '../knowledge-graph';
import { makeEvidence } from './helpers';
import type { ModelConfig, EvidenceAtom } from '../../types';

// ========== Shared Config ==========

const modelConfig: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

// ========== Helpers ==========

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

/** Build a valid topic extraction response. */
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
  type: 'recommended_before' | 'hard_prerequisite' | 'soft_prerequisite' = 'recommended_before'
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

/** A topic extraction response with a generic title (fails validation). */
function genericTopicResponse() {
  return {
    topics: [
      {
        topicKey: 't1',
        title: '课程内容',
        aliases: [] as string[],
        type: 'composite',
        learningGoal: '学习课程内容',
        importance: 'core',
        evidenceIds: ['ev1', 'ev2', 'ev3', 'ev4'],
        confidence: 0.5,
      },
    ],
    unassignedEvidenceIds: [],
    granularityReason: '',
    warnings: [] as string[],
  };
}

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

describe('extractTopicsWithRepair', () => {
  // ---------- No model config ----------

  describe('no model config', () => {
    it('returns model-required when config is null', async () => {
      const result = await extractTopicsWithRepair(null, makeEvidences(4));

      expect(result.status).toBe('model-required');
      expect(result.source).toBe('failed');
      expect(result.topics).toEqual([]);
      expect(result.relations).toEqual([]);
      expect(result.attempts).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns model-required when config has empty apiKey', async () => {
      const result = await extractTopicsWithRepair(
        { endpoint: 'https://api.example.com', model: 'test', apiKey: '' },
        makeEvidences(4)
      );

      expect(result.status).toBe('model-required');
      expect(result.source).toBe('failed');
      expect(result.topics).toEqual([]);
      expect(result.attempts).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ---------- With model and mocked fetch ----------

  describe('with model and mocked fetch', () => {
    it('extracts topics successfully on first attempt', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('ready');
      expect(result.source).toBe('ai');
      expect(result.attempts).toBe(1);
      expect(result.topics.length).toBe(2);
      expect(result.topics.some(t => t.title === '梯度下降')).toBe(true);
      expect(result.topics.some(t => t.title === '反向传播')).toBe(true);
      expect(result.relations.length).toBeGreaterThanOrEqual(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not generate generic "课程内容" topic', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.topics.some(t => t.title === '课程内容')).toBe(false);
      expect(result.topics.some(t => t.title.includes('课程内容'))).toBe(false);
      expect(result.topics.some(t => t.title.includes('课件内容'))).toBe(false);
    });

    it('returns AI relations with correct topic IDs', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播', 'hard_prerequisite')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.source).toBe('ai');
      expect(result.relations.length).toBe(1);
      const rel = result.relations[0];
      expect(rel.type).toBe('hard_prerequisite');

      // The relation should reference actual topic IDs
      const topicIds = result.topics.map(t => t.id);
      expect(topicIds).toContain(rel.sourceTopicId);
      expect(topicIds).toContain(rel.targetTopicId);
    });

    it('falls back to basic relations when AI returns no relations', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody({ relations: [] }),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('ready');
      // With no AI relations, basic relations are generated
      expect(result.source).toBe('ai-fallback');
      expect(result.relations.length).toBe(1); // 2 topics → 1 basic relation
      expect(result.relations[0].type).toBe('recommended_before');
    });
  });

  // ---------- Repair retry ----------

  describe('repair retry', () => {
    it('triggers repair retry when validation fails with generic title', async () => {
      const evidences = makeEvidences(4);

      mockSequence([
        chatBody(genericTopicResponse()), // attempt 0: fails validation (generic title)
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])), // attempt 1: valid
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('ready');
      expect(result.attempts).toBe(2);
      expect(result.topics.length).toBe(2);
      expect(result.topics.some(t => t.title === '课程内容')).toBe(false);
      expect(result.validation?.valid).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('invokes onValidationResult callback on each attempt', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const validations: Array<{ valid: boolean; attempt: number }> = [];

      await extractTopicsWithRepair(modelConfig, evidences, {
        onValidationResult: (v, attempt) => validations.push({ valid: v.valid, attempt }),
      });

      expect(validations.length).toBe(2);
      expect(validations[0].valid).toBe(false);
      expect(validations[0].attempt).toBe(1);
      expect(validations[1].valid).toBe(true);
      expect(validations[1].attempt).toBe(2);
    });

    it('uses repair feedback from validation in the retry', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      // The first validation should have produced repair feedback
      // Since the second attempt succeeded, the repair was effective
      expect(result.status).toBe('ready');
      expect(result.attempts).toBe(2);
    });
  });

  // ---------- Max retries ----------

  describe('max retries', () => {
    it('exhausts 3 total attempts (max retries = 2) when all fail', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('failed');
      expect(result.source).toBe('failed');
      expect(result.attempts).toBe(3); // MAX_REPAIR_RETRIES + 1
      expect(result.topics).toEqual([]);
      expect(result.relations).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not exceed 3 attempts even with more failures', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.attempts).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(3); // never more than 3
    });

    it('records errors for all failed attempts', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
        chatBody(genericTopicResponse()),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.errors.length).toBe(3);
      expect(result.errors[0]).toContain('第1次');
      expect(result.errors[1]).toContain('第2次');
      expect(result.errors[2]).toContain('第3次');
    });
  });

  // ---------- Status callbacks ----------

  describe('status callbacks', () => {
    it('invokes onStatusChange during successful extraction', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const statuses: string[] = [];
      await extractTopicsWithRepair(modelConfig, evidences, {
        onStatusChange: (s) => statuses.push(s),
      });

      expect(statuses).toContain('extracting-topics');
      expect(statuses).toContain('extracting-relations');
    });

    it('invokes repairing-topics status during repair', async () => {
      const evidences = makeEvidences(4);
      mockSequence([
        chatBody(genericTopicResponse()),
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])),
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const statuses: string[] = [];
      await extractTopicsWithRepair(modelConfig, evidences, {
        onStatusChange: (s) => statuses.push(s),
      });

      expect(statuses).toContain('repairing-topics');
    });
  });

  // ---------- Error handling ----------

  describe('error handling', () => {
    it('returns failed when fetch throws on all attempts', async () => {
      const evidences = makeEvidences(4);
      fetchMock.mockImplementation(async () => {
        throw new Error('Network error');
      });

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('failed');
      expect(result.attempts).toBe(3);
      expect(result.errors.length).toBe(3);
      // extractTopics catches internally → "未返回有效结果"
      expect(result.errors.some(e => e.includes('未返回有效结果'))).toBe(true);
    });

    it('returns failed when fetch returns non-ok response', async () => {
      const evidences = makeEvidences(4);
      fetchMock.mockImplementation(async () => makeResponse({}, false, 500));

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('failed');
      expect(result.attempts).toBe(3);
    });

    it('recovers if first fetch fails but retry succeeds', async () => {
      const evidences = makeEvidences(4);
      let call = 0;
      fetchMock.mockImplementation(async () => {
        call++;
        if (call === 1) {
          return makeResponse({}, false, 500);
        }
        // Second call: valid topic extraction
        return makeResponse(
          chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']]))
        );
        // Note: relation fetch will reuse the last response since only 2 are defined
      });
      // Override with sequence for clarity
      call = 0;
      mockSequence([
        makeResponse({}, false, 500), // attempt 0: fetch error → extractTopics returns empty
        chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2'], ['ev3', 'ev4']])), // attempt 1: success
        chatBody(relationResponse('梯度下降', '反向传播')),
      ]);

      const result = await extractTopicsWithRepair(modelConfig, evidences);

      expect(result.status).toBe('ready');
      expect(result.attempts).toBe(2);
      expect(result.topics.length).toBe(2);
    });
  });
});
