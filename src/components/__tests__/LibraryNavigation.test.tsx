import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import {
  createLibraryCourse,
  listLibraryCourses,
  listLibraryDocuments,
  resetLibraryRepositoryForTests,
  saveLibraryProjectSnapshot,
  upsertLibraryDocument,
} from '../../lib/library-repository';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useStore } from '../../store/useStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function button(label: string): HTMLButtonElement {
  const match = Array.from(container!.querySelectorAll('button')).find(item => item.textContent?.includes(label));
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

beforeEach(async () => {
  storage.clear();
  await resetLibraryRepositoryForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('multi-course library navigation', () => {
  it('loads persisted course nebula summaries during initialization', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await upsertLibraryDocument({
      id: 'nebula-doc', courseId: course.id, title: '星云讲义', fileName: 'nebula.pdf',
      fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await saveLibraryProjectSnapshot(course.id, 'nebula-doc', {
      knowledgeTopics: [{
        id: 'topic-1', courseId: course.id, name: 'Softmax', aliases: [], summary: '', learningObjective: '',
        sourceRanges: [{ documentId: 'nebula-doc', startBlockId: 'a', endBlockId: 'b' }], childTopicIds: [],
        importance: 'core', difficulty: 3, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
      }],
      knowledgeCards: [],
    });

    await act(async () => root!.render(createElement(App)));

    expect(useLibraryStore.getState().nebulaSummaries).toEqual([
      expect.objectContaining({ courseId: course.id, knowledgeCount: 1 }),
    ]);
  });

  it('starts at home, creates a course, and opens its upload workspace', async () => {
    await act(async () => root!.render(createElement(App)));
    expect(container!.textContent).toContain('知识被观测，星云才会发光。');
    expect(container!.textContent).toContain('知纲');
    expect(container!.textContent).not.toContain('OBSERVATORY ONLINE');
    expect(container!.textContent).not.toContain('CURRENT SURVEY');

    await act(async () => button('进入课件库').click());
    expect(container!.textContent).toContain('课程与课件');
    expect(container!.querySelector('[data-astronomy-backdrop="library"]')).not.toBeNull();

    const input = container!.querySelector<HTMLInputElement>('input[placeholder="例如：机器学习"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '机器学习');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('创建课程').click());
    expect(container!.textContent).toContain('机器学习');

    await act(async () => button('添加课件').click());
    expect(container!.textContent).toContain('上传课件');
  });

  it('uses distinct backgrounds for QA and the course workspace', async () => {
    await act(async () => root!.render(createElement(App)));

    act(() => useLibraryStore.getState().navigate('qa'));
    await act(async () => {});
    expect(container!.querySelector('[data-astronomy-backdrop="qa"]')).not.toBeNull();

    act(() => useLibraryStore.getState().navigate('home'));
    await act(async () => {});
    await act(async () => button('进入课件库').click());

    const input = container!.querySelector<HTMLInputElement>('input[placeholder="例如：机器学习"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '天体物理');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('创建课程').click());
    await act(async () => button('添加课件').click());

    expect(container!.querySelector('[data-astronomy-backdrop="workspace"]')).not.toBeNull();

    act(() => useStore.getState().setStage('notes'));
    await act(async () => {});
    expect(container!.querySelector('[data-astronomy-backdrop="reading"]')).not.toBeNull();
    act(() => useStore.setState({ stage: 'upload' }));
  });

  it('returns from the library to the start page', async () => {
    await act(async () => root!.render(createElement(App)));
    await act(async () => button('进入课件库').click());
    await act(async () => button('返回首页').click());
    expect(container!.textContent).toContain('知识被观测，星云才会发光。');
  });

  it('opens a course from its nebula hotspot', async () => {
    const course = await createLibraryCourse({ name: '概率论' });
    await upsertLibraryDocument({
      id: 'probability-doc', courseId: course.id, title: '贝叶斯', fileName: 'bayes.pdf',
      fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await saveLibraryProjectSnapshot(course.id, 'probability-doc', {
      knowledgeTopics: [{
        id: 'bayes', courseId: course.id, name: '贝叶斯定理', aliases: [], summary: '', learningObjective: '',
        sourceRanges: [{ documentId: 'probability-doc', startBlockId: 'a', endBlockId: 'b' }], childTopicIds: [],
        importance: 'core', difficulty: 3, knowledgeGenre: 'concept', confidence: 0.9, status: 'generated',
      }],
      knowledgeCards: [],
    });
    await act(async () => root!.render(createElement(App)));

    const hotspot = container!.querySelector<HTMLButtonElement>('[aria-label="打开课程：概率论"]')!;
    await act(async () => hotspot.click());

    expect(container!.textContent).toContain('课程与课件');
    expect(useLibraryStore.getState().activeCourseId).toBe(course.id);
  });

  it('confirms and deletes one courseware with all derived content', async () => {
    const course = await createLibraryCourse({ name: '机器学习' });
    await upsertLibraryDocument({
      id: 'doc-1', courseId: course.id, title: '第一讲', fileName: 'lecture1.pdf',
      fileType: 'pdf', pageCount: 10, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2,
    });
    await act(async () => root!.render(createElement(App)));
    await act(async () => button('进入课件库').click());

    expect(container!.textContent).toContain('lecture1.pdf');
    await act(async () => button('删除课件').click());
    expect(container!.textContent).toContain('同时删除 MinerU 解析、知识结构、知识卡片、完整笔记和检索索引');
    await act(async () => button('确认删除课件').click());

    expect(container!.textContent).not.toContain('lecture1.pdf');
    expect(await listLibraryDocuments(course.id)).toEqual([]);
  });

  it('confirms and deletes a course space while keeping another course', async () => {
    const kept = await createLibraryCourse({ name: '保留课程' });
    const removed = await createLibraryCourse({ name: '待移除空间' });
    await act(async () => root!.render(createElement(App)));
    await act(async () => button('进入课件库').click());
    await act(async () => button('待移除空间').click());
    await act(async () => button('删除课程').click());

    expect(container!.textContent).toContain('删除整个课程空间');
    await act(async () => button('确认删除课程').click());

    expect((await listLibraryCourses()).map(course => course.id)).toEqual([kept.id]);
    expect((await listLibraryCourses()).some(course => course.id === removed.id)).toBe(false);
  });
});
