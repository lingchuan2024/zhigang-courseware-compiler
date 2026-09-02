import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

const mineruMock = vi.hoisted(() => ({
  runMinerUParse: vi.fn(),
}));

vi.mock('../../lib/mineru-client', () => ({
  runMinerUParse: mineruMock.runMinerUParse,
}));

const sourceMock = vi.hoisted(() => ({
  loadDocumentSource: vi.fn(),
}));

vi.mock('../../lib/document-source', () => ({
  loadDocumentSource: sourceMock.loadDocumentSource,
  saveDocumentSource: vi.fn(),
  deleteDocumentSource: vi.fn(),
}));

import { useStore } from '../useStore';
import { createSourceDocument } from '../../lib/markdown-parser';
import { flushPendingSaves } from '../../lib/persistence';
import type { KnowledgeTopic } from '../../types';

const MARKDOWN_V1 = `# 概率模型基础

## 1. 概率模型

概率模型是描述随机现象的数学框架。

## 2. 最大似然估计

似然函数 L(θ) = p(D|θ)
`;

const MARKDOWN_V2_REVISED = MARKDOWN_V1.replace(
  '似然函数 L(θ) = p(D|θ)',
  '似然函数 L(θ) = p(D|θ)，即联合概率密度。',
);

const MARKDOWN_V2_ADDED = `${MARKDOWN_V1}\n\n## 3. 贝叶斯估计\n\n贝叶斯估计结合先验分布与似然函数。\n`;

function buildProject(markdown: string) {
  const doc = createSourceDocument(markdown, 'course-rp', '概率模型基础');
  const ordered = [...doc.blocks].sort((a, b) => a.orderIndex - b.orderIndex);
  const mleHeading = ordered.find(block => block.content.includes('最大似然估计'))!;
  const mleBlock = ordered.find(block => block.content.includes('似然函数'))!;
  const probBlock = ordered.find(block => block.content.includes('随机现象'))!;

  const topics: KnowledgeTopic[] = [
    {
      id: 'topic-prob', courseId: 'course-rp', name: '概率模型', aliases: [], summary: '', learningObjective: '',
      sourceRanges: [{ documentId: doc.id, startBlockId: probBlock.id, endBlockId: probBlock.id }],
      childTopicIds: [], importance: 'core', difficulty: 2, knowledgeGenre: 'concept',
      confidence: 0.9, status: 'generated',
    },
    {
      id: 'topic-mle', courseId: 'course-rp', name: '最大似然估计', aliases: [], summary: '', learningObjective: '',
      sourceRanges: [{ documentId: doc.id, startBlockId: mleHeading.id, endBlockId: mleBlock.id }],
      childTopicIds: [], importance: 'core', difficulty: 2, knowledgeGenre: 'concept',
      confidence: 0.9, status: 'generated',
    },
  ];

  return {
    document: {
      id: 'doc-rp', courseId: 'course-rp', title: '概率模型基础', fileName: 'rp.pdf', fileType: 'pdf' as const,
      sourceKey: 'src-rp', pages: [{ pageNumber: 1, text: markdown }], uploadedAt: 1,
    },
    sourceDocuments: [doc],
    knowledgeTopics: topics,
    knowledgeCards: [
      {
        id: 'card-prob', courseId: 'course-rp', topicId: 'topic-prob', topicName: '概率模型',
        teachingBlockId: 'tb-prob', teachingType: 'definition', title: '概率模型定义',
        conciseSummary: '摘要', detailedNote: '正文',
        sourceRanges: [{ documentId: doc.id, startBlockId: probBlock.id, endBlockId: probBlock.id }],
        keywords: [], aliases: [], prerequisiteTopicIds: [], relatedTopicIds: [],
        confidence: 0.9, reviewStatus: 'generated' as const, status: 'completed' as const, sourceVersion: 1, cardVersion: 1,
      },
      {
        id: 'card-mle', courseId: 'course-rp', topicId: 'topic-mle', topicName: '最大似然估计',
        teachingBlockId: 'tb-mle', teachingType: 'formula', title: '似然函数',
        conciseSummary: '摘要', detailedNote: '正文',
        sourceRanges: [{ documentId: doc.id, startBlockId: mleBlock.id, endBlockId: mleBlock.id }],
        keywords: [], aliases: [], prerequisiteTopicIds: [], relatedTopicIds: [],
        confidence: 0.9, reviewStatus: 'generated' as const, status: 'completed' as const, sourceVersion: 1, cardVersion: 1,
      },
    ],
    chapterPlan: [
      { id: 'chapter-1', title: '概率模型', objective: '', topicIds: ['topic-prob'], framework: [] },
      { id: 'chapter-2', title: '最大似然估计', objective: '', topicIds: ['topic-mle'], framework: [] },
    ],
    chapterNotes: [
      {
        id: 'chapter-1', title: '概率模型', objective: '', topicIds: ['topic-prob'], framework: [],
        markdown: '# 概率模型\n\n完整正文', sourceCardIds: ['card-prob'],
        status: 'completed' as const, retryCount: 0,
      },
      {
        id: 'chapter-2', title: '最大似然估计', objective: '', topicIds: ['topic-mle'], framework: [],
        markdown: '# 最大似然估计\n\n完整正文', sourceCardIds: ['card-mle'],
        status: 'completed' as const, retryCount: 0,
      },
    ],
    courseMasterNote: {
      id: 'master-rp', title: '概率模型基础',
      outline: [
        { id: 'chapter-1', title: '概率模型', objective: '', topicIds: ['topic-prob'], framework: [] },
        { id: 'chapter-2', title: '最大似然估计', objective: '', topicIds: ['topic-mle'], framework: [] },
      ],
      chapters: [
        {
          id: 'chapter-1', title: '概率模型', objective: '', topicIds: ['topic-prob'], framework: [],
          markdown: '# 概率模型\n\n完整正文', sourceCardIds: ['card-prob'],
          status: 'completed' as const, retryCount: 0,
        },
        {
          id: 'chapter-2', title: '最大似然估计', objective: '', topicIds: ['topic-mle'], framework: [],
          markdown: '# 最大似然估计\n\n完整正文', sourceCardIds: ['card-mle'],
          status: 'completed' as const, retryCount: 0,
        },
      ],
      glossary: [], formulaIndex: [],
      markdown: '# 概率模型基础\n\n完整笔记',
      coverage: { totalCardIds: ['card-prob', 'card-mle'], coveredCardIds: ['card-prob', 'card-mle'], missingCardIds: [] },
      status: 'completed' as const, generatedFromStructureVersion: 2,
    },
    knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 2, teachingStructure: 2, ordering: 1, cards: 2, notes: 1, embeddings: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mineruMock.runMinerUParse.mockReset();
  sourceMock.loadDocumentSource.mockReset();
});

