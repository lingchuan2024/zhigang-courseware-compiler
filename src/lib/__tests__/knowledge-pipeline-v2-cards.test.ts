import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';

const mocks = vi.hoisted(() => ({
  callChatCompletion: vi.fn(),
}));

vi.mock('../model-v2', () => ({
  callChatCompletion: mocks.callChatCompletion,
}));

vi.mock('../topic-extraction-v2', () => ({
  extractCandidatesFromAllWindows: vi.fn(async () => ({
    analyses: [{
      windowId: 'window-1',
      candidateTopics: [{
        temporaryId: 'candidate-1',
        name: '广义线性模型',
        aliases: ['GLM'],
        sourceBlockIds: ['block-1'],
        scopeDescription: 'GLM 内容',
        learningObjective: '理解 GLM',
        confidence: 0.9,
      }],
      topicTransitions: [],
      unresolvedReferences: [],
      confidence: 0.9,
    }],
    windowCount: 1,
    failedWindows: [],
  })),
}));

vi.mock('../topic-reconciliation', () => ({
  reconcileTopics: vi.fn(async () => ({
    topics: [{
      id: 'topic-1',
      courseId: 'course-1',
      name: '广义线性模型',
      aliases: ['GLM'],
      summary: '统一描述一类模型',
      learningObjective: '理解 GLM',
      sourceRanges: [{ documentId: 'document-1', startBlockId: 'block-1', endBlockId: 'block-1' }],
      childTopicIds: [],
      importance: 'core',
      difficulty: 3,
      knowledgeGenre: 'concept',
      confidence: 0.9,
      status: 'generated',
    }],
    relations: [],
    mergeWarnings: [],
  })),
}));

vi.mock('../knowledge-relation-traversal', () => ({
  extractTopicRelationGraph: vi.fn(async () => []),
  extractTeachingRelationGraph: vi.fn(async () => []),
}));

vi.mock('../teaching-structure', () => ({
  extractTeachingStructureForAllTopics: vi.fn(async () => ({
    allTeachingBlocks: [{
      id: 'teaching-1',
      topicId: 'topic-1',
      type: 'formula-system',
      category: 'GLM 公式',
      title: 'GLM 公式',
      sourceRanges: [{ documentId: 'document-1', startBlockId: 'block-1', endBlockId: 'block-1' }],
      summary: 'GLM 公式结构',
      importance: 'required',
      confidence: 0.9,
    }],
    allTeachingRelations: [],
    narrativePaths: {
      'topic-1': { topicId: 'topic-1', orderedTeachingBlockIds: ['teaching-1'], rationale: '先讲公式结构' },
    },
  })),
}));

import { runKnowledgePipeline } from '../knowledge-pipeline-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

