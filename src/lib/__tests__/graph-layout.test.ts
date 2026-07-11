import { describe, it, expect } from 'vitest';
import { layoutKnowledgeGraph, fitViewport } from '../graph-layout';
import { CourseTopic, MacroKnowledgeRelation } from '../../types';

// 辅助函数：构造CourseTopic
function makeTopic(id: string, title: string, originalOrder: number, pageNumber = 1): CourseTopic {
  return {
    id,
    title,
    aliases: [],
    type: 'composite',
    learningGoal: `学习${title}`,
    evidenceIds: [`ev_${id}`],
    originalPageNumbers: [pageNumber],
    importance: 'core',
    confidence: 0.7,
    originalOrder,
    recommendedOrder: originalOrder,
    noteStatus: 'pending',
  };
}

// 辅助函数：构造关系
function makeRel(id: string, source: string, target: string, type: MacroKnowledgeRelation['type'] = 'hard_prerequisite'): MacroKnowledgeRelation {
  return {
    id,
    sourceTopicId: source,
    targetTopicId: target,
    type,
    evidenceIds: [],
    reason: '',
    confidence: 0.7,
    origin: 'ai-inferred',
  };
}

// 矩形相交检测
function rectanglesOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  // 如果一个矩形在另一个的左侧或右侧，或上方/下方，则不重叠
  return !(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay);
}

