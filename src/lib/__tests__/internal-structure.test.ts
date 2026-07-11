import { describe, it, expect } from 'vitest';
import {
  generateLocalContentItems,
  orderInternalItems,
  createInternalStructure,
} from '../internal-structure';
import { EvidenceAtom } from '../../types';
import { makeEvidence, makeTopic } from './helpers';

describe('internal-structure', () => {
  // Helper to build evidences for a topic
  function buildEvidences(): EvidenceAtom[] {
    return [
      makeEvidence({ id: 'ev_title', pageNumber: 1, blockIndex: 0, type: 'title', content: '第一章 测试标题' }),
      makeEvidence({ id: 'ev_def1', pageNumber: 1, blockIndex: 1, type: 'definition', content: '定义一内容' }),
      makeEvidence({ id: 'ev_def2', pageNumber: 1, blockIndex: 2, type: 'definition', content: '定义二内容' }),
      makeEvidence({ id: 'ev_formula', pageNumber: 1, blockIndex: 3, type: 'formula', content: 'E = mc^2' }),
      makeEvidence({ id: 'ev_example', pageNumber: 2, blockIndex: 0, type: 'example', content: '例如这样' }),
    ];
  }

  describe('generateLocalContentItems', () => {
    it('items are not 1:1 with evidence (aggregation happens)', () => {
      const evidences = buildEvidences();
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items } = generateLocalContentItems(topic, evidences);

      // 5 evidences total, but:
      // - title is skipped (paragraph boundary)
      // - 2 consecutive definitions are aggregated into 1 item
      // - formula is 1 item
      // - example is 1 item
      // => 3 items from 4 non-title evidences
      expect(items.length).toBe(3);
      expect(items.length).toBeLessThan(evidences.length);
    });

    it('title evidence does NOT become motivation type', () => {
      const evidences = buildEvidences();
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items } = generateLocalContentItems(topic, evidences);

      // No item should have type 'motivation' (title acts as boundary, not content)
      const motivationItems = items.filter(i => i.type === 'motivation');
      expect(motivationItems.length).toBe(0);
    });

    it('micro-relations are generated (at least some)', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
        makeEvidence({ id: 'ev_formula', pageNumber: 1, blockIndex: 1, type: 'formula', content: 'E = mc^2' }),
        makeEvidence({ id: 'ev_der1', pageNumber: 1, blockIndex: 2, type: 'derivation', content: '推导步骤一' }),
        makeEvidence({ id: 'ev_der2', pageNumber: 1, blockIndex: 3, type: 'derivation', content: '推导步骤二' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { relations } = generateLocalContentItems(topic, evidences);

      // definition -> defines -> formula (1 relation)
      // derivation step_before next derivation (1 relation)
      // at least 2 relations
      expect(relations.length).toBeGreaterThanOrEqual(2);
    });

    it('items reference valid evidence IDs', () => {
      const evidences = buildEvidences();
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items } = generateLocalContentItems(topic, evidences);

      const allEvIds = new Set(evidences.map(e => e.id));
      for (const item of items) {
        expect(item.evidenceIds.length).toBeGreaterThan(0);
        for (const evId of item.evidenceIds) {
          expect(allEvIds.has(evId)).toBe(true);
        }
      }
    });

    it("text type is NOT used as UnitContentType", () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_text1', pageNumber: 1, blockIndex: 0, type: 'text', content: '普通文本内容一段' }),
        makeEvidence({ id: 'ev_text2', pageNumber: 1, blockIndex: 1, type: 'text', content: '普通文本内容二段' }),
        makeEvidence({ id: 'ev_text3', pageNumber: 2, blockIndex: 0, type: 'text', content: '最后总结文本段落' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['ev_text1', 'ev_text2', 'ev_text3'],
      });
      const { items } = generateLocalContentItems(topic, evidences);

      expect(items.length).toBe(3);
      for (const item of items) {
        // text should be mapped to 'intuition' or 'conclusion', never 'text'
        expect(item.type).not.toBe('text');
        expect(['intuition', 'conclusion']).toContain(item.type);
      }
    });

    it('aggregated item combines content from multiple evidences', () => {
      const evidences = buildEvidences();
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items } = generateLocalContentItems(topic, evidences);

      // The first item should be the aggregated definitions
      const defItem = items.find(i => i.type === 'definition');
      expect(defItem).toBeDefined();
      expect(defItem!.evidenceIds).toContain('ev_def1');
      expect(defItem!.evidenceIds).toContain('ev_def2');
      expect(defItem!.content).toContain('定义一内容');
      expect(defItem!.content).toContain('定义二内容');
    });

    it('returns warning when no evidences match the topic', () => {
      const evidences = buildEvidences();
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['nonexistent_ev'],
      });
      const { items, warnings } = generateLocalContentItems(topic, evidences);
      expect(items.length).toBe(0);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('orderInternalItems', () => {
    it('ordered item IDs are stable (same input produces same output)', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
        makeEvidence({ id: 'ev_formula', pageNumber: 1, blockIndex: 1, type: 'formula', content: 'E = mc^2' }),
        makeEvidence({ id: 'ev_example', pageNumber: 2, blockIndex: 0, type: 'example', content: '例如' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items, relations } = generateLocalContentItems(topic, evidences);

      const ordered1 = orderInternalItems(items, relations);
      const ordered2 = orderInternalItems(items, relations);
      expect(ordered1).toEqual(ordered2);
    });

    it('returns all item IDs', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
        makeEvidence({ id: 'ev_formula', pageNumber: 1, blockIndex: 1, type: 'formula', content: 'E = mc^2' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items, relations } = generateLocalContentItems(topic, evidences);
      const ordered = orderInternalItems(items, relations);
      expect(ordered.length).toBe(items.length);
      for (const item of items) {
        expect(ordered).toContain(item.id);
      }
    });

    it('respects step_before relations (derivation steps ordered)', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_der1', pageNumber: 1, blockIndex: 0, type: 'derivation', content: '推导步骤一' }),
        makeEvidence({ id: 'ev_der2', pageNumber: 1, blockIndex: 1, type: 'derivation', content: '推导步骤二' }),
        makeEvidence({ id: 'ev_der3', pageNumber: 1, blockIndex: 2, type: 'derivation', content: '推导步骤三' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: evidences.map(e => e.id),
      });
      const { items, relations } = generateLocalContentItems(topic, evidences);
      const ordered = orderInternalItems(items, relations);

      // Find the derivation items in order
      const derItems = items.filter(i => i.type === 'derivation');
      const orderedDerIds = ordered.filter(id =>
        derItems.some(d => d.id === id)
      );

      // step_before relations: der1 -> der2, der2 -> der3
      // So der1 should come before der2, der2 before der3
      const idx1 = orderedDerIds.indexOf(derItems[0].id);
      const idx2 = orderedDerIds.indexOf(derItems[1].id);
      const idx3 = orderedDerIds.indexOf(derItems[2].id);
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });
  });

  describe('createInternalStructure', () => {
    it('InternalStructure has source, warnings, status', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['ev_def'],
      });
      const structure = createInternalStructure(topic, evidences, 'local');

      expect(structure.source).toBe('local');
      expect(Array.isArray(structure.warnings)).toBe(true);
      expect(['pending', 'ready', 'failed', 'stale']).toContain(structure.status);
      expect(structure.items).toBeDefined();
      expect(structure.relations).toBeDefined();
      expect(structure.orderedItemIds).toBeDefined();
    });

    it('status is ready when items are generated', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['ev_def'],
      });
      const structure = createInternalStructure(topic, evidences, 'local');
      expect(structure.status).toBe('ready');
      expect(structure.items.length).toBeGreaterThan(0);
    });

    it('status is failed when no items can be generated (only title evidence)', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_title', pageNumber: 1, blockIndex: 0, type: 'title', content: '只有标题' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['ev_title'],
      });
      const structure = createInternalStructure(topic, evidences, 'local');
      expect(structure.status).toBe('failed');
      expect(structure.items.length).toBe(0);
    });

    it('recommendedOrder is updated based on ordering', () => {
      const evidences: EvidenceAtom[] = [
        makeEvidence({ id: 'ev_def', pageNumber: 1, blockIndex: 0, type: 'definition', content: '定义内容' }),
        makeEvidence({ id: 'ev_formula', pageNumber: 1, blockIndex: 1, type: 'formula', content: 'E = mc^2' }),
      ];
      const topic = makeTopic({
        id: 't1',
        evidenceIds: ['ev_def', 'ev_formula'],
      });
      const structure = createInternalStructure(topic, evidences, 'local');

      // Each item's recommendedOrder should match its position in orderedItemIds
      for (const item of structure.items) {
        const orderIdx = structure.orderedItemIds.indexOf(item.id);
        expect(item.recommendedOrder).toBe(orderIdx);
      }
    });
  });
});
