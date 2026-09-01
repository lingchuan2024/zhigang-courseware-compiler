import { describe, expect, it } from 'vitest';
import type { ModelConfig, SourceDocument } from '../../../types';
import { ExtractionError } from '../../extraction-errors';
import { compileCourseStructure } from '../compiler';
import { buildSectionBatches } from '../section-batching';
import type {
  CourseExtractionProgress,
  CourseExtractionUnitCheckpoint,
  SectionCompilation,
} from '../types';

const config: ModelConfig = { endpoint: 'x', model: 'm', apiKey: 'k' };

function document(id: string, content: string): SourceDocument {
  return {
    id,
    courseId: 'course-1',
    title: id,
    markdown: content,
    blocks: [{
      id: `${id}-b1`, documentId: id, type: 'paragraph', content,
      headingPath: [id], orderIndex: 0, contentHash: `${id}-h1`,
    }],
    outline: [],
    contentHash: `${id}-hash`,
    createdAt: '',
    updatedAt: '',
  };
}

function multiBlockDocument(id: string, blockCount: number): SourceDocument {
  const blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: `${id}-b${index + 1}`,
    documentId: id,
    type: 'paragraph' as const,
    content: `知识片段 ${index + 1}`,
    headingPath: [id],
    orderIndex: index,
    contentHash: `${id}-h${index + 1}`,
  }));
  return {
    id,
    courseId: 'course-1',
    title: id,
    markdown: blocks.map(block => block.content).join('\n'),
    blocks,
    outline: [],
    contentHash: `${id}-hash`,
    createdAt: '',
    updatedAt: '',
  };
}

function compilationForBatch(batch: ReturnType<typeof buildSectionBatches>[number]): SectionCompilation {
  const evidence = {
    blockId: batch.blocks[0].id,
    quote: batch.blocks[0].content,
    role: 'definition' as const,
  };
  return {
    batchId: batch.id,
    sectionIds: batch.sectionIds,
    topicMentions: [{
      localId: `${batch.id}:topic`,
      name: `知识点 ${batch.blocks[0].id}`,
      aliases: [],
      learningObjective: '理解知识片段',
      scope: '测试',
      genre: 'concept',
      difficulty: 1,
      importance: 'core',
      evidence: [evidence],
      confidence: 0.9,
    }],
    teachingUnits: [],
    orderClaims: [],
    unresolvedReferences: [],
    confidence: 0.9,
  };
}

