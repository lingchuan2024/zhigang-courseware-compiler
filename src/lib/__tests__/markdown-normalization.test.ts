import { describe, it, expect } from 'vitest';
import { normalizeGeneratedMarkdown } from '../markdown-normalization';

describe('normalizeGeneratedMarkdown', () => {
  // =========================================================================
  // 1. \(...\) correctly converts to $...$
  // =========================================================================
  describe('inline math \\(...\\) → $...$', () => {
    it('converts simple \\(...\\) to $...$', () => {
      const input = 'The formula \\(x + y = z\\) is correct.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('The formula $x + y = z$ is correct.');
      expect(result.warnings).toHaveLength(0);
    });

    it('trims whitespace inside \\(...\\)', () => {
      const input = 'The formula \\(  x + y  \\) is correct.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('The formula $x + y$ is correct.');
    });

    it('produces no warnings for properly paired \\(...\\)', () => {
      const input = 'Use \\(E = mc^2\\) here.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. \[...\] correctly converts to $$...$$
  // =========================================================================
  describe('display math \\[...\\] → $$...$$', () => {
    it('converts single-line \\[...\\] to $$...$$ with newlines', () => {
      const input = 'The equation \\[x = y\\] holds.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('The equation $$\nx = y\n$$ holds.');
      expect(result.warnings).toHaveLength(0);
    });

    it('trims whitespace inside single-line \\[...\\]', () => {
      const input = 'The equation \\[  x = y  \\] holds.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('The equation $$\nx = y\n$$ holds.');
    });

    it('produces no warnings for properly paired \\[...\\]', () => {
      const input = 'Use \\[E = mc^2\\] here.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Multi-line \[ formula \] converts to $$\nformula\n$$
  // =========================================================================
  describe('multi-line display math', () => {
    it('converts multi-line \\[ formula \\] to $$\\nformula\\n$$', () => {
      const input = '\\[\na + b = c\n\\]';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$$\na + b = c\n$$');
      expect(result.warnings).toHaveLength(0);
    });

    it('trims leading/trailing blank lines in multi-line formulas', () => {
      const input = '\\[\n\n  a + b = c  \n\n\\]';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$$\na + b = c\n$$');
    });

    it('preserves internal newlines in multi-line formulas', () => {
      const input = '\\[\nline one\nline two\nline three\n\\]';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$$\nline one\nline two\nline three\n$$');
    });
  });

  // =========================================================================
  // 4. Code block containing \[ is NOT converted
  // =========================================================================
  describe('code block protection', () => {
    it('does NOT convert \\[ inside fenced code blocks', () => {
      const input = '```\n\\[x = y\\]\n```';
      const result = normalizeGeneratedMarkdown(input);
      // \[ and \] should survive because they are inside a code block
      expect(result.content).toContain('\\[');
      expect(result.content).toContain('\\]');
    });

    it('does NOT convert \\( inside fenced code blocks', () => {
      const input = '```\n\\(x + y\\)\n```';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toContain('\\(');
      expect(result.content).toContain('\\)');
    });

    it('does NOT convert math inside code blocks with language tag', () => {
      const input = '```python\n# \\[not math\\]\nx = 1\n```';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toContain('\\[');
      expect(result.content).toContain('\\]');
    });

    it('does NOT convert math inside tilde-fenced code blocks', () => {
      const input = '~~~\n\\[x = y\\]\n~~~';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toContain('\\[');
      expect(result.content).toContain('\\]');
    });
  });

  // =========================================================================
  // 5. inlineCode containing \( is NOT converted
  // =========================================================================
  describe('inline code protection', () => {
    it('does NOT convert \\( inside inline code', () => {
      const input = 'This is `\\(x\\)` inline code.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('This is `\\(x\\)` inline code.');
    });

    it('does NOT convert \\[ inside inline code', () => {
      const input = 'This is `\\[x\\]` inline code.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('This is `\\[x\\]` inline code.');
    });

    it('does NOT convert complex inline code with math delimiters', () => {
      const input = 'Code: `\\(a + b\\) and \\[c = d\\]` end.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toContain('\\(');
      expect(result.content).toContain('\\)');
      expect(result.content).toContain('\\[');
      expect(result.content).toContain('\\]');
    });
  });

  // =========================================================================
  // 6. Unpaired delimiters produce warnings
  // =========================================================================
  describe('unpaired delimiters', () => {
    it('produces warnings for unpaired \\(', () => {
      const input = 'This has \\( an unpaired delimiter.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('\\('))).toBe(true);
    });

    it('produces warnings for unpaired \\)', () => {
      const input = 'This has \\) an unpaired delimiter.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('\\)'))).toBe(true);
    });

    it('produces warnings for unpaired \\[', () => {
      const input = 'This has \\[ an unpaired delimiter.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('\\['))).toBe(true);
    });

    it('produces warnings for unpaired \\]', () => {
      const input = 'This has \\] an unpaired delimiter.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('\\]'))).toBe(true);
    });

    it('produces no warnings when all delimiters are paired', () => {
      const input = 'Paired \\(x\\) and \\[y\\] delimiters.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. Normalization function is idempotent
  // =========================================================================
  describe('idempotency', () => {
    it('running twice produces the same content', () => {
      const input = 'Inline \\(x + y\\) and display \\[z = w\\] formulas.';
      const first = normalizeGeneratedMarkdown(input);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.content).toBe(first.content);
    });

    it('is idempotent with only inline math', () => {
      const input = 'Use \\(a^2 + b^2 = c^2\\) here.';
      const first = normalizeGeneratedMarkdown(input);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.content).toBe(first.content);
    });

    it('is idempotent with only display math', () => {
      const input = 'Use \\[a^2 + b^2 = c^2\\] here.';
      const first = normalizeGeneratedMarkdown(input);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.content).toBe(first.content);
    });

    it('produces the same warnings on second run', () => {
      const input = 'Inline \\(x\\) and display \\[y\\].';
      const first = normalizeGeneratedMarkdown(input);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.warnings).toEqual(first.warnings);
    });

    it('is idempotent with multi-line display math', () => {
      const input = 'Text\n\\[\na + b = c\n\\]\nMore text.';
      const first = normalizeGeneratedMarkdown(input);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.content).toBe(first.content);
    });
  });

  // =========================================================================
  // 8. Multiple formulas in the same content all convert correctly
  // =========================================================================
  describe('multiple formulas', () => {
    it('converts multiple inline formulas in the same content', () => {
      const input = 'First \\(a\\) then \\(b\\) and again \\(c\\).';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('First $a$ then $b$ and again $c$.');
    });

    it('converts multiple display formulas in the same content', () => {
      const input = 'First \\[a\\] then \\[b\\].';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('First $$\na\n$$ then $$\nb\n$$.');
    });

    it('converts mixed inline and display formulas', () => {
      const input = 'First \\(a\\) then \\[b\\] and again \\(c\\) plus \\[d\\].';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('First $a$ then $$\nb\n$$ and again $c$ plus $$\nd\n$$.');
      expect(result.warnings).toHaveLength(0);
    });

    it('converts adjacent formulas without interference', () => {
      const input = '\\(a\\)\\(b\\)';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$a$$b$');
    });
  });

  // =========================================================================
  // 9. Regression fixture from the spec
  // =========================================================================
  describe('regression: spec fixture', () => {
    const fixtureInput = `## 弱对偶定理

\\[
\\max\\; c^\\top x
\\quad
\\text{s.t. } Ax \\le b,\\; x \\ge 0
\\]`;

    it('produces $$ blocks, not \\[ or \\]', () => {
      const result = normalizeGeneratedMarkdown(fixtureInput);
      // Must NOT contain \[ or \] — they should have been converted
      expect(result.content).not.toContain('\\[');
      expect(result.content).not.toContain('\\]');
      // Must contain $$ blocks
      expect(result.content).toContain('$$');
    });

    it('produces no warnings for the fixture', () => {
      const result = normalizeGeneratedMarkdown(fixtureInput);
      expect(result.warnings).toHaveLength(0);
    });

    it('produces the exact expected output', () => {
      const expected = `## 弱对偶定理

$$
\\max\\; c^\\top x
\\quad
\\text{s.t. } Ax \\le b,\\; x \\ge 0
$$`;
      const result = normalizeGeneratedMarkdown(fixtureInput);
      expect(result.content).toBe(expected);
    });

    it('is idempotent on the fixture', () => {
      const first = normalizeGeneratedMarkdown(fixtureInput);
      const second = normalizeGeneratedMarkdown(first.content);
      expect(second.content).toBe(first.content);
    });
  });

  // =========================================================================
  // Additional edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('leaves content without math delimiters unchanged', () => {
      const input = 'This is plain text with no math.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe(input);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles empty content', () => {
      const result = normalizeGeneratedMarkdown('');
      expect(result.content).toBe('');
      expect(result.warnings).toHaveLength(0);
    });

    it('handles content with only a single inline formula', () => {
      const input = '\\(x\\)';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$x$');
      expect(result.warnings).toHaveLength(0);
    });

    it('handles content with only a single display formula', () => {
      const input = '\\[x\\]';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('$$\nx\n$$');
      expect(result.warnings).toHaveLength(0);
    });

    it('preserves surrounding text around formulas', () => {
      const input = 'Before \\(x\\) after.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toBe('Before $x$ after.');
    });

    it('handles formulas with special LaTeX commands', () => {
      const input = 'Use \\(\\frac{a}{b}\\) and \\[\\sum_{i=1}^{n} x_i\\] here.';
      const result = normalizeGeneratedMarkdown(input);
      expect(result.content).toContain('$\\frac{a}{b}$');
      expect(result.content).toContain('$$\n\\sum_{i=1}^{n} x_i\n$$');
      expect(result.warnings).toHaveLength(0);
    });
  });
});
