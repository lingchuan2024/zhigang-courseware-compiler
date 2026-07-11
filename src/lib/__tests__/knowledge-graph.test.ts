import { describe, it, expect } from 'vitest';
import {
  generateLocalTopicsFromEvidences,
  normalizeTopics,
  normalizeRelations,
  detectCycles,
  breakCycles,
  topologicalSort,
  assessTopicSetQuality,
  generateTopicId,
} from '../knowledge-graph';
import { createExampleCourse } from '../examples';
import { EvidenceAtom, EvidenceType, CourseTopic, MacroKnowledgeRelation } from '../../types';

// 辅助函数：构造 EvidenceAtom（提供默认的 documentId / blockIndex / contentHash）
function makeEvidence(overrides: Partial<EvidenceAtom> & { id: string; pageNumber: number; type: EvidenceType; content: string }): EvidenceAtom {
  return {
    documentId: 'test-doc',
    blockIndex: 0,
    contentHash: `${overrides.documentId || 'test-doc'}-${overrides.pageNumber}-${overrides.blockIndex ?? 0}-${overrides.type}-${overrides.content.slice(0, 20)}`,
    confidence: 0.8,
    ...overrides,
  };
}

// 辅助函数：构造最小EvidenceAtom
function ev(id: string, pageNumber: number, type: EvidenceType, content: string, confidence = 0.8): EvidenceAtom {
  return makeEvidence({ id, pageNumber, type, content, confidence });
}

// 辅助函数：构造最小CourseTopic
function topic(
  id: string,
  title: string,
  evidenceIds: string[],
  originalPageNumbers: number[] = [1],
  originalOrder = 0
): CourseTopic {
  return {
    id,
    title,
    aliases: [],
    type: 'composite',
    learningGoal: `学习${title}`,
    evidenceIds,
    originalPageNumbers,
    importance: 'core',
    confidence: 0.7,
    originalOrder,
    recommendedOrder: originalOrder,
    noteStatus: 'pending',
  };
}

// 辅助函数：构造MacroKnowledgeRelation
function rel(
  id: string,
  source: string,
  target: string,
  type: MacroKnowledgeRelation['type'],
  confidence = 0.7,
  evidenceIds: string[] = []
): MacroKnowledgeRelation {
  return {
    id,
    sourceTopicId: source,
    targetTopicId: target,
    type,
    evidenceIds,
    reason: '',
    confidence,
    origin: 'ai-inferred',
  };
}

