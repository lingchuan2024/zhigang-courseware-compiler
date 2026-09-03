import { describe, expect, it } from 'vitest';
import type { MarkdownBlock } from '../../../types';
import { resolveEvidenceSpan } from '../evidence-span';

const block: MarkdownBlock = {
  id: 'b1',
  documentId: 'd1',
  type: 'paragraph',
  content: '最大似然估计通过最大化似然函数估计参数。通常使用对数似然进行计算。',
  headingPath: ['参数估计'],
  orderIndex: 1,
  contentHash: 'h1',
};

describe('evidence span resolution', () => {
  it('accepts exact offsets', () => {
    const result = resolveEvidenceSpan({
      blockId: 'b1',
      startOffset: 0,
      endOffset: 6,
      quote: '最大似然估计',
      role: 'definition',
    }, block);
    expect(result.span?.quote).toBe('最大似然估计');
  });

  it('repairs wrong offsets when the quote is unique', () => {
    const result = resolveEvidenceSpan({
      blockId: 'b1',
      startOffset: 0,
      endOffset: 2,
      quote: '对数似然',
      role: 'formula',
    }, block);
    expect(result.span).toMatchObject({ startOffset: 24, endOffset: 28 });
  });

  it('locates a unique quote after normalizing whitespace from model output', () => {
    const formatted = { ...block, content: 'Representer\n\n  Theorem 给出有限维表示。' };
    const result = resolveEvidenceSpan({
      blockId: 'b1',
      quote: 'Representer Theorem 给出有限维表示。',
      role: 'statement',
    }, formatted);

    expect(result.issue).toBeUndefined();
    expect(result.span?.quote).toBe('Representer\n\n  Theorem 给出有限维表示。');
  });

  it('rejects an ambiguous quote', () => {
    const repeated = { ...block, content: '模型用于估计。模型也用于预测。' };
    expect(resolveEvidenceSpan({
      blockId: 'b1',
      quote: '模型',
      role: 'statement',
    }, repeated).issue?.code).toBe('INVALID_EVIDENCE');
  });

  it('rejects a draft that targets another block', () => {
    expect(resolveEvidenceSpan({
      blockId: 'other',
      quote: '最大似然估计',
      role: 'definition',
    }, block).span).toBeUndefined();
  });
});
