import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../types';

const mocks = vi.hoisted(() => ({
  generateAllNotes: vi.fn(),
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
    expect(result.topicNotes).toEqual([]);
    expect(statuses).toContain('card-generation');
    expect(statuses).not.toContain('note-generation');
    expect(mocks.generateAllNotes).not.toHaveBeenCalled();
  });
});
