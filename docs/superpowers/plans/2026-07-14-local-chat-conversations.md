# Local QA Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the full-library knowledge-card QA page into a browser-local, multi-conversation chat system with persistent history, bounded multi-turn context, retryable failures, and durable card citation snapshots.

**Architecture:** Extend the existing `zhigang-library` IndexedDB with separate conversation and message stores, expose focused repository methods, and add a dedicated Zustand `useQaStore` for chat lifecycle and async request ownership. Keep lexical/graph card retrieval as the grounding layer, add pure context-window helpers, and replace the current single-answer page state with the approved two-column ChatGPT-style interface plus an on-demand citation drawer.

**Tech Stack:** React 18, TypeScript, Zustand, IndexedDB, Vitest/jsdom, react-markdown, existing knowledge-card RAG and retrieval modules.

---

## File structure

- Modify `src/types/index.ts`: define persistent conversation, message, citation snapshot, and bounded history types.
- Modify `src/lib/library-repository.ts`: upgrade IndexedDB to version 2 and add conversation/message CRUD without changing course stores.
- Modify `src/lib/__tests__/library-repository.test.ts`: verify persistence, sorting, cascade deletion, and interrupted-message recovery.
- Create `src/lib/qa-conversation-context.ts`: pure title, retrieval-query, context-window, and citation-snapshot helpers.
- Create `src/lib/__tests__/qa-conversation-context.test.ts`: verify context semantics independently of React and storage.
- Modify `src/lib/card-rag.ts`: include bounded chat history in grounded and general prompts while keeping card facts authoritative.
- Modify `src/lib/__tests__/card-rag.test.ts`: verify history separation and no-hit behavior.
- Create `src/store/useQaStore.ts`: own conversation selection, persistence, request routing, retry, and drawer selection.
- Create `src/store/__tests__/useQaStore.test.ts`: verify multiple chats, async routing, restore, rename/delete, and failure retry.
- Replace `src/components/KnowledgeQaView.tsx`: render persistent chat navigation, messages, composer, and citation drawer.
- Replace `src/components/__tests__/KnowledgeQaView.test.tsx`: cover the approved interaction contract.

### Task 1: Add persistent chat types and IndexedDB repositories

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/library-repository.ts`
- Modify: `src/lib/__tests__/library-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add imports for the chat repository functions and types, then add focused cases equivalent to:

```typescript
it('stores conversations by most recent update and messages in creation order', async () => {
  await saveChatConversation({
    id: 'chat-old', title: '旧对话', courseIds: [],
    createdAt: 1, updatedAt: 2, lastOpenedAt: 2,
  });
  await saveChatConversation({
    id: 'chat-new', title: '新对话', courseIds: [],
    createdAt: 3, updatedAt: 8, lastOpenedAt: 8,
  });
  await saveChatMessage({
    id: 'message-2', conversationId: 'chat-new', role: 'assistant',
    content: '回答', status: 'completed', createdAt: 5, updatedAt: 5,
  });
  await saveChatMessage({
    id: 'message-1', conversationId: 'chat-new', role: 'user',
    content: '问题', status: 'completed', createdAt: 4, updatedAt: 4,
  });

  expect((await listChatConversations()).map(item => item.id)).toEqual(['chat-new', 'chat-old']);
  expect((await listChatMessages('chat-new')).map(item => item.id)).toEqual(['message-1', 'message-2']);
});

it('deletes all messages when a conversation is deleted', async () => {
  await saveChatConversation({ id: 'chat-1', title: '测试', courseIds: [], createdAt: 1, updatedAt: 1, lastOpenedAt: 1 });
  await saveChatMessage({ id: 'message-1', conversationId: 'chat-1', role: 'user', content: '问题', status: 'completed', createdAt: 2, updatedAt: 2 });

  await deleteChatConversation('chat-1');

  expect(await listChatConversations()).toEqual([]);
  expect(await listChatMessages('chat-1')).toEqual([]);
});

it('marks pending assistant messages as interrupted on recovery', async () => {
  await saveChatMessage({ id: 'pending', conversationId: 'chat-1', role: 'assistant', content: '', status: 'pending', createdAt: 2, updatedAt: 2 });

  await interruptPendingChatMessages();

  expect((await listChatMessages('chat-1'))[0].status).toBe('interrupted');
});
```

