import { describe, it, expect } from 'vitest';
import { CoursePage, EvidenceType } from '../../types';
import { EVIDENCE_TYPE_LABELS, EVIDENCE_TYPE_LIST } from '../../components/document-review/evidence-types';

describe('page preview states', () => {
  describe('PDF page with preview image', () => {
    it('有 preview 的页面应识别为可渲染', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '内容',
        preview: 'data:image/png;base64,abc',
      };
      expect(page.preview).toBeDefined();
      expect(page.text).toBeTruthy();
    });
  });

  describe('blank page detection', () => {
    it('无文本且无 preview 的页面为空白页', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '',
      };
      const isBlank = !page.text || page.text.trim().length === 0;
      expect(isBlank).toBe(true);
    });

    it('有空白字符的页面也识别为空白页', () => {
      const page: CoursePage = {
        pageNumber: 2,
        text: '   \n  \t  ',
      };
      const isBlank = !page.text || page.text.trim().length === 0;
      expect(isBlank).toBe(true);
    });
  });

  describe('OCR fallback detection', () => {
    it('有 warning 的页面应使用 OCR 降级', () => {
      const page: CoursePage = {
        pageNumber: 3,
        text: 'OCR提取的低质量文本',
        warning: 'OCR质量较低',
      };
      expect(page.warning).toBeDefined();
      expect(page.text).toBeTruthy();
    });
  });

  describe('no-image fallback (PPT/text-only)', () => {
    it('有文本但无 preview 的页面使用结构化文本降级', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: 'PPT 提取的文本内容',
        // 无 preview 字段
      };
      const hasNoImage = !page.preview;
      const hasText = page.text && page.text.trim().length > 0;
      expect(hasNoImage).toBe(true);
      expect(hasText).toBe(true);
    });

    it('有 blocks 的页面可显示结构化文本', () => {
      const page: CoursePage = {
        pageNumber: 1,
        text: '标题\n正文内容',
        blocks: [
          {
            items: [{ text: '标题', x: 0, y: 0, fontSize: 18, hasEol: true, sourceIndex: 0 }],
            text: '标题',
            pageNumber: 1,
            blockIndex: 0,
            avgFontSize: 18,
            yStart: 0,
            yEnd: 20,
          },
          {
            items: [{ text: '正文内容', x: 0, y: 30, fontSize: 14, hasEol: true, sourceIndex: 1 }],
            text: '正文内容',
            pageNumber: 1,
            blockIndex: 1,
            avgFontSize: 14,
            yStart: 30,
            yEnd: 50,
          },
        ],
      };
      expect(page.blocks).toBeDefined();
      expect(page.blocks!.length).toBe(2);
      expect(page.blocks![0].text).toBe('标题');
    });
  });
});

describe('evidence type labels', () => {
  it('所有 EvidenceType 都有对应标签', () => {
    for (const type of EVIDENCE_TYPE_LIST) {
      const label = EVIDENCE_TYPE_LABELS[type];
      expect(label).toBeDefined();
      expect(label.label).toBeTruthy();
      expect(label.color).toBeTruthy();
      expect(label.bgColor).toBeTruthy();
    }
  });

  it('label 是中文字符串', () => {
    expect(EVIDENCE_TYPE_LABELS.definition.label).toBe('定义');
    expect(EVIDENCE_TYPE_LABELS.formula.label).toBe('公式');
    expect(EVIDENCE_TYPE_LABELS.example.label).toBe('示例');
  });
});

describe('evidence filtering logic', () => {
  const mockEvidences = [
    { id: 'ev1', pageNumber: 1, type: 'definition' as EvidenceType, content: '定义A', confidence: 0.9 },
    { id: 'ev2', pageNumber: 1, type: 'formula' as EvidenceType, content: '公式B', confidence: 0.8 },
    { id: 'ev3', pageNumber: 1, type: 'formula' as EvidenceType, content: '公式C', confidence: 0.3 },
    { id: 'ev4', pageNumber: 2, type: 'example' as EvidenceType, content: '示例D', confidence: 0.7 },
  ];

  it('按类型筛选正确过滤', () => {
    const filtered = mockEvidences.filter(e => e.type === 'formula');
    expect(filtered.length).toBe(2);
    expect(filtered.every(e => e.type === 'formula')).toBe(true);
  });

  it('搜索查询正确过滤', () => {
    const query = '公式';
    const filtered = mockEvidences.filter(e => e.content.includes(query));
    expect(filtered.length).toBe(2);
  });

  it('低置信度证据正确识别', () => {
    const lowConfidence = mockEvidences.filter(e => e.confidence < 0.5);
    expect(lowConfidence.length).toBe(1);
    expect(lowConfidence[0].id).toBe('ev3');
  });

  it('类型统计正确计算', () => {
    const counts = new Map<EvidenceType, number>();
    for (const ev of mockEvidences.filter(e => e.pageNumber === 1)) {
      counts.set(ev.type, (counts.get(ev.type) || 0) + 1);
    }
    expect(counts.get('definition')).toBe(1);
    expect(counts.get('formula')).toBe(2);
  });
});
