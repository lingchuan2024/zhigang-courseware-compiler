import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement, type ReactElement } from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { remarkCitation } from '../../lib/markdown-citation-plugin';
import { isSafeUrl } from '../markdown-components';

/* ------------------------------------------------------------------ */
/* Minimal render helper (no @testing-library/react dependency).       */
/* ------------------------------------------------------------------ */

let roots: ReturnType<typeof createRoot>[] = [];

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  flushSync(() => {
    root.render(ui);
  });
  return container;
}

afterEach(() => {
  roots.forEach((r) => {
    flushSync(() => r.unmount());
  });
  roots = [];
  document.body.innerHTML = '';
});

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('MarkdownRenderer', () => {
  it('renders headings h1-h3', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: '# Heading 1\n\n## Heading 2\n\n### Heading 3' })
    );
    const h1 = container.querySelector('h1');
    const h2 = container.querySelector('h2');
    const h3 = container.querySelector('h3');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe('Heading 1');
    expect(h2?.textContent).toBe('Heading 2');
    expect(h3?.textContent).toBe('Heading 3');
  });

  it('renders inline math $x^2$ as KaTeX', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: 'Inline math $x^2$ here.' })
    );
    const katex = container.querySelector('.katex');
    expect(katex).not.toBeNull();
    // Inline math should NOT use the display (block) wrapper.
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders block math $$...$$ as KaTeX display', () => {
    // remark-math v6 treats `$$` as a fence (like fenced code): block math
    // requires the opening `$$` at line start and the closing `$$` on its own
    // line. A single-line `$$x$$` is parsed as *inline* math, so we use the
    // fenced form here to exercise true display math.
    const container = render(
      createElement(MarkdownRenderer, {
        content: 'Block math:\n\n$$\nL(\\theta)\n$$',
      })
    );
    const display = container.querySelector('.katex-display');
    expect(display).not.toBeNull();
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders a GFM table with the correct number of cells', () => {
    const content = [
      '| 名称 | 值 |',
      '| --- | --- |',
      '| a | 1 |',
      '| b | 2 |',
    ].join('\n');
    const container = render(createElement(MarkdownRenderer, { content }));
    const headers = container.querySelectorAll('th');
    const cells = container.querySelectorAll('td');
    // 2 header cells, 2 body rows x 2 cells = 4 body cells
    expect(headers.length).toBe(2);
    expect(cells.length).toBe(4);
  });

  it('renders a nested ordered list', () => {
    const content = '1. first\n   1. nested\n   2. nested-two\n2. second';
    const container = render(createElement(MarkdownRenderer, { content }));
    const ols = container.querySelectorAll('ol');
    // One top-level <ol> and one nested <ol>.
    expect(ols.length).toBeGreaterThanOrEqual(2);
    const nestedOl = container.querySelector('ol ol');
    expect(nestedOl).not.toBeNull();
    expect(nestedOl?.querySelectorAll('li').length).toBe(2);
  });

  it('renders [cite-1] in a paragraph as a clickable citation button', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: 'A claim [cite-1] is here.' })
    );
    const btn = container.querySelector('button[data-marker="cite-1"]');
    expect(btn).not.toBeNull();
    // Display shows only the numeric part: [1] not [cite-1]
    expect(btn?.textContent).toBe('[1]');
    // The button is wrapped in <sup>.
    expect(btn?.closest('sup')).not.toBeNull();
    // Accessible name is present
    expect(btn?.getAttribute('aria-label')).toBe('引用 1');
  });

  it('renders citation with valid marker in normal style', () => {
    const container = render(
      createElement(MarkdownRenderer, {
        content: 'A claim [cite-2] here.',
        validMarkers: new Set(['cite-2']),
      })
    );
    const btn = container.querySelector('button[data-marker="cite-2"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // Valid citation should not have the grey warning class
    expect(btn.className).not.toContain('text-space-faint');
    expect(btn.className).toContain('text-cinnabar');
  });

  it('renders citation with invalid marker in grey warning style', () => {
    const container = render(
      createElement(MarkdownRenderer, {
        content: 'A claim [cite-99] here.',
        validMarkers: new Set(['cite-1']),
      })
    );
    const btn = container.querySelector('button[data-marker="cite-99"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // Invalid citation should have grey styling
    expect(btn.className).toContain('text-space-faint');
    expect(btn.className).toContain('cursor-default');
  });

  it('uses separate click handlers for multiple MarkdownRenderer instances', () => {
    const clicksA: string[] = [];
    const clicksB: string[] = [];
    const containerA = render(
      createElement(MarkdownRenderer, {
        content: 'A [cite-1]',
        onCitationClick: (m: string) => clicksA.push(m),
      })
    );
    const containerB = render(
      createElement(MarkdownRenderer, {
        content: 'B [cite-1]',
        onCitationClick: (m: string) => clicksB.push(m),
      })
    );
    const btnA = containerA.querySelector('button[data-marker="cite-1"]') as HTMLButtonElement;
    const btnB = containerB.querySelector('button[data-marker="cite-1"]') as HTMLButtonElement;

    btnA.click();
    btnB.click();
    btnA.click();

    // Each handler should only receive its own clicks — no module-level override
    expect(clicksA).toEqual(['cite-1', 'cite-1']);
    expect(clicksB).toEqual(['cite-1']);
  });

  it('does NOT convert [cite-3] inside a code block into a citation button', () => {
    const content = '```\ncode with [cite-3] inside\n```';
    const container = render(createElement(MarkdownRenderer, { content }));
    expect(container.querySelector('button[data-marker="cite-3"]')).toBeNull();
    // The literal text must still appear inside a <code> element.
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('[cite-3]');
  });

  it('does NOT convert [cite-2] inside inline code into a citation button', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: 'Use `[cite-2]` to cite.' })
    );
    expect(container.querySelector('button[data-marker="cite-2"]')).toBeNull();
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('[cite-2]');
  });

  it('renders a blockquote', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: '> This is a quote.' })
    );
    const bq = container.querySelector('blockquote');
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain('This is a quote.');
  });

  it('sanitizes a javascript: link (no dangerous href)', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: '[click me](javascript:alert(1))' })
    );
    // No element may carry an href that starts with javascript:
    const dangerous = container.querySelector('a[href^="javascript:"]');
    expect(dangerous).toBeNull();
    // The link text is still rendered (as plain text / span, no clickable href).
    expect(container.textContent).toContain('click me');
    // And there must be no <a> with a non-empty unsafe href at all.
    const anchors = container.querySelectorAll('a');
    anchors.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      expect(isSafeUrl(href) || href === '').toBe(true);
    });
  });

  it('renders safe http/https links with target=_blank', () => {
    const container = render(
      createElement(MarkdownRenderer, { content: '[example](https://example.com)' })
    );
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });
});