- [ ] **Step 2: Run the repository tests to verify RED**

Run: `npm test -- --run src/lib/__tests__/library-repository.test.ts`

Expected: FAIL because chat types and repository exports do not exist.

- [ ] **Step 3: Add the persistent types**

Add these exported types near the existing library and retrieval types in `src/types/index.ts`:

```typescript
export interface ChatConversation {
  id: string;
  title: string;
  courseIds: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus = 'pending' | 'completed' | 'failed' | 'interrupted';

export interface ChatCitationSnapshot {
  cardId: string;
  courseId: string;
  documentId: string;
  courseName: string;
  documentTitle: string;
  title: string;
  content: string;
  sourceExcerpt?: string;
}

export interface RagAnswerSection {
  source: 'cards' | 'general';
  content: string;
  cardIds: string[];
}

export interface RagAnswer {
  mode: 'cards' | 'mixed' | 'general';
  sections: RagAnswerSection[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  answer?: RagAnswer;
  citations?: ChatCitationSnapshot[];
  error?: string;
  retryOfMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistoryTurn {
  role: ChatMessageRole;
  content: string;
}
```

Move the existing `RagAnswer` and `RagAnswerSection` definitions out of `card-rag.ts` into `src/types/index.ts`. In `card-rag.ts`, import them with `import type` and re-export their types so existing imports from `card-rag.ts` keep compiling:

```typescript
import type { ChatHistoryTurn, ModelConfig, RagAnswer, RagAnswerSection } from '../types';
export type { RagAnswer, RagAnswerSection } from '../types';
```

- [ ] **Step 4: Upgrade the library database without touching existing stores**

In `src/lib/library-repository.ts`:

```typescript
const DB_VERSION = 2;
const CHAT_CONVERSATIONS = 'qa-conversations';
const CHAT_MESSAGES = 'qa-messages';
```

Inside `request.onupgradeneeded`, create missing stores only:

```typescript
if (!db.objectStoreNames.contains(CHAT_CONVERSATIONS)) {
  const store = db.createObjectStore(CHAT_CONVERSATIONS, { keyPath: 'id' });
  store.createIndex('updatedAt', 'updatedAt', { unique: false });
}
if (!db.objectStoreNames.contains(CHAT_MESSAGES)) {
  const store = db.createObjectStore(CHAT_MESSAGES, { keyPath: 'id' });
  store.createIndex('conversationId', 'conversationId', { unique: false });
  store.createIndex('conversationCreatedAt', ['conversationId', 'createdAt'], { unique: false });
}
```

Extend the memory fallback with `conversations` and `messages` maps so tests and browsers without IndexedDB preserve the same API behavior.

- [ ] **Step 5: Implement focused repository functions**

Export these functions from `src/lib/library-repository.ts`:

```typescript
export async function saveChatConversation(conversation: ChatConversation): Promise<void>;
export async function listChatConversations(): Promise<ChatConversation[]>;
export async function deleteChatConversation(conversationId: string): Promise<void>;
export async function saveChatMessage(message: ChatMessage): Promise<void>;
export async function listChatMessages(conversationId: string): Promise<ChatMessage[]>;
export async function interruptPendingChatMessages(): Promise<void>;
```

Required behavior:

- `listChatConversations` sorts by `updatedAt` descending.
- `listChatMessages` sorts by `createdAt` ascending, breaking ties by `id`.
- `deleteChatConversation` deletes the conversation and every message returned by the `conversationId` index in one read-write transaction.
- `interruptPendingChatMessages` rewrites only assistant messages whose status is `pending`, setting `status: 'interrupted'`, `error: '上次回答因页面关闭而中断'`, and a fresh `updatedAt`.
- `resetLibraryRepositoryForTests` clears the new memory maps and database stores through the existing database deletion path.

- [ ] **Step 6: Run repository tests to verify GREEN**

Run: `npm test -- --run src/lib/__tests__/library-repository.test.ts`

