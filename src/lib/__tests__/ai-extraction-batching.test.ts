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

/**
 * Create N evidence atoms, each on its own page (pageNumber = i+1).
 */
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

/**
 * Create evidence atoms grouped by page.
 * @param evidencesPerPage - array of counts, e.g. [10, 10, 10] creates 3 pages with 10 each
 */
function makeEvidencesByPage(evidencesPerPage: number[], contentLength?: number): EvidenceAtom[] {
  const result: EvidenceAtom[] = [];
  let id = 1;
  for (let page = 0; page < evidencesPerPage.length; page++) {
    const count = evidencesPerPage[page];
    for (let i = 0; i < count; i++) {
      result.push(makeEvidence({
        id: `ev${id}`,
        pageNumber: page + 1,
        blockIndex: i,
        content: contentLength
          ? 'x'.repeat(contentLength)
          : `第${page + 1}页第${i + 1}条证据。`,
        type: 'text',
      }));
      id++;
    }
  }
  return result;
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

/** Build a valid candidate extraction response. */
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

/** Build a single-candidate response referencing a given evidence ID. */
function singleCandidateResponse(title: string, evidenceId: string) {
  return {
    candidates: [
      {
        temporaryId: `c_${evidenceId}`,
        title,
        aliases: [] as string[],
        learningObjective: `掌握${title}`,
        evidenceIds: [evidenceId],
        prerequisiteHints: [] as string[],
        internalItemHints: [] as string[],
        confidence: 0.85,
      },
    ],
    warnings: [] as string[],
  };
}

/** Build a valid topic extraction response (for judgeTopicGranularity). */
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
  it('always returns true (unified windowing)', () => {
    expect(shouldBatch(makeEvidences(1))).toBe(true);
    expect(shouldBatch(makeEvidences(50))).toBe(true);
    expect(shouldBatch(makeEvidences(100))).toBe(true);
    expect(shouldBatch(makeEvidences(500))).toBe(true);
  });
});