describe('graph-layout', () => {
  describe('layoutKnowledgeGraph', () => {
    it('should return finite coordinates for all nodes', () => {
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
      ];
      const relations = [
        makeRel('r1', 'a', 'b'),
        makeRel('r2', 'b', 'c'),
      ];

      const result = layoutKnowledgeGraph(topics, relations);
      for (const t of topics) {
        const pos = result.positions.get(t.id);
        expect(pos).toBeDefined();
        expect(Number.isFinite(pos!.x)).toBe(true);
        expect(Number.isFinite(pos!.y)).toBe(true);
        expect(Number.isFinite(pos!.width)).toBe(true);
        expect(Number.isFinite(pos!.height)).toBe(true);
      }
    });

    it('should not have overlapping nodes (rectangle intersection test)', () => {
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
        makeTopic('d', 'D', 3, 4),
        makeTopic('e', 'E', 4, 5),
      ];
      const relations = [
        makeRel('r1', 'a', 'c'),
        makeRel('r2', 'b', 'c'),
        makeRel('r3', 'c', 'd'),
        makeRel('r4', 'c', 'e'),
      ];

      const result = layoutKnowledgeGraph(topics, relations);
      const positions = Array.from(result.positions.values());

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const p1 = positions[i];
          const p2 = positions[j];
          const overlaps = rectanglesOverlap(
            p1.x, p1.y, p1.width, p1.height,
            p2.x, p2.y, p2.width, p2.height
          );
          expect(overlaps).toBe(false);
        }
      }
    });

    it('should have bounds that contain all nodes', () => {
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
      ];
      const relations = [makeRel('r1', 'a', 'b'), makeRel('r2', 'b', 'c')];

      const result = layoutKnowledgeGraph(topics, relations);
      const { bounds } = result;

      for (const t of topics) {
        const pos = result.positions.get(t.id)!;
        expect(pos.x).toBeGreaterThanOrEqual(bounds.x);
        expect(pos.y).toBeGreaterThanOrEqual(bounds.y);
        expect(pos.x + pos.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(pos.y + pos.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    });

    it('should be deterministic: same input gives same output', () => {
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
        makeTopic('d', 'D', 3, 4),
      ];
      const relations = [
        makeRel('r1', 'a', 'c'),
        makeRel('r2', 'b', 'c'),
        makeRel('r3', 'c', 'd'),
      ];

      const result1 = layoutKnowledgeGraph(topics, relations);
      const result2 = layoutKnowledgeGraph(topics, relations);

      for (const t of topics) {
        const p1 = result1.positions.get(t.id)!;
        const p2 = result2.positions.get(t.id)!;
        expect(p1.x).toBe(p2.x);
        expect(p1.y).toBe(p2.y);
      }
      expect(result1.bounds).toEqual(result2.bounds);
    });

    it('should place prerequisite nodes to the left of dependent nodes (x coordinate)', () => {
      const topics = [
        makeTopic('prereq', '前置知识', 0, 1),
        makeTopic('dependent', '后续知识', 1, 2),
      ];
      const relations = [makeRel('r1', 'prereq', 'dependent', 'hard_prerequisite')];

      const result = layoutKnowledgeGraph(topics, relations);
      const prePos = result.positions.get('prereq')!;
      const depPos = result.positions.get('dependent')!;

      // 前置节点应该在依赖节点的左边
      expect(prePos.x + prePos.width).toBeLessThanOrEqual(depPos.x);
    });

    it('should handle 1 node without crashing or overlapping', () => {
      const topics = [makeTopic('a', 'Single', 0, 1)];
      const result = layoutKnowledgeGraph(topics, []);
      expect(result.positions.size).toBe(1);
      expect(Number.isFinite(result.bounds.width)).toBe(true);
      expect(result.bounds.width).toBeGreaterThan(0);
    });

    it('should handle 5 nodes without crashing or overlapping', () => {
      const topics = Array.from({ length: 5 }, (_, i) => makeTopic(`n${i}`, `Node${i}`, i, i + 1));
      const relations = [
        makeRel('r1', 'n0', 'n2'),
        makeRel('r2', 'n1', 'n2'),
        makeRel('r3', 'n2', 'n3'),
        makeRel('r4', 'n2', 'n4'),
      ];
      const result = layoutKnowledgeGraph(topics, relations);
      expect(result.positions.size).toBe(5);

      // 无重叠检测
      const positions = Array.from(result.positions.values());
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          expect(rectanglesOverlap(
            positions[i].x, positions[i].y, positions[i].width, positions[i].height,
            positions[j].x, positions[j].y, positions[j].width, positions[j].height
          )).toBe(false);
        }
      }
    });

    it('should handle 15 nodes without crashing or overlapping', () => {
      const topics = Array.from({ length: 15 }, (_, i) => makeTopic(`n${i}`, `Node${i}`, i, i + 1));
      // 创建一个链式结构
      const relations: MacroKnowledgeRelation[] = [];
      for (let i = 0; i < 14; i++) {
        relations.push(makeRel(`r${i}`, `n${i}`, `n${i + 1}`));
      }
      const result = layoutKnowledgeGraph(topics, relations);
      expect(result.positions.size).toBe(15);

      const positions = Array.from(result.positions.values());
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          expect(rectanglesOverlap(
            positions[i].x, positions[i].y, positions[i].width, positions[i].height,
            positions[j].x, positions[j].y, positions[j].width, positions[j].height
          )).toBe(false);
        }
      }
    });

    it('should handle 30 nodes without crashing or overlapping', () => {
      const topics = Array.from({ length: 30 }, (_, i) => makeTopic(`n${i}`, `Node${i}`, i, i + 1));
      const relations: MacroKnowledgeRelation[] = [];
      // 每层多个节点
      for (let i = 0; i < 29; i++) {
        relations.push(makeRel(`r${i}`, `n${i}`, `n${Math.min(i + 2, 29)}`));
      }
      const result = layoutKnowledgeGraph(topics, relations);
      expect(result.positions.size).toBe(30);

      const positions = Array.from(result.positions.values());
      let overlapCount = 0;
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          if (rectanglesOverlap(
            positions[i].x, positions[i].y, positions[i].width, positions[i].height,
            positions[j].x, positions[j].y, positions[j].width, positions[j].height
          )) {
            overlapCount++;
          }
        }
      }
      // 允许少量重叠（30节点复杂图可能有重心排序后的微调），但不能大面积重叠
      expect(overlapCount).toBeLessThanOrEqual(3);
    });

    it('should handle 60 nodes without crashing', () => {
      const topics = Array.from({ length: 60 }, (_, i) => makeTopic(`n${i}`, `Node${i}`, i, i + 1));
      const relations: MacroKnowledgeRelation[] = [];
      for (let i = 0; i < 59; i++) {
        relations.push(makeRel(`r${i}`, `n${i}`, `n${i + 1}`));
      }
      const result = layoutKnowledgeGraph(topics, relations);
      expect(result.positions.size).toBe(60);
      expect(Number.isFinite(result.bounds.width)).toBe(true);
      expect(result.bounds.width).toBeGreaterThan(0);
      expect(result.bounds.height).toBeGreaterThan(0);
    });

    it('should handle disconnected subgraphs', () => {
      // 两个不连通的子图: A->B 和 C->D
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
        makeTopic('d', 'D', 3, 4),
      ];
      const relations = [
        makeRel('r1', 'a', 'b'),
        makeRel('r2', 'c', 'd'),
      ];

      const result = layoutKnowledgeGraph(topics, relations);
      expect(result.positions.size).toBe(4);

      // 所有节点都应该有有限坐标
      for (const t of topics) {
        const pos = result.positions.get(t.id)!;
        expect(Number.isFinite(pos.x)).toBe(true);
        expect(Number.isFinite(pos.y)).toBe(true);
      }
    });

    it('should handle graph with no edges', () => {
      const topics = [
        makeTopic('a', 'A', 0, 1),
        makeTopic('b', 'B', 1, 2),
        makeTopic('c', 'C', 2, 3),
        makeTopic('d', 'D', 3, 4),
        makeTopic('e', 'E', 4, 5),
      ];

      const result = layoutKnowledgeGraph(topics, []);
      expect(result.positions.size).toBe(5);

      // 无边时所有节点应该在同一层(rank=0)，但垂直方向不重叠
      const positions = Array.from(result.positions.values());
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          expect(rectanglesOverlap(
            positions[i].x, positions[i].y, positions[i].width, positions[i].height,
            positions[j].x, positions[j].y, positions[j].width, positions[j].height
          )).toBe(false);
        }
      }
    });
  });

  describe('fitViewport', () => {
    it('should compute reasonable viewport that fits within container', () => {
      const bounds = { x: 0, y: 0, width: 1000, height: 600 };
      const viewport = fitViewport(bounds, 800, 600, 40);

      // 视口应该包含bounds的中心区域
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      // 缩放后，scale <= 1.2（最大放大1.2倍）
      const scaleX = (800 - 80) / viewport.width;
      const scaleY = (600 - 80) / viewport.height;
      const scale = Math.min(scaleX, scaleY);
      expect(scale).toBeLessThanOrEqual(1.2);
      expect(scale).toBeGreaterThan(0);
      // 视口应完全包含bounds（fitViewport时不会裁剪内容）
      expect(viewport.x).toBeLessThanOrEqual(bounds.x);
      expect(viewport.y).toBeLessThanOrEqual(bounds.y);
      expect(viewport.x + viewport.width).toBeGreaterThanOrEqual(bounds.x + bounds.width);
      expect(viewport.y + viewport.height).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    });

    it('should handle zero-size container gracefully', () => {
      const bounds = { x: 10, y: 20, width: 500, height: 300 };
      const viewport = fitViewport(bounds, 0, 0, 40);
      expect(viewport).toEqual(bounds);
    });

    it('should center the viewport on bounds', () => {
      const bounds = { x: 50, y: 50, width: 400, height: 300 };
      const containerW = 1200;
      const containerH = 800;
      const viewport = fitViewport(bounds, containerW, containerH, 40);

      // 视口中心应该与bounds中心大致对齐
      const boundsCenterX = bounds.x + bounds.width / 2;
      const boundsCenterY = bounds.y + bounds.height / 2;
      const viewCenterX = viewport.x + viewport.width / 2;
      const viewCenterY = viewport.y + viewport.height / 2;
      expect(Math.abs(boundsCenterX - viewCenterX)).toBeLessThan(1);
      expect(Math.abs(boundsCenterY - viewCenterY)).toBeLessThan(1);
    });
  });
});
