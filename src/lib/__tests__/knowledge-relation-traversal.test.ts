import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeTopic, ModelConfig, TeachingBlock } from '../../types';
import { extractTeachingRelationGraph, extractTopicRelationGraph } from '../knowledge-relation-traversal';

const config: ModelConfig = {
  apiKey: 'test-key', model: 'deepseek-chat', endpoint: 'https://example.test',
};

const topics: KnowledgeTopic[] = [
  {
    id: 't-mle', courseId: 'course', name: '最大似然估计', aliases: [], summary: '参数估计方法', learningObjective: '理解 MLE',
    sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 2, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
  },
  {
    id: 't-glm', courseId: 'course', name: 'GLM', aliases: ['广义线性模型'], summary: '指数族与链接函数', learningObjective: '理解 GLM',
    sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
  },
];

function response(data: unknown): Response {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('knowledge relation traversal', () => {
  it('traverses the completed first-layer catalog and filters invented topic ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ relations: [
      { sourceTopicId: 't-mle', targetTopicId: 't-glm', type: 'helpful_before', reason: 'GLM 常用似然估计', confidence: 0.91 },
      { sourceTopicId: 'invented', targetTopicId: 't-glm', type: 'part_of', reason: '幻觉', confidence: 1 },
    ] })));

    const relations = await extractTopicRelationGraph(config, topics);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ sourceTopicId: 't-mle', targetTopicId: 't-glm', type: 'helpful_before' });
  });

  it('traverses free-form second-layer nodes and keeps a domain-specific relation', async () => {
    const blocks: TeachingBlock[] = [
      { id: 'b-family', topicId: 't-glm', type: 'knowledge_family', category: '广义线性族', title: '哪些分布属于广义线性族', sourceRanges: [], summary: '分布族边界', importance: 'required', confidence: 0.9 },
      { id: 'b-formula', topicId: 't-glm', type: 'formula_system', category: 'GLM 公式', title: 'GLM 的三部分公式', sourceRanges: [], summary: '随机、系统、链接部分', importance: 'required', confidence: 0.9 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ relations: [
      { sourceBlockId: 'b-family', targetBlockId: 'b-formula', type: 'scopes', reason: '分布族限定公式的适用范围', confidence: 0.87 },
    ] })));

    const relations = await extractTeachingRelationGraph(config, topics[1], blocks);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ topicId: 't-glm', sourceBlockId: 'b-family', targetBlockId: 'b-formula', type: 'scopes' });
  });
});
