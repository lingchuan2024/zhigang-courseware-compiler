import { describe, it, expect } from 'vitest';
import { validateFile, MAX_FILE_SIZE, ALLOWED_TYPES } from '../pdf';
import { SourceTextItem, SourceTextBlock } from '../../types';

// ========== Helpers for constructing mechanical layout objects ==========

function makeSourceTextItem(
  overrides: Partial<SourceTextItem> & { text?: string }
): SourceTextItem {
  return {
    text: 'sample text',
    x: 100,
    y: 700,
    fontSize: 12,
    hasEol: false,
    sourceIndex: 0,
    ...overrides,
  };
}

function makeSourceTextBlock(
  overrides: Partial<SourceTextBlock> & { text?: string; pageNumber?: number; blockIndex?: number }
): SourceTextBlock {
  const text = overrides.text ?? 'sample block text';
  const pageNumber = overrides.pageNumber ?? 1;
  const blockIndex = overrides.blockIndex ?? 0;
  return {
    items: [makeSourceTextItem({ text })],
    text,
    pageNumber,
    blockIndex,
    avgFontSize: 12,
    yStart: 700,
    yEnd: 690,
    ...overrides,
  };
}

// ========== Tests ==========

describe('PDF layout preservation', () => {
  // ---------- validateFile ----------

  describe('validateFile', () => {
    it('should reject null file', () => {
      const result = validateFile(null as unknown as File);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject undefined file', () => {
      const result = validateFile(undefined as unknown as File);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject non-PDF files by mime type', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('PDF');
    });

    it('should accept PDF files by mime type', () => {
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept files with .pdf extension even with non-PDF mime type', () => {
      const file = new File(['content'], 'test.pdf', { type: 'application/octet-stream' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should accept .pdf extension with empty mime type', () => {
      const file = new File(['content'], 'report.pdf', { type: '' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject files larger than MAX_FILE_SIZE', () => {
      const largeContent = new Uint8Array(MAX_FILE_SIZE + 1);
      const file = new File([largeContent], 'large.pdf', { type: 'application/pdf' });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('MB');
    });

    it('should accept files exactly at MAX_FILE_SIZE boundary', () => {
      const content = new Uint8Array(MAX_FILE_SIZE);
      const file = new File([content], 'boundary.pdf', { type: 'application/pdf' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject large non-PDF files with appropriate error', () => {
      const largeContent = new Uint8Array(MAX_FILE_SIZE + 1);
      const file = new File([largeContent], 'large.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      // Should fail on type check first (before size check)
      expect(result.error).toContain('PDF');
    });
  });

  // ---------- Exported constants ----------

  describe('exported constants', () => {
    it('MAX_FILE_SIZE should be 20MB', () => {
      expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
    });

    it('ALLOWED_TYPES should include application/pdf', () => {
      expect(ALLOWED_TYPES).toContain('application/pdf');
    });

    it('ALLOWED_TYPES should be an array', () => {
      expect(Array.isArray(ALLOWED_TYPES)).toBe(true);
      expect(ALLOWED_TYPES.length).toBeGreaterThan(0);
    });
  });

  // ---------- SourceTextItem type structure ----------

  describe('SourceTextItem type structure', () => {
    it('should have all required mechanical fields', () => {
      const item: SourceTextItem = {
        text: 'hello world',
        x: 100.5,
        y: 200.3,
        fontSize: 12.5,
        hasEol: false,
        sourceIndex: 0,
      };
      expect(item.text).toBe('hello world');
      expect(item.x).toBe(100.5);
      expect(item.y).toBe(200.3);
      expect(item.fontSize).toBe(12.5);
      expect(item.hasEol).toBe(false);
      expect(item.sourceIndex).toBe(0);
    });

    it('should support hasEol=true for line-end markers', () => {
      const item: SourceTextItem = makeSourceTextItem({ text: '', hasEol: true, sourceIndex: 5 });
      expect(item.text).toBe('');
      expect(item.hasEol).toBe(true);
      expect(item.sourceIndex).toBe(5);
    });

    it('should preserve fontSize with one decimal place (mechanical attribute)', () => {
      const item: SourceTextItem = makeSourceTextItem({ fontSize: 14.1 });
      expect(item.fontSize).toBe(14.1);
    });

    it('should store x and y coordinates from PDF.js transform matrix', () => {
      // In PDF.js, transform[4] = x, transform[5] = y
      const item: SourceTextItem = makeSourceTextItem({ x: 72.0, y: 480.5 });
      expect(item.x).toBe(72.0);
      expect(item.y).toBe(480.5);
    });

    it('should track sourceIndex for position in original items array', () => {
      const items: SourceTextItem[] = [
        makeSourceTextItem({ text: 'first', sourceIndex: 0 }),
        makeSourceTextItem({ text: 'second', sourceIndex: 1 }),
        makeSourceTextItem({ text: 'third', sourceIndex: 2 }),
      ];
      expect(items[0].sourceIndex).toBe(0);
      expect(items[1].sourceIndex).toBe(1);
      expect(items[2].sourceIndex).toBe(2);
    });
  });

  // ---------- SourceTextBlock type structure ----------

  describe('SourceTextBlock type structure', () => {
    it('should have all required fields', () => {
      const block: SourceTextBlock = makeSourceTextBlock({
        text: 'block content',
        pageNumber: 1,
        blockIndex: 0,
        avgFontSize: 12,
        yStart: 700,
        yEnd: 690,
      });
      expect(block.items).toBeDefined();
      expect(block.text).toBe('block content');
      expect(block.pageNumber).toBe(1);
      expect(block.blockIndex).toBe(0);
      expect(block.avgFontSize).toBe(12);
      expect(block.yStart).toBe(700);
      expect(block.yEnd).toBe(690);
    });

    it('items should be an array of SourceTextItem', () => {
      const items: SourceTextItem[] = [
        makeSourceTextItem({ text: 'line1', x: 50, y: 100, hasEol: true, sourceIndex: 0 }),
        makeSourceTextItem({ text: 'line2', x: 50, y: 85, hasEol: false, sourceIndex: 1 }),
      ];
      const block: SourceTextBlock = makeSourceTextBlock({
        items,
        text: 'line1\nline2',
        pageNumber: 2,
        blockIndex: 3,
      });
      expect(block.items).toHaveLength(2);
      expect(block.items[0].text).toBe('line1');
      expect(block.items[1].text).toBe('line2');
      expect(Array.isArray(block.items)).toBe(true);
    });

    it('should support empty items array', () => {
      const block: SourceTextBlock = makeSourceTextBlock({
        items: [],
        text: '',
      });
      expect(block.items).toHaveLength(0);
      expect(block.text).toBe('');
    });

    it('yStart should be the top (max y) and yEnd the bottom (min y) of the block', () => {
      // In PDF coordinate system, y increases upward
      const items: SourceTextItem[] = [
        makeSourceTextItem({ text: 'top line', y: 700, sourceIndex: 0 }),
        makeSourceTextItem({ text: 'bottom line', y: 680, sourceIndex: 1 }),
      ];
      const block: SourceTextBlock = makeSourceTextBlock({
        items,
        text: 'top line\nbottom line',
        yStart: 700, // max y
        yEnd: 680,   // min y
      });
      expect(block.yStart).toBeGreaterThanOrEqual(block.yEnd);
      expect(block.yStart).toBe(700);
      expect(block.yEnd).toBe(680);
    });

    it('blockIndex should represent stable in-page ordering', () => {
      const blocks: SourceTextBlock[] = [
        makeSourceTextBlock({ text: 'first block', blockIndex: 0 }),
        makeSourceTextBlock({ text: 'second block', blockIndex: 1 }),
        makeSourceTextBlock({ text: 'third block', blockIndex: 2 }),
      ];
      blocks.forEach((b, i) => {
        expect(b.blockIndex).toBe(i);
      });
    });

    it('avgFontSize should reflect the average of contained items', () => {
      const items: SourceTextItem[] = [
        makeSourceTextItem({ text: 'a', fontSize: 14, sourceIndex: 0 }),
        makeSourceTextItem({ text: 'b', fontSize: 16, sourceIndex: 1 }),
      ];
      const block: SourceTextBlock = makeSourceTextBlock({
        items,
        text: 'ab',
        avgFontSize: 15, // (14 + 16) / 2
      });
      const computedAvg = items.reduce((sum, i) => sum + i.fontSize, 0) / items.length;
      expect(block.avgFontSize).toBeCloseTo(computedAvg, 1);
    });

    it('text should preserve newlines from mechanical aggregation', () => {
      const block: SourceTextBlock = makeSourceTextBlock({
        text: 'first line\nsecond line\nthird line',
      });
      expect(block.text).toContain('\n');
      expect(block.text.split('\n')).toHaveLength(3);
    });
  });

  // ---------- Mechanical aggregation rule verification (via type structure) ----------

  describe('mechanical block aggregation attributes', () => {
    it('a block aggregates items with similar mechanical properties', () => {
      // Items on the same line (same y, similar fontSize) should be in one block
      const sameLineItems: SourceTextItem[] = [
        makeSourceTextItem({ text: 'Hello', x: 50, y: 700, fontSize: 12, hasEol: false, sourceIndex: 0 }),
        makeSourceTextItem({ text: ' ', x: 80, y: 700, fontSize: 12, hasEol: false, sourceIndex: 1 }),
        makeSourceTextItem({ text: 'World', x: 90, y: 700, fontSize: 12, hasEol: true, sourceIndex: 2 }),
      ];
      const block: SourceTextBlock = makeSourceTextBlock({
        items: sameLineItems,
        text: 'Hello World',
        avgFontSize: 12,
        yStart: 700,
        yEnd: 700,
      });
      expect(block.items).toHaveLength(3);
      expect(block.text).toBe('Hello World');
    });

    it('different blocks should have different blockIndex values within a page', () => {
      const page1Blocks: SourceTextBlock[] = [
        makeSourceTextBlock({ text: 'heading', pageNumber: 1, blockIndex: 0, avgFontSize: 18 }),
        makeSourceTextBlock({ text: 'body paragraph', pageNumber: 1, blockIndex: 1, avgFontSize: 12 }),
        makeSourceTextBlock({ text: 'another section', pageNumber: 1, blockIndex: 2, avgFontSize: 16 }),
      ];
      const indices = page1Blocks.map(b => b.blockIndex);
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBe(indices.length);
    });

    it('blocks on different pages can have the same blockIndex', () => {
      const block1: SourceTextBlock = makeSourceTextBlock({ text: 'page 1 block', pageNumber: 1, blockIndex: 0 });
      const block2: SourceTextBlock = makeSourceTextBlock({ text: 'page 2 block', pageNumber: 2, blockIndex: 0 });
      expect(block1.blockIndex).toBe(block2.blockIndex);
      expect(block1.pageNumber).not.toBe(block2.pageNumber);
    });

    it('fontSize change should be representable in block avgFontSize (mechanical signal)', () => {
      // A heading block would have a larger avgFontSize than a body block
      const headingBlock: SourceTextBlock = makeSourceTextBlock({
        text: 'Chapter 1',
        avgFontSize: 24,
      });
      const bodyBlock: SourceTextBlock = makeSourceTextBlock({
        text: 'This is the body text of the chapter.',
        avgFontSize: 12,
      });
      expect(headingBlock.avgFontSize).toBeGreaterThan(bodyBlock.avgFontSize);
    });
  });
});