/* ------------------------------------------------------------------ */
/* remarkCitation plugin (pure transform)                             */
/* ------------------------------------------------------------------ */

describe('remarkCitation', () => {
  it('splits [cite-N] markers in text nodes into citation nodes', () => {
    const tree: any = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'before [cite-7] after' }],
        },
      ],
    };
    const transformer = remarkCitation();
    transformer(tree);
    const para = tree.children[0];
    const types = para.children.map((c: { type: string }) => c.type);
    expect(types).toEqual(['text', 'citation', 'text']);
    const citation = para.children[1];
    expect(citation.marker).toBe('cite-7');
    expect(citation.data.hName).toBe('citation');
    expect(citation.data.hProperties.marker).toBe('cite-7');
  });

  it('leaves code and inlineCode nodes untouched', () => {
    const tree: any = {
      type: 'root',
      children: [
        {
          type: 'code',
          lang: 'ts',
          value: 'const x = "[cite-9]";',
        },
        {
          type: 'paragraph',
          children: [{ type: 'inlineCode', value: '[cite-9]' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'real [cite-9] cite' }],
        },
      ],
    };
    const transformer = remarkCitation();
    transformer(tree);

    // Block code value unchanged.
    expect(tree.children[0].value).toBe('const x = "[cite-9]";');
    // Inline code value unchanged.
    expect(tree.children[1].children[0].value).toBe('[cite-9]');
    expect(tree.children[1].children[0].type).toBe('inlineCode');
    // Text node WAS transformed.
    const paraTypes = tree.children[2].children.map((c: { type: string }) => c.type);
    expect(paraTypes).toContain('citation');
  });

  it('does nothing when there are no citation markers', () => {
    const tree: any = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'no citations here' }] },
      ],
    };
    const before = JSON.stringify(tree);
    const transformer = remarkCitation();
    transformer(tree);
    const after = JSON.stringify(tree);
    expect(after).toBe(before);
  });
});
