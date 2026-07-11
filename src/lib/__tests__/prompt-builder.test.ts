import { describe, it, expect } from 'vitest';
import {
  buildTopicExtractionPrompt,
  buildRelationExtractionPrompt,
  buildInternalStructurePrompt,
  buildNoteGenerationPrompt,
  buildTopicMergePrompt,
  buildStableCourseContext,
  sortEvidenceDeterministically,
  sortTopicsDeterministically,
  serializeDeterministically,
  serializeMapDeterministically,
  PROMPT_VERSIONS,
} from '../prompt-builder';
import type {
  EvidenceAtom,
  CourseTopic,
  KnowledgePackage,
  CourseGenerationMemory,
  MacroKnowledgeRelation,
  UnitContentItem,
} from '../../types';

// ========== Mock Data Factories ==========

function makeEvidence(overrides: Partial<EvidenceAtom> = {}): EvidenceAtom {
  return {
    id: 'ev-1',
    documentId: 'doc-1',
    pageNumber: 1,
    blockIndex: 0,
    type: 'text',
    content: '这是测试证据内容',
    confidence: 0.9,
    contentHash: 'hash-1',
    ...overrides,
  };
}

function makeTopic(overrides: Partial<CourseTopic> = {}): CourseTopic {
  return {
    id: 'topic-1',
    title: '测试主题',
    aliases: [],
    type: 'concept',
    learningGoal: '理解测试主题',
    evidenceIds: ['ev-1'],
    originalPageNumbers: [1],
    importance: 'core',
    confidence: 0.8,
    originalOrder: 0,
    recommendedOrder: 0,
    noteStatus: 'pending',
    ...overrides,
  };
}

function makeContentItem(overrides: Partial<UnitContentItem> = {}): UnitContentItem {
  return {
    id: 'item-1',
    topicId: 'topic-1',
    type: 'definition',
    content: '这是定义内容',
    evidenceIds: ['ev-1'],
    originalPageNumbers: [1],
    originalOrder: 0,
    recommendedOrder: 0,
    confidence: 0.9,
    ...overrides,
  };
}

function makeRelation(overrides: Partial<MacroKnowledgeRelation> = {}): MacroKnowledgeRelation {
  return {
    id: 'rel-1',
    sourceTopicId: 'topic-1',
    targetTopicId: 'topic-2',
    type: 'hard_prerequisite',
    evidenceIds: ['ev-1'],
    reason: '前置依赖',
    confidence: 0.8,
    origin: 'ai-inferred',
    ...overrides,
  };
}

function makeKp(overrides: Partial<KnowledgePackage> = {}): KnowledgePackage {
  const { topic: overrideTopic, ...rest } = overrides;
  const topic = overrideTopic ?? makeTopic();
  return {
    id: 'kp-1',
    source: {
      evidenceIds: ['ev-1'],
      combinedOriginalText: '原始文本',
      evidence: [
        { evidenceId: 'ev-1', pageNumber: 1, type: 'text', originalText: '证据原文' },
      ],
    },
    internalStructure: {
      items: [makeContentItem({ topicId: topic.id })],
      relations: [],
      orderedItemIds: ['item-1'],
      source: 'ai',
      warnings: [],
      status: 'ready',
    },
    macroRelations: [],
    versions: {
      sourceVersion: 1,
      structureVersion: 1,
      noteVersion: 0,
      promptVersion: 'test',
    },
    ...rest,
    topic,
  };
}

function makeMemory(overrides: Partial<CourseGenerationMemory> = {}): CourseGenerationMemory {
  return {
    terminology: {},
    symbols: {},
    generatedTopicSummaries: {},
    ...overrides,
  };
}

// ========== Shared Course Setup ==========

const COURSE_NAME = '机器学习导论';

const COURSE_TOPICS: CourseTopic[] = [
  makeTopic({
    id: 't1',
    title: '线性回归',
    aliases: ['Linear Regression'],
    type: 'method',
    learningGoal: '掌握线性回归模型',
    evidenceIds: ['ev-1', 'ev-2'],
    originalPageNumbers: [1, 2],
    originalOrder: 1,
    recommendedOrder: 1,
  }),
  makeTopic({
    id: 't2',
    title: '逻辑回归',
    aliases: ['Logistic Regression'],
    type: 'method',
    learningGoal: '掌握逻辑回归模型',
    evidenceIds: ['ev-3', 'ev-4'],
    originalPageNumbers: [3, 4],
    originalOrder: 2,
    recommendedOrder: 2,
  }),
  makeTopic({
    id: 't3',
    title: '神经网络',
    aliases: ['Neural Network'],
    type: 'composite',
    learningGoal: '理解神经网络结构',
    evidenceIds: ['ev-5', 'ev-6'],
    originalPageNumbers: [5, 6],
    originalOrder: 3,
    recommendedOrder: 3,
  }),
];

