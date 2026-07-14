import { IDBFactory } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLibraryCourse,
  replaceDocumentRetrievalRecords,
  resetLibraryRepositoryForTests,
  saveChatConversation,
  upsertLibraryDocument,
} from '../../lib/library-repository';
import { useLibraryStore } from '../../store/useLibraryStore';
import { resetQaStoreRuntimeForTests, useQaStore, type QaAnswerer } from '../../store/useQaStore';
import { useStore } from '../../store/useStore';
import type { RagAnswer } from '../../types';
import { KnowledgeQaView } from '../KnowledgeQaView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialQaState = {
  conversations: [],
  messages: [],
  activeConversationId: null,
  selectedCitation: null,
  initialized: false,
  loadingConversation: false,
  activeRequestConversationIds: [],
  error: null,
};

let root: Root | null = null;
let container: HTMLElement | null = null;
const localStorageValues = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

function answer(content: string, cardIds: string[] = []): RagAnswer {
  return {
    mode: cardIds.length > 0 ? 'cards' : 'general',
    sections: [{ source: cardIds.length > 0 ? 'cards' : 'general', content, cardIds }],
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    }
  }
  assertion();
}

function setTextarea(value: string): HTMLTextAreaElement {
  const textarea = container!.querySelector<HTMLTextAreaElement>('textarea[placeholder="询问全部课件中的知识…"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
}

function pressEnter(textarea: HTMLTextAreaElement, shiftKey = false): void {
  act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', shiftKey, bubbles: true, cancelable: true,
  })));
}

async function sendQuestion(question: string): Promise<void> {
  const previousMessageCount = useQaStore.getState().messages.length;
  pressEnter(setTextarea(question));
  await waitFor(() => {
    const messages = useQaStore.getState().messages;
    expect(messages.length).toBeGreaterThan(previousMessageCount);
    expect(messages.some(message => message.role === 'user' && message.content === question)).toBe(true);
    expect(messages[messages.length - 1]).toMatchObject({ role: 'assistant', status: 'completed' });
  });
}

async function renderQa(answerer: QaAnswerer, onOpenSettings = vi.fn()): Promise<void> {
  await act(async () => root!.render(createElement(KnowledgeQaView, { onOpenSettings, answerer })));
  await waitFor(() => expect(useQaStore.getState().initialized).toBe(true));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: new IDBFactory(),
  });
  await resetLibraryRepositoryForTests();
  localStorageValues.clear();
  resetQaStoreRuntimeForTests();
  useQaStore.setState(initialQaState);
  const course = await createLibraryCourse({ name: '机器学习' });
  await upsertLibraryDocument({
    id: 'doc-old', courseId: course.id, title: '旧版课件', fileName: 'old.pdf', fileType: 'pdf', pageCount: 2,
    stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 1, cardCount: 1,
  });
  await upsertLibraryDocument({
    id: 'doc-1', courseId: course.id, title: 'GLM 课件', fileName: 'glm.pdf', fileType: 'pdf', pageCount: 10,
    stage: 'cards', status: 'ready', uploadedAt: 2, updatedAt: 2, cardCount: 1,
  });
  // Same card id across two documents exercises exact citation provenance.
  await replaceDocumentRetrievalRecords('doc-old', [{
    id: 'record-old', cardId: 'card-1', courseId: course.id, documentId: 'doc-old', topicId: 'topic-old', teachingBlockId: 'block-old',
    title: '普通知识', content: '这是与当前问题无关的旧版内容。', keywords: [], aliases: [], sourceRanges: [], version: 1,
  }]);
  await replaceDocumentRetrievalRecords('doc-1', [{
    id: 'record-1', cardId: 'card-1', courseId: course.id, documentId: 'doc-1', topicId: 'topic-1', teachingBlockId: 'block-1',
    title: 'GLM 组成', content: 'GLM 由随机成分、系统成分和连接函数构成。', sourceExcerpt: '课件原文：三个组成部分。',
    keywords: ['GLM'], aliases: [], sourceRanges: [], version: 1,
  }]);
  useStore.setState({ modelConfig: { endpoint: 'https://example.com/v1', model: 'deepseek-chat', apiKey: 'key' } });
  useLibraryStore.setState({ openDocument: vi.fn(async () => undefined) });
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