describe('knowledge pipeline V2 card boundary', () => {
  beforeEach(() => {
    mocks.callChatCompletion.mockReset();
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        conciseSummary: 'GLM 用随机成分、系统成分和连接函数统一描述一类模型。',
        detailedNote: '## 核心解释\n\nGLM 将分布假设、线性预测子和连接函数组合为统一建模框架。步骤 1：先明确响应变量所属的指数分布族与条件均值。步骤 2：再选择连接函数，把条件均值映射到线性预测子。这样既保留概率分布假设，也能使用线性参数解释输入影响。使用时必须同时说明分布族与连接函数，不能只写一个线性公式。\n\n## 理解检查\n\n说明三部分各自的作用。',
        keyPoints: ['随机成分', '系统成分', '连接函数'],
        applicableConditions: ['响应变量属于指数分布族'],
        examples: ['逻辑回归是二项分布与 logit 连接的组合'],
        misconceptions: ['GLM 不等于普通线性回归'],
        selfCheckQuestions: ['GLM 的三部分分别是什么？'],
      },
      usage: {},
    });
  });

  it('finishes structure extraction after cards without generating notes', async () => {
    const statuses: string[] = [];

    const result = await runKnowledgePipeline(
      config,
      [{ markdown: '# 广义线性模型\n\nGLM 公式结构', title: '测试课件' }],
      'course-1',
      { onStatusChange: status => statuses.push(status) },
    );

    expect(result.status).toBe('ready');
    expect(result.knowledgeCards).toHaveLength(1);
    expect(result.knowledgeCards[0].detailedNote).toContain('## 核心解释');
    expect(result.knowledgeCards[0].keyPoints).toEqual(['随机成分', '系统成分', '连接函数']);
    expect(result.knowledgeCards[0].status).toBe('completed');
    expect(mocks.callChatCompletion).toHaveBeenCalledOnce();
    expect(result.topicNotes).toEqual([]);
    expect(statuses).toContain('card-generation');
    expect(statuses).not.toContain('note-generation');
  });

  it('normalizes fenced AI markdown and LaTeX delimiters before persisting a card', async () => {
    mocks.callChatCompletion.mockResolvedValueOnce({
      data: {
        conciseSummary: 'GLM 公式说明。',
        detailedNote: '```markdown\n## 公式说明\n\n步骤 1：令 $\\mu=\\mathbb E[Y\\mid X=x]$ 表示响应变量的条件均值，并先根据课件确定响应变量所属的分布族。\n\n步骤 2：使用连接函数把条件均值映射到线性预测子，从而得到\n\n\\[\ng(\\mu)=x^\\top\\beta\n\\]\n\n这个公式只有在分布族、连接函数和线性预测子的符号含义都已经确定时才可使用。\n```',
        keyPoints: [],
        applicableConditions: [],
        examples: [],
        misconceptions: [],
        selfCheckQuestions: [],
      },
      usage: {},
    });

    const result = await runKnowledgePipeline(
      config,
      [{ markdown: '# 广义线性模型\n\nGLM 公式结构', title: '测试课件' }],
      'course-1',
    );

    expect(result.knowledgeCards[0].detailedNote).not.toContain('```markdown');
    expect(result.knowledgeCards[0].detailedNote).toContain('$$\ng(\\mu)=x^\\top\\beta\n$$');
  });

  it('closes an unfinished display-math block before persisting a card', async () => {
    mocks.callChatCompletion.mockResolvedValueOnce({
      data: {
        conciseSummary: 'GLM 公式说明。',
        detailedNote: '## 公式说明\n\n步骤 1：令 $\\mu=\\mathbb E[Y\\mid X=x]$ 表示响应变量的条件均值，并先根据课件确定响应变量所属的分布族。\n\n步骤 2：使用连接函数把条件均值映射到线性预测子；这一步要求连接函数与响应变量的取值范围相容。\n\n最终得到下面的公式，使用时还必须说明参数 $\\beta$ 与特征向量 $x$ 的维度。\n\n$$\ng(\\mu)=x^\\top\\beta',
        keyPoints: [],
        applicableConditions: [],
        examples: [],
        misconceptions: [],
        selfCheckQuestions: [],
      },
      usage: {},
    });

    const result = await runKnowledgePipeline(
      config,
      [{ markdown: '# 广义线性模型\n\nGLM 公式结构', title: '测试课件' }],
      'course-1',
    );

    expect(result.knowledgeCards[0].detailedNote).toContain('$$\ng(\\mu)=x^\\top\\beta\n$$');
  });

  it('retries a shallow card with controlled context and type-specific guidance', async () => {
    mocks.callChatCompletion
      .mockResolvedValueOnce({
        data: {
          conciseSummary: 'GLM 公式概览。',
          detailedNote: '公式可能包含模型的主要关系，可以从多个方面进行介绍。',
        },
        usage: {},
      })
      .mockResolvedValueOnce({
        data: {
          conciseSummary: 'GLM 通过连接函数把条件均值与线性预测子联系起来。',
          detailedNote: [
            '## 公式结构',
            '',
            '课件给出连接函数 $g$、条件均值 $\\mu$ 与线性预测子 $x^\\top\\beta$ 的关系。',
            '',
            '步骤 1：先从 $\\mu=\\mathbb E[Y\\mid X=x]$ 明确响应变量的条件均值。',
            '',
            '步骤 2：再使用连接函数得到 $g(\\mu)=x^\\top\\beta$，把均值映射到线性预测子所在空间。',
            '',
            '该表示成立的前提是响应变量分布和连接函数已经确定；更换连接函数会改变模型解释。',
          ].join('\n'),
          keyPoints: ['条件均值', '连接函数', '线性预测子'],
          applicableConditions: ['分布族与连接函数已经确定'],
          examples: ['逻辑回归使用 logit 连接'],
          misconceptions: ['GLM 不要求响应变量服从正态分布'],
          selfCheckQuestions: ['连接函数连接了哪两个量？'],
        },
        usage: {},
      });

    const result = await runKnowledgePipeline(
      config,
      [{ markdown: '# 广义线性模型\n\nGLM 公式结构', title: '测试课件' }],
      'course-1',
    );

    expect(mocks.callChatCompletion).toHaveBeenCalledTimes(2);
    const firstPrompt = mocks.callChatCompletion.mock.calls[0][1];
    const repairPrompt = mocks.callChatCompletion.mock.calls[1][1];
    expect(firstPrompt.system).toContain('知识卡片必须是可独立学习');
    expect(firstPrompt.system).toContain('对比类');
    expect(firstPrompt.system).toContain('AI 教学补充');
    expect(firstPrompt.dynamicInput).toContain('同级二级知识目录');
    expect(firstPrompt.dynamicInput).toContain('一跳关系');
    expect(repairPrompt.dynamicInput).toContain('上一次结果未通过质量检查');
    expect(result.knowledgeCards[0]).toMatchObject({ status: 'completed', cardVersion: 1 });
    expect(result.knowledgeCards[0].detailedNote).toContain('步骤 2');
  });
});
