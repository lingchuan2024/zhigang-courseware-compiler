import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  generateStableEvidenceId,
  generateEvidencesFromPage,
  generateEvidences,
} from '../evidence';
import { CoursePage, SourceTextBlock, SourceTextItem } from '../../types';

// ========== Mock helpers ==========

function makeSourceTextItem(
  text: string,
  overrides: Partial<SourceTextItem> = {}
): SourceTextItem {
  return {
    text,
    x: 50,
    y: 700,
    fontSize: 12,
    hasEol: true,
    sourceIndex: 0,
    ...overrides,
  };
}

function makeBlock(
  text: string,
  overrides: Partial<SourceTextBlock> & {
    pageNumber?: number;
    blockIndex?: number;
  } = {}
): SourceTextBlock {
  const pageNumber = overrides.pageNumber ?? 1;
  const blockIndex = overrides.blockIndex ?? 0;
  return {
    items: [makeSourceTextItem(text)],
    text,
    pageNumber,
    blockIndex,
    avgFontSize: 12,
    yStart: 700,
    yEnd: 700,
    ...overrides,
  };
}

function makePage(
  overrides: Partial<CoursePage> & {
    pageNumber?: number;
    blocks?: SourceTextBlock[];
    text?: string;
  } = {}
): CoursePage {
  const pageNumber = overrides.pageNumber ?? 1;
  return {
    pageNumber,
    text: overrides.text ?? '',
    blocks: overrides.blocks,
    ...overrides,
  };
}

// ========== Tests ==========

