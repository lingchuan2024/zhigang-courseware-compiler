import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig, SourceDocument } from '../../types';
import type { CourseLearningStructure } from '../course-structure/types';

const mocks = vi.hoisted(() => ({
  compileCourseStructure: vi.fn(),
  callChatCompletion: vi.fn(),
}));

vi.mock('../course-structure/compiler', () => ({ compileCourseStructure: mocks.compileCourseStructure }));
vi.mock('../model-v2', () => ({ callChatCompletion: mocks.callChatCompletion }));

import { runKnowledgePipeline } from '../knowledge-pipeline-v2';

const config: ModelConfig = {
  endpoint: 'https://api.example.com/v1', model: 'test-model', apiKey: 'test-key',
};

const sourceDocument: SourceDocument = {
  id: 'document-1', courseId: 'course-1', title: '测试课件', markdown: '# 广义线性模型\n\nGLM 公式结构',
  blocks: [{
    id: 'block-1', documentId: 'document-1', type: 'paragraph', content: 'GLM 公式结构',
    headingPath: ['广义线性模型'], orderIndex: 0, contentHash: 'block-hash',
  }],
  outline: [], contentHash: 'document-hash', createdAt: '', updatedAt: '',
};

const canonical: CourseLearningStructure = {
  courseId: 'course-1', sourceVersion: 3, structureVersion: 4, compilerVersion: 'v1',
  topics: [{
    id: 'topic-1', stableKey: 'topic-1', courseId: 'course-1', name: '广义线性模型', aliases: ['GLM'],
    learningObjective: '理解 GLM', scope: '统一描述一类模型', genre: 'concept', difficulty: 3,
    importance: 'core', evidenceIds: ['evidence-1'], sourceSectionIds: ['section-1'], confidence: 0.9,
    status: 'verified',
  }],
  teachingUnits: [{
    id: 'unit-1', stableKey: 'unit-1', topicId: 'topic-1', role: 'formula', title: 'GLM 公式',
    summary: '随机成分、系统成分和连接函数', evidenceIds: ['evidence-1'], required: true,
    confidence: 0.9, status: 'verified',
  }],
  evidenceSpans: [{
    id: 'evidence-1', stableKey: 'evidence-1', documentId: 'document-1', blockId: 'block-1',
    startOffset: 0, endOffset: 8, quote: 'GLM 公式结构', role: 'formula', contentHash: 'block-hash',
  }],
  orderConstraints: [], orderedTopicIds: ['topic-1'], teachingPaths: { 'topic-1': ['unit-1'] },
  status: 'ready',
  validation: { issues: [], meaningfulBlockCount: 1, coveredMeaningfulBlockCount: 1, coverageRate: 1 },
  checkpoints: [],
};

describe('knowledge pipeline V2 card boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compileCourseStructure.mockResolvedValue(canonical);
  });

  it('projects the canonical structure and creates base cards without model enrichment', async () => {
    const statuses: string[] = [];
    const result = await runKnowledgePipeline(config, [], 'course-1', {
      sourceDocuments: [sourceDocument], onStatusChange: status => statuses.push(status),
    });

    expect(mocks.compileCourseStructure).toHaveBeenCalledWith(
      config, [sourceDocument], 'course-1', expect.objectContaining({ previous: null }),
    );
    expect(result.courseLearningStructure).toBe(canonical);
    expect(result.status).toBe('ready');
    expect(result.knowledgeCards).toHaveLength(1);
    expect(result.knowledgeCards[0]).toMatchObject({
      topicId: 'topic-1', teachingBlockId: 'unit-1',
      conciseSummary: '随机成分、系统成分和连接函数', reviewStatus: 'generated',
    });
    expect(result.topicNotes).toEqual([]);
    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
    expect(statuses).toContain('card-generation');
    expect(statuses).not.toContain('note-generation');
  });

  it('passes the previous canonical structure to enable checkpoint reuse', async () => {
    await runKnowledgePipeline(config, [], 'course-1', {
      sourceDocuments: [sourceDocument], previousStructure: canonical,
    });

    expect(mocks.compileCourseStructure).toHaveBeenCalledWith(
      config, [sourceDocument], 'course-1', expect.objectContaining({ previous: canonical }),
    );
  });
});