Expected: all repository tests pass, including existing course and retrieval tests.

- [ ] **Step 7: Commit the persistence slice**

```bash
git add src/types/index.ts src/lib/library-repository.ts src/lib/__tests__/library-repository.test.ts
git commit -m "feat: persist QA conversations locally"
```

### Task 2: Add bounded multi-turn context and grounded prompts

**Files:**
- Create: `src/lib/qa-conversation-context.ts`
- Create: `src/lib/__tests__/qa-conversation-context.test.ts`
- Modify: `src/lib/card-rag.ts`
- Modify: `src/lib/__tests__/card-rag.test.ts`

- [ ] **Step 1: Write failing pure context tests**

Create tests that express the complete helper contract:

```typescript
it('builds retrieval text from the current question and two recent user questions only', () => {
  const history: ChatHistoryTurn[] = [
    { role: 'user', content: '什么是 GLM？' },
    { role: 'assistant', content: '这段很长的回答不能进入检索查询。' },
    { role: 'user', content: '它有哪些组成？' },
    { role: 'assistant', content: '组成回答。' },
  ];
  expect(buildContextualRetrievalQuery('那逻辑回归呢？', history)).toBe(
    '那逻辑回归呢？\n上下文问题：什么是 GLM？\n上下文问题：它有哪些组成？',
  );
});

it('keeps the newest ordered turns inside both message and character limits', () => {
  const history: ChatHistoryTurn[] = Array.from({ length: 15 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${index}-${'x'.repeat(20)}`,
  }));
  const selected = selectChatContext(history, { maxMessages: 12, maxCharacters: 180 });
  expect(selected.length).toBeLessThanOrEqual(12);
  expect(selected.at(-1)?.content).toContain('turn-14');
  expect(selected.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(180);
});

it('creates a stable local title from the first question', () => {
  expect(createConversationTitle('  GLM 与逻辑回归之间有什么关系？  ')).toBe('GLM 与逻辑回归之间有什么关系？');
  expect(createConversationTitle('x'.repeat(40))).toHaveLength(24);
});
```

- [ ] **Step 2: Write a failing RAG prompt-history test**

In `src/lib/__tests__/card-rag.test.ts`, pass a history array and assert that:

```typescript
expect(requests[0].user).toContain('最近对话：');
expect(requests[0].user).toContain('用户：什么是 GLM？');
expect(requests[0].user).toContain('当前问题：那逻辑回归呢？');
expect(requests[0].system).toContain('历史回答只能用于理解指代');
```

Also verify the no-hit `general` request receives recent history but no `知识卡片正文` section.

- [ ] **Step 3: Run context and RAG tests to verify RED**

Run: `npm test -- --run src/lib/__tests__/qa-conversation-context.test.ts src/lib/__tests__/card-rag.test.ts`

Expected: FAIL because the context module and history-aware RAG signature are absent.

- [ ] **Step 4: Implement the pure context helpers**

Create `src/lib/qa-conversation-context.ts` exporting:

```typescript
export function createConversationTitle(question: string, maxLength = 24): string;
export function buildContextualRetrievalQuery(question: string, history: ChatHistoryTurn[], maxUserTurns = 2): string;
export function selectChatContext(
  history: ChatHistoryTurn[],
  limits?: { maxMessages?: number; maxCharacters?: number },
): ChatHistoryTurn[];
export function createCitationSnapshots(
  cardIds: string[],
  records: RetrievalRecord[],
  courses: LibraryCourse[],
  documents: LibraryDocument[],
): ChatCitationSnapshot[];
```

Use defaults `maxMessages: 12` and `maxCharacters: 16000`. Select from newest to oldest, stop before exceeding the character cap, then reverse the selected slice back to chronological order. `createCitationSnapshots` must deduplicate card IDs while preserving answer order and copy the retrieval content and source excerpt.

- [ ] **Step 5: Make card RAG history-aware without weakening grounding**

Change the public function to accept history after the injected completer so current tests remain source-compatible:

```typescript
export async function answerWithKnowledgeCards(
  config: ModelConfig,
  question: string,
  hits: KnowledgeCardSearchHit[],
  injectedCompleter?: RagCompleter,
  history: ChatHistoryTurn[] = [],
): Promise<RagAnswer>
```

Format history as `用户：...` and `助手：...`. In cards mode, the prompt order must be:

```text
最近对话：
...

