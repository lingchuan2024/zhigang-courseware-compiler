import { describe, expect, it } from 'vitest';
import type { MarkdownBlock, SourceDocument, SourceRange } from '../../types';
import { resolveSourceRanges } from '../source-range-resolver';

function block(id: string, orderIndex: number, content: string, headingPath = ['第一章']): MarkdownBlock {
  return {
    id,
    documentId: 'doc-1',
    type: orderIndex === 0 ? 'heading' : 'paragraph',
    content,
    headingPath,
    orderIndex,
    contentHash: `hash-${id}`,
  };
}

const blocks = [
  block('b1', 0, '# 第一章'),
  block('b2', 1, '定义原文'),
  block('b3', 2, '$$x+y$$'),
  block('b4', 3, '案例原文', ['第一章', '案例']),
];

const document: SourceDocument = {
  id: 'doc-1',
  courseId: 'course-1',
  title: '测试课件',
  markdown: blocks.map(item => item.content).join('\n\n'),
  blocks,
  outline: [],
  contentHash: 'doc-hash',
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

describe('resolveSourceRanges', () => {
  it('returns the exact continuous Markdown blocks in document order', () => {
    const range: SourceRange = { documentId: 'doc-1', startBlockId: 'b2', endBlockId: 'b3' };
    const [resolved] = resolveSourceRanges([range], [document]);

    expect(resolved.documentTitle).toBe('测试课件');
    expect(resolved.blocks.map(item => item.id)).toEqual(['b2', 'b3']);
    expect(resolved.markdown).toBe('定义原文\n\n$$x+y$$');
    expect(resolved.headingPath).toEqual(['第一章']);
    expect(resolved.missingReason).toBeUndefined();
  });

  it('keeps non-contiguous source ranges separate', () => {
    const ranges: SourceRange[] = [
      { documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' },
      { documentId: 'doc-1', startBlockId: 'b4', endBlockId: 'b4' },
    ];

    const resolved = resolveSourceRanges(ranges, [document]);

    expect(resolved).toHaveLength(2);
    expect(resolved[0].blocks.map(item => item.id)).toEqual(['b1', 'b2']);
    expect(resolved[1].blocks.map(item => item.id)).toEqual(['b4']);
  });

  it('reports a missing block instead of substituting other content', () => {
    const range: SourceRange = { documentId: 'doc-1', startBlockId: 'missing', endBlockId: 'b3' };
    const [resolved] = resolveSourceRanges([range], [document]);

    expect(resolved.blocks).toEqual([]);
    expect(resolved.markdown).toBe('');
    expect(resolved.missingReason).toContain('missing');
  });
});
