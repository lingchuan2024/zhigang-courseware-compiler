import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldBatch,
  splitEvidencesIntoWindows,
  extractTopicsWithBatching,
} from '../ai-extraction-batching';
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

/** Create N evidence atoms with predictable IDs. */
function makeEvidences(count: number, contentLength?: number): EvidenceAtom[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvidence({
      id: `ev${i + 1}`,
      pageNumber: i + 1,
      blockIndex: i,
      content: contentLength
        ? 'x'.repeat(contentLength)
        : `这是第${i + 1}条证据内容，描述了某个知识点的关键信息。`,
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

/** Build a single-topic response referencing a given evidence ID. */
function singleTopicResponse(title: string, evidenceId: string) {
  return {
    topics: [
      {
        topicKey: `t_${evidenceId}`,
        title,
        aliases: [] as string[],
        type: 'method',
        learningGoal: `掌握${title}`,
        importance: 'core',
        evidenceIds: [evidenceId],
        confidence: 0.85,
      },
    ],
    unassignedEvidenceIds: [],
    granularityReason: '按窗口划分',
    warnings: [] as string[],
  };
}

/** Build a relation extraction response. */
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

/** Generate a contiguous range of evidence IDs. */
function evIdRange(start: number, end: number): string[] {
  return Array.from({ length: end - start + 1 }, (_, i) => `ev${start + i}`);
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

describe('shouldBatch', () => {
  it('returns false when evidences length is exactly 100', () => {
    expect(shouldBatch(makeEvidences(100))).toBe(false);
  });

  it('returns false for small evidence lists', () => {
    expect(shouldBatch(makeEvidences(1))).toBe(false);
    expect(shouldBatch(makeEvidences(50))).toBe(false);
    expect(shouldBatch(makeEvidences(99))).toBe(false);
  });

  it('returns true when evidences length exceeds 100', () => {
    expect(shouldBatch(makeEvidences(101))).toBe(true);
    expect(shouldBatch(makeEvidences(200))).toBe(true);
    expect(shouldBatch(makeEvidences(500))).toBe(true);
  });
});

describe('splitEvidencesIntoWindows', () => {
  // ---------- Small list (single window) ----------

  it('returns a single window for a small list', () => {
    const evidences = makeEvidences(50);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBe(1);
    expect(windows[0].evidences.length).toBe(50);
    expect(windows[0].windowIndex).toBe(0);
    expect(windows[0].startIndex).toBe(0);
    expect(windows[0].endIndex).toBe(49);
  });

  it('returns a single window for exactly 80 evidences (MAX_EVIDENCES_PER_WINDOW)', () => {
    const evidences = makeEvidences(80);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBe(1);
    expect(windows[0].evidences.length).toBe(80);
    expect(windows[0].startIndex).toBe(0);
    expect(windows[0].endIndex).toBe(79);
  });

  // ---------- Large list (multiple windows) ----------

  it('returns multiple windows for 81 evidences', () => {
    const evidences = makeEvidences(81);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBeGreaterThan(1);
  });

  it('splits a large list into windows with overlap', () => {
    const evidences = makeEvidences(200);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBeGreaterThan(1);

    // Each window should respect MAX_EVIDENCES_PER_WINDOW (80)
    for (const w of windows) {
      expect(w.evidences.length).toBeLessThanOrEqual(80);
    }

    // Adjacent windows should overlap (next start < previous end)
    for (let i = 1; i < windows.length; i++) {
      const prev = windows[i - 1];
      const curr = windows[i];
      expect(curr.startIndex).toBeLessThan(prev.endIndex);
    }

    // Overlap should be exactly OVERLAP_COUNT (5)
    const overlap = windows[0].endIndex - windows[1].startIndex + 1;
    expect(overlap).toBe(5);
  });

  it('covers the full evidence range from first to last index', () => {
    const evidences = makeEvidences(200);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows[0].startIndex).toBe(0);
    expect(windows[windows.length - 1].endIndex).toBe(199);
  });

  it('assigns sequential windowIndex values', () => {
    const evidences = makeEvidences(200);
    const windows = splitEvidencesIntoWindows(evidences);

    windows.forEach((w, i) => {
      expect(w.windowIndex).toBe(i);
    });
  });

  // ---------- Char limit ----------

  it('respects MAX_CHARS_PER_WINDOW when content is large', () => {
    // Each evidence has 1000 chars, so 40 evidences = 40000 chars (the limit)
    // Windows should be char-limited rather than count-limited
    const evidences = makeEvidences(200, 1000);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBeGreaterThan(1);

    for (const w of windows) {
      const totalChars = w.evidences.reduce((sum, e) => sum + e.content.length, 0);
      // Each window should not exceed MAX_CHARS_PER_WINDOW (40000)
      expect(totalChars).toBeLessThanOrEqual(40000);
    }

    // With 1000-char evidences, each window should have at most 40 evidences
    // (char-limited, not count-limited at 80)
    for (const w of windows) {
      expect(w.evidences.length).toBeLessThanOrEqual(40);
    }
  });

  it('produces more windows when char limit is active than without it', () => {
    const shortContentEvidences = makeEvidences(200);
    const longContentEvidences = makeEvidences(200, 1000);

    const shortWindows = splitEvidencesIntoWindows(shortContentEvidences);
    const longWindows = splitEvidencesIntoWindows(longContentEvidences);

    // With 1000-char content, the char limit kicks in earlier than the count limit
    expect(longWindows.length).toBeGreaterThan(shortWindows.length);
  });
});

describe('extractTopicsWithBatching', () => {
  // ---------- No model ----------

  it('returns model-required when no model config is provided', async () => {
    const evidences = makeEvidences(10);
    const result = await extractTopicsWithBatching(null, evidences);

    expect(result.status).toBe('model-required');
    expect(result.source).toBe('failed');
    expect(result.topics).toEqual([]);
    expect(result.windowCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns model-required when config has empty apiKey', async () => {
    const evidences = makeEvidences(10);
    const result = await extractTopicsWithBatching(
      { endpoint: 'x', model: 'y', apiKey: '' },
      evidences
    );

    expect(result.status).toBe('model-required');
    expect(result.windowCount).toBe(0);
  });

  // ---------- Small list delegates to extractTopicsWithRepair ----------

  it('delegates to extractTopicsWithRepair for small evidence list', async () => {
    const evidences = makeEvidences(10);
    mockSequence([
      chatBody(topicResponse(['梯度下降', '反向传播'], [['ev1', 'ev2', 'ev3', 'ev4', 'ev5'], ['ev6', 'ev7', 'ev8', 'ev9', 'ev10']])),
      chatBody(relationResponse('梯度下降', '反向传播')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('ready');
    expect(result.source).toBe('ai');
    expect(result.windowCount).toBe(1); // small list → single window via repair
    expect(result.topics.length).toBe(2);
    expect(result.topics.some(t => t.title === '梯度下降')).toBe(true);
    expect(result.topics.some(t => t.title === '反向传播')).toBe(true);
  });

  it('does not batch when evidences.length is exactly 100', async () => {
    const evidences = makeEvidences(100);
    // 100 evidences → shouldBatch returns false → delegates to repair
    // repair uses extractTopics + extractRelations
    mockSequence([
      chatBody(topicResponse(['主题A', '主题B'], [evIdRange(1, 50), evIdRange(51, 100)])),
      chatBody(relationResponse('主题A', '主题B')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('ready');
    expect(result.windowCount).toBe(1);
    expect(result.topics.length).toBe(2);
  });

  // ---------- Map-Reduce for large list ----------

  it('performs Map-Reduce for large evidence list (> 100)', async () => {
    const evidences = makeEvidences(150);

    // Windows for 150 evidences (default content ~30 chars each, no char limit):
    //   Window 0: ev1..ev80    (80 evidences)
    //   Window 1: ev76..ev150  (75 evidences, overlap ev76..ev80)
    //   Window 2: ev146..ev150 (5 evidences, overlap ev146..ev150)
    // Total: 3 windows
    //
    // Fetch sequence:
    //   1. extractTopics for window 0
    //   2. extractTopics for window 1
    //   3. extractTopics for window 2
    //   4. mergeTopicsWithAI (reduce)
    //   5. extractRelations

    mockSequence([
      // Window 0: returns a topic referencing ev1
      chatBody(singleTopicResponse('优化方法', 'ev1')),
      // Window 1: returns a topic referencing ev76
      chatBody(singleTopicResponse('神经网络', 'ev76')),
      // Window 2: returns a topic referencing ev146
      chatBody(singleTopicResponse('训练技巧', 'ev146')),
      // Merge (reduce): 2 merged topics covering all evidences
      chatBody(topicResponse(['优化方法', '神经网络'], [evIdRange(1, 75), evIdRange(76, 150)])),
      // Relations between merged topics
      chatBody(relationResponse('优化方法', '神经网络', 'hard_prerequisite')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('ready');
    expect(result.windowCount).toBe(3);
    expect(result.topics.length).toBe(2);
    expect(result.topics.some(t => t.title === '优化方法')).toBe(true);
    expect(result.topics.some(t => t.title === '神经网络')).toBe(true);
    expect(result.relations.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 3 windows + 1 merge + 1 relations
  });

  it('returns failed when all window extractions fail', async () => {
    const evidences = makeEvidences(150);

    // All windows return empty topics
    mockSequence([
      chatBody({ topics: [], unassignedEvidenceIds: [], granularityReason: '', warnings: [] }),
      chatBody({ topics: [], unassignedEvidenceIds: [], granularityReason: '', warnings: [] }),
      chatBody({ topics: [], unassignedEvidenceIds: [], granularityReason: '', warnings: [] }),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('failed');
    expect(result.topics).toEqual([]);
  });

  it('reports correct windowCount', async () => {
    const evidences = makeEvidences(250);
    const windows = splitEvidencesIntoWindows(evidences);

    mockSequence([
      // One response per window
      ...windows.map(() =>
        chatBody(singleTopicResponse('主题', `ev${windows[0].evidences[0].id!.replace('ev', '')}`))
      ),
      // Merge
      chatBody(topicResponse(['主题A', '主题B'], [evIdRange(1, 125), evIdRange(126, 250)])),
      // Relations
      chatBody(relationResponse('主题A', '主题B')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.windowCount).toBe(windows.length);
  });
});
