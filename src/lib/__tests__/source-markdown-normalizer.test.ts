import { describe, expect, it } from 'vitest';
import { normalizeMinerUMarkdown } from '../source-markdown-normalizer';

describe('normalizeMinerUMarkdown display math recovery', () => {
  it('closes a missing display-math delimiter after a balanced LaTeX environment', () => {
    const input = [
      'In the last lecture, we introduced the dual problem.',
      '',
      '\\[',
      '\\begin{array}{c c}',
      '\\text{max} & c^T x \\\\',
      '\\text{s.t.} & Ax \\leq b',
      '\\end{array}',
      'The dual problem is introduced next.',
      '',
      '## Quick Review: Economic Interpretation',
    ].join('\n');

    const normalized = normalizeMinerUMarkdown(input);

    expect(normalized).toContain('\\end{array}\n$$\nThe dual problem is introduced next.');
    expect((normalized.match(/\$\$/g) ?? [])).toHaveLength(2);
    // Existing heading normalization promotes the first H2 to H1.
    expect(normalized).toContain('# Quick Review: Economic Interpretation');
  });

  it('does not add an extra delimiter to an already closed formula', () => {
    const input = '\\[\n\\begin{array}{c}x\\end{array}\n\\]';

    const normalized = normalizeMinerUMarkdown(input);

    expect((normalized.match(/\$\$/g) ?? [])).toHaveLength(2);
  });
});

describe('normalizeMinerUMarkdown repeated slide boilerplate cleanup', () => {
  it('keeps the first copy of a repeated long page header and removes later copies', () => {
    const header = 'Optimization Theory and Methodology — Renmin University';
    const input = [
      `## ${header}`,
      'Page one introduces linear programming.',
      '',
      `##  ${header.toUpperCase()}  `,
      'Page two introduces the dual problem.',
      '',
      `### ${header}`,
      'Page three proves weak duality.',
    ].join('\n');

    const normalized = normalizeMinerUMarkdown(input);
    const occurrences = normalized.toLocaleLowerCase().match(/optimization theory and methodology/g) ?? [];

    expect(occurrences).toHaveLength(1);
    expect(normalized).toContain('Page one introduces linear programming.');
    expect(normalized).toContain('Page two introduces the dual problem.');
    expect(normalized).toContain('Page three proves weak duality.');
  });

  it('does not deduplicate repeated lines inside fenced code blocks', () => {
    const input = ['```text', 'same', 'same', 'same', '```'].join('\n');

    const normalized = normalizeMinerUMarkdown(input);

    expect((normalized.match(/^same$/gm) ?? [])).toHaveLength(3);
  });

  it('removes generated page counters while preserving ordinary numbers', () => {
    const input = ['Page 1 of 71', 'The coefficient is 71.', '第 2 页', '3 / 71'].join('\n\n');

    const normalized = normalizeMinerUMarkdown(input);

    expect(normalized).not.toContain('Page 1 of 71');
    expect(normalized).not.toContain('第 2 页');
    expect(normalized).not.toContain('3 / 71');
    expect(normalized).toContain('The coefficient is 71.');
  });
});
