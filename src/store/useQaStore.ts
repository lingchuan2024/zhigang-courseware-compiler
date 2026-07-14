import { create } from 'zustand';
import type {
  ChatCitationSnapshot,
  ChatConversation,
  ChatHistoryTurn,
  ChatMessage,
  ModelConfig,
  RagAnswer,
} from '../types';
import { answerWithKnowledgeCards } from '../lib/card-rag';
import {
  searchKnowledgeCardsWithContext,
  type KnowledgeCardSearchHit,
} from '../lib/card-retrieval';
import {
  deleteChatConversation,
  interruptPendingChatMessages,
  listChatConversations,
  listChatMessages,
  listLibraryCourses,
  listLibraryDocuments,
  listRetrievalRecords,
  saveChatConversation,
  saveChatMessage,
} from '../lib/library-repository';
import {
  createCitationSnapshots,
  createConversationTitle,
  selectChatContext,
} from '../lib/qa-conversation-context';

const ACTIVE_CONVERSATION_KEY = 'zhigang_qa_active_conversation';
const requestCounts = new Map<string, number>();
let selectionEpoch = 0;
let lastTimestamp = 0;

export interface QaAnswerer {
  (
    config: ModelConfig,
    question: string,
    hits: KnowledgeCardSearchHit[],
    history: ChatHistoryTurn[],
  ): Promise<RagAnswer>;
}

export interface SendQuestionInput {
  config: ModelConfig;
  question: string;
  answerer?: QaAnswerer;
  retryOfMessageId?: string;
}

