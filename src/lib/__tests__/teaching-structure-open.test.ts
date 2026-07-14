import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeTopic, MarkdownBlock, ModelConfig } from '../../types';
import { extractTeachingStructure } from '../teaching-structure';

const config: ModelConfig = { apiKey: 'test-key', model: 'deepseek-chat', endpoint: 'https://example.test' };
const topic: KnowledgeTopic = {
  id: 't-glm', courseId: 'course', name: 'GLM', aliases: ['广义线性模型'], summary: '概括', learningObjective: '理解 GLM',
  sourceRanges: [{ documentId: 'doc', startBlockId: 'blk', endBlockId: 'blk' }], childTopicIds: [],
  importance: 'core', difficulty: 3, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
};
const source: MarkdownBlock = { id: 'blk', documentId: 'doc', type: 'paragraph', content: 'GLM 包含随机成分、系统成分和链接函数。', headingPath: ['GLM'], orderIndex: 0, contentHash: 'hash' };

afterEach(() => vi.unstubAllGlobals());

describe('open second-layer extraction', () => {
  it('accepts an AI-defined subtopic category outside the old nineteen teaching roles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          blocks: [{ type: 'knowledge_family', category: '广义线性族', title: '哪些分布属于 GLM', blockIds: ['blk'], summary: '伯努利、泊松、高斯等分布的统一表达', importance: 'required', confidence: 0.92 }],
          relations: [], narrativeOrder: [0], narrativeRationale: '先明确范围',
        }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    }));

    const result = await extractTeachingStructure(config, topic, [source]);

    expect(result.blocks[0]).toMatchObject({ type: 'knowledge_family', category: '广义线性族', title: '哪些分布属于 GLM' });
  });
});
