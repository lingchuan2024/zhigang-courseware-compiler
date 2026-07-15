import { act, createElement, forwardRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store/useStore';
import { DocumentReviewWorkspace } from '../DocumentReviewWorkspace';

vi.mock('../PdfPreview', () => ({
  PdfPreview: forwardRef(() => createElement('div', null, 'PDF preview')),
}));
vi.mock('../PageNavigator', () => ({
  PageNavigator: () => createElement('div', null, 'pages'),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
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

beforeEach(() => {
  storage.clear();
  act(() => useStore.setState({
    stage: 'document',
    document: {
      id: 'doc-1',
      courseId: 'course-1',
      title: 'lecture',
      fileName: 'lecture.pdf',
      fileType: 'pdf',
      sourceKey: 'source-1',
      uploadedAt: 0,
      pages: [{ pageNumber: 1, text: 'page', preview: 'data:image/png;base64,a' }],
    },
    sourceDocuments: [],
    mineruConfig: {
      endpoint: 'https://mineru.example.com',
      apiKey: 'token',
      modelVersion: 'vlm',
      language: 'ch',
      enableFormula: true,
      enableTable: true,
    },
  }));
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

function renderWorkspace(onRequestMinerUParse: () => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(DocumentReviewWorkspace, { onRequestMinerUParse })));
  return container;
}

describe('DocumentReviewWorkspace MinerU entry', () => {
  it('submits the launch once and disables the entry while pending', async () => {
    let resolve!: () => void;
    const onRequestMinerUParse = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const container = renderWorkspace(onRequestMinerUParse);
    const entry = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('进入 MinerU 解析'))!;

    await act(async () => { entry.click(); });
    expect(onRequestMinerUParse).toHaveBeenCalledTimes(1);
    expect(entry.disabled).toBe(true);
    expect(entry.textContent).toContain('正在进入');

    act(() => entry.click());
    expect(onRequestMinerUParse).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});
