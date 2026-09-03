import { describe, it, expect } from 'vitest';
import {
  PRODUCT_STAGES,
  STAGE_LABELS,
  STAGE_NUMBERS,
  isStageCompleted,
  hasStageData,
  canNavigateToStage,
  deriveProductSteps,
  getLatestStage,
} from '../workflow-navigation';
import type { ProductStateSnapshot } from '../../types';
import type {
  CourseDocument,
  KnowledgeCard,
  KnowledgeTopic,
  CourseMasterNote,
  SourceDocument,
  MinerUParseResult,
} from '../../types';

// ========== 测试辅助函数 ==========

function makeDoc(): CourseDocument {
  return {
    id: 'doc1',
    title: '测试课件',
    fileName: 'test.pdf',
    pages: [],
    uploadedAt: Date.now(),
  };
}

function makeSourceDocument(): SourceDocument {
  return {
    id: 'doc1',
    courseId: 'course-1',
    title: '测试课件',
    markdown: '# 测试课件',
    blocks: [],
    outline: [],
    contentHash: 'hash',
    createdAt: '',
    updatedAt: '',
  };
}

function makeCompletedParse(): MinerUParseResult {
  return {
    status: 'completed',
    progress: 100,
    markdown: '# 测试课件',
    assets: [],
    sourceFileName: 'test.pdf',
    completedAt: Date.now(),
  };
}

function makeKnowledgeTopic(id = 'kt-1'): KnowledgeTopic {
  return {
    id,
    courseId: 'course-1',
    name: '广义线性模型',
    aliases: ['GLM'],
    summary: '统一一类模型',
    learningObjective: '理解 GLM',
    sourceRanges: [],
    childTopicIds: [],
    importance: 'core',
    difficulty: 3,
    knowledgeGenre: 'concept',
    confidence: 0.9,
    status: 'generated',
  };
}

function makeKnowledgeCard(id = 'card-1'): KnowledgeCard {
  return {
    id,
    courseId: 'course-1',
    topicId: 'kt-1',
    topicName: '广义线性模型',
    teachingBlockId: 'tb-1',
    teachingType: 'formula-system',
    title: 'GLM 公式',
    conciseSummary: '公式摘要',
    detailedNote: '公式说明',
    sourceRanges: [],
    keywords: [],
    aliases: [],
    prerequisiteTopicIds: [],
    relatedTopicIds: [],
    confidence: 0.9,
    reviewStatus: 'generated',
    status: 'completed',
    sourceVersion: 1,
    cardVersion: 1,
  };
}

function makeCourseMasterNote(
  markdown = '# 完整笔记',
  structureVersion = 3,
): CourseMasterNote {
  return {
    id: 'master-1',
    title: '测试课程',
    outline: [],
    chapters: [],
    glossary: [],
    formulaIndex: [],
    markdown,
    coverage: { totalCardIds: ['card-1'], coveredCardIds: ['card-1'], missingCardIds: [] },
    status: 'completed',
    generatedFromStructureVersion: structureVersion,
  };
}

function makeState(overrides: Partial<ProductStateSnapshot> = {}): ProductStateSnapshot {
  return {
    document: null,
    structureExtractionStatus: 'idle',
    jobStatus: 'idle',
    staleMarker: null,
    ...overrides,
  };
}

function makeParsedState(overrides: Partial<ProductStateSnapshot> = {}): ProductStateSnapshot {
  return makeState({
    document: makeDoc(),
    sourceDocuments: [makeSourceDocument()],
    mineruParseResult: makeCompletedParse(),
    ...overrides,
  });
}

// ========== 测试用例 ==========

