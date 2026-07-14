import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeCardSearchHit } from '../../lib/card-retrieval';
import type { RagAnswer } from '../../lib/card-rag';
import { createLibraryCourse, replaceDocumentRetrievalRecords, resetLibraryRepositoryForTests, upsertLibraryDocument } from '../../lib/library-repository';
import { useStore } from '../../store/useStore';
import { KnowledgeQaView } from '../KnowledgeQaView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(async () => {
  await resetLibraryRepositoryForTests();
  const course = await createLibraryCourse({ name: '机器学习' });
  await upsertLibraryDocument({
    id: 'doc-1', courseId: course.id, title: 'GLM 课件', fileName: 'glm.pdf', fileType: 'pdf', pageCount: 10,
    stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 1, cardCount: 1,
  });
  await replaceDocumentRetrievalRecords('doc-1', [{
    id: 'record-1', cardId: 'card-1', courseId: course.id, documentId: 'doc-1', topicId: 'topic-1', teachingBlockId: 'block-1',
    title: 'GLM 组成', content: 'GLM 由随机成分、系统成分和连接函数构成。', keywords: ['GLM'], aliases: [], sourceRanges: [], version: 1,
  }]);
  useStore.setState({ modelConfig: { endpoint: 'https://example.com/v1', model: 'deepseek-chat', apiKey: 'key' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('KnowledgeQaView', () => {
  it('answers with a clickable knowledge card index', async () => {
    const answerer = vi.fn(async (_config: unknown, _question: string, hits: KnowledgeCardSearchHit[]): Promise<RagAnswer> => ({
      mode: 'cards',
      sections: [{ source: 'cards', content: 'GLM 包含三个组成部分。', cardIds: [hits[0].record.cardId] }],
    }));
    await act(async () => root!.render(createElement(KnowledgeQaView, { onOpenSettings: vi.fn(), answerer })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    const input = container!.querySelector<HTMLInputElement>('input[placeholder="询问全部课件中的知识…"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'GLM 的组成是什么？');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('发送'))!;
    await act(async () => send.click());

    expect(answerer).toHaveBeenCalledOnce();
    expect(container!.textContent).toContain('基于知识卡片');
    expect(container!.textContent).toContain('GLM 包含三个组成部分');
    expect(container!.querySelector('button[data-card-id="card-1"]')?.textContent).toContain('GLM 组成');
  });
});
