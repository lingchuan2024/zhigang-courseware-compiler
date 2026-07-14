import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';

const mocks = vi.hoisted(() => ({
  generateAllNotes: vi.fn(),
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

vi.mock('../note-generator-v2', () => ({
  generateAllNotes: mocks.generateAllNotes,
}));

import { runKnowledgePipeline } from '../knowledge-pipeline-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'test-key',
};

describe('knowledge pipeline V2 card boundary', () => {
  beforeEach(() => {
    mocks.generateAllNotes.mockReset();
    mocks.generateAllNotes.mockResolvedValue([{ topicId: 'topic-1', markdown: '# 不应生成', sectionBindings: [], glossaryUpdates: [], formulaUpdates: [], version: 1 }]);
    mocks.callChatCompletion.mockReset();
    mocks.callChatCompletion.mockResolvedValue({
      data: {
        conciseSummary: 'GLM 用随机成分、系统成分和连接函数统一描述一类模型。',
        detailedNote: '## 核心解释\n\nGLM 将分布假设、线性预测子和连接函数组合为统一建模框架。\n\n## 理解检查\n\n说明三部分各自的作用。',
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
    expect(mocks.generateAllNotes).not.toHaveBeenCalled();
  });
});
