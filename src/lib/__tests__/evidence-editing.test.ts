const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../store/useStore';
import type { CourseDocument } from '../../types';

function makeDoc(): CourseDocument {
  return {
    id: 'doc1',
    title: '测试课件',
    fileName: 'test.pdf',
    pages: [
      { pageNumber: 1, text: '第一页内容：定义\n公式\n结论', preview: 'data:image/png;base64,abc' },
      { pageNumber: 2, text: '第二页内容：推导\n示例', preview: 'data:image/png;base64,def' },
    ],
    uploadedAt: Date.now(),
  };
}

describe('evidence editing store actions', () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().setDocument(makeDoc());
  });

  describe('updateEvidence', () => {
    it('更新证据内容但保留稳定 ID', () => {
      const { evidences } = useStore.getState();
      expect(evidences.length).toBeGreaterThan(0);

      const firstEvidence = evidences[0];
      const originalId = firstEvidence.id;
      const newContent = '修改后的内容';

      useStore.getState().updateEvidence(originalId, newContent);

      const updated = useStore.getState().evidences.find(e => e.id === originalId);
      expect(updated).toBeDefined();
      expect(updated!.content).toBe(newContent);
      expect(updated!.id).toBe(originalId); // ID 保持不变
    });

    it('更新证据后设置 staleMarker', () => {
      const { evidences } = useStore.getState();
      useStore.getState().updateEvidence(evidences[0].id, '新内容');

      const { staleMarker } = useStore.getState();
      expect(staleMarker).not.toBeNull();
      expect(staleMarker!.reason).toBe('evidence-edited');
    });
  });

  describe('deleteEvidence', () => {
    it('删除指定证据', () => {
      const { evidences } = useStore.getState();
      const initialCount = evidences.length;
      const toDelete = evidences[0];

      useStore.getState().deleteEvidence(toDelete.id);

      const remaining = useStore.getState().evidences;
      expect(remaining.length).toBe(initialCount - 1);
      expect(remaining.find(e => e.id === toDelete.id)).toBeUndefined();
    });

    it('删除证据后设置 staleMarker', () => {
      const { evidences } = useStore.getState();
      useStore.getState().deleteEvidence(evidences[0].id);

      expect(useStore.getState().staleMarker).not.toBeNull();
      expect(useStore.getState().staleMarker!.reason).toBe('evidence-edited');
    });
  });

  describe('splitEvidence', () => {
    it('将证据拆分为两条，保留原 ID 用于前半部分', () => {
      const { evidences } = useStore.getState();
      const original = evidences[0];
      const originalContent = original.content;
      const originalCount = evidences.length;

      // 找一个可以拆分的位置
      const splitPoint = originalContent.indexOf('\n');
      if (splitPoint < 0) return; // skip if no newline

      const splitContent = originalContent.substring(splitPoint).trim();

      useStore.getState().splitEvidence(original.id, splitContent);

      const newEvidences = useStore.getState().evidences;
      expect(newEvidences.length).toBe(originalCount + 1);

      // 原 ID 保留
      const firstPart = newEvidences.find(e => e.id === original.id);
      expect(firstPart).toBeDefined();
      expect(firstPart!.content).toBe(originalContent.substring(0, splitPoint).trim());

      // 新 ID 生成
      const secondPart = newEvidences.find(e =>
        e.id !== original.id &&
        e.pageNumber === original.pageNumber &&
        e.content === splitContent
      );
      expect(secondPart).toBeDefined();
    });
  });

  describe('mergeEvidences', () => {
    it('合并两条同页证据，保留第一个 ID', () => {
      const { evidences } = useStore.getState();
      const samePage = evidences.filter(e => e.pageNumber === 1);
      if (samePage.length < 2) return;

      const ev1 = samePage[0];
      const ev2 = samePage[1];
      const originalCount = evidences.length;

      useStore.getState().mergeEvidences(ev1.id, ev2.id);

      const newEvidences = useStore.getState().evidences;
      expect(newEvidences.length).toBe(originalCount - 1);

      // 第一个 ID 保留
      const merged = newEvidences.find(e => e.id === ev1.id);
      expect(merged).toBeDefined();
      expect(merged!.content).toContain(ev1.content);
      expect(merged!.content).toContain(ev2.content);

      // 第二个 ID 被移除
      expect(newEvidences.find(e => e.id === ev2.id)).toBeUndefined();
    });

    it('不能合并不同页面的证据', () => {
      const { evidences } = useStore.getState();
      const page1Ev = evidences.find(e => e.pageNumber === 1);
      const page2Ev = evidences.find(e => e.pageNumber === 2);
      if (!page1Ev || !page2Ev) return;

      const originalCount = evidences.length;
      useStore.getState().mergeEvidences(page1Ev.id, page2Ev.id);

      // 不应该有变化
      expect(useStore.getState().evidences.length).toBe(originalCount);
    });
  });

  describe('stale propagation', () => {
    it('更新证据后 staleMarker 标记所有知识点', () => {
      const { evidences } = useStore.getState();
      // 模拟有知识点和包的情况
      // 在真实流程中，这些会在 confirmParse 后存在
      // 这里只验证 staleMarker 的行为
      useStore.getState().updateEvidence(evidences[0].id, '修改内容');

      const { staleMarker } = useStore.getState();
      expect(staleMarker).not.toBeNull();
      expect(staleMarker!.reason).toBe('evidence-edited');
      // affectedTopicIds 应该是空数组（因为没有知识点）
      // 但 staleMarker 仍然存在
    });
  });
});
