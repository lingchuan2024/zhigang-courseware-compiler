import { describe, expect, it } from 'vitest';
import {
  PRODUCT_STAGES,
  STAGE_LABELS,
  deriveProductSteps,
  getLatestStage,
  isStageCompleted,
} from '../workflow-navigation';
import type { ProductStateSnapshot } from '../../types';

function state(overrides: Partial<ProductStateSnapshot> = {}): ProductStateSnapshot {
  return {
    document: null,
    evidences: [],
    topics: [],
    knowledgePackages: [],
    sourceDocuments: [],
    knowledgeTopics: [],
    topicNotes: [],
    mineruParseResult: null,
    structureExtractionStatus: 'idle',
    jobStatus: 'idle',
    staleMarker: null,
    ...overrides,
  };
}

describe('visible MinerU workflow', () => {
  it('uses the six user-visible stages in order', () => {
    expect(PRODUCT_STAGES).toEqual(['upload', 'document', 'mineru', 'structure', 'cards', 'notes']);
    expect(STAGE_LABELS.mineru).toBe('MinerU 解析');
    expect(STAGE_LABELS.cards).toBe('知识卡片');
  });

  it('completes MinerU only after Markdown is available', () => {
    const pending = state({
      document: { id: 'doc', title: '课件', fileName: 'course.pdf', pages: [], uploadedAt: 1 },
      mineruParseResult: { status: 'parsing', progress: 48, assets: [] },
    });
    expect(isStageCompleted('mineru', pending)).toBe(false);

    const completed = state({
      ...pending,
      sourceDocuments: [{
        id: 'source', courseId: 'course', title: '课件', markdown: '# 标题',
        blocks: [], outline: [], contentHash: 'hash', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      mineruParseResult: { status: 'completed', progress: 100, markdown: '# 标题', assets: [] },
    });
    expect(isStageCompleted('mineru', completed)).toBe(true);
    expect(getLatestStage(completed)).toBe('mineru');
  });

  it('allows returning to preview and MinerU after knowledge extraction', () => {
    const completed = state({
      document: { id: 'doc', title: '课件', fileName: 'course.pdf', pages: [], uploadedAt: 1 },
      sourceDocuments: [{
        id: 'source', courseId: 'course', title: '课件', markdown: '# 标题',
        blocks: [], outline: [], contentHash: 'hash', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      knowledgeTopics: [{
        id: 'topic', courseId: 'course', name: '主题', aliases: [], summary: '主题摘要', learningObjective: '掌握主题',
        sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 2,
        knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
      }],
      mineruParseResult: { status: 'completed', progress: 100, markdown: '# 标题', assets: [] },
    });
    const steps = deriveProductSteps('structure', completed);
    expect(steps.find(step => step.stage === 'document')?.canClick).toBe(true);
    expect(steps.find(step => step.stage === 'mineru')?.canClick).toBe(true);
  });
});