describe('evidence mechanical chunking', () => {
  // ---------- computeContentHash ----------

  describe('computeContentHash', () => {
    it('should not include type in hash (stable across type changes)', () => {
      const hashText = computeContentHash('doc1', 1, 0, 'text', 'same content');
      const hashDefinition = computeContentHash('doc1', 1, 0, 'definition', 'same content');
      const hashFormula = computeContentHash('doc1', 1, 0, 'formula', 'same content');
      const hashProcedure = computeContentHash('doc1', 1, 0, 'procedure', 'same content');
      expect(hashText).toBe(hashDefinition);
      expect(hashText).toBe(hashFormula);
      expect(hashText).toBe(hashProcedure);
    });

    it('should produce same hash for identical inputs', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello world');
      const h2 = computeContentHash('doc1', 1, 0, 'text', 'hello world');
      expect(h1).toBe(h2);
    });

    it('should produce different hash for different documentId', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc2', 1, 0, 'text', 'hello');
      expect(h1).not.toBe(h2);
    });

    it('should produce different hash for different pageNumber', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc1', 2, 0, 'text', 'hello');
      expect(h1).not.toBe(h2);
    });

    it('should produce different hash for different blockIndex', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc1', 1, 1, 'text', 'hello');
      expect(h1).not.toBe(h2);
    });

    it('should produce different hash for different content', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const h2 = computeContentHash('doc1', 1, 0, 'text', 'world');
      expect(h1).not.toBe(h2);
    });

    it('should normalize whitespace in content before hashing', () => {
      const h1 = computeContentHash('doc1', 1, 0, 'text', 'hello   world');
      const h2 = computeContentHash('doc1', 1, 0, 'text', 'hello world');
      const h3 = computeContentHash('doc1', 1, 0, 'text', 'hello\n  world');
      // After normalization (trim + collapse whitespace), all should be equal
      expect(h1).toBe(h2);
      expect(h1).toBe(h3);
    });

    it('should return a hash prefixed with "h"', () => {
      const h = computeContentHash('doc1', 1, 0, 'text', 'hello');
      expect(h.startsWith('h')).toBe(true);
    });
  });

  // ---------- generateStableEvidenceId ----------

  describe('generateStableEvidenceId', () => {
    it('should be deterministic for same inputs', () => {
      const hash = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash);
      const id2 = generateStableEvidenceId('doc1', 1, 0, hash);
      expect(id1).toBe(id2);
    });

    it('should follow the ev_documentId_page_blockHash format', () => {
      const hash = computeContentHash('doc1', 2, 3, 'formula', 'E=mc^2');
      const id = generateStableEvidenceId('doc1', 2, 3, hash);
      expect(id).toBe(`ev_doc1_2_3_${hash}`);
    });

    it('should produce different IDs for different documentId', () => {
      const hash1 = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const hash2 = computeContentHash('doc2', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash1);
      const id2 = generateStableEvidenceId('doc2', 1, 0, hash2);
      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different pageNumber', () => {
      const hash = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash);
      const id2 = generateStableEvidenceId('doc1', 2, 0, hash);
      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different blockIndex', () => {
      const hash = computeContentHash('doc1', 1, 0, 'text', 'hello');
      const id1 = generateStableEvidenceId('doc1', 1, 0, hash);
      const id2 = generateStableEvidenceId('doc1', 1, 1, hash);
      expect(id1).not.toBe(id2);
    });
  });

  // ---------- generateEvidencesFromPage with blocks ----------

  describe('generateEvidencesFromPage with blocks', () => {
    it('should use blocks when page.blocks is provided', () => {
      const page = makePage({
        pageNumber: 1,
        text: 'this is fallback text that should NOT be used',
        blocks: [
          makeBlock('First block about definitions.', { blockIndex: 0 }),
          makeBlock('Second block about examples.', { blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences.length).toBe(2);
      // Should NOT contain the fallback text
      evidences.forEach(ev => {
        expect(ev.content).not.toContain('fallback text');
      });
    });

    it('should assign correct pageNumber to all evidences from blocks', () => {
      const page = makePage({
        pageNumber: 5,
        blocks: [
          makeBlock('block A', { pageNumber: 5, blockIndex: 0 }),
          makeBlock('block B', { pageNumber: 5, blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      evidences.forEach(ev => {
        expect(ev.pageNumber).toBe(5);
      });
    });

    it('should assign sequential blockIndex to chunks from blocks', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('first block content here.', { blockIndex: 0 }),
          makeBlock('second block content here.', { blockIndex: 1 }),
          makeBlock('third block content here.', { blockIndex: 2 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      // blockIndex should be sequential starting from 0
      evidences.forEach((ev, i) => {
        expect(ev.blockIndex).toBe(i);
      });
    });

    it('should generate stable IDs that include documentId and pageNumber', () => {
      const page = makePage({
        pageNumber: 3,
        blocks: [makeBlock('test content block', { pageNumber: 3 })],
      });
      const evidences = generateEvidencesFromPage(page, 'my-doc');
      expect(evidences.length).toBeGreaterThan(0);
      evidences.forEach(ev => {
        expect(ev.id).toContain('my-doc');
        expect(ev.id).toContain('_3_'); // pageNumber in ID
        expect(ev.id.startsWith('ev_')).toBe(true);
      });
    });

    it('should set contentHash on each evidence', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('content one', { blockIndex: 0 }),
          makeBlock('content two', { blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      evidences.forEach(ev => {
        expect(ev.contentHash).toBeTruthy();
        expect(ev.contentHash.startsWith('h')).toBe(true);
      });
    });

    it('should produce fine-grained chunks: one block produces at least one evidence', () => {
      const blocks: SourceTextBlock[] = [];
      for (let i = 0; i < 5; i++) {
        blocks.push(
          makeBlock(`这是第${i + 1}个文本块，包含独立的定义内容。`, {
            blockIndex: i,
          })
        );
      }
      const page = makePage({ pageNumber: 1, blocks });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      // 5 small blocks → at least 5 evidences
      expect(evidences.length).toBeGreaterThanOrEqual(5);
    });

    it('should split large blocks into multiple fine-grained chunks', () => {
      // Create a block with text > MAX_EVIDENCE_CHARS (300)
      const longText = Array.from({ length: 20 }, (_, i) =>
        `这是第${i + 1}行的内容，包含足够的文本用于测试分块逻辑。`
      ).join('\n');
      expect(longText.length).toBeGreaterThan(300);

      const page = makePage({
        pageNumber: 1,
        blocks: [makeBlock(longText)],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      // A single large block should be split into multiple evidences
      expect(evidences.length).toBeGreaterThan(1);
    });

    it('should not merge content from different blocks', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('苹果是一种水果。', { blockIndex: 0 }),
          makeBlock('香蕉是另一种水果。', { blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      // Each evidence should contain content from only one block
      evidences.forEach(ev => {
        const hasApple = ev.content.includes('苹果');
        const hasBanana = ev.content.includes('香蕉');
        // An evidence should not contain content from both blocks
        expect(hasApple && hasBanana).toBe(false);
      });
    });

    it('should skip blocks with empty text', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('valid content', { blockIndex: 0 }),
          makeBlock('', { blockIndex: 1 }),
          makeBlock('more valid content', { blockIndex: 2 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      // Empty block should be skipped
      evidences.forEach(ev => {
        expect(ev.content).not.toBe('');
      });
    });

    it('should use default documentId when not provided', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [makeBlock('test content')],
      });
      const evidences = generateEvidencesFromPage(page);
      expect(evidences.length).toBeGreaterThan(0);
      expect(evidences[0].documentId).toBe('unknown');
    });
  });

  // ---------- generateEvidencesFromPage without blocks (fallback) ----------

  describe('generateEvidencesFromPage without blocks (fallback to text)', () => {
    it('should fall back to text splitting when blocks is undefined', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '定义：这是一个测试定义。\n\n例如：这是一个例子。',
      };
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences.length).toBeGreaterThan(0);
      const combined = evidences.map(e => e.content).join(' ');
      expect(combined).toContain('测试定义');
      expect(combined).toContain('例子');
    });

    it('should fall back to text splitting when blocks is empty array', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '定义：这是一个测试定义。',
        blocks: [],
      };
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences.length).toBeGreaterThan(0);
      expect(evidences[0].content).toContain('测试定义');
    });

    it('should return empty array for empty page text and no blocks', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '',
      };
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences).toHaveLength(0);
    });

    it('should return empty array for whitespace-only text and no blocks', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '   \n  \n  ',
      };
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences).toHaveLength(0);
    });

    it('should split text into multiple chunks when text has multiple sections', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: [
          '1. 第一个标题',
          '这是第一段正文内容，描述了一些概念。',
          '',
          '2. 第二个标题',
          '这是第二段正文内容，描述了另一些概念。',
        ].join('\n'),
      };
      const evidences = generateEvidencesFromPage(page, 'doc1');
      expect(evidences.length).toBeGreaterThan(1);
    });
  });

  // ---------- Stable IDs ----------

  describe('stable IDs', () => {
    it('same page with blocks produces same evidence IDs', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('定义：最大似然估计是一种参数估计方法。', { blockIndex: 0 }),
          makeBlock('例如：给定一组样本，求参数的MLE。', { blockIndex: 1 }),
        ],
      });
      const evs1 = generateEvidencesFromPage(page, 'doc1');
      const evs2 = generateEvidencesFromPage(page, 'doc1');
      expect(evs1.length).toBe(evs2.length);
      for (let i = 0; i < evs1.length; i++) {
        expect(evs1[i].id).toBe(evs2[i].id);
        expect(evs1[i].contentHash).toBe(evs2[i].contentHash);
      }
    });

    it('same page with text fallback produces same evidence IDs', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '定义：这是一个测试定义。\n\n例如：这是一个例子。',
      };
      const evs1 = generateEvidencesFromPage(page, 'doc1');
      const evs2 = generateEvidencesFromPage(page, 'doc1');
      expect(evs1.length).toBe(evs2.length);
      for (let i = 0; i < evs1.length; i++) {
        expect(evs1[i].id).toBe(evs2[i].id);
      }
    });

    it('different documentId produces different evidence IDs for same content', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [makeBlock('same content here')],
      });
      const evs1 = generateEvidencesFromPage(page, 'docA');
      const evs2 = generateEvidencesFromPage(page, 'docB');
      expect(evs1.length).toBe(evs2.length);
      for (let i = 0; i < evs1.length; i++) {
        expect(evs1[i].id).not.toBe(evs2[i].id);
        expect(evs1[i].documentId).toBe('docA');
        expect(evs2[i].documentId).toBe('docB');
      }
    });
  });

  // ---------- No cross-page merging ----------

  describe('no cross-page merging', () => {
    it('should not merge evidence across pages', () => {
      const pages: CoursePage[] = [
        makePage({
          pageNumber: 1,
          text: 'Page one content about apples.',
          blocks: [makeBlock('Page one content about apples.', { pageNumber: 1 })],
        }),
        makePage({
          pageNumber: 2,
          text: 'Page two content about bananas.',
          blocks: [makeBlock('Page two content about bananas.', { pageNumber: 2 })],
        }),
      ];
      const evidences = generateEvidences(pages, 'doc1');
      const page1Evs = evidences.filter(e => e.pageNumber === 1);
      const page2Evs = evidences.filter(e => e.pageNumber === 2);

      expect(page1Evs.length).toBeGreaterThan(0);
      expect(page2Evs.length).toBeGreaterThan(0);

      // Page 1 evidence should not contain page 2 content
      page1Evs.forEach(ev => {
        expect(ev.content).not.toContain('bananas');
      });
      // Page 2 evidence should not contain page 1 content
      page2Evs.forEach(ev => {
        expect(ev.content).not.toContain('apples');
      });
    });

    it('should process each page independently with correct pageNumber', () => {
      const pages: CoursePage[] = [
        makePage({
          pageNumber: 1,
          blocks: [makeBlock('content A', { pageNumber: 1 })],
        }),
        makePage({
          pageNumber: 2,
          blocks: [makeBlock('content B', { pageNumber: 2 })],
        }),
        makePage({
          pageNumber: 3,
          blocks: [makeBlock('content C', { pageNumber: 3 })],
        }),
      ];
      const evidences = generateEvidences(pages, 'doc1');
      const pageNumbers = new Set(evidences.map(e => e.pageNumber));
      expect(pageNumbers.has(1)).toBe(true);
      expect(pageNumbers.has(2)).toBe(true);
      expect(pageNumbers.has(3)).toBe(true);
    });

    it('blockIndex resets to 0 for each page', () => {
      const pages: CoursePage[] = [
        makePage({
          pageNumber: 1,
          blocks: [
            makeBlock('page1 block0', { pageNumber: 1 }),
            makeBlock('page1 block1', { pageNumber: 1 }),
          ],
        }),
        makePage({
          pageNumber: 2,
          blocks: [
            makeBlock('page2 block0', { pageNumber: 2 }),
            makeBlock('page2 block1', { pageNumber: 2 }),
          ],
        }),
      ];
      const evidences = generateEvidences(pages, 'doc1');
      const page1Evs = evidences.filter(e => e.pageNumber === 1);
      const page2Evs = evidences.filter(e => e.pageNumber === 2);

      // Page 1 should start at blockIndex 0
      expect(page1Evs[0].blockIndex).toBe(0);
      // Page 2 should also start at blockIndex 0
      expect(page2Evs[0].blockIndex).toBe(0);

      // But their IDs should be different (includes pageNumber)
      expect(page1Evs[0].id).not.toBe(page2Evs[0].id);
    });

    it('should handle mixed pages (some with blocks, some without)', () => {
      const pages: CoursePage[] = [
        makePage({
          pageNumber: 1,
          blocks: [makeBlock('structured content', { pageNumber: 1 })],
        }),
        {
          pageNumber: 2,
          text: '这是非结构化的文本内容，用于回退测试。',
        },
      ];
      const evidences = generateEvidences(pages, 'doc1');
      const page1Evs = evidences.filter(e => e.pageNumber === 1);
      const page2Evs = evidences.filter(e => e.pageNumber === 2);
      expect(page1Evs.length).toBeGreaterThan(0);
      expect(page2Evs.length).toBeGreaterThan(0);
      expect(page1Evs[0].content).toContain('structured content');
      expect(page2Evs[0].content).toContain('非结构化');
    });
  });

  // ---------- Fine-grained evidence from blocks ----------

  describe('fine-grained evidence from blocks', () => {
    it('should produce more evidence atoms than raw page text would', () => {
      // With blocks, each block boundary is respected → more fine-grained
      const blockTexts = [
        '定义：梯度下降是一种优化算法。',
        '公式：θ = θ - α∇J(θ)',
        '步骤：1. 初始化参数 2. 计算梯度 3. 更新参数 4. 重复直到收敛。',
        '例子：对于线性回归，梯度下降用于最小化损失函数。',
        '注意：学习率过大可能导致不收敛。',
      ];
      const blocks = blockTexts.map((text, i) =>
        makeBlock(text, { blockIndex: i, pageNumber: 1 })
      );
      const pageWithBlocks = makePage({
        pageNumber: 1,
        text: blockTexts.join('\n\n'),
        blocks,
      });
      const pageWithoutBlocks: CoursePage = {
        pageNumber: 1,
        text: blockTexts.join('\n\n'),
      };

      const evsWithBlocks = generateEvidencesFromPage(pageWithBlocks, 'doc1');
      const evsWithoutBlocks = generateEvidencesFromPage(pageWithoutBlocks, 'doc1');

      // With blocks, each block should produce at least one evidence
      expect(evsWithBlocks.length).toBeGreaterThanOrEqual(blockTexts.length);
      // The block-based approach should be at least as fine-grained
      expect(evsWithBlocks.length).toBeGreaterThanOrEqual(evsWithoutBlocks.length);
    });

    it('each evidence from blocks should have meaningful content', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('定义：神经网络是一种模仿人脑的机器学习模型。', { blockIndex: 0 }),
          makeBlock('公式：y = f(Wx + b)', { blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      evidences.forEach(ev => {
        expect(ev.content.length).toBeGreaterThan(0);
        expect(ev.content.trim()).toBe(ev.content); // should be trimmed
      });
    });

    it('should assign a type and confidence to each evidence', () => {
      const page = makePage({
        pageNumber: 1,
        blocks: [
          makeBlock('定义：机器学习是研究如何让计算机自动学习的学科。', { blockIndex: 0 }),
          makeBlock('例如：垃圾邮件分类是机器学习的一个应用。', { blockIndex: 1 }),
        ],
      });
      const evidences = generateEvidencesFromPage(page, 'doc1');
      evidences.forEach(ev => {
        expect(ev.type).toBeTruthy();
        expect(ev.confidence).toBeGreaterThanOrEqual(0);
        expect(ev.confidence).toBeLessThanOrEqual(1);
      });
    });
  });
});
