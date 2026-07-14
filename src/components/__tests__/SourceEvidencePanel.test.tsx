import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { KnowledgeNetworkNode } from '../../lib/knowledge-network-adapter';
import type { MarkdownBlock, SourceDocument, SourceRange } from '../../types';
import { SourceEvidencePanel } from '../knowledge-network/SourceEvidencePanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sourceBlock(id: string, orderIndex: number, content: string): MarkdownBlock {
  return {
    id,
    documentId: 'doc-1',
    type: 'paragraph',
    content,
    headingPath: ['第一章', '概率模型'],
    orderIndex,
    contentHash: `hash-${id}`,
  };
}

const blocks = [sourceBlock('b1', 0, '**定义原文**'), sourceBlock('b2', 1, '$$p(x)$$'), sourceBlock('b3', 2, '案例原文')];
const sourceDocument: SourceDocument = {
  id: 'doc-1', courseId: 'course-1', title: '概率论课件', markdown: '', blocks, outline: [],
  contentHash: 'hash', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
};

function graphNode(sourceRanges: SourceRange[]): KnowledgeNetworkNode {
  return {
    id: 'topic-1', label: '概率模型', description: 'AI摘要不可作为原文', kind: 'topic', category: 'concept',
    importance: 'core', confidence: 0.9, sourceRanges, order: 0,
  };
}

function renderPanel(node: KnowledgeNetworkNode, documents: SourceDocument[] = [sourceDocument]): HTMLElement {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(SourceEvidencePanel, { node, documents, relationCount: 2 })));
  return container;
}

describe('SourceEvidencePanel', () => {
  it('renders separate source cards and switches to raw Markdown', () => {
    const container = renderPanel(graphNode([
      { documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' },
      { documentId: 'doc-1', startBlockId: 'b3', endBlockId: 'b3' },
    ]));

    expect(container.querySelectorAll('[data-testid="source-range-card"]')).toHaveLength(2);
    expect(container.textContent).toContain('定义原文');
    const rawButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '原始 Markdown')!;
    act(() => rawButton.click());
    expect(container.textContent).toContain('**定义原文**');
    expect(container.textContent).toContain('$$p(x)$$');
  });

  it('shows a missing-source warning without substituting the AI summary', () => {
    const container = renderPanel(graphNode([
      { documentId: 'doc-1', startBlockId: 'missing', endBlockId: 'missing' },
    ]));

    expect(container.textContent).toContain('缺少可定位原文');
    expect(container.textContent).not.toContain('AI摘要不可作为原文');
  });

  it('does not expose internal block ids in the source-card header', () => {
    const container = renderPanel(graphNode([
      { documentId: 'doc-1', startBlockId: 'b1', endBlockId: 'b2' },
    ]));

    expect(container.textContent).not.toContain('b1–b2');
    expect(container.textContent).toContain('概率论课件');
    expect(container.textContent).toContain('2 个原文块');
  });

  it('isolates a malformed formula block so it cannot poison following source text', () => {
    const malformedFormula = sourceBlock('formula-broken', 1, [
      '$',
      '\\begin{array}{c c}',
      '\\text{max} & c^T x',
      '\\end{array}',
      'The dual problem is introduced next.',
      '## Quick Review: Economic Interpretation',
    ].join('\n'));
    // This is how documents persisted before the delimiter fix look: the
    // formula was misclassified as a paragraph because `\[` became one `$`.
    malformedFormula.type = 'paragraph';
    const damagedDocument: SourceDocument = {
      ...sourceDocument,
      blocks: [sourceBlock('intro', 0, 'Intro paragraph.'), malformedFormula],
    };
    const container = renderPanel(graphNode([
      { documentId: 'doc-1', startBlockId: 'intro', endBlockId: 'formula-broken' },
    ]), [damagedDocument]);

    expect(container.querySelectorAll('[data-testid="source-block-preview"]')).toHaveLength(2);
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(container.textContent).toContain('The dual problem is introduced next.');
    expect(container.textContent).toContain('Quick Review: Economic Interpretation');
  });
});