当前问题：...

知识卡片正文：
...
```

Add the system constraint: `历史回答只能用于理解指代和对话意图，不能作为课程事实来源；课程事实必须来自本次提供的知识卡片。` The general branch receives history and the current question but no card heading or fabricated citations.

- [ ] **Step 6: Run context and RAG tests to verify GREEN**

Run: `npm test -- --run src/lib/__tests__/qa-conversation-context.test.ts src/lib/__tests__/card-rag.test.ts`

Expected: all context and RAG tests pass.

- [ ] **Step 7: Commit the context slice**

```bash
git add src/lib/qa-conversation-context.ts src/lib/__tests__/qa-conversation-context.test.ts src/lib/card-rag.ts src/lib/__tests__/card-rag.test.ts
git commit -m "feat: add multi-turn card RAG context"
```

### Task 3: Add a dedicated QA conversation store

**Files:**
- Create: `src/store/useQaStore.ts`
- Create: `src/store/__tests__/useQaStore.test.ts`

- [ ] **Step 1: Write failing store lifecycle tests**

Use the real repository memory/IndexedDB implementation and an injected answerer. Cover these observable behaviors:

```typescript
it('creates a conversation only on first send and restores it after initialize', async () => {
  await useQaStore.getState().initialize();
  expect(useQaStore.getState().conversations).toEqual([]);

  await useQaStore.getState().sendQuestion({
    config, question: 'GLM 是什么？', answerer,
  });

  expect(useQaStore.getState().conversations[0].title).toBe('GLM 是什么？');
  expect(useQaStore.getState().messages.map(item => item.role)).toEqual(['user', 'assistant']);

  useQaStore.setState({
    conversations: [], messages: [], activeConversationId: null,
    selectedCitation: null, initialized: false,
    loadingConversation: false, activeRequestConversationIds: [], error: null,
  });
  await useQaStore.getState().initialize();
  expect(useQaStore.getState().messages.map(item => item.content)).toContain('GLM 是什么？');
});
```

Add separate tests for:

- creating two chats and switching without mixing messages;
- resolving a delayed answer into its original conversation after the user switches chats;
- renaming a conversation;
- deleting the active conversation and selecting the next most recent one;
- saving a failed assistant message and successfully retrying it;
- opening and closing a citation snapshot drawer;
- restoring the active conversation ID from localStorage.

- [ ] **Step 2: Run the store test to verify RED**

Run: `npm test -- --run src/store/__tests__/useQaStore.test.ts`

Expected: FAIL because `useQaStore` does not exist.

- [ ] **Step 3: Define the store API**

Create `src/store/useQaStore.ts` with this public shape:

```typescript
export interface QaAnswerer {
  (config: ModelConfig, question: string, hits: KnowledgeCardSearchHit[], history: ChatHistoryTurn[]): Promise<RagAnswer>;
}

interface SendQuestionInput {
  config: ModelConfig;
  question: string;
  answerer?: QaAnswerer;
  retryOfMessageId?: string;
}

