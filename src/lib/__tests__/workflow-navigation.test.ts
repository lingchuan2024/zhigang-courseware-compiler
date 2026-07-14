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
  createEvidenceEditStaleMarker,
  createStructureEditStaleMarker,
} from '../workflow-navigation';
import type { ProductStateSnapshot } from '../../types';
import type {
  CourseTopic,
  KnowledgePackage,
  CourseDocument,
  EvidenceAtom,
  NaturalKnowledgeNote,
  KnowledgeCard,
  CourseMasterNote,
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

function makeTopic(id: string, title: string): CourseTopic {
  return {
    id,
    title,
    aliases: [],
    type: 'concept',
    learningGoal: '学习目标',
    evidenceIds: ['ev_1', 'ev_2'],
    originalPageNumbers: [1],
    originalOrder: 0,
    recommendedOrder: 0,
    importance: 'core',
    confidence: 0.8,
    noteStatus: 'pending',
  };
}

function makePackage(topic: CourseTopic): KnowledgePackage {
  return {
    id: `pkg_${topic.id}`,
    topic,
    source: {
      evidenceIds: topic.evidenceIds,
      combinedOriginalText: '原始文本',
      evidence: [],
    },
    internalStructure: {
      items: [],
      relations: [],
      orderedItemIds: [],
      source: 'ai',
      warnings: [],
      status: 'ready',
    },
    macroRelations: [],
    note: undefined,
    versions: {
      sourceVersion: 0,
      structureVersion: 0,
      noteVersion: 0,
      promptVersion: 'test',
    },
  };
}

function makeNote(topicId: string): NaturalKnowledgeNote {
  return {
    id: 'note1',
    topicId,
    title: '笔记',
    contentMarkdown: '内容',
    shortSummary: '摘要',
    citations: [],
    terminologyUpdates: {},
    symbolUpdates: {},
    continuityMemory: '',
    warnings: [],
  };
}

function makeEvidence(id: string): EvidenceAtom {
  return {
    id,
    documentId: 'doc1',
    pageNumber: 1,
    blockIndex: 0,
    type: 'text',
    content: '内容',
    confidence: 0.9,
    contentHash: `hash_${id}`,
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

function makeCourseMasterNote(markdown = '# 完整笔记'): CourseMasterNote {
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
    generatedFromStructureVersion: 3,
  };
}

function makeState(overrides: Partial<ProductStateSnapshot> = {}): ProductStateSnapshot {
  return {
    document: null,
    evidences: [],
    topics: [],
    knowledgePackages: [],
    structureExtractionStatus: 'idle',
    jobStatus: 'idle',
    staleMarker: null,
    ...overrides,
  };
}

// ========== 测试用例 ==========

describe('workflow-navigation', () => {
  // ========== 1. PRODUCT_STAGES ==========
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

  // ========== 2. deriveProductSteps 返回 6 步 ==========
  describe('deriveProductSteps', () => {
    it('返回 6 个步骤', () => {
      const steps = deriveProductSteps('upload', makeState());
      expect(steps).toHaveLength(6);
    });

    it('步骤的阶段、标签、编号与常量一致', () => {
      const steps = deriveProductSteps('upload', makeState());
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
      expect(steps[2].status).toBe('pending');
      expect(steps[3].status).toBe('pending');
    });

    it('document 阶段时 upload 为 completed 且可点击', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const steps = deriveProductSteps('document', state);
      expect(steps[0].status).toBe('completed');
      expect(steps[0].canClick).toBe(true);
      expect(steps[1].status).toBe('active');
      expect(steps[1].canClick).toBe(false);
    });

    it('structure 阶段时前两步 completed 且可点击', () => {
      const topics = [makeTopic('t1', '知识点A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'ready',
      });
      const steps = deriveProductSteps('structure', state);
      expect(steps[0].status).toBe('completed');
      expect(steps[0].canClick).toBe(true);
      expect(steps[1].status).toBe('completed');
      expect(steps[1].canClick).toBe(true);
      expect(steps[2].status).toBe('completed');
      expect(steps[3].status).toBe('active');
      expect(steps[4].status).toBe('pending');
    });

    it('notes 阶段时知识卡片之前的步骤 completed 且可点击', () => {
      const topics = [makeTopic('t1', '知识点A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
      });
      const steps = deriveProductSteps('notes', state);
      expect(steps[0].status).toBe('completed');
      expect(steps[0].canClick).toBe(true);
      expect(steps[1].status).toBe('completed');
      expect(steps[1].canClick).toBe(true);
      expect(steps[2].status).toBe('completed');
      expect(steps[2].canClick).toBe(true);
      expect(steps[3].status).toBe('completed');
      expect(steps[3].canClick).toBe(true);
      expect(steps[4].status).toBe('completed');
      expect(steps[4].canClick).toBe(true);
      expect(steps[5].status).toBe('active');
    });

    it('查看较早阶段时，已有部分章节的完整笔记仍可点击返回', () => {
      const partial = { ...makeCourseMasterNote('# 已完成章节'), status: 'partial' as const };
      const steps = deriveProductSteps('cards', makeState({
        knowledgeCards: [makeKnowledgeCard()],
        courseMasterNote: partial,
      }));
      const notes = steps.find(step => step.stage === 'notes')!;
      expect(notes.status).toBe('completed');
      expect(notes.statusLabel).toBe('部分完成');
      expect(notes.canClick).toBe(true);
    });
  });

  // ========== 3. isStageCompleted 从真实数据派生 ==========
  describe('isStageCompleted', () => {
    it('upload: 有文档时完成', () => {
      const state = makeState({ document: makeDoc() });
      expect(isStageCompleted('upload', state)).toBe(true);
    });

    it('upload: 无文档时未完成', () => {
      expect(isStageCompleted('upload', makeState())).toBe(false);
    });

    it('document: 有文档和证据时完成', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      expect(isStageCompleted('document', state)).toBe(true);
    });

    it('document: 有文档即可完成预览阶段', () => {
      const state = makeState({ document: makeDoc() });
      expect(isStageCompleted('document', state)).toBe(true);
    });

    it('document: 无文档时未完成（即使有证据）', () => {
      const state = makeState({ evidences: [makeEvidence('ev_1')] });
      expect(isStageCompleted('document', state)).toBe(false);
    });

    it('structure: 有知识点、知识包且 status=ready 时完成', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'ready',
      });
      expect(isStageCompleted('structure', state)).toBe(true);
    });

    it('structure: status=failed 且有数据时也视为完成', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'failed',
      });
      expect(isStageCompleted('structure', state)).toBe(true);
    });

    it('structure: 无知识点时未完成', () => {
      const state = makeState({
        knowledgePackages: [],
        structureExtractionStatus: 'ready',
      });
      expect(isStageCompleted('structure', state)).toBe(false);
    });

    it('structure: 无知识包时未完成', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        topics,
        knowledgePackages: [],
        structureExtractionStatus: 'ready',
      });
      expect(isStageCompleted('structure', state)).toBe(false);
    });

    it('structure: 有知识点和知识包时完成（无论 status）', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'idle',
      });
      expect(isStageCompleted('structure', state)).toBe(true);
    });

    it('notes: 有笔记时完成', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({ knowledgePackages: packages });
      expect(isStageCompleted('notes', state)).toBe(true);
    });

    it('notes: 无笔记时未完成', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        topics,
        knowledgePackages: [makePackage(topics[0])],
      });
      expect(isStageCompleted('notes', state)).toBe(false);
    });

    it('cards: 只有非空知识卡片时完成', () => {
      expect(isStageCompleted('cards', makeState({ knowledgeCards: [] }))).toBe(false);
      expect(isStageCompleted('cards', makeState({ knowledgeCards: [makeKnowledgeCard()] }))).toBe(true);
    });

    it('notes: V2 完整笔记必须完成、非空且结构版本一致', () => {
      const base = {
        sourceDocuments: [{ id: 'doc', courseId: 'course-1', title: '课件', markdown: '# 课件', blocks: [], outline: [], contentHash: 'h', createdAt: '', updatedAt: '' }],
        knowledgeCards: [makeKnowledgeCard()],
        knowledgeBaseVersions: { source: 1, normalization: 1, topicStructure: 3, teachingStructure: 1, ordering: 1, cards: 1, notes: 1, embeddings: 0 },
      };

      expect(isStageCompleted('notes', makeState({ ...base, courseMasterNote: makeCourseMasterNote('   ') }))).toBe(false);
      expect(isStageCompleted('notes', makeState({ ...base, courseMasterNote: { ...makeCourseMasterNote(), status: 'partial' } }))).toBe(false);
      expect(isStageCompleted('notes', makeState({ ...base, courseMasterNote: { ...makeCourseMasterNote(), generatedFromStructureVersion: 2 } }))).toBe(false);
      expect(isStageCompleted('notes', makeState({ ...base, courseMasterNote: makeCourseMasterNote() }))).toBe(true);
    });
  });

  // ========== hasStageData ==========
  describe('hasStageData', () => {
    it('upload: 有文档时有数据', () => {
      expect(hasStageData('upload', makeState({ document: makeDoc() }))).toBe(true);
    });

    it('upload: 无文档时无数据', () => {
      expect(hasStageData('upload', makeState())).toBe(false);
    });

    it('document: 有文档和证据时有数据', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      expect(hasStageData('document', state)).toBe(true);
    });

    it('document: 有文档时即有预览数据', () => {
      const state = makeState({ document: makeDoc() });
      expect(hasStageData('document', state)).toBe(true);
    });

    it('structure: 有知识点时有数据', () => {
      const topics = [makeTopic('t1', 'A')];
      expect(hasStageData('structure', makeState({ topics }))).toBe(true);
    });

    it('structure: 无知识点时无数据', () => {
      expect(hasStageData('structure', makeState())).toBe(false);
    });

    it('notes: 有笔记时有数据', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      expect(hasStageData('notes', makeState({ knowledgePackages: packages }))).toBe(true);
    });

    it('notes: 无笔记时无数据', () => {
      expect(hasStageData('notes', makeState())).toBe(false);
    });

    it('cards: 有知识卡片时有数据', () => {
      expect(hasStageData('cards', makeState({ knowledgeCards: [makeKnowledgeCard()] }))).toBe(true);
    });

    it('notes: 部分章节或母笔记草稿也算有数据，但不算完成', () => {
      const partial = { ...makeCourseMasterNote('# 已完成章节'), status: 'partial' as const };
      const state = makeState({ sourceDocuments: [], courseMasterNote: partial });
      expect(hasStageData('notes', state)).toBe(true);
      expect(isStageCompleted('notes', state)).toBe(false);
    });
  });

  // ========== 4. canNavigateToStage 允许返回已完成阶段 ==========
  describe('canNavigateToStage 允许返回已完成阶段', () => {
    it('允许跳回已有部分数据的完整笔记，即使迁移项目暂时没有知识卡片', () => {
      const partial = { ...makeCourseMasterNote('# 已完成章节'), status: 'partial' as const };
      const result = canNavigateToStage('notes', 'cards', makeState({ courseMasterNote: partial }));
      expect(result.allowed).toBe(true);
    });

    it('从 notes 返回 document 时允许导航（只读模式）', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
      });

      const result = canNavigateToStage('document', 'notes', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('从 notes 返回 structure 时允许导航（只读模式）', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
      });

      const result = canNavigateToStage('structure', 'notes', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('从 structure 返回 upload 时允许导航（只读模式）', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'ready',
      });

      const result = canNavigateToStage('upload', 'structure', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('从 structure 返回 document 时允许导航（只读模式）', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'ready',
      });

      const result = canNavigateToStage('document', 'structure', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('返回查看模式不需要确认', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const result = canNavigateToStage('upload', 'document', state);
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });
  });

  // ========== 5. canNavigateToStage 阻止未来阶段 ==========
  describe('canNavigateToStage 阻止未来阶段', () => {
    it('从 upload 不能导航到 structure', () => {
      const state = makeState({ document: makeDoc() });
      const result = canNavigateToStage('structure', 'upload', state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('未来');
    });

    it('上传完成后可以导航到紧邻的 document', () => {
      const state = makeState({ document: makeDoc() });
      const result = canNavigateToStage('document', 'upload', state);
      expect(result.allowed).toBe(true);
    });

    it('从 upload 不能导航到 notes', () => {
      const state = makeState({ document: makeDoc() });
      const result = canNavigateToStage('notes', 'upload', state);
      expect(result.allowed).toBe(false);
    });

    it('从 document 不能导航到 notes', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const result = canNavigateToStage('notes', 'document', state);
      expect(result.allowed).toBe(false);
    });

    it('从 document 不能导航到 structure（structure 未完成）', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const result = canNavigateToStage('structure', 'document', state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('未来');
    });
  });

  describe('canNavigateToStage 当前阶段与前进', () => {
    it('导航到当前阶段允许（view 模式）', () => {
      const state = makeState({ document: makeDoc() });
      const result = canNavigateToStage('upload', 'upload', state);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('view');
    });

    it('前进到已完成的未来阶段允许导航（edit 模式）', () => {
      // document 已完成（有文档和证据），从 upload 前进到 document
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const result = canNavigateToStage('document', 'upload', state);
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
      const state = makeState({ document: makeDoc() });
      expect(getLatestStage(state)).toBe('document');
    });

    it('有文档和证据时返回 document', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      expect(getLatestStage(state)).toBe('document');
    });

    it('有知识点、知识包且 ready 时返回 structure', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'ready',
      });
      expect(getLatestStage(state)).toBe('structure');
    });

    it('有笔记时返回 notes', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
      });
      expect(getLatestStage(state)).toBe('notes');
    });

    it('返回最远的已完成阶段', () => {
      // notes 完成（有笔记）→ 返回 notes 而非 structure
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
      });
      expect(getLatestStage(state)).toBe('notes');
    });

    it('structure 已完成（有数据，status=idle）时返回 structure', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'idle',
      });
      expect(getLatestStage(state)).toBe('structure');
    });

    it('知识卡片完成但尚未生成完整笔记时返回 cards', () => {
      expect(getLatestStage(makeState({ knowledgeCards: [makeKnowledgeCard()] }))).toBe('cards');
    });

    it('部分完整笔记也应作为最新可恢复阶段', () => {
      const partial = { ...makeCourseMasterNote('# 已完成章节'), status: 'partial' as const };
      expect(getLatestStage(makeState({ knowledgeCards: [makeKnowledgeCard()], courseMasterNote: partial }))).toBe('notes');
    });
  });

  // ========== 7. 证据编辑 Stale 标记 ==========
  describe('createEvidenceEditStaleMarker', () => {
    it('标记所有知识点和知识包', () => {
      const topics = [makeTopic('t1', 'A'), makeTopic('t2', 'B')];
      const packages = [makePackage(topics[0]), makePackage(topics[1])];

      const marker = createEvidenceEditStaleMarker(topics, packages);

      expect(marker.reason).toBe('evidence-edited');
      expect(marker.affectedTopicIds).toEqual(['t1', 't2']);
      expect(marker.affectedPackageIds).toEqual(['pkg_t1', 'pkg_t2']);
    });

    it('timestamp 为有效数字', () => {
      const marker = createEvidenceEditStaleMarker([], []);
      expect(typeof marker.timestamp).toBe('number');
      expect(marker.timestamp).toBeGreaterThan(0);
    });

    it('空数组时返回空受影响列表', () => {
      const marker = createEvidenceEditStaleMarker([], []);
      expect(marker.affectedTopicIds).toEqual([]);
      expect(marker.affectedPackageIds).toEqual([]);
    });

    it('有 staleMarker 时下游 structure 步骤显示 stale 状态', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      const staleMarker = createEvidenceEditStaleMarker(topics, packages);

      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
        staleMarker,
      });

      // 当前在 document（编辑证据后返回）
      const steps = deriveProductSteps('document', state);
      const structureStep = steps.find(s => s.stage === 'structure');
      expect(structureStep?.status).toBe('stale');
    });

    it('有 staleMarker 时下游 notes 步骤也显示 stale', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      packages[0].note = makeNote('t1');
      const staleMarker = createEvidenceEditStaleMarker(topics, packages);

      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
        staleMarker,
      });

      // 当前在 document（编辑证据后返回）
      const steps = deriveProductSteps('document', state);
      const notesStep = steps.find(s => s.stage === 'notes');
      expect(notesStep?.status).toBe('stale');
    });

    it('staleMarker 不影响当前阶段和已完成的上游阶段', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      const staleMarker = createEvidenceEditStaleMarker(topics, packages);

      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
        staleMarker,
      });

      const steps = deriveProductSteps('document', state);
      // upload 是上游已完成阶段，不应显示 stale
      expect(steps[0].status).toBe('completed');
      // document 是当前阶段
      expect(steps[1].status).toBe('active');
    });
  });

  // ========== 8. 结构编辑 Stale 标记 ==========
  describe('createStructureEditStaleMarker', () => {
    it('只标记指定知识点', () => {
      const topics = [makeTopic('t1', 'A'), makeTopic('t2', 'B'), makeTopic('t3', 'C')];
      const packages = [makePackage(topics[0]), makePackage(topics[1]), makePackage(topics[2])];

      const marker = createStructureEditStaleMarker(['t1', 't3'], packages);

      expect(marker.reason).toBe('structure-edited');
      expect(marker.affectedTopicIds).toEqual(['t1', 't3']);
      expect(marker.affectedTopicIds).not.toContain('t2');
    });

    it('只标记对应的知识包', () => {
      const topics = [makeTopic('t1', 'A'), makeTopic('t2', 'B'), makeTopic('t3', 'C')];
      const packages = [makePackage(topics[0]), makePackage(topics[1]), makePackage(topics[2])];

      const marker = createStructureEditStaleMarker(['t1', 't3'], packages);

      expect(marker.affectedPackageIds).toEqual(['pkg_t1', 'pkg_t3']);
      expect(marker.affectedPackageIds).not.toContain('pkg_t2');
    });

    it('timestamp 为有效数字', () => {
      const marker = createStructureEditStaleMarker(['t1'], []);
      expect(typeof marker.timestamp).toBe('number');
      expect(marker.timestamp).toBeGreaterThan(0);
    });

    it('空 topicIds 时返回空受影响列表', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];

      const marker = createStructureEditStaleMarker([], packages);

      expect(marker.affectedTopicIds).toEqual([]);
      expect(marker.affectedPackageIds).toEqual([]);
    });

    it('单个 topicId 只标记对应包', () => {
      const topics = [makeTopic('t1', 'A'), makeTopic('t2', 'B')];
      const packages = [makePackage(topics[0]), makePackage(topics[1])];

      const marker = createStructureEditStaleMarker(['t2'], packages);

      expect(marker.affectedTopicIds).toEqual(['t2']);
      expect(marker.affectedPackageIds).toEqual(['pkg_t2']);
    });
  });

  // ========== 9. 步骤状态标签 ==========
  describe('步骤状态标签', () => {
    it('当前阶段 jobStatus=running 时显示"正在处理"', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        jobStatus: 'running',
      });
      const steps = deriveProductSteps('document', state);
      const docStep = steps.find(s => s.stage === 'document');
      expect(docStep?.status).toBe('active');
      expect(docStep?.statusLabel).toBe('正在处理');
    });

    it('当前阶段 jobStatus=idle 时不显示状态标签', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const steps = deriveProductSteps('document', state);
      const docStep = steps.find(s => s.stage === 'document');
      expect(docStep?.status).toBe('active');
      expect(docStep?.statusLabel).toBeUndefined();
    });

    it('下游阶段有 staleMarker 时显示"需要更新"', () => {
      const topics = [makeTopic('t1', 'A')];
      const packages = [makePackage(topics[0])];
      const staleMarker = createEvidenceEditStaleMarker(topics, packages);
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: packages,
        structureExtractionStatus: 'ready',
        staleMarker,
      });

      const steps = deriveProductSteps('document', state);
      const structureStep = steps.find(s => s.stage === 'structure');
      expect(structureStep?.status).toBe('stale');
      expect(structureStep?.statusLabel).toBe('需要更新');
    });

    it('structureExtractionStatus=failed 时显示"提取失败"', () => {
      const topics = [makeTopic('t1', 'A')];
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        topics,
        knowledgePackages: [makePackage(topics[0])],
        structureExtractionStatus: 'failed',
      });

      const steps = deriveProductSteps('structure', state);
      const structureStep = steps.find(s => s.stage === 'structure');
      expect(structureStep?.status).toBe('failed');
      expect(structureStep?.statusLabel).toBe('提取失败');
      expect(structureStep?.canClick).toBe(true);
    });

    it('structureExtractionStatus=model-required 时显示"需要配置"', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
        structureExtractionStatus: 'model-required',
      });

      const steps = deriveProductSteps('structure', state);
      const structureStep = steps.find(s => s.stage === 'structure');
      expect(structureStep?.status).toBe('blocked');
      expect(structureStep?.statusLabel).toBe('需要配置');
      expect(structureStep?.canClick).toBe(true);
    });

    it('已完成阶段无特殊状态标签', () => {
      const state = makeState({
        document: makeDoc(),
        evidences: [makeEvidence('ev_1')],
      });
      const steps = deriveProductSteps('document', state);
      const uploadStep = steps.find(s => s.stage === 'upload');
      expect(uploadStep?.status).toBe('completed');
      expect(uploadStep?.statusLabel).toBeUndefined();
    });

    it('pending 阶段无状态标签', () => {
      const steps = deriveProductSteps('upload', makeState());
      const docStep = steps.find(s => s.stage === 'document');
      expect(docStep?.status).toBe('pending');
      expect(docStep?.statusLabel).toBeUndefined();
    });
  });
});