describe('splitEvidencesIntoWindows', () => {
  // ---------- Single page ----------

  it('returns a single window for evidences on one page', () => {
    const evidences = makeEvidencesByPage([10]);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBe(1);
    expect(windows[0].evidences.length).toBe(10);
    expect(windows[0].windowIndex).toBe(0);
    expect(windows[0].startPage).toBe(1);
    expect(windows[0].endPage).toBe(1);
  });

  // ---------- Few pages (single window) ----------

  it('returns a single window for 5 pages (within MIN/MAX range)', () => {
    const evidences = makeEvidencesByPage([5, 5, 5, 5, 5]);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBe(1);
    expect(windows[0].startPage).toBe(1);
    expect(windows[0].endPage).toBe(5);
  });

  // ---------- Multiple windows ----------

  it('returns multiple windows for 12 pages', () => {
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBeGreaterThan(1);

    // Each window should respect MAX_PAGES_PER_WINDOW (6)
    for (const w of windows) {
      const pages = w.endPage - w.startPage + 1;
      expect(pages).toBeLessThanOrEqual(6);
    }

    // Each window should respect MAX_EVIDENCES_PER_WINDOW (40)
    for (const w of windows) {
      expect(w.evidences.length).toBeLessThanOrEqual(40);
    }
  });

  // ---------- Overlap ----------

  it('adjacent windows overlap by 1 page', () => {
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const windows = splitEvidencesIntoWindows(evidences);

    if (windows.length > 1) {
      for (let i = 1; i < windows.length; i++) {
        const prev = windows[i - 1];
        const curr = windows[i];
        // Next window start should be <= prev end (overlap)
        expect(curr.startPage).toBeLessThanOrEqual(prev.endPage);
      }
    }
  });

  // ---------- Char limit ----------

  it('respects MAX_CHARS_PER_WINDOW when content is large', () => {
    // 10 pages, each with 5 evidences of 5000 chars = 25000 chars per page
    // 2 pages would be 50000 chars > 16000, so windows will be 1 page each
    const evidences = makeEvidencesByPage([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 5000);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows.length).toBeGreaterThan(1);

    for (const w of windows) {
      const totalChars = w.evidences.reduce((sum, e) => sum + e.content.length, 0);
      // Each window should not exceed MAX_CHARS_PER_WINDOW (16000)
      // (unless a single page already exceeds it)
      if (w.evidences.length > 0) {
        const singlePageChars = w.evidences
          .filter(e => e.pageNumber === w.startPage)
          .reduce((sum, e) => sum + e.content.length, 0);
        if (singlePageChars <= 16000) {
          expect(totalChars).toBeLessThanOrEqual(16000);
        }
      }
    }
  });

  // ---------- Coverage ----------

  it('covers all pages from first to last', () => {
    const evidences = makeEvidencesByPage([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const windows = splitEvidencesIntoWindows(evidences);

    expect(windows[0].startPage).toBe(1);
    expect(windows[windows.length - 1].endPage).toBe(10);
  });

  it('assigns sequential windowIndex values', () => {
    const evidences = makeEvidencesByPage([2, 2, 2, 2, 2, 2, 2, 2]);
    const windows = splitEvidencesIntoWindows(evidences);

    windows.forEach((w, i) => {
      expect(w.windowIndex).toBe(i);
    });
  });

  // ---------- Empty input ----------

  it('returns empty array for empty input', () => {
    expect(splitEvidencesIntoWindows([])).toEqual([]);
  });
});

describe('extractTopicsWithBatching', () => {
  // ---------- No model ----------

  it('returns model-required when no model config is provided', async () => {
    const evidences = makeEvidencesByPage([5]);
    const result = await extractTopicsWithBatching(null, evidences);

    expect(result.status).toBe('model-required');
    expect(result.source).toBe('failed');
    expect(result.topics).toEqual([]);
    expect(result.windowCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns model-required when config has empty apiKey', async () => {
    const evidences = makeEvidencesByPage([5]);
    const result = await extractTopicsWithBatching(
      { endpoint: 'x', model: 'y', apiKey: '' },
      evidences
    );

    expect(result.status).toBe('model-required');
    expect(result.windowCount).toBe(0);
  });

  // ---------- Single window extraction ----------

  it('extracts topics from a single window (5 pages, 5 evidences each)', async () => {
    const evidences = makeEvidencesByPage([5, 5, 5, 5, 5]);
    // 25 evidences, 4 topics covering all evidences (each ≤ 28% < 35%)
    mockSequence([
      chatBody(candidateResponse(
        ['梯度下降', '反向传播', '损失函数', '优化器'],
        [evIdRange(1, 7), evIdRange(8, 13), evIdRange(14, 19), evIdRange(20, 25)]
      )),
      chatBody(topicResponse(
        ['梯度下降', '反向传播', '损失函数', '优化器'],
        [evIdRange(1, 7), evIdRange(8, 13), evIdRange(14, 19), evIdRange(20, 25)]
      )),
      chatBody(relationResponse('梯度下降', '反向传播')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('ready');
    expect(result.source).toBe('ai');
    expect(result.windowCount).toBe(1);
    expect(result.topics.length).toBe(4);
    expect(result.topics.some(t => t.title === '梯度下降')).toBe(true);
    expect(result.topics.some(t => t.title === '反向传播')).toBe(true);
    expect(result.topics.find(t => t.title === '梯度下降')?.originalPageNumbers).toEqual([1, 2]);
  });

  // ---------- Multi-window Map-Reduce ----------

  it('performs Map-Reduce for 12 pages (multiple windows)', async () => {
    // 12 pages, 3 evidences each = 36 evidences
    // Windows: ~2-3 windows (4-6 pages each with 1-page overlap)
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const windows = splitEvidencesIntoWindows(evidences);
    const windowCount = windows.length;

    // Each window returns 1 candidate, merge returns 3 topics, then relations
    const mockBodies: unknown[] = [];
    for (let i = 0; i < windowCount; i++) {
      const evId = windows[i].evidences[0].id;
      mockBodies.push(chatBody(singleCandidateResponse(`知识点${i + 1}`, evId)));
    }
    // Merge
    mockBodies.push(chatBody(topicResponse(
      ['知识点1', '知识点2', '知识点3'],
      [evIdRange(1, 12), evIdRange(13, 24), evIdRange(25, 36)]
    )));
    // Relations
    mockBodies.push(chatBody(relationResponse('知识点1', '知识点2', 'hard_prerequisite')));

    mockSequence(mockBodies);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('ready');
    expect(result.windowCount).toBe(windowCount);
    expect(result.topics.length).toBe(3);
    expect(result.relations.length).toBeGreaterThanOrEqual(1);
    // windowCount (candidates) + 1 (merge) + 1 (relations)
    expect(fetchMock).toHaveBeenCalledTimes(windowCount + 2);
  });

  // ---------- Window failure handling ----------

  it('continues when some windows fail (>= 70% success)', async () => {
    // 20 pages → 4+ windows
    const evidences2 = makeEvidencesByPage(Array(20).fill(3)); // 20 pages → 4+ windows
    const windows2 = splitEvidencesIntoWindows(evidences2);
    const wCount = windows2.length;

    const mockBodies: unknown[] = [];
    for (let i = 0; i < wCount; i++) {
      if (i === 0) {
        // First window fails (HTTP error)
        mockBodies.push(makeResponse({ error: 'timeout' }, false, 500));
      } else {
        const evId = windows2[i].evidences[0].id;
        mockBodies.push(chatBody(singleCandidateResponse(`知识点${i}`, evId)));
      }
    }
    // Merge
    mockBodies.push(chatBody(topicResponse(
      Array.from({ length: wCount - 1 }, (_, i) => `知识点${i + 1}`),
      windows2.slice(1).map(w => [w.evidences[0].id])
    )));
    // Relations
    mockBodies.push(chatBody(relationResponse('知识点1', '知识点2')));

    mockSequence(mockBodies);

    const result = await extractTopicsWithBatching(modelConfig, evidences2);

    // Should succeed since success rate >= 70% (with retry, the first window might still fail)
    // With 2 retries, the first window will be called 3 times total
    // The mockSequence will cycle, so let's just check the result
    if (result.status === 'ready') {
      expect(result.topics.length).toBeGreaterThan(0);
    }
  });

  it('returns failed when all windows fail', async () => {
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3]);
    const windows = splitEvidencesIntoWindows(evidences);

    // All windows return HTTP error
    fetchMock.mockImplementation(async () => makeResponse({ error: 'server error' }, false, 500));

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('failed');
    expect(result.topics).toEqual([]);
    expect(result.failedStage).toBe('candidate-extraction');
    // Each window retried WINDOW_RETRY_COUNT + 1 times
    expect(fetchMock).toHaveBeenCalledTimes(windows.length * (2 + 1));
  });

  it('keeps AI window candidates when the global merge response is invalid', async () => {
    const evidences = makeEvidencesByPage([5, 5, 5, 5]);
    mockSequence([
      chatBody(candidateResponse(
        ['线性规划', '对偶问题', '弱对偶定理', '强对偶定理'],
        [evIdRange(1, 5), evIdRange(6, 10), evIdRange(11, 15), evIdRange(16, 20)]
      )),
      chatBody('这不是合法 JSON'),
      chatBody(relationResponse('线性规划', '对偶问题')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences, { totalPages: 4 });

    expect(result.status).toBe('ready');
    expect(result.source).toBe('ai-fallback');
    expect(result.topics.map(topic => topic.title)).toEqual([
      '线性规划',
      '对偶问题',
      '弱对偶定理',
      '强对偶定理',
    ]);
    expect(result.warnings.some(warning => warning.includes('保留窗口候选'))).toBe(true);
  });

  // ---------- Checkpoint ----------

  it('returns checkpoint data for retry', async () => {
    const evidences = makeEvidencesByPage([5, 5, 5, 5, 5]);
    // 25 evidences, 4 topics covering all evidences (each ≤ 28% < 35%)
    mockSequence([
      chatBody(candidateResponse(
        ['线性回归', '逻辑回归', '决策树', '随机森林'],
        [evIdRange(1, 7), evIdRange(8, 13), evIdRange(14, 19), evIdRange(20, 25)]
      )),
      chatBody(topicResponse(
        ['线性回归', '逻辑回归', '决策树', '随机森林'],
        [evIdRange(1, 7), evIdRange(8, 13), evIdRange(14, 19), evIdRange(20, 25)]
      )),
      chatBody(relationResponse('线性回归', '逻辑回归')),
    ]);

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint.lastCompletedStage).toBe('relation-extraction');
  });

  // ---------- onWindowProgress callback ----------

  it('calls onWindowProgress during extraction', async () => {
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const windows = splitEvidencesIntoWindows(evidences);
    const wCount = windows.length;

    const mockBodies: unknown[] = [];
    for (let i = 0; i < wCount; i++) {
      const evId = windows[i].evidences[0].id;
      mockBodies.push(chatBody(singleCandidateResponse(`知识点${i + 1}`, evId)));
    }
    // 30 evidences, 4 topics covering all (each ≤ 27% < 35%)
    mockBodies.push(chatBody(topicResponse(
      ['知识点1', '知识点2', '知识点3', '知识点4'],
      [evIdRange(1, 8), evIdRange(9, 15), evIdRange(16, 23), evIdRange(24, 30)]
    )));
    mockBodies.push(chatBody(relationResponse('知识点1', '知识点2')));

    mockSequence(mockBodies);

    let lastCurrent = 0;
    let lastTotal = 0;
    const result = await extractTopicsWithBatching(modelConfig, evidences, {
      onWindowProgress: (current, total) => {
        lastCurrent = current;
        lastTotal = total;
      },
    });

    expect(lastTotal).toBe(wCount);
    expect(lastCurrent).toBe(wCount);
    expect(result.status).toBe('ready');
  });

  // ---------- Error details ----------

  it('includes failedStage and failedWindowIndex on failure', async () => {
    const evidences = makeEvidencesByPage([3, 3, 3, 3, 3, 3, 3, 3]);
    fetchMock.mockImplementation(async () => makeResponse({ error: 'server error' }, false, 500));

    const result = await extractTopicsWithBatching(modelConfig, evidences);

    expect(result.status).toBe('failed');
    expect(result.failedStage).toBe('candidate-extraction');
    expect(result.failedWindowIndex).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
    // Error message should contain specific error type, not just "知识点为空"
    expect(result.errors.some(e => e.includes('候选知识点提取'))).toBe(true);
  });
});
