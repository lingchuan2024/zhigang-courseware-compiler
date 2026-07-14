import { describe, expect, it } from 'vitest';
import type {
  CourseLearningPath,
  KnowledgeTopic,
  SourceRange,
  TeachingBlock,
  TeachingRelation,
  TopicNarrativePath,
  TopicRelation,
} from '../../types';
import { buildCourseNetwork, buildExpandedKnowledgeNetwork, buildTeachingNetwork } from '../knowledge-network-adapter';

const sourceRange: SourceRange = { documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' };

function topic(id: string, name: string): KnowledgeTopic {
  return {
    id,
    courseId: 'course-1',
    name,
    aliases: [],
    summary: `${name}摘要`,
    learningObjective: `理解${name}`,
    sourceRanges: [sourceRange],
    childTopicIds: [],
    importance: 'core',
    difficulty: 2,
    knowledgeGenre: 'concept',
    confidence: 0.9,
    status: 'generated',
  };
}

function teachingBlock(id: string, title: string): TeachingBlock {
  return {
    id,
    topicId: 't1',
    type: id === 'b1' ? 'definition' : 'example',
    title,
    sourceRanges: [sourceRange],
    summary: `${title}摘要`,
    importance: 'required',
    confidence: 0.85,
  };
}

describe('knowledge network adapter', () => {
  it('keeps course relations and learning-path edges as separate layers', () => {
    const topics = [topic('t1', '概率模型'), topic('t2', '最大似然估计'), topic('t3', '线性回归')];
    const relations: TopicRelation[] = [
      { id: 'r1', sourceTopicId: 't1', targetTopicId: 't2', type: 'hard_prerequisite', reason: '前置', confidence: 0.9 },
      { id: 'r2', sourceTopicId: 'missing', targetTopicId: 't3', type: 'helpful_before', reason: '无效', confidence: 0.4 },
    ];
    const path: CourseLearningPath = {
      orderedTopicIds: ['t1', 't2', 't3'],
      steps: [],
    };

    const graph = buildCourseNetwork(topics, relations, path);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.map(edge => edge.id)).toEqual(['r1']);
    expect(graph.pathEdges.map(edge => [edge.sourceId, edge.targetId])).toEqual([
      ['t1', 't2'],
      ['t2', 't3'],
    ]);
    expect(graph.nodes[0].sourceRanges).toEqual([sourceRange]);
    expect(graph.nodes.map(node => node.sequence)).toEqual([1, 2, 3]);
    expect(graph.warnings[0]).toContain('missing');
  });

  it('builds the second-layer network only from the selected topic', () => {
    const blocks = [teachingBlock('b1', '定义'), teachingBlock('b2', '案例'), {
      ...teachingBlock('other', '其他知识内容'),
      topicId: 't2',
    }];
    const relations: TeachingRelation[] = [
      { id: 'tr1', topicId: 't1', sourceBlockId: 'b1', targetBlockId: 'b2', type: 'example_of', reason: '举例', confidence: 0.9 },
      { id: 'tr2', topicId: 't2', sourceBlockId: 'other', targetBlockId: 'b2', type: 'supports', reason: '其他', confidence: 0.5 },
    ];
    const path: TopicNarrativePath = {
      topicId: 't1',
      orderedTeachingBlockIds: ['b1', 'b2'],
      rationale: '先定义后案例',
    };

    const graph = buildTeachingNetwork('t1', blocks, relations, path);

    expect(graph.nodes.map(node => node.id)).toEqual(['b1', 'b2']);
    expect(graph.edges.map(edge => edge.id)).toEqual(['tr1']);
    expect(graph.pathEdges).toHaveLength(1);
    expect(graph.pathEdges[0]).toMatchObject({ sourceId: 'b1', targetId: 'b2' });
    expect(graph.nodes.map(node => node.sequence)).toEqual([1, 2]);
  });

  it('expands a selected topic internal network in the same course graph', () => {
    const course = buildCourseNetwork(
      [topic('t1', 'GLM'), topic('t2', '最大似然估计')],
      [{ id: 'r1', sourceTopicId: 't2', targetTopicId: 't1', type: 'hard_prerequisite', reason: '前置', confidence: 0.9 }],
      { orderedTopicIds: ['t2', 't1'], steps: [] },
    );
    const teaching = buildTeachingNetwork(
      't1',
      [
        { ...teachingBlock('b1', 'GLM 公式'), category: '公式体系' },
        { ...teachingBlock('b2', '广义线性族'), category: '分布族' },
      ],
      [{ id: 'tr1', topicId: 't1', sourceBlockId: 'b2', targetBlockId: 'b1', type: 'explains', reason: '界定公式的适用对象', confidence: 0.88 }],
      { topicId: 't1', orderedTeachingBlockIds: ['b2', 'b1'], rationale: '先族后公式' },
    );

    const graph = buildExpandedKnowledgeNetwork(course, teaching, 't1');

    expect(graph.nodes.map(node => node.id)).toEqual(['t1', 't2', 'b1', 'b2']);
    expect(graph.nodes.find(node => node.id === 'b1')).toMatchObject({
      category: '公式体系',
      sequence: 2,
      sequenceLabel: '2.2',
    });
    expect(graph.edges.map(edge => edge.id)).toContain('tr1');
    expect(graph.focusNodeIds).toEqual(['b1', 'b2']);
    expect(graph.expandedGroup).toEqual({
      topicId: 't1',
      label: 'GLM · 内部知识网',
      nodeIds: ['b1', 'b2'],
    });
  });
});
