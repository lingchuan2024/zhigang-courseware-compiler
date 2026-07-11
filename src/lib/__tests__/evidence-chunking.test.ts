import { describe, it, expect } from 'vitest';
import { isHeadingLine, classifyLine, splitPageIntoEvidenceChunks } from '../evidence';

describe('evidence-chunking', () => {
  describe('isHeadingLine', () => {
    it('should detect numbered headings separated from body text', () => {
      // 编号标题应被正确识别
      expect(isHeadingLine('1. 引言')).toBe(true);
      expect(isHeadingLine('2. 概率模型基本概念')).toBe(true);
      expect(isHeadingLine('3、最大似然估计')).toBe(true);
      expect(isHeadingLine('2.3 线性回归')).toBe(true);
    });

    it('should detect headings with formulas still as headings', () => {
      // 包含公式符号但整体是短标题的情况
      expect(isHeadingLine('3. 最大似然估计（MLE）')).toBe(true);
      expect(isHeadingLine('4. 线性回归模型 y=wx+b')).toBe(true);
    });

    it('should NOT misdetect plain numbers like "1.0" as headings', () => {
      // 1.0 这种纯数字/小数不应被识别为标题
      // 注意：isHeadingLine 要求去掉编号后有至少MIN_HEADING_CONTENT(2)个字符
      expect(isHeadingLine('1.0')).toBe(false);
      expect(isHeadingLine('3.14')).toBe(false);
    });

    it('should maintain order when multiple headings appear on same page', () => {
      const pageText = '1. 第一节标题\n第一节内容。\n\n2. 第二节标题\n第二节内容。\n\n3. 第三节标题\n第三节内容。';
      const chunks = splitPageIntoEvidenceChunks(pageText);
      const headingChunks = chunks.filter(c => c.type === 'heading');

      expect(headingChunks.length).toBe(3);
      expect(headingChunks[0].text).toContain('第一节');
      expect(headingChunks[1].text).toContain('第二节');
      expect(headingChunks[2].text).toContain('第三节');
    });

    it('should not treat long body text as a single title', () => {
      const longText = '这是一段很长的正文内容，包含了多个句子。它讲述了很多事情。' +
        '从历史背景到理论基础，再到实际应用。这段文字足够长，不应被识别为标题。';
      expect(isHeadingLine(longText)).toBe(false);
      expect(classifyLine(longText)).toBe('text');
    });

    it('should detect chapter headings like "第1章 概率模型" correctly', () => {
      expect(isHeadingLine('第1章 概率模型')).toBe(true);
      expect(isHeadingLine('第一章 引言')).toBe(true);
      expect(isHeadingLine('第2节 线性回归')).toBe(true);
      expect(isHeadingLine('第三讲 正则化')).toBe(true);
    });

    it('should detect Chinese headings like "一、引言" correctly', () => {
      expect(isHeadingLine('一、引言')).toBe(true);
      expect(isHeadingLine('二、相关工作')).toBe(true);
      expect(isHeadingLine('（一）背景介绍')).toBe(true);
      expect(isHeadingLine('十三、总结')).toBe(true);
    });

    it('should detect English headings like "Chapter 1 Probability" correctly', () => {
      expect(isHeadingLine('Chapter 1 Probability')).toBe(true);
      expect(isHeadingLine('Section 2.3 Linear Regression')).toBe(true);
      expect(isHeadingLine('Lecture 5 Regularization')).toBe(true);
    });
  });

  describe('splitPageIntoEvidenceChunks', () => {
    it('should separate heading from following body text', () => {
      const pageText = '1. 引言\n本讲介绍概率模型的基本概念和方法。';
      const chunks = splitPageIntoEvidenceChunks(pageText);

      // 应该至少有一个heading chunk和一个text chunk
      const headingChunks = chunks.filter(c => c.type === 'heading');
      const textChunks = chunks.filter(c => c.type === 'text');
      expect(headingChunks.length).toBeGreaterThanOrEqual(1);
      expect(textChunks.length).toBeGreaterThanOrEqual(1);
      expect(headingChunks[0].text).toContain('引言');
    });

    it('should split multiple sections on same page correctly', () => {
      const pageText =
        '1. 定义\n' +
        '机器学习是人工智能的一个分支。\n' +
        '\n' +
        '2. 方法\n' +
        '我们采用深度学习方法。\n' +
        '\n' +
        '3. 结论\n' +
        '实验结果表明方法有效。';

      const chunks = splitPageIntoEvidenceChunks(pageText);
      const headings = chunks.filter(c => c.type === 'heading');
      expect(headings.length).toBe(3);
    });

    it('should detect formula lines as separate chunks', () => {
      const pageText = '3. 最大似然估计\n似然函数 L(θ) = p(D|θ) = ∏ p(y|x;θ)\n最大似然估计是求解参数的方法。';
      const chunks = splitPageIntoEvidenceChunks(pageText);
      // 应该有heading、formula和text类型
      const types = new Set(chunks.map(c => c.type));
      expect(types.has('heading')).toBe(true);
    });

    it('should handle empty text gracefully', () => {
      expect(splitPageIntoEvidenceChunks('')).toEqual([]);
      expect(splitPageIntoEvidenceChunks('   ')).toEqual([]);
      expect(splitPageIntoEvidenceChunks('\n\n\n')).toEqual([]);
    });

    it('should classify list items correctly', () => {
      const pageText = '要点：\n- 第一项内容\n- 第二项内容\n- 第三项内容';
      const chunks = splitPageIntoEvidenceChunks(pageText);
      const listChunks = chunks.filter(c => c.type === 'list');
      expect(listChunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('classifyLine edge cases', () => {
    it('should classify empty lines as empty', () => {
      expect(classifyLine('')).toBe('empty');
      expect(classifyLine('   ')).toBe('empty');
    });

    it('should classify lines with multiple sentence endings as text not heading', () => {
      // 包含多个句号的行不应该是标题
      const multiSentence = '这是第一句话。这是第二句话。这是第三句话。';
      expect(classifyLine(multiSentence)).toBe('text');
    });

    it('should not classify lines starting with formula symbols as headings', () => {
      expect(classifyLine('= mc² 是质能方程')).toBe('text');
      expect(classifyLine('+ b 是截距项')).toBe('text');
    });
  });
});
