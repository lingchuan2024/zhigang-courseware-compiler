import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTopicNote } from '../model-v2';
import {
  makeTopic,
  makeKnowledgePackage,
  makeMemory,
} from './helpers';
import type {
  ModelConfig,
  KnowledgePackage,
  CourseTopic,
} from '../../types';

// ========== Shared Mock Config ==========

const modelConfig: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

// ========== Mock Fetch Helpers ==========

/**
 * Create a Response-like object with the given body.
 * Matches the shape consumed by callChatCompletion: { ok, status, statusText, json() }.
 */
function makeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  };
}

/**
 * Build a chat completion response body from a JSON-serializable content object.
 * The content object is stringified and placed in choices[0].message.content,
 * simulating a DeepSeek / OpenAI API response.
 */
function chatBody(content: unknown) {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    choices: [{ message: { content: contentStr } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
}

// ========== Mock Data Builders ==========

/**
 * Build a KnowledgePackage whose source.evidenceIds match the given list.
 * This is critical because generateTopicNote uses kp.source.evidenceIds
 * as the knownEvidenceIds set for citation compilation.
 */
function makeKpWithEvidence(
  evidenceIds: string[],
  topicOverrides?: Partial<CourseTopic>
): KnowledgePackage {
  const topic = makeTopic({
    id: 'topic-1',
    title: '测试知识点',
    learningGoal: '掌握测试知识点的核心概念',
    ...topicOverrides,
  });
  return makeKnowledgePackage({
    id: 'kp-1',
    topic,
    source: {
      evidenceIds,
      combinedOriginalText: evidenceIds.map(id => `证据 ${id}`).join('\n'),
      evidence: evidenceIds.map((id, i) => ({
        evidenceId: id,
        pageNumber: i + 1,
        type: 'text',
        originalText: `证据内容 ${id}`,
      })),
    },
  });
}

// ========== Mock Setup ==========

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Suppress console.warn from generateTopicNote's error handling
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Configure the mocked fetch to resolve with a response wrapping the given body. */
function mockFetchResponse(body: unknown) {
  fetchMock.mockResolvedValue(makeResponse(body));
}

// ========== Tests ==========

describe('generateTopicNote', () => {
  // ----------------------------------------------------------------
  // 4. No API key → { note: null, usedModel: false }
  // ----------------------------------------------------------------

  describe('no API key', () => {
    it('returns { note: null, usedModel: false } when config is null', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const result = await generateTopicNote(null, kp, memory, orderedTopics);

      expect(result.note).toBeNull();
      expect(result.usedModel).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns { note: null, usedModel: false } when apiKey is empty string', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];
      const configWithEmptyKey: ModelConfig = {
        endpoint: 'https://api.example.com/v1',
        model: 'test-model',
        apiKey: '',
      };

      const result = await generateTopicNote(configWithEmptyKey, kp, memory, orderedTopics);

      expect(result.note).toBeNull();
      expect(result.usedModel).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 1. Normalization: \[...\] → $$...$$
  // ----------------------------------------------------------------

  describe('markdown normalization', () => {
    it('normalizes \\[...\\] to $$...$$ in the saved contentMarkdown', async () => {
      const kp = makeKpWithEvidence([]);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      // API returns content with \[...\] display math delimiters
      const apiContent = {
        title: '弱对偶定理',
        contentMarkdown:
          '弱对偶定理说明：\n\n' +
          '\\[\n' +
          'c^\\top x \\le b^\\top y\n' +
          '\\]\n\n' +
          '该不等式对任意可行解成立。',
        shortSummary: '弱对偶定理描述了原问题与对偶问题目标值之间的关系。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();
      const md = result.note!.contentMarkdown;

      // The \[...\] should have been converted to $$...$$
      expect(md).toContain('$$');
      expect(md).not.toContain('\\[');
      expect(md).not.toContain('\\]');

      // The formula content should be preserved inside $$ blocks
      expect(md).toContain('c^\\top x \\le b^\\top y');
    });

    it('normalizes \\(...\\) to $...$ for inline math', async () => {
      const kp = makeKpWithEvidence([]);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '似然函数',
        contentMarkdown:
          '似然函数记为 \\(L(\\theta)\\)，表示在参数 $\\theta$ 下观测到数据的概率。',
        shortSummary: '似然函数的定义。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();
      const md = result.note!.contentMarkdown;

      // The \(...\) should have been converted to $...$
      expect(md).toContain('$L(\\theta)$');
      expect(md).not.toContain('\\(');
      expect(md).not.toContain('\\)');
    });
  });

  // ----------------------------------------------------------------
  // 2. Citation compilation: [[evidence:ev-1,ev-2]] → [cite-N]
  // ----------------------------------------------------------------

  describe('citation compilation', () => {
    it('compiles [[evidence:ev-1,ev-2]] to [cite-1] markers', async () => {
      const kp = makeKpWithEvidence(['ev-1', 'ev-2']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '最大似然估计',
        contentMarkdown:
          '最大似然估计通过最大化似然函数来估计参数。\n\n' +
          '似然函数定义为 $L(\\theta)=\\prod_{i=1}^{n}p(x_i\\mid\\theta)$。[[evidence:ev-1,ev-2]]',
        shortSummary: 'MLE通过最大化似然函数估计参数。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();
      const md = result.note!.contentMarkdown;

      // The [[evidence:ev-1,ev-2]] placeholder should be replaced with [cite-1]
      expect(md).toContain('[cite-1]');
      expect(md).not.toContain('[[evidence:');

      // The citations array should have exactly one entry
      expect(result.note!.citations).toHaveLength(1);
      expect(result.note!.citations[0].marker).toBe('cite-1');
      expect(result.note!.citations[0].evidenceIds).toEqual(
        expect.arrayContaining(['ev-1', 'ev-2'])
      );
    });

    it('assigns the same [cite-N] marker to identical evidence groups', async () => {
      const kp = makeKpWithEvidence(['ev-1', 'ev-2']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      // Two placeholders with the same evidence group → same marker
      const apiContent = {
        title: '重复引用测试',
        contentMarkdown:
          '第一处引用。[[evidence:ev-1,ev-2]]\n\n' +
          '第二处引用相同的证据组。[[evidence:ev-2,ev-1]]',
        shortSummary: '测试相同证据组的引用去重。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      const md = result.note!.contentMarkdown;

      // Both placeholders should be replaced with [cite-1] (same group)
      const citeMatches = md.match(/\[cite-\d+\]/g);
      expect(citeMatches).not.toBeNull();
      expect(citeMatches!).toHaveLength(2);
      expect(citeMatches!).toEqual(['[cite-1]', '[cite-1]']);

      // Only one citation entry in the array (deduplicated)
      expect(result.note!.citations).toHaveLength(1);
    });

    it('assigns different [cite-N] markers to different evidence groups', async () => {
      const kp = makeKpWithEvidence(['ev-1', 'ev-2', 'ev-3']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '多引用测试',
        contentMarkdown:
          '第一处引用。[[evidence:ev-1]]\n\n' +
          '第二处引用。[[evidence:ev-2,ev-3]]',
        shortSummary: '测试不同证据组的引用编号。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      const md = result.note!.contentMarkdown;

      expect(md).toContain('[cite-1]');
      expect(md).toContain('[cite-2]');
      expect(result.note!.citations).toHaveLength(2);
    });

    it('produces warnings for unknown evidence IDs', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '未知证据测试',
        contentMarkdown:
          '已知引用 [[evidence:ev-1]] 和未知引用 [[evidence:ev-999]]。',
        shortSummary: '测试未知证据ID的警告。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      const warnings = result.note!.warnings;

      // Should warn about the unknown evidence ID
      expect(warnings.some(w => w.includes('ev-999'))).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // 3. Warnings merging from all sources
  // ----------------------------------------------------------------

  describe('warnings merging', () => {
    it('merges warnings from normalization, citation compilation, and validation', async () => {
      // kp.source.evidenceIds includes ev-1 and ev-2, but NOT ev-unknown
      const kp = makeKpWithEvidence(['ev-1', 'ev-2']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '警告合并测试',
        contentMarkdown:
          // Unmatched \( → normalization warning
          '某些内容 \\( 未闭合的行内公式\n\n' +
          // Valid evidence placeholder → compiled to [cite-1]
          '这是一个有效声明 [[evidence:ev-1,ev-2]]。\n\n' +
          // Literal [cite-99] not in citations → validation warning
          '这里有个无效引用 [cite-99]。\n\n' +
          // Unknown evidence ID → citation compilation warning
          '还有一个未知证据 [[evidence:ev-unknown]]。',
        shortSummary: '警告合并测试摘要。',
        // API-level warning
        warnings: ['API返回的警告'],
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();

      const warnings = result.note!.warnings;

      // 1. From API response (data.warnings)
      expect(warnings.some(w => w.includes('API返回的警告'))).toBe(true);

      // 2. From normalization: unmatched \( or \)
      expect(
        warnings.some(w => w.includes('未闭合') && w.includes('\\('))
      ).toBe(true);

      // 3. From citation compilation: unknown evidence ID
      expect(
        warnings.some(w => w.includes('未知的 Evidence ID') && w.includes('ev-unknown'))
      ).toBe(true);

      // 4. From validation: citation marker not in citations array
      expect(
        warnings.some(w => w.includes('不在引用列表中') && w.includes('cite-99'))
      ).toBe(true);
    });

    it('includes normalization warnings about unmatched $$ blocks', async () => {
      const kp = makeKpWithEvidence([]);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      // Content with an odd number of $$ (unmatched display math)
      const apiContent = {
        title: '未闭合公式测试',
        contentMarkdown: '一段公式 $$ E = mc^2 没有闭合。',
        shortSummary: '测试未闭合公式的警告。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      const warnings = result.note!.warnings;

      // Normalization should warn about unmatched $$
      expect(warnings.some(w => w.includes('$$'))).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // 5. Regression fixture: \[...\] + [[evidence:ev-2,ev-3,ev-4,ev-5]]
  // ----------------------------------------------------------------

  describe('regression fixture', () => {
    it('normalizes \\[...\\] to $$...$$ and compiles [[evidence:ev-2,ev-3,ev-4,ev-5]] to a single [cite-N]', async () => {
      const kp = makeKpWithEvidence(['ev-2', 'ev-3', 'ev-4', 'ev-5']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      // Simulate a realistic DeepSeek API response that uses \[...\] delimiters
      // and a multi-evidence citation placeholder
      const apiContent = {
        title: '弱对偶定理',
        contentMarkdown:
          '弱对偶定理说明：\n\n' +
          '\\[\n' +
          'c^\\top x \\le b^\\top y\n' +
          '\\]\n\n' +
          '该不等式对任意可行解成立。[[evidence:ev-2,ev-3,ev-4,ev-5]]',
        shortSummary: '弱对偶定理给出了原问题最优值的上界。',
        terminologyUpdates: { '弱对偶定理': '描述线性规划中原问题与对偶问题目标值关系的不等式' },
        symbolUpdates: { 'c^\\top x': '原问题的目标函数值', 'b^\\top y': '对偶问题的目标函数值' },
        continuityMemory: '下一个知识点将讨论强对偶定理。',
        warnings: [],
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(
        modelConfig,
        kp,
        memory,
        orderedTopics,
        undefined,
        '线性规划课程'
      );

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();

      const note = result.note!;
      const md = note.contentMarkdown;

      // --- Normalization: \[...\] → $$...$$ ---
      expect(md).toContain('$$');
      expect(md).not.toContain('\\[');
      expect(md).not.toContain('\\]');
      // The formula content is preserved inside $$ blocks
      expect(md).toContain('c^\\top x \\le b^\\top y');

      // --- Citation compilation: single [cite-N] marker ---
      const citeMatches = md.match(/\[cite-\d+\]/g);
      expect(citeMatches).not.toBeNull();
      expect(citeMatches!).toHaveLength(1);
      expect(citeMatches![0]).toBe('[cite-1]');

      // No raw evidence placeholders should remain
      expect(md).not.toContain('[[evidence:');

      // --- Citations array ---
      expect(note.citations).toHaveLength(1);
      expect(note.citations[0].marker).toBe('cite-1');
      expect(note.citations[0].evidenceIds).toEqual(
        expect.arrayContaining(['ev-2', 'ev-3', 'ev-4', 'ev-5'])
      );
      expect(note.citations[0].evidenceIds).toHaveLength(4);

      // --- Metadata passthrough ---
      expect(note.title).toBe('弱对偶定理');
      expect(note.topicId).toBe('topic-1');
      expect(note.terminologyUpdates).toEqual({
        '弱对偶定理': '描述线性规划中原问题与对偶问题目标值关系的不等式',
      });
      expect(note.symbolUpdates).toEqual({
        'c^\\top x': '原问题的目标函数值',
        'b^\\top y': '对偶问题的目标函数值',
      });
      expect(note.continuityMemory).toBe('下一个知识点将讨论强对偶定理。');
    });
  });

  // ----------------------------------------------------------------
  // Additional behaviors
  // ----------------------------------------------------------------

  describe('additional behaviors', () => {
    it('uses the API-provided title when available', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: 'API提供的标题',
        contentMarkdown: '内容正文。[[evidence:ev-1]]',
        shortSummary: '摘要',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      expect(result.note!.title).toBe('API提供的标题');
    });

    it('falls back to topic title when API does not provide one', async () => {
      const kp = makeKpWithEvidence(['ev-1'], { title: '主题标题' });
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        // No title field
        contentMarkdown: '内容正文。[[evidence:ev-1]]',
        shortSummary: '摘要',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      expect(result.note!.title).toBe('主题标题');
    });

    it('falls back to topic learningGoal when API does not provide shortSummary', async () => {
      const kp = makeKpWithEvidence(['ev-1'], { learningGoal: '掌握核心概念' });
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '测试',
        contentMarkdown: '内容正文。[[evidence:ev-1]]',
        // No shortSummary field
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).not.toBeNull();
      expect(result.note!.shortSummary).toBe('掌握核心概念');
    });

    it('returns { note: null, usedModel: false } on fetch network error', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      fetchMock.mockRejectedValue(new Error('Network error'));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).toBeNull();
      expect(result.usedModel).toBe(false);
    });

    it('returns { note: null, usedModel: false } on non-ok HTTP response', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      fetchMock.mockResolvedValue(makeResponse({}, false, 500));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).toBeNull();
      expect(result.usedModel).toBe(false);
    });

    it('returns { note: null, usedModel: false } when API returns empty contentMarkdown', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory();
      const orderedTopics: CourseTopic[] = [kp.topic];

      const apiContent = {
        title: '空内容',
        contentMarkdown: '',
        shortSummary: '摘要',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(modelConfig, kp, memory, orderedTopics);

      expect(result.note).toBeNull();
      expect(result.usedModel).toBe(false);
    });

    it('passes previousNoteSummary and courseName through to prompt builder without error', async () => {
      const kp = makeKpWithEvidence(['ev-1']);
      const memory = makeMemory({
        terminology: {
          'MLE': {
            preferredName: '最大似然估计',
            aliases: ['MLE'],
            introducedByTopicId: 'topic-0',
          },
        },
        symbols: {
          '\\theta': {
            meaning: '模型参数',
            introducedByTopicId: 'topic-0',
            sourceEvidenceIds: ['ev-0'],
          },
        },
        generatedTopicSummaries: { 'topic-0': '前置知识点摘要' },
      });
      const orderedTopics: CourseTopic[] = [
        makeTopic({ id: 'topic-0', title: '前置知识', originalOrder: 0 }),
        kp.topic,
      ];

      const apiContent = {
        title: '当前知识点',
        contentMarkdown: '正文内容。[[evidence:ev-1]]',
        shortSummary: '当前知识点摘要。',
      };
      mockFetchResponse(chatBody(apiContent));

      const result = await generateTopicNote(
        modelConfig,
        kp,
        memory,
        orderedTopics,
        '上一节我们学习了MLE的基本概念。',
        '统计学习课程'
      );

      expect(result.usedModel).toBe(true);
      expect(result.note).not.toBeNull();
      expect(result.note!.title).toBe('当前知识点');

      // Verify fetch was called exactly once
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Verify the request used the correct endpoint and auth header
      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.example.com/v1/chat/completions');
      const options = callArgs[1];
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      expect(options.headers['Content-Type']).toBe('application/json');
    });
  });
});
