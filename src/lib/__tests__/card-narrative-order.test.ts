import { describe, expect, it } from 'vitest';
import type { KnowledgeTopic, TeachingBlock, TopicNarrativePath } from '../../types';
import { generateCards } from '../card-generator';

const topic: KnowledgeTopic = {
  id: 'topic-1', courseId: 'course-1', name: 'GLM', aliases: [], summary: '广义线性模型',
  learningObjective: '理解 GLM', sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3,
  knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
};

function teachingBlock(id: string, title: string): TeachingBlock {
  return {
    id, topicId: topic.id, type: 'free-form', title, sourceRanges: [], summary: `${title}摘要`,
    importance: 'required', confidence: 0.9,
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
      [],
      [],
      narrativePaths,
    );

    expect(cards.map(card => card.teachingBlockId)).toEqual(['block-family', 'block-formula']);
    expect(cards.map(card => card.narrativeIndex)).toEqual([0, 1]);
  });
});