describe('KnowledgeQaView chat interface', () => {
  it('creates a chat, preserves two turns, renders Markdown, and opens the exact citation drawer', async () => {
    const answerer = vi.fn<QaAnswerer>(async (_config, question, hits) => (
      answer(question.startsWith('GLM') ? '**GLM** 包含三个组成部分。' : '逻辑回归使用连接函数。', [hits[0].record.cardId])
    ));
    await renderQa(answerer);

    await sendQuestion('GLM 的组成是什么？');
    expect(container!.querySelector('strong')?.textContent).toBe('GLM');
    expect(container!.textContent).toContain('基于知识卡片');
    expect(container!.textContent).toContain('今天');
    expect(container!.querySelector('[data-conversation-id]')).not.toBeNull();

    await sendQuestion('那逻辑回归呢？');
    expect(answerer.mock.calls[1][3]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'GLM 的组成是什么？' }),
    ]));

    act(() => container!.querySelector<HTMLButtonElement>('button[data-card-id="card-1"]')!.click());
    const drawer = container!.querySelector('[data-testid="citation-drawer"]')!;
    expect(drawer.textContent).toContain('GLM 课件');
    expect(drawer.textContent).toContain('GLM 由随机成分');
    expect(drawer.textContent).not.toContain('旧版内容');
    await act(async () => Array.from(drawer.querySelectorAll('button')).find(button => button.textContent === '打开对应课件')!.click());
    expect(useLibraryStore.getState().openDocument).toHaveBeenCalledWith('doc-1');

    act(() => drawer.querySelector<HTMLButtonElement>('button[aria-label="关闭引用详情"]')!.click());
    expect(container!.querySelector('[data-testid="citation-drawer"]')).toBeNull();
    expect(container!.querySelector('[data-testid="qa-two-column-layout"]')).not.toBeNull();
  });

  it('starts a fresh welcome state and switches between two isolated conversations', async () => {
    const answerer: QaAnswerer = async (_config, question) => answer(`回答：${question}`);
    await renderQa(answerer);
    await sendQuestion('第一个问题');
    const firstId = useQaStore.getState().activeConversationId!;
    expect(container!.querySelector('[data-testid="qa-chat-title"]')?.textContent).toBe('第一个问题');

    act(() => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('新建聊天'))!.click());
    expect(container!.textContent).toContain('从全部课件知识卡片开始提问');
    await sendQuestion('第二个问题');
    const secondId = useQaStore.getState().activeConversationId!;
    expect(secondId).not.toBe(firstId);
    expect(container!.querySelector('[data-testid="qa-chat-title"]')?.textContent).toBe('第二个问题');

    await act(async () => container!.querySelector<HTMLButtonElement>(`[data-conversation-id="${firstId}"]`)!.click());
    await waitFor(() => expect(container!.textContent).toContain('回答：第一个问题'));
    expect(container!.querySelector('[data-testid="qa-chat-title"]')?.textContent).toBe('第一个问题');
    expect(container!.textContent).not.toContain('回答：第二个问题');

    await act(async () => container!.querySelector<HTMLButtonElement>(`[data-conversation-id="${secondId}"]`)!.click());
    await waitFor(() => expect(container!.textContent).toContain('回答：第二个问题'));
  });

  it('renames inline and deletes a chat only after confirmation', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await renderQa(async () => answer('已回答'));
    await sendQuestion('原始标题');
    const conversationId = useQaStore.getState().activeConversationId!;

    act(() => container!.querySelector<HTMLButtonElement>(`button[data-rename-conversation="${conversationId}"]`)!.click());
    const renameInput = container!.querySelector<HTMLInputElement>(`input[data-rename-input="${conversationId}"]`)!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(renameInput, '新标题');
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitFor(() => expect(container!.textContent).toContain('新标题'));
    expect(container!.querySelector('[data-testid="qa-chat-title"]')?.textContent).toBe('新标题');

    const deleteButton = () => container!.querySelector<HTMLButtonElement>(`button[data-delete-conversation="${conversationId}"]`)!;
    act(() => deleteButton().click());
    expect(container!.querySelector(`[data-conversation-id="${conversationId}"]`)).not.toBeNull();
    act(() => deleteButton().click());
    await waitFor(() => expect(container!.querySelector(`[data-conversation-id="${conversationId}"]`)).toBeNull());
  });

  it('shows a failed assistant message and retries it', async () => {
    const answerer = vi.fn<QaAnswerer>()
      .mockRejectedValueOnce(new Error('模型超时'))
      .mockResolvedValueOnce(answer('重试成功'));
    await renderQa(answerer);
    pressEnter(setTextarea('请解释 GLM'));
    await waitFor(() => expect(container!.textContent).toContain('模型超时'));

    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent === '重新生成')!.click());
    await waitFor(() => expect(container!.textContent).toContain('重试成功'));
    expect(answerer).toHaveBeenCalledTimes(2);
  });

  it('submits on Enter while Shift+Enter keeps a newline', async () => {
    const answerer = vi.fn<QaAnswerer>(async () => answer('收到'));
    await renderQa(answerer);
    const textarea = setTextarea('第一行');
    pressEnter(textarea, true);
    setTextarea('第一行\n');
    expect(answerer).not.toHaveBeenCalled();
    expect(textarea.value).toBe('第一行\n');

    setTextarea('第一行\n第二行');
    pressEnter(textarea);
    await waitFor(() => expect(answerer).toHaveBeenCalledOnce());
    expect(answerer.mock.calls[0][1]).toBe('第一行\n第二行');
  });

  it('opens settings and retains the draft when the model key is missing', async () => {
    const onOpenSettings = vi.fn();
    const answerer = vi.fn<QaAnswerer>();
    useStore.setState({ modelConfig: { endpoint: 'https://example.com/v1', model: 'deepseek-chat', apiKey: '' } });
    await renderQa(answerer, onOpenSettings);

    const textarea = setTextarea('这个草稿不能丢');
    pressEnter(textarea);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(answerer).not.toHaveBeenCalled();
    expect(textarea.value).toBe('这个草稿不能丢');
  });

  it('falls back to the stored citation snapshot when the exact live card is unavailable', async () => {
    await renderQa(async (_config, _question, hits) => answer('可追溯回答', [hits[0].record.cardId]));
    await sendQuestion('GLM 的组成是什么？');
    await replaceDocumentRetrievalRecords('doc-1', []);

    act(() => root!.unmount());
    root = createRoot(container!);
    await renderQa(async () => answer('不会调用'));
    await waitFor(() => expect(container!.querySelector('button[data-card-id="card-1"]')).not.toBeNull());
    act(() => container!.querySelector<HTMLButtonElement>('button[data-card-id="card-1"]')!.click());

    const drawer = container!.querySelector('[data-testid="citation-drawer"]')!;
    expect(drawer.textContent).toContain('卡片已更新或不可用，显示历史引用');
    expect(drawer.textContent).toContain('GLM 由随机成分');
  });

  it('places every conversation older than yesterday in the 更早 group', async () => {
    const timestamp = Date.now() - 3 * 24 * 60 * 60 * 1000;
    await saveChatConversation({
      id: 'old-chat',
      title: '三天前的聊天',
      courseIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    });

    await renderQa(async () => answer('不会调用'));
    const history = container!.querySelector('nav[aria-label="聊天历史"]')!;
    expect(history.textContent).toContain('更早');
    expect(history.textContent).not.toContain('过去 7 天');
  });

});
