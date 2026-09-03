import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';

const mocks = vi.hoisted(() => ({ compileCourseStructure: vi.fn() }));
vi.mock('../course-structure/compiler', () => ({ compileCourseStructure: mocks.compileCourseStructure }));

import { runKnowledgePipeline } from '../knowledge-pipeline-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1', model: 'test-model', apiKey: 'key',
};

beforeEach(() => vi.clearAllMocks());

describe('compiler failure error surfacing', () => {
  it('exposes a compiler 401 with an actionable API-key hint', async () => {
    mocks.compileCourseStructure.mockRejectedValueOnce(new Error('模型服务返回 401（Unauthorized）'));
    const result = await runKnowledgePipeline(config, [{ markdown: '# 课件', title: '课件' }], 'course-1');

    expect(result.status).toBe('failed');
    expect(result.errors.join('\n')).toContain('401');
    expect(result.errors.join('\n')).toContain('API Key 无效或被服务端拒绝');
  });

  it('surfaces a generic compiler failure without inventing a window error', async () => {
    mocks.compileCourseStructure.mockRejectedValueOnce(new Error('模型超时'));
    const result = await runKnowledgePipeline(config, [{ markdown: '# 课件', title: '课件' }], 'course-1');

    expect(result.status).toBe('failed');
    expect(result.errors).toEqual(['课程结构编译失败：模型超时']);
  });
});
