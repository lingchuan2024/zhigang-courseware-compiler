import { describe, expect, it } from 'vitest';
import { createExampleCourse } from '../examples';

describe('example course (v6 fixture)', () => {
  const example = createExampleCourse();
  const blockIds = new Set(
    example.sourceDocuments.flatMap(doc => doc.blocks.map(block => block.id)),
  );
  const topicIds = new Set(example.knowledgeTopics.map(topic => topic.id));
  const teachingBlockIds = new Set(example.teachingBlocks.map(block => block.id));

  it('covers every topic with cards and a narrative path', () => {
    expect(example.knowledgeTopics.length).toBeGreaterThanOrEqual(8);

    for (const topic of example.knowledgeTopics) {
      const cards = example.knowledgeCards.filter(card => card.topicId === topic.id);
      expect(cards.length).toBeGreaterThan(0);
      expect(topic.name.trim().length).toBeGreaterThan(0);
      expect(topic.sourceRanges.length).toBeGreaterThan(0);
      expect(example.narrativePaths[topic.id]?.orderedTeachingBlockIds.length)
        .toBe(cards.length);
    }
  });

  it('resolves every source range to real markdown blocks', () => {
    const ranges = [
      ...example.knowledgeTopics.map(topic => topic.sourceRanges).flat(),
      ...example.teachingBlocks.map(block => block.sourceRanges).flat(),
      ...example.knowledgeCards.map(card => card.sourceRanges).flat(),
    ];
    expect(ranges.length).toBeGreaterThan(0);

    for (const range of ranges) {
      expect(blockIds.has(range.startBlockId)).toBe(true);
      expect(blockIds.has(range.endBlockId)).toBe(true);
    }
  });

  it('keeps topic relations and learning path consistent', () => {
    for (const relation of example.topicRelations) {
      expect(topicIds.has(relation.sourceTopicId)).toBe(true);
      expect(topicIds.has(relation.targetTopicId)).toBe(true);
    }

    const ordered = example.courseLearningPath.orderedTopicIds;
    expect(ordered.length).toBe(example.knowledgeTopics.length);
    expect(new Set(ordered).size).toBe(ordered.length);
    for (const topicId of ordered) {
      expect(topicIds.has(topicId)).toBe(true);
    }
  });

  it('references existing teaching blocks from cards and relations', () => {
    for (const card of example.knowledgeCards) {
      expect(teachingBlockIds.has(card.teachingBlockId)).toBe(true);
      expect(card.conciseSummary.trim().length).toBeGreaterThan(0);
      expect(card.detailedNote.trim().length).toBeGreaterThan(0);
    }

    for (const relation of example.teachingRelations) {
      expect(teachingBlockIds.has(relation.sourceBlockId)).toBe(true);
      expect(teachingBlockIds.has(relation.targetBlockId)).toBe(true);
    }
  });

  it('ships a completed master note with full card coverage', () => {
    const note = example.courseMasterNote;
    expect(note.status).toBe('completed');
    expect(note.chapters.length).toBeGreaterThanOrEqual(2);
    expect(note.chapters.every(chapter => chapter.status === 'completed')).toBe(true);
    expect(note.markdown).toContain('# 概率模型基础');
    expect(note.coverage.missingCardIds).toEqual([]);
    expect(note.generatedFromStructureVersion).toBe(example.structureVersion);
  });

  it('provides a markdown document preview with multiple pages', () => {
    expect(example.document.fileType).toBe('markdown');
    expect(example.document.pages.length).toBeGreaterThan(5);
    expect(example.sourceDocuments[0].markdown).toContain('最大似然估计');
  });
});