interface QaState {
  conversations: ChatConversation[];
  messages: ChatMessage[];
  activeConversationId: string | null;
  selectedCitation: ChatCitationSnapshot | null;
  initialized: boolean;
  loadingConversation: boolean;
  activeRequestConversationIds: string[];
  error: string | null;
  initialize(): Promise<void>;
  startNewChat(): void;
  selectConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  sendQuestion(input: SendQuestionInput): Promise<void>;
  retryMessage(messageId: string, config: ModelConfig, answerer?: QaAnswerer): Promise<void>;
  openCitation(citation: ChatCitationSnapshot): void;
  closeCitation(): void;
}
```

- [ ] **Step 4: Implement initialization and conversation CRUD**

Use `zhigang_qa_active_conversation` as the localStorage key. `initialize` must:

1. call `interruptPendingChatMessages()`;
2. load conversations sorted by update time;
3. choose the saved ID if it still exists, otherwise the first conversation;
4. load only the selected conversation's messages;
5. set `initialized: true` even when there are no conversations.

`startNewChat` clears the active ID, visible messages, selected citation, and persisted active ID without creating a database record.

`selectConversation` updates and persists `lastOpenedAt`, saves the active ID to localStorage, closes the citation drawer, and then loads that conversation's messages. `renameConversation` trims the title and rejects an empty result. `deleteConversation` calls the repository cascade delete and selects the newest remaining conversation.

- [ ] **Step 5: Implement request ownership and persistence**

`sendQuestion` must capture a local `conversationId` before awaiting network work. If no active conversation exists, create one with an ID from `crypto.randomUUID()` (falling back to timestamp/random), title from `createConversationTitle`, and empty `courseIds`.

Persist in this order:

1. completed user message;
2. pending assistant placeholder;
3. retrieve latest records, courses, and documents, then build contextual query/history;
4. call the injected answerer or a wrapper around `answerWithKnowledgeCards`;
5. persist completed assistant answer and citation snapshots;
6. update the owning conversation timestamp;
7. update visible messages only if that conversation is still active.

On error, rewrite the placeholder as `failed` with its error text. Track request ownership by conversation ID so switching the UI does not redirect the result.

Use this adapter when no injected answerer is provided:

```typescript
const defaultAnswerer: QaAnswerer = (config, question, hits, history) =>
  answerWithKnowledgeCards(config, question, hits, undefined, history);