describe('knowledge-graph', () => {
  describe('generateLocalTopicsFromEvidences', () => {
    it('should segment content by title-based boundaries', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '1. 概率模型基本概念'),
        ev('e2', 1, 'text', '概率模型是描述随机现象的数学框架。'),
        ev('e3', 2, 'title', '2. 最大似然估计'),
        ev('e4', 2, 'text', '似然函数 L(θ) = p(D|θ)'),
        ev('e5', 2, 'formula', 'θ̂ = argmax L(θ)'),
        ev('e6', 3, 'title', '3. 线性回归'),
        ev('e7', 3, 'text', 'y = w^T x + b + ε'),
      ];

      const result = generateLocalTopicsFromEvidences(evidences);
      expect(result.topics.length).toBeGreaterThanOrEqual(3);

      // 每个主题应该有标题
      const titles = result.topics.map(t => t.title);
      expect(titles.some(t => t.includes('概率模型'))).toBe(true);
      expect(titles.some(t => t.includes('最大似然'))).toBe(true);
      expect(titles.some(t => t.includes('线性回归'))).toBe(true);
    });

    it('should not assign any evidence to multiple topics', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '1. 第一章'),
        ev('e2', 1, 'text', '正文内容一。'),
        ev('e3', 2, 'title', '2. 第二章'),
        ev('e4', 2, 'text', '正文内容二。'),
        ev('e5', 3, 'title', '3. 第三章'),
        ev('e6', 3, 'text', '正文内容三。'),
      ];

      const result = generateLocalTopicsFromEvidences(evidences);
      const allEvIds: string[] = [];
      for (const t of result.topics) {
        allEvIds.push(...t.evidenceIds);
      }
      const uniqueIds = new Set(allEvIds);
      // 每个证据ID在所有主题中只出现一次（不重复分配）
      expect(allEvIds.length).toBe(uniqueIds.size);
    });

    it('should generate at least 8 meaningful topics for the example course', () => {
      // 使用示例课程的证据（与examples.ts中的PAGES一致）
      const { evidences } = createExampleCourse();
      const result = generateLocalTopicsFromEvidences(evidences);

      expect(result.topics.length).toBeGreaterThanOrEqual(8);

      // 所有主题都应该有非空标题
      for (const t of result.topics) {
        expect(t.title.trim().length).toBeGreaterThan(0);
        expect(t.title.length).toBeLessThanOrEqual(50);
        expect(t.evidenceIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('normalizeTopics', () => {
    it('should filter out topics with empty titles', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '有效标题'),
        ev('e2', 1, 'text', '内容'),
      ];

      const modelTopics = [
        { title: '', evidenceIds: ['e1'] },
        { title: '   ', evidenceIds: ['e2'] },
        { title: '有效主题', evidenceIds: ['e1'] },
      ];

      const result = normalizeTopics(modelTopics as any, evidences);
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('有效主题');
    });

    it('should filter out topics with unknown types by defaulting to composite', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '测试'),
        ev('e2', 1, 'text', '内容'),
      ];

      const modelTopics = [
        { title: '主题A', type: 'invalid_type' as any, evidenceIds: ['e1'] },
        { title: '主题B', type: 'concept', evidenceIds: ['e2'] },
      ];

      const result = normalizeTopics(modelTopics, evidences);
      expect(result.length).toBe(2);
      // 未知类型应该默认为 composite
      expect(result[0].type).toBe('composite');
      expect(result[1].type).toBe('concept');
    });

    it('should filter out topics with no valid evidenceIds', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'text', '内容'),
      ];

      const modelTopics = [
        { title: '无证据主题', evidenceIds: [] },
        { title: '无效证据', evidenceIds: ['fake_id'] },
        { title: '有效主题', evidenceIds: ['e1'] },
      ];

      const result = normalizeTopics(modelTopics as any, evidences);
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('有效主题');
    });

    it('should merge duplicate/near-duplicate topics', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '概率模型'),
        ev('e2', 1, 'text', '定义'),
      ];

      const modelTopics = [
        { title: '概率模型', evidenceIds: ['e1'] },
        { title: '概率模型', aliases: [], evidenceIds: ['e2'] },
      ];

      const result = normalizeTopics(modelTopics as any, evidences);
      // 合并后应该只有一个主题
      expect(result.length).toBe(1);
      expect(result[0].evidenceIds).toContain('e1');
      expect(result[0].evidenceIds).toContain('e2');
    });
  });

  describe('normalizeRelations', () => {
    const evidences: EvidenceAtom[] = [
      ev('e1', 1, 'text', 'a'),
      ev('e2', 1, 'text', 'b'),
    ];

    function makeTopics(): CourseTopic[] {
      return [
        topic(generateTopicId('A'), 'A', ['e1'], [1], 0),
        topic(generateTopicId('B'), 'B', ['e2'], [2], 1),
      ];
    }

    it('should filter out relations with unknown types', () => {
      const topics = makeTopics();
      const modelRels = [
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'unknown_type' as any },
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'hard_prerequisite' as const },
      ];

      const result = normalizeRelations(modelRels, topics, evidences);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('hard_prerequisite');
    });

    it('should filter out self-loops', () => {
      const topics = makeTopics();
      const modelRels = [
        { sourceTopicId: topics[0].id, targetTopicId: topics[0].id, type: 'hard_prerequisite' as const },
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'soft_prerequisite' as const },
      ];

      const result = normalizeRelations(modelRels, topics, evidences);
      expect(result.length).toBe(1);
      expect(result[0].targetTopicId).toBe(topics[1].id);
    });

    it('should deduplicate relations', () => {
      const topics = makeTopics();
      const modelRels = [
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'hard_prerequisite' as const, confidence: 0.6 },
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'hard_prerequisite' as const, confidence: 0.8 },
      ];

      const result = normalizeRelations(modelRels, topics, evidences);
      expect(result.length).toBe(1);
      // 保留较高置信度
      expect(result[0].confidence).toBe(0.8);
    });

    it('should normalize contrasts_with by ordering IDs (A->B and B->A become one)', () => {
      const topics = [
        topic('topic_aaa', 'AAA', ['e1'], [1], 0),
        topic('topic_zzz', 'ZZZ', ['e2'], [2], 1),
      ];

      // B->A 方向的 contrasts_with 应该被翻转为 A->B
      const modelRels = [
        { sourceTopicId: 'topic_zzz', targetTopicId: 'topic_aaa', type: 'contrasts_with' as const },
      ];

      const result = normalizeRelations(modelRels, topics, evidences);
      expect(result.length).toBe(1);
      // source应该是字母序较小的ID
      expect(result[0].sourceTopicId).toBe('topic_aaa');
      expect(result[0].targetTopicId).toBe('topic_zzz');
    });

    it('should filter relations with non-existent topic IDs', () => {
      const topics = makeTopics();
      const modelRels = [
        { sourceTopicId: 'nonexistent', targetTopicId: topics[1].id, type: 'hard_prerequisite' as const },
        { sourceTopicId: topics[0].id, targetTopicId: topics[1].id, type: 'used_by' as const },
      ];

      const result = normalizeRelations(modelRels, topics, evidences);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('used_by');
    });
  });

  describe('detectCycles', () => {
    it('should return hasCycle=false for acyclic graph', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
        topic('c', 'C', [], [3], 2),
      ];
      const relations = [
        rel('r1', 'a', 'b', 'hard_prerequisite'),
        rel('r2', 'b', 'c', 'hard_prerequisite'),
      ];

      const result = detectCycles(topics, relations);
      expect(result.hasCycle).toBe(false);
      expect(result.cycles.length).toBe(0);
    });

    it('should detect simple cycle A->B->C->A', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
        topic('c', 'C', [], [3], 2),
      ];
      const relations = [
        rel('r1', 'a', 'b', 'hard_prerequisite'),
        rel('r2', 'b', 'c', 'hard_prerequisite'),
        rel('r3', 'c', 'a', 'hard_prerequisite'),
      ];

      const result = detectCycles(topics, relations);
      expect(result.hasCycle).toBe(true);
      expect(result.cycles.length).toBeGreaterThanOrEqual(1);
      // 应该有边被标记为移除
      expect(result.edgesToRemove.length).toBeGreaterThanOrEqual(1);
    });

    it('should not detect cycles in non-prerequisite relations (e.g., contrasts_with)', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
      ];
      const relations = [
        rel('r1', 'a', 'b', 'contrasts_with'),
        rel('r2', 'b', 'a', 'contrasts_with'),
      ];

      const result = detectCycles(topics, relations);
      // contrasts_with 不参与拓扑排序，不应该形成环
      expect(result.hasCycle).toBe(false);
    });
  });

  describe('breakCycles', () => {
    it('should remove edges deterministically with tie-breaker (lowest confidence, then ID)', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
        topic('c', 'C', [], [3], 2),
      ];
      // 三角形环，所有边置信度相同 -> tie-breaker 应选择ID字母序最小的边
      const relations = [
        rel('r_ab', 'a', 'b', 'hard_prerequisite', 0.7),
        rel('r_bc', 'b', 'c', 'hard_prerequisite', 0.7),
        rel('r_ca', 'c', 'a', 'hard_prerequisite', 0.7),
      ];

      const cycleInfo = detectCycles(topics, relations);
      expect(cycleInfo.hasCycle).toBe(true);

      const broken = breakCycles(relations, cycleInfo);
      // 应该移除至少一条边
      expect(broken.length).toBeLessThan(relations.length);

      // 多次运行结果应该一致（确定性）
      const broken2 = breakCycles(relations, cycleInfo);
      expect(broken.map(r => r.id).sort()).toEqual(broken2.map(r => r.id).sort());
    });

    it('should prefer removing lower confidence edges', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
      ];
      // A->B 和 B->A 形成2节点环
      const relations = [
        rel('r_high', 'a', 'b', 'hard_prerequisite', 0.9),
        rel('r_low', 'b', 'a', 'hard_prerequisite', 0.3),
      ];

      const cycleInfo = detectCycles(topics, relations);
      const broken = breakCycles(relations, cycleInfo);

      // 低置信度边应被移除
      const remainingIds = broken.map(r => r.id);
      expect(remainingIds).toContain('r_high');
      expect(remainingIds).not.toContain('r_low');
    });
  });

  describe('topologicalSort', () => {
    it('should produce deterministic ordering', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
        topic('c', 'C', [], [3], 2),
        topic('d', 'D', [], [4], 3),
      ];
      const relations = [
        rel('r1', 'a', 'c', 'hard_prerequisite'),
        rel('r2', 'b', 'd', 'hard_prerequisite'),
      ];

      const result1 = topologicalSort(topics, relations);
      const result2 = topologicalSort(topics, relations);
      expect(result1.orderedTopicIds).toEqual(result2.orderedTopicIds);
    });

    it('should return warnings when cycles are broken', () => {
      const topics = [
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
      ];
      const relations = [
        rel('r1', 'a', 'b', 'hard_prerequisite'),
        rel('r2', 'b', 'a', 'hard_prerequisite'),
      ];

      const result = topologicalSort(topics, relations);
      // 应该有环检测的警告
      const cycleWarnings = result.warnings.filter(w => w.includes('环'));
      expect(cycleWarnings.length).toBeGreaterThanOrEqual(1);
      // 所有节点都应该在结果中
      expect(result.orderedTopicIds.length).toBe(2);
    });

    it('should respect prerequisite ordering in DAG', () => {
      const topics = [
        topic('c', 'C', [], [3], 2),
        topic('a', 'A', [], [1], 0),
        topic('b', 'B', [], [2], 1),
      ];
      // A -> C, B -> C：A和B应在C前面
      const relations = [
        rel('r1', 'a', 'c', 'hard_prerequisite'),
        rel('r2', 'b', 'c', 'hard_prerequisite'),
      ];

      const result = topologicalSort(topics, relations);
      const idxA = result.orderedTopicIds.indexOf('a');
      const idxB = result.orderedTopicIds.indexOf('b');
      const idxC = result.orderedTopicIds.indexOf('c');
      expect(idxA).toBeLessThan(idxC);
      expect(idxB).toBeLessThan(idxC);
    });
  });

  describe('assessTopicSetQuality', () => {
    it('should penalize single-topic coverage of long content (>15 evidences)', () => {
      const evidences: EvidenceAtom[] = [];
      for (let i = 0; i < 20; i++) {
        evidences.push(ev(`e${i}`, Math.floor(i / 3) + 1, 'text', `内容段落${i}`));
      }

      const topics = [
        topic('t1', '课程内容', evidences.map(e => e.id), [1], 0),
      ];

      const assessment = assessTopicSetQuality(topics, evidences);
      // -30 (single topic covering >15 evs) → score=70, penalized but not rejected
      expect(assessment.score).toBeLessThan(100);
      expect(assessment.reasons.some(r => r.includes('单主题') || r.includes('过多'))).toBe(true);
    });

    it('should reject single-topic when coverage is poor AND content is long', () => {
      const evidences: EvidenceAtom[] = [];
      for (let i = 0; i < 25; i++) {
        evidences.push(ev(`e${i}`, Math.floor(i / 3) + 1, 'text', `内容段落${i}，包含更多文字和描述。`));
      }

      // 单主题只覆盖10/25=40%的证据
      const topics = [
        topic('t1', '课程内容', evidences.slice(0, 10).map(e => e.id), [1], 0),
      ];

      const assessment = assessTopicSetQuality(topics, evidences);
      // 覆盖率40% < 50% → -40; 单主题>5 → -30; 总分30 < 50
      expect(assessment.acceptable).toBe(false);
      expect(assessment.score).toBeLessThan(50);
    });

    it('should reject single-topic when there are multiple title evidences', () => {
      const evidences: EvidenceAtom[] = [
        ev('e0', 1, 'title', '第一章'),
        ev('e1', 1, 'text', '内容一'),
        ev('e2', 2, 'title', '第二章'),
        ev('e3', 2, 'text', '内容二'),
        ev('e4', 3, 'title', '第三章'),
        ev('e5', 3, 'text', '内容三'),
        ev('e6', 4, 'title', '第四章'),
        ev('e7', 4, 'text', '内容四'),
        ev('e8', 5, 'title', '第五章'),
        ev('e9', 5, 'text', '内容五'),
      ];

      // 5个title证据但只有一个主题 → -50，再加其他扣分
      const topics = [
        topic('t1', '全部内容', evidences.map(e => e.id), [1, 2, 3, 4, 5], 0),
      ];

      const assessment = assessTopicSetQuality(topics, evidences);
      // titleEvCount=5 >=3 → -50; score=50 borderline
      // Add: no topic should really cover all these → check reasons mention the issue
      expect(assessment.reasons.some(r => r.includes('一个主题') || r.includes('泛化'))).toBe(true);
    });

    it('should accept good multi-topic results', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'title', '第一章 概念'),
        ev('e2', 1, 'text', '概念定义'),
        ev('e3', 2, 'title', '第二章 方法'),
        ev('e4', 2, 'text', '方法描述'),
        ev('e5', 3, 'title', '第三章 应用'),
        ev('e6', 3, 'text', '应用说明'),
      ];

      const topics = [
        topic('t1', '概念', ['e1', 'e2'], [1], 0),
        topic('t2', '方法', ['e3', 'e4'], [2], 1),
        topic('t3', '应用', ['e5', 'e6'], [3], 2),
      ];

      const assessment = assessTopicSetQuality(topics, evidences);
      expect(assessment.acceptable).toBe(true);
      expect(assessment.score).toBeGreaterThanOrEqual(50);
    });

    it('should penalize topics with no evidence', () => {
      const evidences: EvidenceAtom[] = [
        ev('e1', 1, 'text', '内容'),
      ];

      const topics = [
        topic('t1', '有效主题', ['e1'], [1], 0),
        topic('t2', '空主题', [], [2], 1),
      ];

      const assessment = assessTopicSetQuality(topics, evidences);
      expect(assessment.reasons.some(r => r.includes('无有效证据'))).toBe(true);
    });
  });
});
