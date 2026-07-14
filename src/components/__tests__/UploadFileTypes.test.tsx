import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { UploadView } from '../UploadView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return container;
}

describe('courseware upload formats', () => {
  it('文件选择器同时接受 PDF 和 PPTX', () => {
    const container = render(createElement(UploadView));
    // 新版 UploadView 默认进入课件模式。
    const buttons = container.querySelectorAll('button');
    const coursewareBtn = Array.from(buttons).find(b => b.textContent?.includes('PDF'));
    if (coursewareBtn) {
      act(() => coursewareBtn.click());
    }

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.accept).toContain('.pdf');
    expect(input?.accept).toContain('.pptx');
  });

  it('不再显示 Markdown 文本或 Markdown 文件入口', () => {
    const container = render(createElement(UploadView));
    expect(container.textContent).not.toContain('Markdown 文本');
    expect(container.querySelector('textarea')).toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).not.toContain('.md');
  });
});
