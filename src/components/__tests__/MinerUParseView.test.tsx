import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceDocument } from '../../types';
import { useStore } from '../../store/useStore';
import { MinerUParseView } from '../MinerUParseView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanedMarkdown = '# Lecture\n\nUnique content.\n';
const rawMarkdown = '# Lecture\n\nRepeated header\n\nRepeated header\n\nUnique content.\n';
const sourceDocument: SourceDocument = {
  id: 'doc-1', courseId: 'course-1', title: 'lecture6', markdown: cleanedMarkdown,
  blocks: [], outline: [], contentHash: 'hash', createdAt: '2026-07-13', updatedAt: '2026-07-13',
};
const roots: Root[] = [];

beforeEach(() => {
  act(() => useStore.setState({
    stage: 'mineru',
    document: {
      id: 'doc-1', title: 'lecture6', fileName: 'lecture6.pdf', fileType: 'pdf', pages: [], uploadedAt: 0,
    },
    sourceDocuments: [sourceDocument],
    mineruConfig: { endpoint: 'https://mineru.example.com', apiKey: 'test', modelVersion: 'pipeline', language: 'en', enableFormula: true, enableTable: true },
    modelConfig: { endpoint: 'https://model.example.com', model: 'test', apiKey: 'test' },
    mineruParseResult: {
      status: 'completed', progress: 100, markdown: rawMarkdown, assets: [], sourceFileName: 'lecture6.pdf',
    },
  }));
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

describe('MinerUParseView cleaned Markdown review', () => {
  it('previews cleaned Markdown and keeps the original MinerU output available for audit', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(createElement(MinerUParseView, { onOpenSettings: vi.fn() })));

    expect(container.textContent).toContain('清洗后 Markdown');
    expect(container.textContent).toContain('MinerU 原始输出');
    expect(container.textContent).toContain('Unique content.');
    expect(container.textContent).not.toContain('Repeated header');

    const rawButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'MinerU 原始输出')!;
    act(() => rawButton.click());
    expect((container.textContent?.match(/Repeated header/g) ?? [])).toHaveLength(2);
  });
});