describe('workflow-navigation', () => {
  // ========== 1. 阶段常量 ==========
  describe('PRODUCT_STAGES', () => {
    it('包含正好 6 个阶段', () => {
      expect(PRODUCT_STAGES).toHaveLength(6);
    });

    it('顺序为 upload → document → mineru → structure → cards → notes', () => {
      expect(PRODUCT_STAGES).toEqual(['upload', 'document', 'mineru', 'structure', 'cards', 'notes']);
      expect(STAGE_LABELS.cards).toBe('知识卡片');
      expect(STAGE_LABELS.notes).toBe('完整笔记');
    });

    it('STAGE_LABELS 为每个阶段提供非空标签', () => {
      PRODUCT_STAGES.forEach(stage => {
        expect(STAGE_LABELS[stage]).toBeTruthy();
      });
    });

    it('STAGE_NUMBERS 为每个阶段提供从 1 开始递增的编号', () => {
      PRODUCT_STAGES.forEach((stage, i) => {
        expect(STAGE_NUMBERS[stage]).toBe(i + 1);
      });
    });
  });

  // ========== 2. deriveProductSteps ==========
  describe('deriveProductSteps', () => {
    it('返回 6 个步骤且与常量一致', () => {
      const steps = deriveProductSteps('upload', makeState());
      expect(steps).toHaveLength(6);
      steps.forEach((step, i) => {
        expect(step.stage).toBe(PRODUCT_STAGES[i]);
        expect(step.label).toBe(STAGE_LABELS[step.stage]);
        expect(step.number).toBe(STAGE_NUMBERS[step.stage]);
      });
    });

    it('upload 阶段时第一步 active，其余 pending', () => {
      const steps = deriveProductSteps('upload', makeState());
      expect(steps[0].status).toBe('active');
      expect(steps[0].canClick).toBe(false);
      expect(steps[1].status).toBe('pending');
      expect(steps[3].status).toBe('pending');
    });

    it('document 阶段时 upload 为 completed 且可点击', () => {
      const steps = deriveProductSteps('document', makeState({ document: makeDoc() }));
      expect(steps[0].status).toBe('completed');
      expect(steps[0].canClick).toBe(true);
      expect(steps[1].status).toBe('active');
      expect(steps[1].canClick).toBe(false);
    });

    it('structure 阶段时前三步 completed 且可点击', () => {
      const steps = deriveProductSteps('structure', makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
      }));
      expect(steps[0].status).toBe('completed');
      expect(steps[1].status).toBe('completed');
      expect(steps[2].status).toBe('completed');
      expect(steps[3].status).toBe('active');
      expect(steps[4].status).toBe('pending');
    });

    it('notes 阶段时全部前置步骤 completed 且可点击', () => {
      const steps = deriveProductSteps('notes', makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
        knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 3, teachingStructure: 1, ordering: 1, cards: 1, notes: 1, embeddings: 0 },
        courseMasterNote: makeCourseMasterNote(),
      }));
      for (let i = 0; i < 5; i++) {
        expect(steps[i].status).toBe('completed');
        expect(steps[i].canClick).toBe(true);
      }
      expect(steps[5].status).toBe('active');
    });

    it('查看较早阶段时，已有部分章节的完整笔记仍可点击返回', () => {
      const partial = { ...makeCourseMasterNote('# 已完成章节'), status: 'partial' as const };
      const steps = deriveProductSteps('cards', makeParsedState({
        knowledgeCards: [makeKnowledgeCard()],
        courseMasterNote: partial,
      }));
      const notes = steps.find(step => step.stage === 'notes')!;
      expect(notes.status).toBe('completed');
      expect(notes.statusLabel).toBe('部分完成');
      expect(notes.canClick).toBe(true);
    });

    it('存在 staleMarker 时，未来阶段显示需要更新', () => {
      const steps = deriveProductSteps('structure', makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
        staleMarker: {
          reason: 'evidence-edited',
          affectedTopicIds: ['kt-1'],
          affectedPackageIds: [],
          timestamp: Date.now(),
        },
      }));
      const cards = steps.find(step => step.stage === 'cards')!;
      expect(cards.status).toBe('stale');
      expect(cards.statusLabel).toBe('需要更新');
      expect(cards.canClick).toBe(true);
    });
  });

  // ========== 3. isStageCompleted ==========
  describe('isStageCompleted', () => {
    it('upload/document: 有文档时完成，无文档时未完成', () => {
      expect(isStageCompleted('upload', makeState({ document: makeDoc() }))).toBe(true);
      expect(isStageCompleted('document', makeState({ document: makeDoc() }))).toBe(true);
      expect(isStageCompleted('upload', makeState())).toBe(false);
      expect(isStageCompleted('document', makeState())).toBe(false);
    });

    it('mineru: 解析完成且有源文档时完成', () => {
      expect(isStageCompleted('mineru', makeParsedState())).toBe(true);
      expect(isStageCompleted('mineru', makeState({ document: makeDoc() }))).toBe(false);
    });

    it('structure: 有知识点时完成（无论提取状态）', () => {
      expect(isStageCompleted('structure', makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
      }))).toBe(true);
      expect(isStageCompleted('structure', makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        structureExtractionStatus: 'failed',
      }))).toBe(true);
      expect(isStageCompleted('structure', makeParsedState())).toBe(false);
    });

    it('cards: 有知识卡片时完成', () => {
      expect(isStageCompleted('cards', makeParsedState({
        knowledgeCards: [makeKnowledgeCard()],
      }))).toBe(true);
      expect(isStageCompleted('cards', makeParsedState({
        knowledgeCards: [{ ...makeKnowledgeCard(), status: 'partial' }],
      }))).toBe(false);
      expect(isStageCompleted('cards', makeParsedState())).toBe(false);
    });

    it('notes: 完整笔记必须完成、非空且结构版本一致', () => {
      const versions = { source: 1, normalization: 1, topicStructure: 3, teachingStructure: 1, ordering: 1, cards: 1, notes: 1, embeddings: 0 };
      const base = makeParsedState({
        knowledgeCards: [makeKnowledgeCard()],
        knowledgeBaseVersions: versions,
      });

      expect(isStageCompleted('notes', { ...base, courseMasterNote: makeCourseMasterNote() })).toBe(true);
      expect(isStageCompleted('notes', { ...base, courseMasterNote: makeCourseMasterNote('', 99) })).toBe(false);
      expect(isStageCompleted('notes', {
        ...base,
        courseMasterNote: { ...makeCourseMasterNote(), status: 'partial' },
      })).toBe(false);
      expect(isStageCompleted('notes', { ...base, courseMasterNote: { ...makeCourseMasterNote(), markdown: '  ' } })).toBe(false);
      expect(isStageCompleted('notes', base)).toBe(false);
    });
  });

  // ========== 4. hasStageData ==========
  describe('hasStageData', () => {
    it('document: 有文档即有数据', () => {
      expect(hasStageData('document', makeState({ document: makeDoc() }))).toBe(true);
      expect(hasStageData('document', makeState())).toBe(false);
    });

    it('mineru: 有解析结果或源文档即有数据', () => {
      expect(hasStageData('mineru', makeState({ mineruParseResult: makeCompletedParse() }))).toBe(true);
      expect(hasStageData('mineru', makeState({ sourceDocuments: [makeSourceDocument()] }))).toBe(true);
      expect(hasStageData('mineru', makeState())).toBe(false);
    });

    it('structure: 有知识点即有数据', () => {
      expect(hasStageData('structure', makeParsedState({ knowledgeTopics: [makeKnowledgeTopic()] }))).toBe(true);
      expect(hasStageData('structure', makeParsedState())).toBe(false);
    });

    it('cards: 有知识卡片即有数据', () => {
      expect(hasStageData('cards', makeParsedState({ knowledgeCards: [makeKnowledgeCard()] }))).toBe(true);
      expect(hasStageData('cards', makeParsedState())).toBe(false);
    });

    it('notes: 部分章节或母笔记草稿也算有数据，但不算完成', () => {
      const state = makeParsedState({
        courseMasterNote: { ...makeCourseMasterNote(), status: 'partial' },
      });
      expect(hasStageData('notes', state)).toBe(true);
      expect(isStageCompleted('notes', state)).toBe(false);
    });
  });

  // ========== 5. canNavigateToStage ==========
  describe('canNavigateToStage 允许返回已完成阶段', () => {
    it('从 notes 返回 document 时允许导航（只读模式）', () => {
      const state = makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
        courseMasterNote: makeCourseMasterNote(),
      });
      const result = canNavigateToStage('document', 'notes', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('从 notes 返回 structure 时允许导航（只读模式）', () => {
      const state = makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
      });
      const result = canNavigateToStage('structure', 'notes', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
      expect(result.requiresConfirmation).toBe(false);
    });

    it('允许跳回已有部分数据的完整笔记，即使尚未生成知识卡片', () => {
      const state = makeParsedState({
        courseMasterNote: { ...makeCourseMasterNote(), status: 'partial' },
      });
      const result = canNavigateToStage('notes', 'structure', state);
      expect(result.allowed).toBe(true);
    });
  });

  describe('canNavigateToStage 阻止未来阶段', () => {
    it('从 upload 不能跳到 structure', () => {
      expect(canNavigateToStage('structure', 'upload', makeState()).allowed).toBe(false);
    });

    it('上传完成后可以导航到紧邻的 document', () => {
      const result = canNavigateToStage('document', 'upload', makeState({ document: makeDoc() }));
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('edit');
    });

    it('从 upload 不能导航到 notes', () => {
      expect(canNavigateToStage('notes', 'upload', makeState()).allowed).toBe(false);
    });

    it('从 document 不能导航到未完成的 structure', () => {
      const state = makeState({ document: makeDoc() });
      expect(canNavigateToStage('structure', 'document', state).allowed).toBe(false);
    });
  });

  describe('canNavigateToStage 当前阶段与前进', () => {
    it('导航到当前阶段允许（view 模式）', () => {
      const state = makeParsedState({ knowledgeTopics: [makeKnowledgeTopic()] });
      const result = canNavigateToStage('structure', 'structure', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('前进到已完成的未来阶段允许导航（edit 模式）', () => {
      const state = makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
      });
      const result = canNavigateToStage('cards', 'structure', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('edit');
    });
  });

  // ========== 6. getLatestStage ==========
  describe('getLatestStage', () => {
    it('无任何数据时返回 upload', () => {
      expect(getLatestStage(makeState())).toBe('upload');
    });

    it('只有文档时返回 document', () => {
      expect(getLatestStage(makeState({ document: makeDoc() }))).toBe('document');
    });

    it('解析完成后返回 mineru', () => {
      expect(getLatestStage(makeParsedState())).toBe('mineru');
    });

    it('有知识点时返回 structure', () => {
      expect(getLatestStage(makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
      }))).toBe('structure');
    });

    it('知识卡片完成但尚未生成完整笔记时返回 cards', () => {
      expect(getLatestStage(makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
      }))).toBe('cards');
    });

    it('有完成笔记时返回 notes', () => {
      expect(getLatestStage(makeParsedState({
        knowledgeTopics: [makeKnowledgeTopic()],
        knowledgeCards: [makeKnowledgeCard()],
        knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 3, teachingStructure: 1, ordering: 1, cards: 1, notes: 1, embeddings: 0 },
        courseMasterNote: makeCourseMasterNote(),
      }))).toBe('notes');
    });

    it('部分完整笔记也应作为最新可恢复阶段', () => {
      expect(getLatestStage(makeParsedState({
        courseMasterNote: { ...makeCourseMasterNote(), status: 'partial' },
      }))).toBe('notes');
    });
  });
});
