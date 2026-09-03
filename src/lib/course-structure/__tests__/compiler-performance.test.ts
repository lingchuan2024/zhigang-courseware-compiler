import { describe, expect, it } from 'vitest';
import type { ModelConfig, SourceDocument } from '../../../types';
import { compileCourseStructure } from '../compiler';
import { buildSectionBatches } from '../section-batching';
import type { SectionCompilation } from '../types';

const config: ModelConfig = { endpoint: 'test', model: 'test', apiKey: 'test' };

function sectionDocument(index: number): SourceDocument {
  const documentId = `document-${index}`;
  const content = `课程概念 ${index} 的定义、条件和应用。`;
  return {
    id: documentId,
    courseId: 'course',
    title: `章节 ${index}`,
    markdown: content,
    blocks: [{
      id: `${documentId}-block`, documentId, type: 'paragraph', content,
      headingPath: [`章节 ${index}`], orderIndex: 0, contentHash: `hash-${index}`,
    }],
    outline: [], contentHash: `document-hash-${index}`, createdAt: '', updatedAt: '',
  };
}

describe('course compiler model-call surface', () => {
  it('does not add model calls per topic', async () => {
    const documents = Array.from({ length: 12 }, (_, index) => sectionDocument(index + 1));
    let batchCalls = 0;
    let reviewCalls = 0;

    const result = await compileCourseStructure(config, documents, 'course', {
      compileBatch: async batch => {
        batchCalls += 1;
        const evidence = {
          blockId: batch.blocks[0].id,
          quote: batch.blocks[0].content,
          role: 'definition' as const,
        };
        const topics = [1, 2, 3].map(number => ({
          localId: `${batch.id}:topic-${number}`,
          name: `${batch.documentId} 概念 ${number}`,
          aliases: [],
          learningObjective: `解释概念 ${number}`,
          scope: batch.documentId,
          genre: 'concept' as const,
          difficulty: 2,
          importance: 'important' as const,
          evidence: [evidence],
          confidence: 0.9,
        }));
        return {
          batchId: batch.id,
          sectionIds: batch.sectionIds,
          topicMentions: topics,
          teachingUnits: topics.map(topic => ({
            localId: `${topic.localId}:unit`, topicLocalId: topic.localId,
            role: 'definition' as const, title: topic.name, summary: topic.scope,
            evidence: [evidence], required: true, confidence: 0.9,
          })),
          orderClaims: [], unresolvedReferences: [], confidence: 0.9,
        } satisfies SectionCompilation;
      },
      review: async () => {
        reviewCalls += 1;
        return { operations: [], constraints: [], warnings: [] };
      },
    });

    expect(result.topics.length).toBeGreaterThan(20);
    expect(batchCalls).toBe(buildSectionBatches(documents).length);
    expect(reviewCalls).toBe(1);
  });
});
