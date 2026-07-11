import { describe, it, expect } from 'vitest';
import { validateGeneratedMarkdown } from '../markdown-validation';
import { Citation } from '../../types';

describe('markdown-validation', () => {
  describe('validateGeneratedMarkdown', () => {
    it('unclosed code fence produces warning', () => {
      const content = 'Some text\n```python\nprint("hello")';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('代码块'))).toBe(true);
    });

    it('closed code fence produces no code fence warning', () => {
      const content = '```python\nprint("hello")\n```';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('代码块'))).toBe(false);
    });

    it('unclosed $$ produces warning', () => {
      const content = 'Some text\n$$\nx^2 + y^2 = r^2';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('数学公式'))).toBe(true);
    });

    it('closed $$ produces no math warning', () => {
      const content = '$$\nx^2 + y^2 = r^2\n$$';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('数学公式'))).toBe(false);
    });

    it('citation referencing non-existent marker produces warning', () => {
      const content = 'Some text [cite-1] more text';
      const citations: Citation[] = []; // No citations defined
      const { warnings } = validateGeneratedMarkdown(content, citations);
      expect(warnings.some(w => w.includes('引用标记') && w.includes('不在引用列表'))).toBe(true);
    });

    it('citation in array but not used in content produces warning', () => {
      const content = 'Some text without citations';
      const citations: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev1'] },
      ];
      const { warnings } = validateGeneratedMarkdown(content, citations);
      expect(warnings.some(w => w.includes('引用列表中但未在内容中使用'))).toBe(true);
    });

    it('valid citation produces no citation warnings', () => {
      const content = 'Some text [cite-1] more text';
      const citations: Citation[] = [
        { marker: 'cite-1', evidenceIds: ['ev1'] },
      ];
      const { warnings } = validateGeneratedMarkdown(content, citations);
      expect(warnings.some(w => w.includes('引用标记'))).toBe(false);
    });

    it('dangerous link protocol produces warning', () => {
      const content = '[Click here](javascript:alert(1))';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('不安全'))).toBe(true);
    });

    it('dangerous data: protocol produces warning', () => {
      const content = '[Image](data:text/html,<script>alert(1)</script>)';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('不安全'))).toBe(true);
    });

    it('safe link produces no dangerous link warning', () => {
      const content = '[Google](https://google.com)';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('不安全'))).toBe(false);
    });

    it('valid markdown produces no warnings', () => {
      const content = '# Title\n\nSome paragraph text.\n\n## Section\n\nMore text.';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.length).toBe(0);
    });

    it('valid markdown with code block and math produces no warnings', () => {
      const content = '# Title\n\n```python\nprint("hello")\n```\n\n$$\nx^2\n$$\n';
      const { warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.length).toBe(0);
    });

    it('fixed content closes unclosed code fence', () => {
      const content = '```python\nprint("hello")';
      const { fixedContent } = validateGeneratedMarkdown(content, []);
      const fenceCount = (fixedContent.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);
    });

    it('fixed content closes unclosed $$', () => {
      const content = '$$\nx^2 + y^2';
      const { fixedContent } = validateGeneratedMarkdown(content, []);
      const dollarCount = (fixedContent.match(/\$\$/g) || []).length;
      expect(dollarCount % 2).toBe(0);
    });

    it('fixed content removes dangerous link target', () => {
      const content = '[Click here](javascript:alert(1))';
      const { fixedContent } = validateGeneratedMarkdown(content, []);
      expect(fixedContent).not.toContain('javascript:');
      // Link text should be preserved
      expect(fixedContent).toContain('Click here');
    });

    it('fixed content does NOT fix citation issues (only warns)', () => {
      const content = 'Text [cite-99] here';
      const { fixedContent, warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('引用标记'))).toBe(true);
      // Citation marker should still be in content (not removed)
      expect(fixedContent).toContain('[cite-99]');
    });

    it('fixed content does NOT fix table issues (only warns)', () => {
      const content = '| Col1 | Col2 |\n| --- | --- |\n| a | b | c |';
      const { fixedContent, warnings } = validateGeneratedMarkdown(content, []);
      expect(warnings.some(w => w.includes('表格'))).toBe(true);
      // Table should still be in content (not modified)
      expect(fixedContent).toContain('| a | b | c |');
    });
  });
});
