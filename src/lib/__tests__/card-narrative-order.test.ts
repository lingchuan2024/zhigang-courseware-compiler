import { describe, expect, it } from 'vitest';
import type { KnowledgeTopic, MarkdownBlock, TeachingBlock, TopicNarrativePath } from '../../types';
import { generateCards } from '../card-generator';

const topic: KnowledgeTopic = {
  id: 'topic-1', courseId: 'course-1', name: 'GLM', aliases: [], summary: '广义线性模型',
  learningObjective: '理解 GLM', sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3,
  knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
};

function teachingBlock(id: string, title: string): TeachingBlock {
  return {
    id, topicId: topic.id, type: 'free-form', title,
    sourceRanges: [{ documentId: 'doc-1', startBlockId: `source-${id}`, endBlockId: `source-${id}` }],
    summary: `${title}摘要`,
    importance: 'required', confidence: 0.9,
  };
}

function sourceBlock(id: string, orderIndex: number): MarkdownBlock {
  return {
    id: `source-${id}`, documentId: 'doc-1', type: 'paragraph', content: `${id} 的课件原文`,
    headingPath: [], orderIndex, contentHash: `hash-${id}`,
  };
}

describe('knowledge card narrative order', () => {
  it('uses the second-layer narrative path instead of the raw teaching block array order', () => {
    const narrativePaths: Record<string, TopicNarrativePath> = {
      [topic.id]: {
        topicId: topic.id,
        orderedTeachingBlockIds: ['block-family', 'block-formula'],
        rationale: '先说明广义线性族，再解释公式',
      },
    };

    const cards = generateCards(
      [topic],
      [teachingBlock('block-formula', 'GLM 公式'), teachingBlock('block-family', '广义线性族')],
      [sourceBlock('block-formula', 1), sourceBlock('block-family', 0)],
      [],
      narrativePaths,
    );

    expect(cards.map(card => card.teachingBlockId)).toEqual(['block-family', 'block-formula']);
    expect(cards.map(card => card.narrativeIndex)).toEqual([0, 1]);
  });

  it('does not create an untraceable card for a teaching block without source evidence', () => {
    const untraceable = { ...teachingBlock('missing', '无原文节点'), sourceRanges: [] };

    expect(generateCards([topic], [untraceable], [], [], {})).toEqual([]);
  });
});
