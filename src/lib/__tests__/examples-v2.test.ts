import { describe, it, expect } from 'vitest';
import { createExampleCourse, createExampleCourseV2 } from '../examples';
import { generateEvidences } from '../evidence';

describe('examples-v2', () => {
  describe('createExampleCourse', () => {
    it('should generate evidences via generateEvidences (not hardcoded)', () => {
      const { document, evidences } = createExampleCourse();

      // 文档应该有页面
      expect(document.pages.length).toBeGreaterThan(0);
      expect(document.title).toBe('概率模型基础');

      // 证据应该是通过generateEvidences从页面生成的（每个证据有ev_前缀ID）
      expect(evidences.length).toBeGreaterThan(0);
      expect(evidences.every(e => e.id.startsWith('ev_'))).toBe(true);

      // 手动调用generateEvidences应得到相同数量的证据
      // (ID是generateId随机生成的，所以数量和类型一致即可)
      const manualEvidences = generateEvidences(document.pages);
      expect(manualEvidences.length).toBe(evidences.length);
    });
  });

  describe('createExampleCourseV2', () => {
    it('should enter structure-review stage (produces topics and relations)', () => {
      const result = createExampleCourseV2();

      // createExampleCourseV2 生成完整的结构审查数据
      expect(result.topics).toBeDefined();
      expect(result.topics.length).toBeGreaterThan(0);
      expect(result.macroRelations).toBeDefined();
      expect(result.knowledgePackages).toBeDefined();
      expect(result.knowledgePackages.length).toBe(result.topics.length);
      expect(result.evidences).toBeDefined();
      expect(result.document).toBeDefined();
    });

    it('should cover key concepts: 概率模型, 最大似然估计, 线性回归, 正则化, Ridge, Lasso', () => {
      const result = createExampleCourseV2();
      const allTitles = result.topics.map(t => t.title).join(' ');

      // 这些核心概念应该出现在主题标题或别名中
      const keyConcepts = ['概率模型', '最大似然', '线性回归', '正则化', 'Ridge', 'Lasso'];
      for (const concept of keyConcepts) {
        expect(allTitles).toContain(concept);
      }
    });

    it('should not have a single "课程内容" fallback topic', () => {
      const result = createExampleCourseV2();

      // 不应该只有一个"课程内容"的降级主题
      const fallbackTopic = result.topics.find(t => t.title === '课程内容');
      // 如果存在"课程内容"主题，说明降级了，但不应该只有这一个
      if (fallbackTopic) {
        expect(result.topics.length).toBeGreaterThan(1);
      }
      // 更严格的检查：主题数量应远大于1
      expect(result.topics.length).toBeGreaterThanOrEqual(8);
    });

    it('should have valid evidenceIds and page numbers for each topic', () => {
      const result = createExampleCourseV2();
      const validEvidenceIds = new Set(result.evidences.map(e => e.id));
      const validPageNumbers = new Set(result.document.pages.map(p => p.pageNumber));

      for (const topic of result.topics) {
        // 每个主题都有evidenceIds
        expect(topic.evidenceIds.length).toBeGreaterThan(0);

        // 所有evidenceIds都应该是有效的
        for (const eid of topic.evidenceIds) {
          expect(validEvidenceIds.has(eid)).toBe(true);
        }

        // 页码应该有效
        expect(topic.originalPageNumbers.length).toBeGreaterThan(0);
        for (const pg of topic.originalPageNumbers) {
          expect(validPageNumbers.has(pg)).toBe(true);
        }
      }
    });

    it('should have at least 8 topics', () => {
      const result = createExampleCourseV2();
      expect(result.topics.length).toBeGreaterThanOrEqual(8);
    });

    it('should have knowledgePackages with notes generated', () => {
      const result = createExampleCourseV2();

      for (const kp of result.knowledgePackages) {
        expect(kp.topic).toBeDefined();
        expect(kp.topic.id).toBeDefined();
        expect(kp.note).toBeDefined();
        expect(kp.note!.contentMarkdown.length).toBeGreaterThan(0);
        expect(kp.note!.shortSummary.length).toBeGreaterThan(0);
      }
    });

    it('should produce structureWarnings (may be empty array for clean generation)', () => {
      const result = createExampleCourseV2();
      expect(Array.isArray(result.structureWarnings)).toBe(true);
    });
  });
});
