import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '../../../types';
import { buildSectionBatches } from '../section-batching';

function document(id: string, contents: string[]): SourceDocument {
  return {
    id,
    courseId: 'course',
    title: id,
    markdown: contents.join('\n\n'),
    outline: [],
    contentHash: `hash-${id}`,
    createdAt: '',
    updatedAt: '',
    blocks: contents.map((content, orderIndex) => ({
      id: `${id}-b${orderIndex}`,
      documentId: id,
      type: orderIndex === 0 ? 'heading' : 'paragraph',
      content,
      headingPath: [id],
      orderIndex,
      contentHash: `${id}-h${orderIndex}`,
      ...(orderIndex === 0 ? { headingLevel: 1 } : {}),
    })),
  };
}

describe('section batching', () => {
  it('never mixes documents in one batch', () => {
    const batches = buildSectionBatches([
      document('d1', ['# A', 'a']),
      document('d2', ['# B', 'b']),
    ], 1000);
    expect(batches.every(batch => new Set(
      batch.blocks.map(block => block.documentId),
    ).size === 1)).toBe(true);
  });

  it('keeps every block exactly once without overlap duplication', () => {
    const doc = document('d1', ['# A', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80)]);
    const batches = buildSectionBatches([doc], 60);
    const atoms = batches.flatMap(batch => batch.blocks);
    expect([...new Set(atoms.map(block => block.id))])
      .toEqual(doc.blocks.map(block => block.id));
    expect(atoms.filter(atom => atom.id === 'd1-b0').map(atom => atom.content).join(''))
      .toBe(doc.blocks[0].content);
  });

  it('uses top-level outline boundaries and retains preamble blocks', () => {
    const doc = document('d1', ['课程导言', '# A', '正文 A', '# B', '正文 B']);
    doc.blocks[0].type = 'paragraph';
    doc.blocks[1].type = 'heading';
    doc.blocks[1].headingLevel = 1;
    doc.blocks[3].type = 'heading';
    doc.blocks[3].headingLevel = 1;
    doc.outline = [
      { id: 's-a', title: 'A', level: 1, blockIds: ['d1-b1', 'd1-b2'], childSectionIds: [], startOrder: 1, endOrder: 2 },
      { id: 's-b', title: 'B', level: 1, blockIds: ['d1-b3', 'd1-b4'], childSectionIds: [], startOrder: 3, endOrder: 4 },
    ];
    const batches = buildSectionBatches([doc], 3);
    expect([...new Set(batches.flatMap(batch => batch.blocks.map(block => block.id)))])
      .toEqual(doc.blocks.map(block => block.id));
    expect(batches.flatMap(batch => batch.sectionIds)).toContain('s-a');
  });

  it('assigns stable atom ids and source offsets when a single source block is split', () => {
    const doc = document('large', ['重复知识。'.repeat(80)]);
    doc.blocks[0].type = 'paragraph';
    const atoms = buildSectionBatches([doc], 20).flatMap(batch => batch.blocks);

    expect(atoms.length).toBeGreaterThan(1);
    expect(new Set(atoms.map(atom => atom.atomId)).size).toBe(atoms.length);
    expect(atoms.every(atom => atom.id === 'large-b0')).toBe(true);
    expect(atoms.map(atom => atom.sourceStartOffset)).toEqual(
      atoms.reduce<number[]>((offsets, _atom, index) => {
        offsets.push(index === 0 ? 0 : offsets[index - 1] + atoms[index - 1].content.length);
        return offsets;
      }, []),
    );
    expect(atoms.map(atom => atom.content).join('')).toBe(doc.blocks[0].content);
  });
});
