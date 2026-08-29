import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';

const mocks = vi.hoisted(() => ({
  extractCandidatesFromAllWindows: vi.fn(),
}));

vi.mock('../topic-extraction-v2', () => ({
  extractCandidatesFromAllWindows: mocks.extractCandidatesFromAllWindows,
}));

vi.mock('../model-v2', () => ({
  callChatCompletion: vi.fn(),
}));

vi.mock('../topic-reconciliation', () => ({
  reconcileTopics: vi.fn(),
}));

vi.mock('../knowledge-relation-traversal', () => ({
  extractTopicRelationGraph: vi.fn(async () => []),
  extractTeachingRelationGraph: vi.fn(async () => []),
}));

import { runKnowledgePipeline } from '../knowledge-pipeline-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'key',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('window failure error surfacing', () => {
  it('exposes the real window error (401) instead of a bare empty-candidates message', async () => {
    mocks.extractCandidatesFromAllWindows.mockResolvedValue({
      analyses: [],
      windowCount: 2,
      failedWindows: [0, 1],
      windowErrors: [
        '模型服务返回 401（Unauthorized） — {"error":{"code":"401","message":"Unauthorized"}}',
        '模型服务返回 401（Unauthorized） — {"error":{"code":"401","message":"Unauthorized"}}',
      ],
    });

    const result = await runKnowledgePipeline(config, [{ markdown: '# 课件', title: '课件' }], 'course-1');

    expect(result.status).toBe('failed');
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const joined = result.errors.join('\n');
    expect(joined).toContain('401');
    expect(joined).toContain('API Key 无效或被服务端拒绝');
    expect(joined).not.toContain('候选知识点提取为空（未产生失败窗口');
  });

  it('deduplicates identical window errors and keeps at most three detail lines', async () => {
    const same = '模型服务返回 500（Internal Server Error）';
    mocks.extractCandidatesFromAllWindows.mockResolvedValue({
      analyses: [],
      windowCount: 5,
      failedWindows: [0, 1, 2, 3, 4],
      windowErrors: [same, same, same, same, same],
    });

    const result = await runKnowledgePipeline(config, [{ markdown: '# 课件', title: '课件' }], 'course-1');

    const detailLines = result.errors.filter(line => line.startsWith('候选知识点提取失败'));
    expect(detailLines.length).toBe(1);
    expect(result.errors.join('\n')).not.toContain('API Key 无效');
  });

  it('falls back to the plain empty message when no window errors are collected', async () => {
    mocks.extractCandidatesFromAllWindows.mockResolvedValue({
      analyses: [],
      windowCount: 1,
      failedWindows: [],
      windowErrors: [],
    });

    const result = await runKnowledgePipeline(config, [{ markdown: '# 课件', title: '课件' }], 'course-1');

    expect(result.errors.join('\n')).toContain('候选知识点提取为空');
  });
});
