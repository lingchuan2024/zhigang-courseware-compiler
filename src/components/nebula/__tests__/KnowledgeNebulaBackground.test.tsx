import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseNebulaSummary } from '../../../types';
import { KnowledgeNebulaBackground } from '../KnowledgeNebulaBackground';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary: CourseNebulaSummary = {
  version: 1,
  courseId: 'course-1',
  courseName: '机器学习',
  documentCount: 2,
  knowledgeCount: 1,
  completedCardCount: 1,
  updatedAt: 1,
  paletteId: 'crimson-cyan',
  seed: 42,
  stars: [{
    key: 'softmax', name: 'Softmax', sourceDocumentCount: 2, evidenceCount: 3,
    importance: 'core', cardStatus: 'complete',
  }],
};

let root: Root;
let container: HTMLDivElement;

function canvasContext(): Partial<CanvasRenderingContext2D> {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
    setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), createRadialGradient: vi.fn(() => gradient),
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext() as never);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KnowledgeNebulaBackground', () => {
  it('renders one visible canvas, controls, and an accessible course hotspot', () => {
    const onCourseOpen = vi.fn();
    act(() => root.render(createElement(KnowledgeNebulaBackground, {
      summaries: [summary],
      onCourseOpen,
      reducedMotion: false,
    })));

    expect(container.querySelectorAll('canvas[data-nebula-canvas="true"]')).toHaveLength(1);
    expect(container.textContent).toContain('放大');
    expect(container.textContent).toContain('缩小');
    expect(container.textContent).toContain('适应全部星云');

    const hotspot = container.querySelector<HTMLButtonElement>('[aria-label="打开课程：机器学习"]')!;
    act(() => hotspot.click());
    expect(onCourseOpen).toHaveBeenCalledWith('course-1');
  });

  it('renders a dormant universe without data controls when Canvas 2D is unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    act(() => root.render(createElement(KnowledgeNebulaBackground, {
      summaries: [],
      onCourseOpen: vi.fn(),
      reducedMotion: true,
    })));

    expect(container.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
    expect(container.textContent).not.toContain('还没有被点亮的知识星');
    expect(container.textContent).not.toContain('导入并解析课件后');
    expect(container.querySelector('[aria-label="放大星云"]')).toBeNull();
    expect(container.querySelector('[aria-label^="打开课程："]')).toBeNull();
    expect(container.querySelector('[data-canvas-fallback="true"]')).not.toBeNull();
  });

  it('uses dormant mode when courses exist without knowledge', () => {
    act(() => root.render(createElement(KnowledgeNebulaBackground, {
      summaries: [{ ...summary, knowledgeCount: 0, stars: [] }],
      onCourseOpen: vi.fn(),
      reducedMotion: true,
    })));

    expect(container.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="打开课程："]')).toBeNull();
    expect(container.querySelector('[aria-label="放大星云"]')).toBeNull();
  });

  it('removes global listeners and animation work on unmount', () => {
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    act(() => root.render(createElement(KnowledgeNebulaBackground, {
      summaries: [summary],
      onCourseOpen: vi.fn(),
    })));

    act(() => root.unmount());

    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    root = createRoot(container);
  });
});