```

Build citation snapshots from `answer.sections.flatMap(section => section.cardIds)` plus the latest records, courses, and documents before persisting the completed assistant message.

- [ ] **Step 6: Implement retry and drawer actions**

`retryMessage` finds the failed/interrupted assistant message and the nearest preceding user message in the same persisted conversation, then calls `sendQuestion` with `retryOfMessageId`. It must not duplicate the user message; expose a private generation helper that accepts an existing user message for retry.

`openCitation` and `closeCitation` only update UI state. The component later resolves live records first and falls back to the snapshot.

- [ ] **Step 7: Run store tests to verify GREEN**

Run: `npm test -- --run src/store/__tests__/useQaStore.test.ts`

Expected: all store tests pass without React rendering.

- [ ] **Step 8: Commit the state slice**

```bash
git add src/store/useQaStore.ts src/store/__tests__/useQaStore.test.ts
git commit -m "feat: manage persistent QA chat state"
```

### Task 4: Replace the single-answer page with the approved chat interface

**Files:**
- Modify: `src/components/KnowledgeQaView.tsx`
- Modify: `src/components/__tests__/KnowledgeQaView.test.tsx`

- [ ] **Step 1: Replace the component test with failing chat interactions**

Keep the existing course/retrieval fixture, initialize the QA store before rendering, and add tests for:

```typescript
it('creates a chat, preserves multiple turns, and opens a citation drawer', async () => {
  renderQa();
  await sendQuestion('GLM 的组成是什么？');

  expect(container.textContent).toContain('GLM 的组成是什么？');
  expect(container.textContent).toContain('基于知识卡片');
  expect(container.querySelector('[data-conversation-id]')).not.toBeNull();

  await sendQuestion('那逻辑回归呢？');
  expect(answerer.mock.calls[1][3]).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'user', content: 'GLM 的组成是什么？' }),
  ]));

  const citation = container.querySelector<HTMLButtonElement>('button[data-card-id="card-1"]')!;
  act(() => citation.click());
  expect(container.querySelector('[data-testid="citation-drawer"]')).not.toBeNull();
  expect(container.textContent).toContain('GLM 课件');
});
```

Add separate component tests for:

- “新建聊天” returning to the empty welcome state;
- switching between two conversations;
- inline rename and confirmed delete;
- failed assistant message showing “重新生成”;
- `Enter` submitting and `Shift+Enter` preserving a newline;
- closing the citation drawer restoring the two-column layout.

- [ ] **Step 2: Run the component tests to verify RED**

Run: `npm test -- --run src/components/__tests__/KnowledgeQaView.test.tsx`

Expected: FAIL because the current page only renders one submitted question and one answer.

- [ ] **Step 3: Build the left conversation navigation**

Replace current course-scope sidebar content with:

- a full-width “＋ 新建聊天” button;
- grouped conversation buttons using a pure local `groupConversationsByDate` helper;
- active conversation styling and `data-conversation-id` attributes;
- a small menu or explicit icon buttons for rename and delete;
- an inline rename input that saves on Enter/blur and cancels on Escape.

Keep the default scope label “全部课件” in the chat header; do not add a scope picker in this iteration.

- [ ] **Step 4: Render the multi-message conversation**

Map `useQaStore.messages` chronologically:

- user messages render as right-aligned bubbles;
- completed assistant messages map `answer.sections` and render each section through `MarkdownRenderer`;
- cards/general source badges remain separate;
- pending messages show the retrieval/generation status;
- failed/interrupted messages render their error and a “重新生成” button;
- citation buttons use the stored snapshots and call `openCitation`.

Scroll to the latest message after message count changes, but do not force-scroll while the user is reading older content unless the previous scroll position was near the bottom.

- [ ] **Step 5: Implement the composer keyboard contract**

Use a `<textarea>` instead of the current single-line input. On keydown:

```typescript
if (event.key === 'Enter' && !event.shiftKey) {
  event.preventDefault();
  void submitQuestion();
}
```

Before sending, if `modelConfig.apiKey` is missing, call `onOpenSettings` and keep the draft text. Disable submission only while the active conversation owns an in-flight request or the trimmed draft is empty.

- [ ] **Step 6: Implement the on-demand citation drawer**

When `selectedCitation` is non-null, render an overlay drawer with `data-testid="citation-drawer"`. Resolve `records.find(record => record.cardId === selectedCitation.cardId)` at render time; use current record content when present, otherwise snapshot content and a “卡片已更新或不可用，显示历史引用” notice.

The drawer must include a close button and “打开对应课件”, which calls `openDocument(selectedCitation.documentId)`.

- [ ] **Step 7: Run component tests to verify GREEN**

Run: `npm test -- --run src/components/__tests__/KnowledgeQaView.test.tsx`

Expected: all approved chat interactions pass.

- [ ] **Step 8: Commit the interface slice**

```bash
git add src/components/KnowledgeQaView.tsx src/components/__tests__/KnowledgeQaView.test.tsx
git commit -m "feat: add ChatGPT-style library QA history"
```

### Task 5: Integration verification and cleanup

**Files:**
- Modify only files required by failures discovered in this task.

- [ ] **Step 1: Run focused integration tests**

Run:

```bash
npm test -- --run \
  src/lib/__tests__/library-repository.test.ts \
  src/lib/__tests__/qa-conversation-context.test.ts \
  src/lib/__tests__/card-rag.test.ts \
  src/store/__tests__/useQaStore.test.ts \
  src/components/__tests__/KnowledgeQaView.test.tsx
```

Expected: all focused test files pass with no unhandled React act warnings or rejected promises.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: all test files pass.

- [ ] **Step 3: Run static verification**

Run: `npm run check`

Expected: TypeScript exits with code 0.

Run: `npm run lint`

Expected: ESLint exits with 0 errors. Existing warnings may remain, but this feature must not add warnings.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: Vite production build exits with code 0; existing chunk-size warnings are acceptable.

- [ ] **Step 5: Perform a local browser smoke check**

Using the existing Vite development server:

1. open “全库知识问答”;
2. create a first chat and ask two related questions;
3. create a second chat and verify the first chat remains in the sidebar;
4. refresh and verify the active conversation and messages restore;
5. open and close a knowledge-card citation drawer;
6. rename and delete the second chat;
7. confirm the first chat and its citation snapshot still render.

- [ ] **Step 6: Review the final diff for scope and secrets**

Run: `git diff --check` and `git status --short`.

Confirm no API keys, generated browser data under `.superpowers/`, or unrelated user files are staged.

- [ ] **Step 7: Commit any integration-only corrections**

If Step 1–6 required code corrections, stage only those correction files and commit:

```bash
git commit -m "fix: stabilize persistent QA conversations"
```

If no corrections were required, do not create an empty commit.