describe('MinerU 重解析增量保留', () => {
  it('重新解析后保留未受影响的知识产物，仅把引用变化的主题标记为 stale', async () => {
    const project = buildProject(MARKDOWN_V1);
    useStore.setState({
      ...project,
      stage: 'document',
      job: null,
      jobStatus: 'idle',
      staleMarker: null,
      mineruParseResult: null,
      modelConfig: null,
      mineruConfig: { apiKey: 'mineru-key', endpoint: 'https://mineru.net/api/v4', modelVersion: 'vlm', language: 'chinese', enableFormula: true, enableTable: true },
    });

    sourceMock.loadDocumentSource.mockResolvedValue(new ArrayBuffer(8));
    mineruMock.runMinerUParse.mockResolvedValue({
      batchId: 'batch-2', markdown: MARKDOWN_V2_REVISED, assets: [],
    });

    await useStore.getState().startMinerUParse();
    await flushPendingSaves();

    const state = useStore.getState();
    // 未清空：主题、卡片、章节都还在
    expect(state.knowledgeTopics).toHaveLength(2);
    expect(state.knowledgeCards).toHaveLength(2);

    // 只有 MLE 主题 stale；概率模型主题完好且引用被重映射到新文档
    expect(state.staleMarker?.reason).toBe('source-reparsed');
    expect(state.staleMarker?.affectedTopicIds).toEqual(['topic-mle']);
    expect(state.staleMarker?.summary).toContain('1 个知识点的原文有变化');

    const newDoc = state.sourceDocuments[0];
    expect(newDoc.id).not.toBe(project.sourceDocuments[0].id);

    const probCard = state.knowledgeCards.find(card => card.id === 'card-prob')!;
    expect(probCard.status).toBe('completed');
    expect(probCard.sourceRanges[0].documentId).toBe(newDoc.id);
    expect(newDoc.blocks.some(block => block.id === probCard.sourceRanges[0].startBlockId)).toBe(true);

    const mleCard = state.knowledgeCards.find(card => card.id === 'card-mle')!;
    expect(mleCard.status).toBe('stale');

    // 覆盖 stale 卡片的章节标记为 stale；未受影响章节保留，母笔记降级为 partial
    expect(state.chapterNotes.find(c => c.id === 'chapter-1')?.status).toBe('completed');
    expect(state.chapterNotes.find(c => c.id === 'chapter-2')?.status).toBe('stale');
    expect(state.courseMasterNote?.status).toBe('partial');
  });

  it('内容完全一致的重新解析不产生 stale，产物原样保留', async () => {
    const project = buildProject(MARKDOWN_V1);
    useStore.setState({
      ...project,
      stage: 'document',
      job: null,
      jobStatus: 'idle',
      staleMarker: null,
      mineruParseResult: null,
      modelConfig: null,
      mineruConfig: { apiKey: 'mineru-key', endpoint: 'https://mineru.net/api/v4', modelVersion: 'vlm', language: 'chinese', enableFormula: true, enableTable: true },
    });

    sourceMock.loadDocumentSource.mockResolvedValue(new ArrayBuffer(8));
    mineruMock.runMinerUParse.mockResolvedValue({ markdown: MARKDOWN_V1, assets: [] });

    await useStore.getState().startMinerUParse();

    const state = useStore.getState();
    expect(state.staleMarker).toBeNull();
    expect(state.knowledgeCards.every(card => card.status === 'completed')).toBe(true);
    expect(state.chapterNotes.every(c => c.status === 'completed')).toBe(true);
    expect(state.courseMasterNote?.status).toBe('completed');
    // 版本计数推进（内容来源已更新）
    expect(state.knowledgeBaseVersions.source).toBe(2);
  });

  it('有新增未覆盖内容时把旧完整笔记降级为 partial', async () => {
    const project = buildProject(MARKDOWN_V1);
    useStore.setState({
      ...project,
      stage: 'document', job: null, jobStatus: 'idle', staleMarker: null, mineruParseResult: null,
      modelConfig: null,
      mineruConfig: { apiKey: 'mineru-key', endpoint: 'https://mineru.net/api/v4', modelVersion: 'vlm', language: 'chinese', enableFormula: true, enableTable: true },
    });
    sourceMock.loadDocumentSource.mockResolvedValue(new ArrayBuffer(8));
    mineruMock.runMinerUParse.mockResolvedValue({ markdown: MARKDOWN_V2_ADDED, assets: [] });

    await useStore.getState().startMinerUParse();

    const state = useStore.getState();
    expect(state.staleMarker?.summary).toContain('新增内容块');
    expect(state.courseMasterNote?.status).toBe('partial');
  });
});