export interface QaState {
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

const defaultAnswerer: QaAnswerer = (config, question, hits, history) =>
  answerWithKnowledgeCards(config, question, hits, undefined, history);

function nextTimestamp(): number {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  return lastTimestamp;
}

function createId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `${prefix}-${randomUUID()}`;
  return `${prefix}-${nextTimestamp()}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortConversations(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function readActiveConversationId(): string | null {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_CONVERSATION_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistActiveConversationId(id: string | null): void {
  try {
    if (id) globalThis.localStorage?.setItem(ACTIVE_CONVERSATION_KEY, id);
    else globalThis.localStorage?.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // Chat persistence remains usable when storage is disabled.
  }
}

function answerContent(answer: RagAnswer): string {
  return answer.sections.map(section => section.content.trim()).filter(Boolean).join('\n\n');
}

function addRequestOwner(conversationId: string): void {
  const currentCount = requestCounts.get(conversationId) ?? 0;
  requestCounts.set(conversationId, currentCount + 1);
  if (currentCount > 0) return;
  useQaStore.setState(state => ({
    activeRequestConversationIds: state.activeRequestConversationIds.includes(conversationId)
      ? state.activeRequestConversationIds
      : [...state.activeRequestConversationIds, conversationId],
  }));
}

function removeRequestOwner(conversationId: string): void {
  const remaining = (requestCounts.get(conversationId) ?? 1) - 1;
  if (remaining > 0) {
    requestCounts.set(conversationId, remaining);
    return;
  }
  requestCounts.delete(conversationId);
  useQaStore.setState(state => ({
    activeRequestConversationIds: state.activeRequestConversationIds.filter(id => id !== conversationId),
  }));
}

function completedHistoryBefore(messages: ChatMessage[], userMessageId: string): ChatHistoryTurn[] {
  const userIndex = messages.findIndex(item => item.id === userMessageId);
  const preceding = userIndex >= 0 ? messages.slice(0, userIndex) : messages;
  return preceding
    .filter(item => item.status === 'completed' && item.content.trim())
    .map(item => ({ role: item.role, content: item.content }));
}

interface GenerationInput {
  conversationId: string;
  userMessage: ChatMessage;
  config: ModelConfig;
  answerer?: QaAnswerer;
  retryOfMessageId?: string;
}

async function refreshOwningConversation(conversationId: string): Promise<void> {
  const current = useQaStore.getState().conversations.find(item => item.id === conversationId);
  if (!current) return;
  const updated = { ...current, updatedAt: nextTimestamp() };
  await saveChatConversation(updated);
  useQaStore.setState(state => {
    if (!state.conversations.some(item => item.id === conversationId)) return {};
    return {
      conversations: sortConversations(state.conversations.map(item => (
        item.id === conversationId
          ? { ...item, updatedAt: Math.max(item.updatedAt, updated.updatedAt) }
          : item
      ))),
    };
  });
}

async function generateAnswer(input: GenerationInput): Promise<void> {
  const { conversationId, userMessage, config, retryOfMessageId } = input;
  const placeholderTime = nextTimestamp();
  const placeholder: ChatMessage = {
    id: createId('assistant'),
    conversationId,
    role: 'assistant',
    content: '',
    status: 'pending',
    retryOfMessageId,
    createdAt: placeholderTime,
    updatedAt: placeholderTime,
  };

  if (useQaStore.getState().activeConversationId === conversationId) {
    useQaStore.setState(state => ({ messages: [...state.messages, placeholder], error: null }));
  }
  addRequestOwner(conversationId);

  try {
    await saveChatMessage(placeholder);
    const storedMessages = await listChatMessages(conversationId);
    const history = selectChatContext(completedHistoryBefore(storedMessages, userMessage.id));
    const owningConversation = useQaStore.getState().conversations.find(item => item.id === conversationId)
      ?? (await listChatConversations()).find(item => item.id === conversationId);
    if (!owningConversation) return;
    const courseIds = owningConversation.courseIds;
    const [records, courses, documents] = await Promise.all([
      listRetrievalRecords(courseIds.length > 0 ? { courseIds } : undefined),
      listLibraryCourses(),
      listLibraryDocuments(),
    ]);
    const hits = searchKnowledgeCardsWithContext(
      userMessage.content,
      history,
      records,
      courseIds.length > 0 ? { courseIds } : {},
    );
    const answer = await (input.answerer ?? defaultAnswerer)(
      config,
      userMessage.content,
      hits,
      history,
    );
    const cardIds = answer.sections.flatMap(section => section.cardIds);
    const completed: ChatMessage = {
      ...placeholder,
      content: answerContent(answer),
      status: 'completed',
      answer,
      citations: createCitationSnapshots(cardIds, hits, courses, documents),
      error: undefined,
      updatedAt: nextTimestamp(),
    };
    await saveChatMessage(completed);
    await refreshOwningConversation(conversationId);
    useQaStore.setState(state => (
      state.activeConversationId === conversationId
        ? { messages: state.messages.map(item => item.id === completed.id ? completed : item) }
        : {}
    ));
  } catch (error) {
    const failed: ChatMessage = {
      ...placeholder,
      status: 'failed',
      error: errorMessage(error),
      updatedAt: nextTimestamp(),
    };
    await saveChatMessage(failed).catch(() => undefined);
    useQaStore.setState(state => (
      state.activeConversationId === conversationId
        ? {
            messages: state.messages.map(item => item.id === failed.id ? failed : item),
            error: failed.error ?? null,
          }
        : {}
    ));
  } finally {
    removeRequestOwner(conversationId);
  }
}

async function retryStoredMessage(
  assistant: ChatMessage,
  config: ModelConfig,
  answerer?: QaAnswerer,
): Promise<void> {
  if (assistant.role !== 'assistant' || !['failed', 'interrupted'].includes(assistant.status)) {
    throw new Error('只能重试失败或中断的回答');
  }
  const storedMessages = await listChatMessages(assistant.conversationId);
  const assistantIndex = storedMessages.findIndex(item => item.id === assistant.id);
  const precedingMessages = assistantIndex >= 0 ? storedMessages.slice(0, assistantIndex) : storedMessages;
  const userMessage = [...precedingMessages].reverse().find(item => item.role === 'user');
  if (!userMessage) throw new Error('找不到原始问题');
  await generateAnswer({
    conversationId: assistant.conversationId,
    userMessage,
    config,
    answerer,
    retryOfMessageId: assistant.id,
  });
}

export const useQaStore = create<QaState>((set, get) => ({
  conversations: [],
  messages: [],
  activeConversationId: null,
  selectedCitation: null,
  initialized: false,
  loadingConversation: false,
  activeRequestConversationIds: [],
  error: null,

  initialize: async () => {
    const epoch = ++selectionEpoch;
    set({ loadingConversation: true, error: null });
    try {
      await interruptPendingChatMessages();
      const conversations = await listChatConversations();
      const savedId = readActiveConversationId();
      const activeConversationId = conversations.some(item => item.id === savedId)
        ? savedId
        : conversations[0]?.id ?? null;
      const messages = activeConversationId ? await listChatMessages(activeConversationId) : [];
      if (epoch !== selectionEpoch) return;
      persistActiveConversationId(activeConversationId);
      set({
        conversations,
        messages,
        activeConversationId,
        selectedCitation: null,
        initialized: true,
        loadingConversation: false,
      });
    } catch (error) {
      if (epoch !== selectionEpoch) return;
      set({
        initialized: true,
        loadingConversation: false,
        error: errorMessage(error),
      });
    }
  },

  startNewChat: () => {
    selectionEpoch += 1;
    persistActiveConversationId(null);
    set({
      activeConversationId: null,
      messages: [],
      selectedCitation: null,
      loadingConversation: false,
      error: null,
    });
  },

  selectConversation: async id => {
    const conversation = get().conversations.find(item => item.id === id);
    if (!conversation) return;
    const epoch = ++selectionEpoch;
    const opened = { ...conversation, lastOpenedAt: nextTimestamp() };
    persistActiveConversationId(id);
    set(state => ({
      activeConversationId: id,
      selectedCitation: null,
      loadingConversation: true,
      error: null,
      conversations: state.conversations.map(item => item.id === id ? opened : item),
    }));
    try {
      await saveChatConversation(opened);
      const messages = await listChatMessages(id);
      if (epoch !== selectionEpoch || get().activeConversationId !== id) return;
      set({ messages, loadingConversation: false });
    } catch (error) {
      if (epoch !== selectionEpoch || get().activeConversationId !== id) return;
      set({ loadingConversation: false, error: errorMessage(error) });
    }
  },

  renameConversation: async (id, title) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('标题不能为空');
    const conversation = get().conversations.find(item => item.id === id);
    if (!conversation) throw new Error('聊天不存在');
    const updated = { ...conversation, title: normalizedTitle, updatedAt: nextTimestamp() };
    await saveChatConversation(updated);
    set(state => ({
      conversations: sortConversations(state.conversations.map(item => item.id === id ? updated : item)),
    }));
  },

  deleteConversation: async id => {
    const deletingActive = get().activeConversationId === id;
    if (deletingActive) selectionEpoch += 1;
    await deleteChatConversation(id);
    const conversations = await listChatConversations();
    if (!deletingActive) {
      set({ conversations });
      return;
    }
    const activeConversationId = conversations[0]?.id ?? null;
    const messages = activeConversationId ? await listChatMessages(activeConversationId) : [];
    persistActiveConversationId(activeConversationId);
    set({
      conversations,
      messages,
      activeConversationId,
      selectedCitation: null,
      loadingConversation: false,
      error: null,
    });
  },

  sendQuestion: async input => {
    if (input.retryOfMessageId) {
      const existing = get().messages.find(item => item.id === input.retryOfMessageId);
      if (!existing) throw new Error('找不到需要重试的回答');
      await retryStoredMessage(existing, input.config, input.answerer);
      return;
    }

    const question = input.question.trim();
    if (!question) throw new Error('问题不能为空');
    let conversationId = get().activeConversationId;
    let conversation = conversationId
      ? get().conversations.find(item => item.id === conversationId)
      : undefined;
    if (!conversationId || !conversation) {
      const now = nextTimestamp();
      conversationId = createId('conversation');
      conversation = {
        id: conversationId,
        title: createConversationTitle(question),
        courseIds: [],
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      };
      selectionEpoch += 1;
      persistActiveConversationId(conversationId);
      set(state => ({
        conversations: sortConversations([conversation!, ...state.conversations]),
        activeConversationId: conversationId,
        messages: [],
        selectedCitation: null,
        initialized: true,
        error: null,
      }));
      await saveChatConversation(conversation);
    }

    const userTime = nextTimestamp();
    const userMessage: ChatMessage = {
      id: createId('user'),
      conversationId,
      role: 'user',
      content: question,
      status: 'completed',
      createdAt: userTime,
      updatedAt: userTime,
    };
    if (get().activeConversationId === conversationId) {
      set(state => ({ messages: [...state.messages, userMessage], error: null }));
    }
    await saveChatMessage(userMessage);
    await generateAnswer({
      conversationId,
      userMessage,
      config: input.config,
      answerer: input.answerer,
    });
  },

  retryMessage: async (messageId, config, answerer) => {
    const assistant = get().messages.find(item => item.id === messageId);
    if (!assistant) throw new Error('找不到需要重试的回答');
    await retryStoredMessage(assistant, config, answerer);
  },

  openCitation: citation => set({ selectedCitation: citation }),
  closeCitation: () => set({ selectedCitation: null }),
}));
