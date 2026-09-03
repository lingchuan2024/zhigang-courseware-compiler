import { describe, expect, it } from 'vitest';
import type { KnowledgeTopic, TeachingBlock } from '../../types';
import { buildCardEnrichmentPrompt } from '../card-enrichment';

const topic: KnowledgeTopic = {
  id: 'topic-1', courseId: 'course-1', name: 'Representer Theorem', aliases: [], summary: '表示定理',
  learningObjective: '理解有限维表示', sourceRanges: [], childTopicIds: [], importance: 'core', difficulty: 3,
  knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
};

const teachingBlock: TeachingBlock = {
  id: 'unit-1', topicId: topic.id, type: 'free-form', title: '定理陈述', summary: '最优解存在有限维表示',
  sourceRanges: [], importance: 'required', confidence: 0.9,
};

describe('knowledge card enrichment prompt', () => {
  it('uses a bounded low-reasoning request for Agent Plan responses', () => {
    const prompt = buildCardEnrichmentPrompt(topic, teachingBlock, [], [teachingBlock], '课件原文');

    expect(prompt.reasoningEffort).toBe('minimal');
    expect(prompt.maxOutputTokens).toBe(4096);
    expect(prompt.maxStructuredAttempts).toBe(1);
    expect(prompt.maxTransportAttempts).toBe(1);
  });
});