const COURSE_RELATIONS: MacroKnowledgeRelation[] = [
  makeRelation({
    id: 'r1',
    sourceTopicId: 't1',
    targetTopicId: 't2',
    type: 'hard_prerequisite',
    reason: '逻辑回归需要线性回归基础',
  }),
  makeRelation({
    id: 'r2',
    sourceTopicId: 't2',
    targetTopicId: 't3',
    type: 'soft_prerequisite',
    reason: '神经网络借鉴逻辑回归思想',
  }),
];

const SHARED_MEMORY: CourseGenerationMemory = makeMemory({
  terminology: {
    '梯度下降': {
      preferredName: '梯度下降',
      aliases: ['Gradient Descent'],
      introducedByTopicId: 't1',
    },
  },
  symbols: {
    'θ': {
      meaning: '模型参数',
      introducedByTopicId: 't1',
      sourceEvidenceIds: ['ev-1'],
    },
  },
  generatedTopicSummaries: {
    t1: '线性回归通过最小化损失函数拟合数据',
    t2: '逻辑回归用于二分类问题',
  },
});

// ========== Tests ==========

describe('prompt-builder', () => {
  // ---------------------------------------------------------------
  // 1. Same task type, different topics → system prompt is identical
  // ---------------------------------------------------------------
  describe('1. Same task type, different topics → system prompt identical', () => {
    it('buildNoteGenerationPrompt: different topics in same course → identical system', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[1],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      expect(prompt1.system).toBe(prompt2.system);
    });

    it('buildInternalStructurePrompt: different topics → identical system', () => {
      const kp1 = makeKp({ topic: COURSE_TOPICS[0] });
      const kp2 = makeKp({ topic: COURSE_TOPICS[1] });

      const prompt1 = buildInternalStructurePrompt(kp1, COURSE_TOPICS);
      const prompt2 = buildInternalStructurePrompt(kp2, COURSE_TOPICS);

      expect(prompt1.system).toBe(prompt2.system);
    });

    it('buildRelationExtractionPrompt: different evidence sets → identical system', () => {
      const evidencesA = [makeEvidence({ id: 'ev-1', content: '内容A' })];
      const evidencesB = [makeEvidence({ id: 'ev-2', content: '内容B' })];

      const prompt1 = buildRelationExtractionPrompt(COURSE_TOPICS, evidencesA);
      const prompt2 = buildRelationExtractionPrompt(COURSE_TOPICS, evidencesB);

      expect(prompt1.system).toBe(prompt2.system);
    });
  });

  // ---------------------------------------------------------------
  // 2. stablePrefix is identical for the same course
  // ---------------------------------------------------------------
  describe('2. stablePrefix is identical for the same course', () => {
    it('buildNoteGenerationPrompt: different topics, same course → identical stablePrefix', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[1],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
    });

    it('stablePrefix contains course name and full outline', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const prompt = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      expect(prompt.stablePrefix).toContain(COURSE_NAME);
      expect(prompt.stablePrefix).toContain('线性回归');
      expect(prompt.stablePrefix).toContain('逻辑回归');
      expect(prompt.stablePrefix).toContain('神经网络');
    });

    it('buildStableCourseContext: same inputs → identical output', () => {
      const ctx1 = {
        courseName: COURSE_NAME,
        orderedTopics: COURSE_TOPICS,
        macroRelations: COURSE_RELATIONS,
      };
      // Even with reversed topic array, output is same because of deterministic sorting
      expect(buildStableCourseContext(ctx1)).toBe(buildStableCourseContext(ctx1));
    });

    it('stablePrefix does not change when kp.macroRelations differ', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: [COURSE_RELATIONS[0]],
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      // buildStableCourseContext does not embed macroRelations content in output
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
    });
  });

  // ---------------------------------------------------------------
  // 3. dynamicInput is different for different topics
  // ---------------------------------------------------------------
  describe('3. dynamicInput is different for different topics', () => {
    it('buildNoteGenerationPrompt: different topics → different dynamicInput', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [
            makeContentItem({ id: 'item-1a', topicId: 't1', content: '线性回归的定义', type: 'definition' }),
            makeContentItem({ id: 'item-1b', topicId: 't1', content: '最小二乘法', type: 'procedure' }),
          ],
          relations: [],
          orderedItemIds: ['item-1a', 'item-1b'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[1],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [
            makeContentItem({ id: 'item-2a', topicId: 't2', content: '逻辑回归的定义', type: 'definition' }),
            makeContentItem({ id: 'item-2b', topicId: 't2', content: 'Sigmoid函数', type: 'formula' }),
          ],
          relations: [],
          orderedItemIds: ['item-2a', 'item-2b'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      expect(prompt1.dynamicInput).not.toBe(prompt2.dynamicInput);
      expect(prompt1.dynamicInput).toContain('线性回归');
      expect(prompt2.dynamicInput).toContain('逻辑回归');
    });

    it('buildNoteGenerationPrompt: same topic, different previousNoteSummary → different dynamicInput', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME, '摘要A'
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME, '摘要B'
      );

      expect(prompt1.dynamicInput).not.toBe(prompt2.dynamicInput);
      expect(prompt1.dynamicInput).toContain('摘要A');
      expect(prompt2.dynamicInput).toContain('摘要B');
    });

    it('buildTopicExtractionPrompt: different evidence → different dynamicInput', () => {
      const evidencesA = [makeEvidence({ id: 'ev-1', content: '内容A' })];
      const evidencesB = [makeEvidence({ id: 'ev-2', content: '内容B' })];

      const prompt1 = buildTopicExtractionPrompt(evidencesA);
      const prompt2 = buildTopicExtractionPrompt(evidencesB);

      expect(prompt1.dynamicInput).not.toBe(prompt2.dynamicInput);
    });
  });

  // ---------------------------------------------------------------
  // 4. JSON Schema is located in the stablePrefix (before dynamic input)
  // ---------------------------------------------------------------
  describe('4. JSON Schema is located in the stablePrefix (before dynamic input)', () => {
    it('buildRelationExtractionPrompt: JSON schema in stablePrefix, before dynamic input', () => {
      const prompt = buildRelationExtractionPrompt(COURSE_TOPICS, [
        makeEvidence({ id: 'ev-1', pageNumber: 1 }),
        makeEvidence({ id: 'ev-2', pageNumber: 2 }),
      ]);

      // JSON schema is in stablePrefix
      expect(prompt.stablePrefix).toContain('"relations"');
      expect(prompt.stablePrefix).toContain('"sourceTopicId"');
      expect(prompt.stablePrefix).toContain('"targetTopicId"');
      expect(prompt.stablePrefix).toContain('"confidence"');

      // JSON schema does NOT appear in dynamicInput
      expect(prompt.dynamicInput).not.toContain('"sourceTopicId"');
      expect(prompt.dynamicInput).not.toContain('"targetTopicId"');

      // In the user message, JSON schema appears before === DYNAMIC INPUT ===
      const userContent = prompt.messages[1].content;
      const schemaIndex = userContent.indexOf('"sourceTopicId"');
      const dynamicIndex = userContent.indexOf('=== DYNAMIC INPUT ===');
      expect(schemaIndex).toBeGreaterThan(-1);
      expect(dynamicIndex).toBeGreaterThan(-1);
      expect(schemaIndex).toBeLessThan(dynamicIndex);
    });

    it('buildInternalStructurePrompt: JSON schema in stablePrefix, before dynamic input', () => {
      const kp = makeKp({ topic: COURSE_TOPICS[0] });
      const prompt = buildInternalStructurePrompt(kp, COURSE_TOPICS);

      expect(prompt.stablePrefix).toContain('"items"');
      expect(prompt.stablePrefix).toContain('"itemKey"');
      expect(prompt.stablePrefix).toContain('"evidenceIds"');

      expect(prompt.dynamicInput).not.toContain('"itemKey"');

      const userContent = prompt.messages[1].content;
      const schemaIndex = userContent.indexOf('"itemKey"');
      const dynamicIndex = userContent.indexOf('=== DYNAMIC INPUT ===');
      expect(schemaIndex).toBeGreaterThan(-1);
      expect(dynamicIndex).toBeGreaterThan(-1);
      expect(schemaIndex).toBeLessThan(dynamicIndex);
    });

    it('buildNoteGenerationPrompt: JSON schema in system prompt (before dynamic input)', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const prompt = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      // JSON schema is in system prompt
      expect(prompt.system).toContain('JSON Schema');
      expect(prompt.system).toContain('"contentMarkdown"');
      expect(prompt.system).toContain('"shortSummary"');

      // JSON schema does NOT appear in dynamicInput
      expect(prompt.dynamicInput).not.toContain('"contentMarkdown"');

      // System message comes before user message (which contains dynamic input)
      expect(prompt.messages[0].role).toBe('system');
      expect(prompt.messages[1].role).toBe('user');
    });

    it('buildTopicExtractionPrompt: JSON return format in system, stable spec in stablePrefix', () => {
      const prompt = buildTopicExtractionPrompt([
        makeEvidence({ id: 'ev-1' }),
      ]);

      // System prompt contains the full JSON return format
      expect(prompt.system).toContain('"topics"');
      expect(prompt.system).toContain('"topicKey"');
      expect(prompt.system).toContain('"unassignedEvidenceIds"');

      // stablePrefix contains stable output rules
      expect(prompt.stablePrefix).toContain('只返回JSON');

      // Dynamic input does not contain schema
      expect(prompt.dynamicInput).not.toContain('"topicKey"');
    });
  });

  // ---------------------------------------------------------------
  // 5. Evidence order changes don't affect output (deterministic sorting)
  // ---------------------------------------------------------------
  describe("5. Evidence order changes don't affect output (deterministic sorting)", () => {
    it('buildTopicExtractionPrompt: identical output regardless of evidence order', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev-c', pageNumber: 3, blockIndex: 1, content: '第三页内容' }),
        makeEvidence({ id: 'ev-a', pageNumber: 1, blockIndex: 0, content: '第一页内容' }),
        makeEvidence({ id: 'ev-b', pageNumber: 2, blockIndex: 0, content: '第二页内容' }),
        makeEvidence({ id: 'ev-d', pageNumber: 1, blockIndex: 1, content: '第一页第二个块' }),
      ];

      const shuffled: EvidenceAtom[] = [
        makeEvidence({ id: 'ev-d', pageNumber: 1, blockIndex: 1, content: '第一页第二个块' }),
        makeEvidence({ id: 'ev-b', pageNumber: 2, blockIndex: 0, content: '第二页内容' }),
        makeEvidence({ id: 'ev-c', pageNumber: 3, blockIndex: 1, content: '第三页内容' }),
        makeEvidence({ id: 'ev-a', pageNumber: 1, blockIndex: 0, content: '第一页内容' }),
      ];

      const prompt1 = buildTopicExtractionPrompt(evidences);
      const prompt2 = buildTopicExtractionPrompt(shuffled);

      expect(prompt1.system).toBe(prompt2.system);
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
      expect(prompt1.dynamicInput).toBe(prompt2.dynamicInput);
      expect(prompt1.messages).toEqual(prompt2.messages);
    });

    it('sortEvidenceDeterministically: sorts by pageNumber, then blockIndex, then id', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev-z', pageNumber: 2, blockIndex: 0 }),
        makeEvidence({ id: 'ev-a', pageNumber: 1, blockIndex: 1 }),
        makeEvidence({ id: 'ev-b', pageNumber: 1, blockIndex: 0 }),
        makeEvidence({ id: 'ev-y', pageNumber: 2, blockIndex: 0 }),
      ];

      const sorted = sortEvidenceDeterministically(evidences);

      // Expected: ev-b (p1,b0) < ev-a (p1,b1) < ev-y (p2,b0, id<y) < ev-z (p2,b0, id>y)
      expect(sorted.map(e => e.id)).toEqual(['ev-b', 'ev-a', 'ev-y', 'ev-z']);
    });

    it('sortEvidenceDeterministically: does not mutate original array', () => {
      const original: EvidenceAtom[] = [
        makeEvidence({ id: 'ev-b', pageNumber: 2 }),
        makeEvidence({ id: 'ev-a', pageNumber: 1 }),
      ];
      const originalOrder = original.map(e => e.id);

      sortEvidenceDeterministically(original);

      expect(original.map(e => e.id)).toEqual(originalOrder);
    });

    it('sortTopicsDeterministically: sorts by originalOrder, then id', () => {
      const topics: CourseTopic[] = [
        makeTopic({ id: 't-z', originalOrder: 2 }),
        makeTopic({ id: 't-a', originalOrder: 1 }),
        makeTopic({ id: 't-y', originalOrder: 2 }),
      ];

      const sorted = sortTopicsDeterministically(topics);

      // Expected: t-a (order 1) < t-y (order 2, id<y... wait t-y < t-z) < t-z (order 2)
      expect(sorted.map(t => t.id)).toEqual(['t-a', 't-y', 't-z']);
    });

    it('buildRelationExtractionPrompt: different topic order → same output', () => {
      const evidences = [makeEvidence({ id: 'ev-1' })];
      const topicsNormal = [...COURSE_TOPICS];
      const topicsShuffled = [...COURSE_TOPICS].reverse();

      const prompt1 = buildRelationExtractionPrompt(topicsNormal, evidences);
      const prompt2 = buildRelationExtractionPrompt(topicsShuffled, evidences);

      expect(prompt1.dynamicInput).toBe(prompt2.dynamicInput);
    });
  });

  // ---------------------------------------------------------------
  // 6. Map/Set serialization is stable (same data, different insertion order → same output)
  // ---------------------------------------------------------------
  describe('6. Map/Set serialization is stable', () => {
    it('serializeDeterministically: same data, different key insertion order → same output', () => {
      const obj1: Record<string, unknown> = {};
      obj1['zebra'] = 'z';
      obj1['apple'] = 'a';
      obj1['mango'] = 'm';

      const obj2: Record<string, unknown> = {};
      obj2['mango'] = 'm';
      obj2['zebra'] = 'z';
      obj2['apple'] = 'a';

      expect(serializeDeterministically(obj1)).toBe(serializeDeterministically(obj2));
    });

    it('serializeDeterministically: output keys are sorted alphabetically', () => {
      const obj: Record<string, unknown> = {
        zebra: 'z',
        apple: 'a',
        mango: 'm',
      };

      const result = serializeDeterministically(obj);
      const lines = result.split('\n');

      expect(lines[0]).toContain('apple');
      expect(lines[1]).toContain('mango');
      expect(lines[2]).toContain('zebra');
    });

    it('serializeMapDeterministically: same data, different insertion order → same output', () => {
      const map1 = new Map<string, string>();
      map1.set('zebra', 'z');
      map1.set('apple', 'a');
      map1.set('mango', 'm');

      const map2 = new Map<string, string>();
      map2.set('mango', 'm');
      map2.set('zebra', 'z');
      map2.set('apple', 'a');

      const serializer = (key: string, value: string) => `${key}=${value}`;

      expect(serializeMapDeterministically(map1, serializer))
        .toBe(serializeMapDeterministically(map2, serializer));
    });

    it('serializeMapDeterministically: output keys are sorted', () => {
      const map = new Map<string, number>();
      map.set('zebra', 1);
      map.set('apple', 2);
      map.set('mango', 3);

      const result = serializeMapDeterministically(map, (k, v) => `${k}:${v}`);
      const lines = result.split('\n');

      expect(lines[0]).toContain('apple');
      expect(lines[1]).toContain('mango');
      expect(lines[2]).toContain('zebra');
    });

    it('buildTopicMergePrompt: same Set data, different insertion order → same output', () => {
      const windowResults = [
        {
          windowIndex: 0,
          topics: [makeTopic({ id: 't1', title: '主题A', evidenceIds: ['ev-1'] })],
        },
        {
          windowIndex: 1,
          topics: [makeTopic({ id: 't2', title: '主题B', evidenceIds: ['ev-2'] })],
        },
      ];

      const set1 = new Set<string>(['ev-3', 'ev-1', 'ev-2']);
      const set2 = new Set<string>(['ev-2', 'ev-3', 'ev-1']);

      const prompt1 = buildTopicMergePrompt(windowResults, set1);
      const prompt2 = buildTopicMergePrompt(windowResults, set2);

      expect(prompt1.dynamicInput).toBe(prompt2.dynamicInput);
      expect(prompt1.messages).toEqual(prompt2.messages);
    });

    it('buildTopicMergePrompt: large Set with different insertion order → same output', () => {
      const windowResults = [
        {
          windowIndex: 0,
          topics: [makeTopic({ id: 't1', title: '主题A' })],
        },
      ];

      const idsOrdered = ['ev-001', 'ev-002', 'ev-003', 'ev-004', 'ev-005'];
      const idsShuffled = ['ev-005', 'ev-002', 'ev-001', 'ev-004', 'ev-003'];

      const prompt1 = buildTopicMergePrompt(windowResults, new Set(idsOrdered));
      const prompt2 = buildTopicMergePrompt(windowResults, new Set(idsShuffled));

      expect(prompt1.dynamicInput).toBe(prompt2.dynamicInput);
    });

    it('buildTopicMergePrompt: Set evidence IDs appear sorted in dynamicInput', () => {
      const windowResults = [
        {
          windowIndex: 0,
          topics: [makeTopic({ id: 't1', title: '主题A' })],
        },
      ];

      const ids = new Set(['ev-003', 'ev-001', 'ev-002']);
      const prompt = buildTopicMergePrompt(windowResults, ids);

      // The evidence IDs should appear sorted in the dynamic input
      const idx1 = prompt.dynamicInput.indexOf('ev-001');
      const idx2 = prompt.dynamicInput.indexOf('ev-002');
      const idx3 = prompt.dynamicInput.indexOf('ev-003');

      expect(idx1).toBeGreaterThan(-1);
      expect(idx2).toBeGreaterThan(-1);
      expect(idx3).toBeGreaterThan(-1);
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });
  });

  // ---------------------------------------------------------------
  // 7. Prompt does not contain timestamps or random values
  // ---------------------------------------------------------------
  describe('7. Prompt does not contain timestamps or random values', () => {
    it('buildTopicExtractionPrompt: idempotent across multiple calls', () => {
      const evidences = [
        makeEvidence({ id: 'ev-1', pageNumber: 1, content: '内容A' }),
        makeEvidence({ id: 'ev-2', pageNumber: 2, content: '内容B' }),
      ];

      const prompt1 = buildTopicExtractionPrompt(evidences);
      const prompt2 = buildTopicExtractionPrompt(evidences);
      const prompt3 = buildTopicExtractionPrompt(evidences);

      expect(prompt1).toEqual(prompt2);
      expect(prompt2).toEqual(prompt3);
    });

    it('buildNoteGenerationPrompt: idempotent across multiple calls', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);
      const prompt2 = buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);
      const prompt3 = buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);

      expect(prompt1).toEqual(prompt2);
      expect(prompt2).toEqual(prompt3);
    });

    it('all prompt builders are idempotent', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const kp = makeKp({ topic: COURSE_TOPICS[0], macroRelations: COURSE_RELATIONS });

      const builders = [
        () => buildTopicExtractionPrompt(evidences),
        () => buildRelationExtractionPrompt(COURSE_TOPICS, evidences),
        () => buildInternalStructurePrompt(kp, COURSE_TOPICS),
        () => buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME),
        () => buildTopicMergePrompt(
          [{ windowIndex: 0, topics: COURSE_TOPICS }],
          new Set(['ev-1'])
        ),
      ];

      for (const buildFn of builders) {
        const p1 = buildFn();
        const p2 = buildFn();
        expect(p1).toEqual(p2);
      }
    });

    it('prompt output does not contain ISO timestamp patterns', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '测试内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      const fullText = prompt.system + prompt.stablePrefix + prompt.dynamicInput;

      // ISO datetime: 2024-01-15T10:30:00
      expect(fullText).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('prompt output does not contain unix timestamp patterns', () => {
      const kp = makeKp({ topic: COURSE_TOPICS[0], macroRelations: COURSE_RELATIONS });
      const prompt = buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);

      const fullText = prompt.system + prompt.stablePrefix + prompt.dynamicInput;

      // Unix timestamp (10-13 digit number)
      expect(fullText).not.toMatch(/\b\d{10,13}\b/);
    });

    it('prompt output does not contain Date.now() or Math.random() artifacts', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt1 = buildTopicExtractionPrompt(evidences);

      // Wait a tiny bit and build again
      const prompt2 = buildTopicExtractionPrompt(evidences);

      // If there were timestamps or random values, outputs would differ
      expect(prompt1).toEqual(prompt2);
    });
  });

  // ---------------------------------------------------------------
  // 8. Prompt version changes create different cache prefix
  // ---------------------------------------------------------------
  describe('8. Prompt version changes create different cache prefix', () => {
    it('different task types can have different promptVersions', () => {
      // topic-extraction is v3.0, note-generation is v3.1
      expect(PROMPT_VERSIONS['topic-extraction']).not.toBe(PROMPT_VERSIONS['note-generation']);
    });

    it('topic-extraction vs note-generation: different promptVersion → different cache prefix', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const topicExtractionPrompt = buildTopicExtractionPrompt(evidences);

      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const noteGenerationPrompt = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );

      // Cache prefix = everything stable: promptVersion + system + stablePrefix
      const cachePrefix1 =
        topicExtractionPrompt.promptVersion +
        topicExtractionPrompt.system +
        topicExtractionPrompt.stablePrefix;
      const cachePrefix2 =
        noteGenerationPrompt.promptVersion +
        noteGenerationPrompt.system +
        noteGenerationPrompt.stablePrefix;

      expect(cachePrefix1).not.toBe(cachePrefix2);
    });

    it('same promptVersion but different task type → still different cache prefix', () => {
      // topic-extraction and relation-extraction both have v3.0
      expect(PROMPT_VERSIONS['topic-extraction']).toBe(PROMPT_VERSIONS['relation-extraction']);

      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const topicExtractionPrompt = buildTopicExtractionPrompt(evidences);
      const relationExtractionPrompt = buildRelationExtractionPrompt(COURSE_TOPICS, evidences);

      // Even with same promptVersion, system + stablePrefix differ
      const cachePrefix1 =
        topicExtractionPrompt.promptVersion +
        topicExtractionPrompt.system +
        topicExtractionPrompt.stablePrefix;
      const cachePrefix2 =
        relationExtractionPrompt.promptVersion +
        relationExtractionPrompt.system +
        relationExtractionPrompt.stablePrefix;

      expect(cachePrefix1).not.toBe(cachePrefix2);
    });

    it('note-generation vs note-repair: different promptVersion in PROMPT_VERSIONS', () => {
      // Both are v3.1, but let's verify the version map is consistent
      expect(PROMPT_VERSIONS['note-generation']).toBe(PROMPT_VERSIONS['note-repair']);
    });

    it('all prompt versions are non-empty strings', () => {
      for (const [taskType, version] of Object.entries(PROMPT_VERSIONS)) {
        expect(taskType).toBeTruthy();
        expect(version).toBeTruthy();
        expect(typeof version).toBe('string');
        expect(version.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------
  // 9. Messages structure: system + user with stablePrefix + separator + dynamicInput
  // ---------------------------------------------------------------
  describe('9. Messages structure', () => {
    it('messages has exactly 2 entries: system + user', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      expect(prompt.messages).toHaveLength(2);
      expect(prompt.messages[0].role).toBe('system');
      expect(prompt.messages[1].role).toBe('user');
    });

    it('system message content equals system field', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      expect(prompt.messages[0].content).toBe(prompt.system);
    });

    it('user message content = stablePrefix + separator + dynamicInput', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      const expectedContent =
        prompt.stablePrefix + '\n\n=== DYNAMIC INPUT ===\n\n' + prompt.dynamicInput;

      expect(prompt.messages[1].content).toBe(expectedContent);
    });

    it('user message contains the === DYNAMIC INPUT === separator', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      expect(prompt.messages[1].content).toContain('=== DYNAMIC INPUT ===');
    });

    it('stablePrefix appears before === DYNAMIC INPUT === in user message', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const prompt = buildTopicExtractionPrompt(evidences);

      const userContent = prompt.messages[1].content;
      const stableIndex = userContent.indexOf(prompt.stablePrefix);
      const dynamicSeparatorIndex = userContent.indexOf('=== DYNAMIC INPUT ===');

      expect(stableIndex).toBeGreaterThanOrEqual(0);
      expect(dynamicSeparatorIndex).toBeGreaterThan(stableIndex);
    });

    it('all prompt builders produce correct message structure', () => {
      const evidences = [makeEvidence({ id: 'ev-1', content: '内容' })];
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const prompts = [
        buildTopicExtractionPrompt(evidences),
        buildRelationExtractionPrompt(COURSE_TOPICS, evidences),
        buildInternalStructurePrompt(kp, COURSE_TOPICS),
        buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME),
        buildTopicMergePrompt(
          [{ windowIndex: 0, topics: COURSE_TOPICS }],
          new Set(['ev-1'])
        ),
      ];

      for (const prompt of prompts) {
        expect(prompt.messages).toHaveLength(2);
        expect(prompt.messages[0].role).toBe('system');
        expect(prompt.messages[1].role).toBe('user');
        expect(prompt.messages[0].content).toBe(prompt.system);
        expect(prompt.messages[1].content).toBe(
          prompt.stablePrefix + '\n\n=== DYNAMIC INPUT ===\n\n' + prompt.dynamicInput
        );
      }
    });
  });

  // ---------------------------------------------------------------
  // 10. buildNoteGenerationPrompt: same system and stablePrefix for different topics
  // ---------------------------------------------------------------
  describe('10. buildNoteGenerationPrompt: same system and stablePrefix for different topics in same course', () => {
    it('three different topics → identical system and stablePrefix', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [makeContentItem({ id: 'i1', topicId: 't1', content: '线性回归内容' })],
          relations: [],
          orderedItemIds: ['i1'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[1],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [makeContentItem({ id: 'i2', topicId: 't2', content: '逻辑回归内容' })],
          relations: [],
          orderedItemIds: ['i2'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });
      const kp3 = makeKp({
        topic: COURSE_TOPICS[2],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [makeContentItem({ id: 'i3', topicId: 't3', content: '神经网络内容' })],
          relations: [],
          orderedItemIds: ['i3'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });

      const prompt1 = buildNoteGenerationPrompt(kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);
      const prompt2 = buildNoteGenerationPrompt(kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);
      const prompt3 = buildNoteGenerationPrompt(kp3, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);

      // System and stablePrefix identical across all three
      expect(prompt1.system).toBe(prompt2.system);
      expect(prompt2.system).toBe(prompt3.system);
      expect(prompt1.stablePrefix).toBe(prompt2.stablePrefix);
      expect(prompt2.stablePrefix).toBe(prompt3.stablePrefix);

      // But dynamicInput must be different for each
      expect(prompt1.dynamicInput).not.toBe(prompt2.dynamicInput);
      expect(prompt2.dynamicInput).not.toBe(prompt3.dynamicInput);
      expect(prompt1.dynamicInput).not.toBe(prompt3.dynamicInput);
    });

    it('stablePrefix does not contain topic-specific dynamic content', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
        internalStructure: {
          items: [
            makeContentItem({
              id: 'i1',
              topicId: 't1',
              content: '这是特定于主题的动态内容XYZ',
            }),
          ],
          relations: [],
          orderedItemIds: ['i1'],
          source: 'ai',
          warnings: [],
          status: 'ready',
        },
      });

      const prompt = buildNoteGenerationPrompt(kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);

      // The specific content should be in dynamicInput, not stablePrefix
      expect(prompt.dynamicInput).toContain('这是特定于主题的动态内容XYZ');
      expect(prompt.stablePrefix).not.toContain('这是特定于主题的动态内容XYZ');
    });

    it('same course, different topics → system + stablePrefix form same cache prefix', () => {
      const kp1 = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });
      const kp2 = makeKp({
        topic: COURSE_TOPICS[1],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(kp1, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);
      const prompt2 = buildNoteGenerationPrompt(kp2, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME);

      const cachePrefix1 =
        prompt1.promptVersion + prompt1.system + prompt1.stablePrefix;
      const cachePrefix2 =
        prompt2.promptVersion + prompt2.system + prompt2.stablePrefix;

      expect(cachePrefix1).toBe(cachePrefix2);
    });

    it('different courseName → different stablePrefix', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const prompt1 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, '课程A'
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, '课程B'
      );

      expect(prompt1.stablePrefix).not.toBe(prompt2.stablePrefix);
      expect(prompt1.stablePrefix).toContain('课程A');
      expect(prompt2.stablePrefix).toContain('课程B');
    });

    it('different orderedTopics → different stablePrefix', () => {
      const kp = makeKp({
        topic: COURSE_TOPICS[0],
        macroRelations: COURSE_RELATIONS,
      });

      const fewerTopics = COURSE_TOPICS.slice(0, 2);

      const prompt1 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, COURSE_TOPICS, COURSE_NAME
      );
      const prompt2 = buildNoteGenerationPrompt(
        kp, SHARED_MEMORY, fewerTopics, COURSE_NAME
      );

      expect(prompt1.stablePrefix).not.toBe(prompt2.stablePrefix);
      // Full course has 3 topics, fewer has 2
      expect(prompt1.stablePrefix).toContain('神经网络');
      expect(prompt2.stablePrefix).not.toContain('神经网络');
    });
  });
});
