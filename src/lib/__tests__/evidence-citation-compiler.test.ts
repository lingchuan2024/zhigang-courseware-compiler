import { describe, it, expect } from 'vitest';
import {
  compileEvidenceCitations,
  hasLegacyCitations,
  extractAllCitationMarkers,
} from '../evidence-citation-compiler';

// ========== 测试用已知 Evidence ID 集合 ==========
// 覆盖 ev-1 ~ ev-5，用于大多数测试场景
function knownIds(...ids: string[]): Set<string> {
  return new Set(ids);
}

describe('evidence-citation-compiler', () => {
  // ============================================================
  // compileEvidenceCitations
  // ============================================================
  describe('compileEvidenceCitations', () => {
    // ---- 1. 多个 Evidence ID 在同一占位符中编译为单个引用 ----
    describe('多个 Evidence ID 编译为单个引用', () => {
      it('[[evidence:ev-1,ev-2]] 生成单个 [cite-1] 标记', () => {
        const md = '这是结论 [[evidence:ev-1,ev-2]]。';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('这是结论 [cite-1]。');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.citations[0].evidenceIds).toEqual(['ev-1', 'ev-2']);
        expect(result.warnings).toEqual([]);
      });

      it('三个 ID 同样编译为单个引用', () => {
        const md = '[[evidence:ev-1,ev-2,ev-3]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2', 'ev-3'));

        expect(result.markdown).toBe('[cite-1]');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].evidenceIds).toHaveLength(3);
      });

      it('占位符前后文本保持不变', () => {
        const md = '前文 [[evidence:ev-1,ev-2]] 后文';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));
        expect(result.markdown).toBe('前文 [cite-1] 后文');
      });
    });

    // ---- 2. 未知 Evidence ID 被过滤并产生警告 ----
    describe('未知 Evidence ID 过滤与警告', () => {
      it('未知 ID 被过滤掉，保留有效 ID 并生成引用', () => {
        const md = '结论 [[evidence:ev-1,unknown-id]]。';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('结论 [cite-1]。');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].evidenceIds).toEqual(['ev-1']);
        expect(result.warnings).toContain('未知的 Evidence ID: unknown-id');
      });

      it('多个未知 ID 各自产生独立警告', () => {
        const md = '[[evidence:ev-1,bad-1,bad-2]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.citations[0].evidenceIds).toEqual(['ev-1']);
        expect(result.warnings).toContain('未知的 Evidence ID: bad-1');
        expect(result.warnings).toContain('未知的 Evidence ID: bad-2');
        expect(result.warnings).toHaveLength(2);
      });

      it('有效 ID 在未知 ID 之后仍被正确处理', () => {
        const md = '[[evidence:bad-1,ev-2,bad-2,ev-3]]';
        const result = compileEvidenceCitations(md, knownIds('ev-2', 'ev-3'));

        expect(result.citations[0].evidenceIds).toEqual(['ev-2', 'ev-3']);
        expect(result.warnings).toContain('未知的 Evidence ID: bad-1');
        expect(result.warnings).toContain('未知的 Evidence ID: bad-2');
      });
    });

    // ---- 3. 相同 evidence group（相同 ID 集合）复用同一标记 ----
    describe('相同 evidence group 复用标记', () => {
      it('两个相同占位符复用同一 [cite-1] 标记', () => {
        const md = '第一处 [[evidence:ev-1,ev-2]]，第二处 [[evidence:ev-1,ev-2]]。';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('第一处 [cite-1]，第二处 [cite-1]。');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
      });

      it('ID 顺序不同但集合相同也复用同一标记（按排序归一化）', () => {
        const md = '[[evidence:ev-1,ev-2]] 和 [[evidence:ev-2,ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('[cite-1] 和 [cite-1]');
        expect(result.citations).toHaveLength(1);
      });

      it('三处相同 group 仍只生成一个 citation 条目', () => {
        const md = 'A[[evidence:ev-1]]B[[evidence:ev-1]]C[[evidence:ev-1]]D';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('A[cite-1]B[cite-1]C[cite-1]D');
        expect(result.citations).toHaveLength(1);
      });
    });

    // ---- 4. 不同的 evidence group 获得不同标记 ----
    describe('不同 evidence group 获得不同标记', () => {
      it('两个不同单 ID 占位符分别得到 cite-1 与 cite-2', () => {
        const md = '一 [[evidence:ev-1]]，二 [[evidence:ev-2]]。';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('一 [cite-1]，二 [cite-2]。');
        expect(result.citations).toHaveLength(2);
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.citations[0].evidenceIds).toEqual(['ev-1']);
        expect(result.citations[1].marker).toBe('cite-2');
        expect(result.citations[1].evidenceIds).toEqual(['ev-2']);
      });

      it('单 ID 与多 ID 组合分别得到不同标记', () => {
        const md = '[[evidence:ev-1]] 然后 [[evidence:ev-2,ev-3]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2', 'ev-3'));

        expect(result.markdown).toBe('[cite-1] 然后 [cite-2]');
        expect(result.citations).toHaveLength(2);
      });

      it('两个不同的多 ID 组合得到不同标记', () => {
        const md = '[[evidence:ev-1,ev-2]] / [[evidence:ev-3,ev-4]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2', 'ev-3', 'ev-4'));

        expect(result.markdown).toBe('[cite-1] / [cite-2]');
        expect(result.citations).toHaveLength(2);
        expect(result.citations[0].evidenceIds).toEqual(['ev-1', 'ev-2']);
        expect(result.citations[1].evidenceIds).toEqual(['ev-3', 'ev-4']);
      });
    });

    // ---- 5. 相邻占位符同 group 复用标记（不堆积） ----
    describe('相邻占位符同 group 复用标记', () => {
      it('两个相邻同 group 占位符各生成一个 [cite-1]，不堆积为 cite-2', () => {
        const md = '[[evidence:ev-1]][[evidence:ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('[cite-1][cite-1]');
        expect(result.citations).toHaveLength(1);
      });

      it('三个相邻同 group 占位符生成 [cite-1][cite-1][cite-1]', () => {
        const md = '[[evidence:ev-1]][[evidence:ev-1]][[evidence:ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('[cite-1][cite-1][cite-1]');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
      });

      it('相邻同 group 多 ID 占位符也复用标记', () => {
        const md = '[[evidence:ev-1,ev-2]][[evidence:ev-1,ev-2]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('[cite-1][cite-1]');
        expect(result.citations).toHaveLength(1);
      });
    });

    // ---- 6. 回归测试：[[evidence:ev-2,ev-3,ev-4,ev-5]] 生成单个 [cite-N] ----
    describe('回归测试：四 ID 占位符生成单个标记', () => {
      it('[[evidence:ev-2,ev-3,ev-4,ev-5]] 生成单个 [cite-1]', () => {
        const md = '结论 [[evidence:ev-2,ev-3,ev-4,ev-5]] 结束';
        const result = compileEvidenceCitations(
          md,
          knownIds('ev-2', 'ev-3', 'ev-4', 'ev-5')
        );

        // 必须是单个标记，不能拆成多个
        expect(result.markdown).toBe('结论 [cite-1] 结束');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.citations[0].evidenceIds).toEqual([
          'ev-2',
          'ev-3',
          'ev-4',
          'ev-5',
        ]);
        expect(result.warnings).toEqual([]);
      });

      it('回归：四 ID 占位符重复出现仍复用同一标记', () => {
        const md = 'A[[evidence:ev-2,ev-3,ev-4,ev-5]]B[[evidence:ev-2,ev-3,ev-4,ev-5]]C';
        const result = compileEvidenceCitations(
          md,
          knownIds('ev-2', 'ev-3', 'ev-4', 'ev-5')
        );

        expect(result.markdown).toBe('A[cite-1]B[cite-1]C');
        expect(result.citations).toHaveLength(1);
      });

      it('回归：四 ID 乱序仍归一为同一 group', () => {
        const md = '[[evidence:ev-5,ev-2,ev-4,ev-3]]';
        const result = compileEvidenceCitations(
          md,
          knownIds('ev-2', 'ev-3', 'ev-4', 'ev-5')
        );

        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
        // evidenceIds 按排序归一化存储
        expect(result.citations[0].evidenceIds).toEqual([
          'ev-2',
          'ev-3',
          'ev-4',
          'ev-5',
        ]);
      });
    });

    // ---- 7. 空占位符（全部未知 ID）产生警告并被移除 ----
    describe('空占位符（全部未知 ID）', () => {
      it('全部未知 ID 的占位符被移除并产生警告', () => {
        const md = '前缀[[evidence:bad-id]]后缀';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('前缀后缀');
        expect(result.citations).toEqual([]);
        expect(result.warnings).toContain('未知的 Evidence ID: bad-id');
        expect(result.warnings).toContain(
          '占位符 [[evidence:bad-id]] 中没有有效的 Evidence ID'
        );
      });

      it('多个未知 ID 同时触发逐个警告与空占位符警告', () => {
        const md = '[[evidence:bad-1,bad-2]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('');
        expect(result.citations).toEqual([]);
        // 两条未知 ID 警告 + 一条空占位符警告
        expect(result.warnings).toHaveLength(3);
        expect(result.warnings).toContain('未知的 Evidence ID: bad-1');
        expect(result.warnings).toContain('未知的 Evidence ID: bad-2');
        expect(result.warnings).toContain(
          '占位符 [[evidence:bad-1,bad-2]] 中没有有效的 Evidence ID'
        );
      });

      it('空占位符与有效占位符混合时各自独立处理', () => {
        const md = '有效[[evidence:ev-1]]空[[evidence:bad]]尾';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('有效[cite-1]空尾');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.warnings).toContain('未知的 Evidence ID: bad');
        expect(result.warnings).toContain(
          '占位符 [[evidence:bad]] 中没有有效的 Evidence ID'
        );
      });
    });

    // ---- 8. 占位符内重复 ID 被去重 ----
    describe('占位符内重复 ID 去重', () => {
      it('同一 ID 重复两次只保留一个', () => {
        const md = '[[evidence:ev-1,ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('[cite-1]');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].evidenceIds).toEqual(['ev-1']);
      });

      it('同一 ID 重复三次只保留一个', () => {
        const md = '[[evidence:ev-1,ev-1,ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.citations[0].evidenceIds).toEqual(['ev-1']);
        expect(result.citations[0].evidenceIds).toHaveLength(1);
      });

      it('混合重复：部分 ID 重复，结果去重后排序', () => {
        const md = '[[evidence:ev-2,ev-1,ev-2,ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.citations).toHaveLength(1);
        expect(result.citations[0].evidenceIds).toEqual(['ev-1', 'ev-2']);
      });

      it('去重后的 group 与未重复的相同 group 复用同一标记', () => {
        const md = '[[evidence:ev-1,ev-1]] 和 [[evidence:ev-1]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe('[cite-1] 和 [cite-1]');
        expect(result.citations).toHaveLength(1);
      });
    });

    // ---- 9. 标记按首次出现顺序递增 ----
    describe('标记按首次出现顺序递增', () => {
      it('首次出现决定编号，后续复用不占用新编号', () => {
        const md = '[[evidence:ev-2]] [[evidence:ev-1]] [[evidence:ev-2]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        // ev-2 首先出现 → cite-1；ev-1 第二次出现 → cite-2；ev-2 再次出现 → 复用 cite-1
        expect(result.markdown).toBe('[cite-1] [cite-2] [cite-1]');
        expect(result.citations).toHaveLength(2);
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.citations[0].evidenceIds).toEqual(['ev-2']);
        expect(result.citations[1].marker).toBe('cite-2');
        expect(result.citations[1].evidenceIds).toEqual(['ev-1']);
      });

      it('三个不同 group 按出现顺序编号 cite-1, cite-2, cite-3', () => {
        const md = 'A[[evidence:ev-3]]B[[evidence:ev-1]]C[[evidence:ev-2]]D';
        const result = compileEvidenceCitations(
          md,
          knownIds('ev-1', 'ev-2', 'ev-3')
        );

        expect(result.markdown).toBe('A[cite-1]B[cite-2]C[cite-3]D');
        expect(result.citations[0].marker).toBe('cite-1');
        expect(result.citations[1].marker).toBe('cite-2');
        expect(result.citations[2].marker).toBe('cite-3');
      });

      it('citations 数组顺序与首次出现顺序一致', () => {
        const md = '[[evidence:ev-2,ev-3]] [[evidence:ev-1]] [[evidence:ev-2,ev-3]]';
        const result = compileEvidenceCitations(
          md,
          knownIds('ev-1', 'ev-2', 'ev-3')
        );

        expect(result.citations).toHaveLength(2);
        expect(result.citations[0].evidenceIds).toEqual(['ev-2', 'ev-3']);
        expect(result.citations[1].evidenceIds).toEqual(['ev-1']);
      });
    });

    // ---- 边界情况 ----
    describe('边界情况', () => {
      it('没有占位符的文本原样返回', () => {
        const md = '这是一段普通文本，没有任何占位符。';
        const result = compileEvidenceCitations(md, knownIds('ev-1'));

        expect(result.markdown).toBe(md);
        expect(result.citations).toEqual([]);
        expect(result.warnings).toEqual([]);
      });

      it('空字符串输入返回空结果', () => {
        const result = compileEvidenceCitations('', knownIds('ev-1'));

        expect(result.markdown).toBe('');
        expect(result.citations).toEqual([]);
        expect(result.warnings).toEqual([]);
      });

      it('knownEvidenceIds 为空集时所有 ID 都被视为未知', () => {
        const md = '[[evidence:ev-1]]';
        const result = compileEvidenceCitations(md, new Set());

        expect(result.markdown).toBe('');
        expect(result.citations).toEqual([]);
        expect(result.warnings).toContain('未知的 Evidence ID: ev-1');
      });

      it('占位符中 ID 前后有空格时被正确 trim', () => {
        const md = '[[evidence: ev-1 , ev-2 ]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('[cite-1]');
        expect(result.citations[0].evidenceIds).toEqual(['ev-1', 'ev-2']);
      });

      it('占位符中存在空段（连续逗号）时被过滤', () => {
        const md = '[[evidence:ev-1,,ev-2]]';
        const result = compileEvidenceCitations(md, knownIds('ev-1', 'ev-2'));

        expect(result.markdown).toBe('[cite-1]');
        expect(result.citations[0].evidenceIds).toEqual(['ev-1', 'ev-2']);
        expect(result.warnings).toEqual([]);
      });
    });
  });

  // ============================================================
  // hasLegacyCitations
  // ============================================================
  describe('hasLegacyCitations', () => {
    it('检测 [cite-1] 格式返回 true', () => {
      expect(hasLegacyCitations('some [cite-1] text')).toBe(true);
    });

    it('检测多位数字 [cite-42] 返回 true', () => {
      expect(hasLegacyCitations('see [cite-42] for details')).toBe(true);
    });

    it('检测大数字 [cite-1000] 返回 true', () => {
      expect(hasLegacyCitations('[cite-1000]')).toBe(true);
    });

    it('无任何引用标记时返回 false', () => {
      expect(hasLegacyCitations('普通文本无引用')).toBe(false);
    });

    it('evidence 占位符 [[evidence:...]] 不被识别为 legacy 引用', () => {
      expect(hasLegacyCitations('[[evidence:ev-1]]')).toBe(false);
    });

    it('[cite-] 缺少数字时返回 false', () => {
      expect(hasLegacyCitations('[cite-]')).toBe(false);
    });

    it('[cite-1 缺少右括号时返回 false', () => {
      expect(hasLegacyCitations('[cite-1')).toBe(false);
    });

    it('cite-1 缺少左括号时返回 false', () => {
      expect(hasLegacyCitations('cite-1]')).toBe(false);
    });

    it('文本中同时存在 evidence 占位符与 legacy 标记时返回 true', () => {
      expect(hasLegacyCitations('[[evidence:ev-1]] 和 [cite-2]')).toBe(true);
    });

    it('多个 legacy 标记返回 true', () => {
      expect(hasLegacyCitations('[cite-1][cite-2][cite-3]')).toBe(true);
    });
  });

  // ============================================================
  // extractAllCitationMarkers
  // ============================================================
  describe('extractAllCitationMarkers', () => {
    it('提取单个 legacy 标记', () => {
      expect(extractAllCitationMarkers('a [cite-1] b')).toEqual(['cite-1']);
    });

    it('按出现顺序提取多个 legacy 标记', () => {
      expect(extractAllCitationMarkers('a [cite-1] b [cite-2] c')).toEqual([
        'cite-1',
        'cite-2',
      ]);
    });

    it('提取多位数字标记', () => {
      expect(extractAllCitationMarkers('[cite-10] 和 [cite-2]')).toEqual([
        'cite-10',
        'cite-2',
      ]);
    });

    it('无标记时返回空数组', () => {
      expect(extractAllCitationMarkers('没有标记的文本')).toEqual([]);
    });

    it('evidence 占位符不被提取（仅提取 legacy 标记）', () => {
      expect(extractAllCitationMarkers('[[evidence:ev-1]]')).toEqual([]);
    });

    it('同时存在 evidence 占位符与 legacy 标记时只提取 legacy', () => {
      expect(
        extractAllCitationMarkers('[[evidence:ev-1]] 和 [cite-5]')
      ).toEqual(['cite-5']);
    });

    it('相邻 legacy 标记都被提取', () => {
      expect(extractAllCitationMarkers('[cite-1][cite-2][cite-3]')).toEqual([
        'cite-1',
        'cite-2',
        'cite-3',
      ]);
    });

    it('同一标记重复出现都被提取（不去重）', () => {
      expect(extractAllCitationMarkers('[cite-1] x [cite-1]')).toEqual([
        'cite-1',
        'cite-1',
      ]);
    });

    it('空字符串输入返回空数组', () => {
      expect(extractAllCitationMarkers('')).toEqual([]);
    });
  });
});