describe('course structure compiler integration', () => {
  it('compiles two document-safe batches without adding calls per topic', async () => {
    const documents = [
      document('d1', '似然函数用于最大似然估计。'),
      document('d2', '对数似然便于优化计算。'),
    ];
    const seenDocumentIds: string[] = [];
    let batchCallCount = 0;
    const result = await compileCourseStructure(config, documents, 'course-1', {
      compileBatch: async batch => {
        batchCallCount += 1;
        seenDocumentIds.push(batch.documentId);
        const shared = { blockId: batch.blocks[0].id, quote: batch.blocks[0].content, role: 'definition' as const };
        const compilation: SectionCompilation = batch.documentId === 'd1'
          ? {
            batchId: batch.id,
            sectionIds: batch.sectionIds,
            topicMentions: [
              { localId: `${batch.id}:likelihood`, name: '似然函数', aliases: [], learningObjective: '解释似然函数', scope: '参数估计', genre: 'concept', difficulty: 1, importance: 'core', evidence: [shared], confidence: 0.9 },
              { localId: `${batch.id}:mle`, name: '最大似然估计', aliases: ['MLE'], learningObjective: '使用最大似然估计', scope: '参数估计', genre: 'algorithm', difficulty: 2, importance: 'core', evidence: [shared], confidence: 0.9 },
            ],
            teachingUnits: [
              { localId: `${batch.id}:u1`, topicLocalId: `${batch.id}:likelihood`, role: 'definition', title: '似然函数定义', summary: '似然函数', evidence: [shared], required: true, confidence: 0.9 },
              { localId: `${batch.id}:u2`, topicLocalId: `${batch.id}:mle`, role: 'procedure_step', title: '最大化', summary: '最大化似然', evidence: [shared], required: true, confidence: 0.9 },
            ],
            orderClaims: [{ beforeTopicLocalId: `${batch.id}:likelihood`, afterTopicLocalId: `${batch.id}:mle`, strength: 'hard', reason: 'MLE 使用似然函数', evidence: [shared], source: 'explicit', confidence: 1 }],
            unresolvedReferences: [],
            confidence: 0.9,
          }
          : {
            batchId: batch.id,
            sectionIds: batch.sectionIds,
            topicMentions: [{ localId: `${batch.id}:log`, name: '对数似然', aliases: [], learningObjective: '解释对数似然', scope: '优化', genre: 'concept', difficulty: 2, importance: 'important', evidence: [shared], confidence: 0.9 }],
            teachingUnits: [{ localId: `${batch.id}:u1`, topicLocalId: `${batch.id}:log`, role: 'definition', title: '对数似然定义', summary: '便于优化', evidence: [shared], required: true, confidence: 0.9 }],
            orderClaims: [],
            unresolvedReferences: [],
            confidence: 0.9,
          };
        return compilation;
      },
      review: async (_model, topics) => {
        const mle = topics.find(topic => topic.name === '最大似然估计')!;
        const log = topics.find(topic => topic.name === '对数似然')!;
        return {
          operations: [],
          constraints: [{ id: 'review-order', beforeTopicId: mle.id, afterTopicId: log.id, strength: 'soft', reason: '先理解估计', evidenceIds: [], source: 'inferred', confidence: 0.8 }],
          warnings: [],
        };
      },
    });

    expect(batchCallCount).toBe(buildSectionBatches(documents).length);
    expect(seenDocumentIds).toEqual(['d1', 'd2']);
    expect(result.topics).toHaveLength(3);
    const sharedEvidenceTopics = result.topics.filter(topic => topic.evidenceIds.some(id => (
      result.evidenceSpans.find(evidence => evidence.id === id)?.blockId === 'd1-b1'
    )));
    expect(sharedEvidenceTopics).toHaveLength(2);
    result.orderConstraints.filter(edge => edge.strength === 'hard').forEach(edge => {
      expect(result.orderedTopicIds.indexOf(edge.beforeTopicId))
        .toBeLessThan(result.orderedTopicIds.indexOf(edge.afterTopicId));
    });
    expect(Object.values(result.teachingPaths).every(path => path.length > 0)).toBe(true);
    expect(result.status).toBe('ready');
  });

  it('reuses every unchanged checkpoint without recompiling a section', async () => {
    const documents = [document('d1', '似然函数用于参数估计。')];
    const compileBatch = async (batch: ReturnType<typeof buildSectionBatches>[number]): Promise<SectionCompilation> => {
      const evidence = { blockId: batch.blocks[0].id, quote: batch.blocks[0].content, role: 'definition' as const };
      return {
        batchId: batch.id,
        sectionIds: batch.sectionIds,
        topicMentions: [{ localId: `${batch.id}:t1`, name: '似然函数', aliases: [], learningObjective: '解释似然函数', scope: '估计', genre: 'concept', difficulty: 1, importance: 'core', evidence: [evidence], confidence: 1 }],
        teachingUnits: [{ localId: `${batch.id}:u1`, topicLocalId: `${batch.id}:t1`, role: 'definition', title: '定义', summary: '似然函数', evidence: [evidence], required: true, confidence: 1 }],
        orderClaims: [], unresolvedReferences: [], confidence: 1,
      };
    };
    const review = async () => ({ operations: [], constraints: [], warnings: [] });
    const first = await compileCourseStructure(config, documents, 'course-1', { compileBatch, review });
    let recompileCalls = 0;
    const second = await compileCourseStructure(config, documents, 'course-1', {
      previous: first,
      compileBatch: async batch => {
        recompileCalls += 1;
        return compileBatch(batch);
      },
      review,
    });
    expect(recompileCalls).toBe(0);
    expect(second.sourceVersion).toBe(first.sourceVersion);
    expect(second.structureVersion).toBe(first.structureVersion);
  });

  it('reports zero completed batches before the first long model request finishes', async () => {
    const progress: Array<[number, number]> = [];
    await compileCourseStructure(config, [document('d1', '似然函数用于参数估计。')], 'course-1', {
      compileBatch: async batch => compilationForBatch(batch),
      review: async () => ({ operations: [], constraints: [], warnings: [] }),
      onBatchProgress: (current, total) => progress.push([current, total]),
    });

    expect(progress).toEqual([[0, 1], [1, 1]]);
  });

  it('emits a durable checkpoint and exact counters after every evidence unit', async () => {
    const checkpoints: CourseExtractionUnitCheckpoint[] = [];
    const progress: CourseExtractionProgress[] = [];
    const documents = [
      document('success', '成功知识片段。'),
      document('failure', '失败知识片段。'),
    ];

    await compileCourseStructure(config, documents, 'course-1', {
      compileBatch: async batch => {
        if (batch.documentId === 'failure') throw new Error('单元失败');
        return compilationForBatch(batch);
      },
      review: async () => ({ operations: [], constraints: [], warnings: [] }),
      onUnitCheckpoint: checkpoint => checkpoints.push(checkpoint),
      onExtractionProgress: event => progress.push(event),
    });

    expect(checkpoints.map(checkpoint => checkpoint.status).sort()).toEqual(['failed', 'succeeded']);
    expect(checkpoints.every(checkpoint => checkpoint.attempts === 1)).toBe(true);
    expect(progress[0]).toMatchObject({
      completedUnits: 0,
      successfulUnits: 0,
      failedUnits: 0,
      totalUnits: 2,
      discoveredTopicMentions: 0,
    });
    expect(progress.at(-1)).toMatchObject({
      completedUnits: 2,
      successfulUnits: 1,
      failedUnits: 1,
      totalUnits: 2,
      discoveredTopicMentions: 1,
    });
  });

  it('resumes from a persisted successful unit without calling the model again', async () => {
    const documents = [document('resume', '可以恢复的知识片段。')];
    let persisted: CourseExtractionUnitCheckpoint | undefined;
    await compileCourseStructure(config, documents, 'course-1', {
      compileBatch: async batch => compilationForBatch(batch),
      review: async () => ({ operations: [], constraints: [], warnings: [] }),
      onUnitCheckpoint: checkpoint => { persisted = checkpoint; },
    });

    let calls = 0;
    const resumed = await compileCourseStructure(config, documents, 'course-1', {
      resumeCheckpoints: persisted ? [persisted] : [],
      compileBatch: async batch => {
        calls += 1;
        return compilationForBatch(batch);
      },
      review: async () => ({ operations: [], constraints: [], warnings: [] }),
    });

    expect(persisted?.status).toBe('succeeded');
    expect(calls).toBe(0);
    expect(resumed.topics).toHaveLength(1);
  });

  it('stops starting new units after the foreground budget and returns a degraded partial structure', async () => {
    const documents = [multiBlockDocument('budget', 4)];
    documents[0].blocks.forEach((block, index) => {
      block.content = `片段${index}${'知'.repeat(994)}`;
    });
    let clock = 0;
    let calls = 0;
    const checkpoints: CourseExtractionUnitCheckpoint[] = [];

    const result = await compileCourseStructure(config, documents, 'course-1', {
      concurrency: 1,
      foregroundBudgetMs: 60_000,
      now: () => clock,
      compileBatch: async batch => {
        calls += 1;
        clock = 60_001;
        return compilationForBatch(batch);
      },
      review: async () => ({ operations: [], constraints: [], warnings: [] }),
      onUnitCheckpoint: checkpoint => checkpoints.push(checkpoint),
    });

    expect(calls).toBe(1);
    expect(checkpoints.filter(checkpoint => checkpoint.status === 'succeeded')).toHaveLength(1);
    expect(checkpoints.filter(checkpoint => checkpoint.status === 'failed')).toHaveLength(3);
    expect(result.topics).toHaveLength(1);
    expect(result.status).toBe('degraded');
    expect(result.validation.issues.some(issue => issue.message.includes('前台处理时限'))).toBe(true);
  });

  it('caps curriculum review by the remaining total foreground budget', async () => {
    let clock = 0;
    let reviewTimeout: number | undefined;
    const result = await compileCourseStructure(config, [document('total', '总时限知识片段。')], 'course-1', {
      now: () => clock,
      totalBudgetMs: 90_000,
      compileBatch: async batch => {
        clock = 75_000;
        return compilationForBatch(batch);
      },
      review: async (_model, _topics, _evidence, timeoutMs) => {
        reviewTimeout = timeoutMs;
        return { operations: [], constraints: [], warnings: [] };
      },
    });

    expect(reviewTimeout).toBe(15_000);
    expect(result.topics).toHaveLength(1);
  });

  it('skips curriculum review when semantic extraction has exhausted the total budget', async () => {
    let clock = 0;
    let reviewCalls = 0;
    const result = await compileCourseStructure(config, [document('exhausted', '耗尽时限的知识片段。')], 'course-1', {
      now: () => clock,
      totalBudgetMs: 90_000,
      compileBatch: async batch => {
        clock = 90_001;
        return compilationForBatch(batch);
      },
      review: async () => {
        reviewCalls += 1;
        return { operations: [], constraints: [], warnings: [] };
      },
    });

    expect(reviewCalls).toBe(0);
    expect(result.topics).toHaveLength(1);
    expect(result.validation.issues.some(issue => issue.message.includes('总处理时限'))).toBe(true);
  });

  it('Agent Plan 单元超时后不递归拆分或重放', async () => {
    const documents = [multiBlockDocument('large', 4)];
    const seenBatchSizes: number[] = [];

    const result = await compileCourseStructure(
      { ...config, apiMode: 'responses' },
      documents,
      'course-1',
      {
        compileBatch: async batch => {
          seenBatchSizes.push(batch.blocks.length);
          throw new ExtractionError('api-timeout', 'section-compile', '模型请求超时');
        },
        review: async () => ({ operations: [], constraints: [], warnings: [] }),
      },
    );

    expect(seenBatchSizes).toEqual([4]);
    expect(result.checkpoints).toHaveLength(0);
    expect(result.validation.issues.some(issue => issue.code === 'FAILED_SECTION_BATCH')).toBe(true);
  });

  it('Agent Plan 单个大块在请求前已按文本边界拆分', async () => {
    const documents = [document('single-large', '知识内容。'.repeat(240))];
    const seenFragments: Array<{ blockId: string; contentLength: number }> = [];

    const result = await compileCourseStructure(
      { ...config, apiMode: 'responses' },
      documents,
      'course-1',
      {
        compileBatch: async batch => {
          seenFragments.push({
            blockId: batch.blocks[0].id,
            contentLength: batch.blocks[0].content.length,
          });
          return compilationForBatch(batch);
        },
        review: async () => ({ operations: [], constraints: [], warnings: [] }),
      },
    );

    expect(seenFragments.length).toBeGreaterThan(1);
    expect(seenFragments.every(fragment => fragment.contentLength <= 1000)).toBe(true);
    expect(new Set(seenFragments.map(fragment => fragment.blockId)))
      .toEqual(new Set(['single-large-b1']));
    expect(result.checkpoints).toHaveLength(seenFragments.length);
    expect(result.validation.issues.some(issue => issue.code === 'FAILED_SECTION_BATCH')).toBe(false);
  });

  it('Agent Plan 初始语义单元限制为约 1000 tokens', async () => {
    const documents = [multiBlockDocument('token-heavy', 4)];
    documents[0].blocks.forEach((block, index) => {
      block.content = `片段${index}${'知'.repeat(994)}`;
    });
    const seenBatchSizes: number[] = [];

    await compileCourseStructure(
      { ...config, apiMode: 'responses' },
      documents,
      'course-1',
      {
        compileBatch: async batch => {
          seenBatchSizes.push(batch.blocks.length);
          return compilationForBatch(batch);
        },
        review: async () => ({ operations: [], constraints: [], warnings: [] }),
      },
    );

    expect(seenBatchSizes).toEqual([1, 1, 1, 1]);
  });

  it('不可再拆的失败批次向界面保留真实错误', async () => {
    const result = await compileCourseStructure(
      { ...config, apiMode: 'responses' },
      [multiBlockDocument('single', 1)],
      'course-1',
      {
        compileBatch: async () => {
          throw new ExtractionError('api-timeout', 'section-compile', '连接模型服务失败：请求超时');
        },
        review: async () => ({ operations: [], constraints: [], warnings: [] }),
      },
    );

    const issue = result.validation.issues.find(item => item.code === 'FAILED_SECTION_BATCH');
    expect(issue?.batchId).toBe('batch_single_0');
    expect(issue?.message).toContain('连接模型服务失败：请求超时');
  });
});
