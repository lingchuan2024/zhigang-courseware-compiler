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
import * as repository from '../lib/library-repository';
import {
  createCitationSnapshots,
  createConversationTitle,
  selectChatContext,
} from '../lib/qa-conversation-context';

const ACTIVE_CONVERSATION_KEY = 'zhigang_qa_active_conversation';
const activeGenerations = new Map<string, symbol>();
const invalidatedGenerations = new Map<string, symbol>();
const settledCancelledGenerations = new Set<symbol>();
interface GenerationRuntime {
  conversationId: string;
  assistantMessageId?: string;
  assistantMessage?: ChatMessage;
  releaseRequested: boolean;
}
const generationRuntimes = new Map<symbol, GenerationRuntime>();
const deletedConversationIds = new Set<string>();
const deletionStates = new Map<string, 'pending' | 'succeeded' | 'failed'>();
let provisionalConversationReservation: symbol | null = null;
let selectionEpoch = 0;
let lastTimestamp = 0;

class GenerationCancelledError extends Error {}

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

function reserveGeneration(conversationId: string): symbol {
  if (activeGenerations.has(conversationId)) {
    throw new Error('当前聊天正在生成回答');
  }
  if (deletedConversationIds.has(conversationId)) {
    throw new Error('聊天已被删除');
  }
  const token = Symbol(conversationId);
  activeGenerations.set(conversationId, token);
  generationRuntimes.set(token, { conversationId, releaseRequested: false });
  useQaStore.setState(state => ({
    activeRequestConversationIds: state.activeRequestConversationIds.includes(conversationId)
      ? state.activeRequestConversationIds
      : [...state.activeRequestConversationIds, conversationId],
  }));
  return token;
}

function reserveProvisionalConversation(): symbol {
  if (provisionalConversationReservation) {
    throw new Error('新聊天正在创建，请稍后再试');
  }
  const token = Symbol('provisional-conversation');
  provisionalConversationReservation = token;
  return token;
}

function releaseProvisionalConversation(token: symbol | null): void {
  if (token && provisionalConversationReservation === token) {
    provisionalConversationReservation = null;
  }
}

function cleanupDeletionGuard(conversationId: string): void {
  const state = deletionStates.get(conversationId);
  if (invalidatedGenerations.has(conversationId) || state === 'pending') return;
  deletedConversationIds.delete(conversationId);
  deletionStates.delete(conversationId);
}

function finalizeInvalidatedGeneration(conversationId: string, token: symbol): void {
  const runtime = generationRuntimes.get(token);
  if (!runtime?.releaseRequested || !settledCancelledGenerations.has(token)) return;
  if (invalidatedGenerations.get(conversationId) !== token) return;
  invalidatedGenerations.delete(conversationId);
  settledCancelledGenerations.delete(token);
  generationRuntimes.delete(token);
  cleanupDeletionGuard(conversationId);
}

function settleSuccessfulDeletionIfGenerationFinished(conversationId: string): void {
  const token = invalidatedGenerations.get(conversationId);
  if (!token || !generationRuntimes.get(token)?.releaseRequested) return;
  settledCancelledGenerations.add(token);
  finalizeInvalidatedGeneration(conversationId, token);
}

function releaseGeneration(conversationId: string, token: symbol): void {
  const runtime = generationRuntimes.get(token);
  if (runtime) runtime.releaseRequested = true;
  if (activeGenerations.get(conversationId) === token) {
    activeGenerations.delete(conversationId);
    generationRuntimes.delete(token);
  } else if (invalidatedGenerations.get(conversationId) === token) {
    const deletionState = deletionStates.get(conversationId);
    if (!runtime?.assistantMessageId && deletionState === 'failed') {
      settledCancelledGenerations.add(token);
    }
    if (deletionState === 'pending' || !settledCancelledGenerations.has(token)) return;
    finalizeInvalidatedGeneration(conversationId, token);
  } else {
    generationRuntimes.delete(token);
    return;
  }
  if (activeGenerations.has(conversationId)) return;
  useQaStore.setState(state => ({
    activeRequestConversationIds: state.activeRequestConversationIds.filter(id => id !== conversationId),
  }));
}

function assertGenerationActive(conversationId: string, token: symbol): void {
  if (
    deletedConversationIds.has(conversationId) ||
    activeGenerations.get(conversationId) !== token
  ) {
    throw new GenerationCancelledError();
  }
}

function invalidateConversation(conversationId: string): void {
  deletedConversationIds.add(conversationId);
  deletionStates.set(conversationId, 'pending');
  const token = activeGenerations.get(conversationId);
  if (token) invalidatedGenerations.set(conversationId, token);
  activeGenerations.delete(conversationId);
  useQaStore.setState(state => ({
    activeRequestConversationIds: state.activeRequestConversationIds.filter(id => id !== conversationId),
  }));
}

/** Clears module-scoped async ownership after tests or a hot-module replacement. */
export function resetQaStoreRuntimeForTests(): void {
  activeGenerations.clear();
  invalidatedGenerations.clear();
  settledCancelledGenerations.clear();
  generationRuntimes.clear();
  deletedConversationIds.clear();
  deletionStates.clear();
  provisionalConversationReservation = null;
  selectionEpoch = 0;
  lastTimestamp = 0;
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
  token: symbol;
  config: ModelConfig;
  answerer?: QaAnswerer;
  retryOfMessageId?: string;
}

async function refreshOwningConversation(conversationId: string, token: symbol): Promise<void> {
  assertGenerationActive(conversationId, token);
  const current = useQaStore.getState().conversations.find(item => item.id === conversationId);
  if (!current) return;
  const updated = { ...current, updatedAt: nextTimestamp() };
  await repository.saveChatConversation(updated);
  assertGenerationActive(conversationId, token);
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

async function reconcileCancelledAssistant(
  conversationId: string,
  token: symbol,
  allowCreateMissing: boolean,
): Promise<void> {
  if (invalidatedGenerations.get(conversationId) !== token) return;
  const deletionState = deletionStates.get(conversationId);
  if (deletionState === 'succeeded') {
    await repository.deleteChatConversation(conversationId);
    settledCancelledGenerations.add(token);
    return;
  }
  if (deletionState !== 'failed') return;
  const runtime = generationRuntimes.get(token);
  if (!runtime?.assistantMessageId) return;
  const exact = (await repository.listChatMessages(conversationId))
    .find(item => item.id === runtime.assistantMessageId);
  if (!exact && (!allowCreateMissing || !runtime.assistantMessage)) return;
  const terminal = exact?.status === 'pending' || !exact
    ? {
        ...(exact ?? runtime.assistantMessage!),
        status: 'interrupted' as const,
        error: '删除聊天失败，回答生成已中断',
        updatedAt: nextTimestamp(),
      }
    : exact;
  if (terminal.status === 'interrupted' && exact?.status !== 'interrupted') {
    await repository.saveChatMessage(terminal);
  } else if (!exact) {
    await repository.saveChatMessage(terminal);
  }
  settledCancelledGenerations.add(token);
  useQaStore.setState(state => {
    if (state.activeConversationId !== conversationId) return {};
    const exists = state.messages.some(item => item.id === terminal.id);
    return {
      messages: exists
        ? state.messages.map(item => item.id === terminal.id ? terminal : item)
        : [...state.messages, terminal],
    };
  });
  finalizeInvalidatedGeneration(conversationId, token);
}

async function generateAnswer(input: GenerationInput): Promise<void> {
  const { conversationId, userMessage, token, config, retryOfMessageId } = input;
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
  const runtime = generationRuntimes.get(token);
  if (runtime) {
    runtime.assistantMessageId = placeholder.id;
    runtime.assistantMessage = placeholder;
  }

  let completed: ChatMessage;
  try {
    assertGenerationActive(conversationId, token);
    await repository.saveChatMessage(placeholder);
    assertGenerationActive(conversationId, token);
    if (useQaStore.getState().activeConversationId === conversationId) {
      useQaStore.setState(state => ({ messages: [...state.messages, placeholder], error: null }));
    }

    const storedMessages = await repository.listChatMessages(conversationId);
    assertGenerationActive(conversationId, token);
    const history = selectChatContext(completedHistoryBefore(storedMessages, userMessage.id));
    const owningConversation = useQaStore.getState().conversations.find(item => item.id === conversationId)
      ?? (await repository.listChatConversations()).find(item => item.id === conversationId);
    assertGenerationActive(conversationId, token);
    if (!owningConversation) throw new GenerationCancelledError();
    const courseIds = owningConversation.courseIds;
    const [records, courses, documents] = await Promise.all([
      repository.listRetrievalRecords(courseIds.length > 0 ? { courseIds } : undefined),
      repository.listLibraryCourses(),
      repository.listLibraryDocuments(),
    ]);
    assertGenerationActive(conversationId, token);
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
    assertGenerationActive(conversationId, token);
    const cardIds = answer.sections.flatMap(section => section.cardIds);
    completed = {
      ...placeholder,
      content: answerContent(answer),
      status: 'completed',
      answer,
      citations: createCitationSnapshots(cardIds, hits, courses, documents),
      error: undefined,
      updatedAt: nextTimestamp(),
    };
    const completedRuntime = generationRuntimes.get(token);
    if (completedRuntime) completedRuntime.assistantMessage = completed;
    await repository.saveChatMessage(completed);
    assertGenerationActive(conversationId, token);
    useQaStore.setState(state => (
      state.activeConversationId === conversationId
        ? { messages: state.messages.map(item => item.id === completed.id ? completed : item) }
        : {}
    ));
  } catch (error) {
    if (
      error instanceof GenerationCancelledError ||
      invalidatedGenerations.get(conversationId) === token
    ) {
      try {
        await reconcileCancelledAssistant(conversationId, token, true);
      } catch (settleError) {
        useQaStore.setState(state => (
          state.activeConversationId === conversationId
            ? { error: `中断回答失败：${errorMessage(settleError)}` }
            : {}
        ));
      }
      return;
    }
    const failed: ChatMessage = {
      ...placeholder,
      status: 'failed',
      error: errorMessage(error),
      updatedAt: nextTimestamp(),
    };
    if (activeGenerations.get(conversationId) !== token || deletedConversationIds.has(conversationId)) return;
    await repository.saveChatMessage(failed).catch(() => undefined);
    useQaStore.setState(state => (
      state.activeConversationId === conversationId
        ? {
            messages: state.messages.map(item => item.id === failed.id ? failed : item),
            error: failed.error ?? null,
          }
        : {}
    ));
    return;
  }

  try {
    await refreshOwningConversation(conversationId, token);
  } catch (error) {
    if (error instanceof GenerationCancelledError) return;
    useQaStore.setState(state => (
      state.activeConversationId === conversationId
        ? { error: `回答已保存，但聊天时间更新失败：${errorMessage(error)}` }
        : {}
    ));
  }
}

async function interruptPendingGenerationAfterDeleteFailure(conversationId: string): Promise<void> {
  const messages = await repository.listChatMessages(conversationId);
  const now = nextTimestamp();
  const interruptedById = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role !== 'assistant' || message.status !== 'pending') continue;
    const interrupted: ChatMessage = {
      ...message,
      status: 'interrupted',
      error: '删除聊天失败，回答生成已中断',
      updatedAt: now,
    };
    await repository.saveChatMessage(interrupted);
    interruptedById.set(interrupted.id, interrupted);
  }
  if (interruptedById.size === 0) return;
  useQaStore.setState(state => (
    state.activeConversationId === conversationId
      ? {
          messages: state.messages.map(item => interruptedById.get(item.id) ?? item),
        }
      : {}
  ));
}

async function retryStoredMessage(
  assistant: ChatMessage,
  config: ModelConfig,
  answerer?: QaAnswerer,
): Promise<void> {
  if (assistant.role !== 'assistant' || !['failed', 'interrupted'].includes(assistant.status)) {
    throw new Error('只能重试失败或中断的回答');
  }
  const storedMessages = await repository.listChatMessages(assistant.conversationId);
  const messagesById = new Map(storedMessages.map(item => [item.id, item]));
  let originalAssistant = messagesById.get(assistant.id);
  if (!originalAssistant) throw new Error('重试消息已不存在');
  const visited = new Set<string>();
  while (originalAssistant.retryOfMessageId) {
    if (visited.has(originalAssistant.id)) throw new Error('重试链已损坏');
    visited.add(originalAssistant.id);
    const parent = messagesById.get(originalAssistant.retryOfMessageId);
    if (!parent || parent.role !== 'assistant') throw new Error('重试链已损坏');
    originalAssistant = parent;
  }
  const assistantIndex = storedMessages.findIndex(item => item.id === originalAssistant.id);
  if (assistantIndex < 0) throw new Error('重试消息已不存在');
  const precedingMessages = storedMessages.slice(0, assistantIndex);
  const userMessage = [...precedingMessages].reverse().find(item => item.role === 'user');
  if (!userMessage) throw new Error('找不到原始问题');
  const token = reserveGeneration(assistant.conversationId);
  try {
    await generateAnswer({
      conversationId: assistant.conversationId,
      userMessage,
      token,
      config,
      answerer,
      retryOfMessageId: assistant.id,
    });
  } finally {
    releaseGeneration(assistant.conversationId, token);
  }
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
    if (get().initialized) return;
    const epoch = ++selectionEpoch;
    set({ loadingConversation: true, error: null });
    try {
      await repository.interruptPendingChatMessages();
      const conversations = await repository.listChatConversations();
      const savedId = readActiveConversationId();
      const activeConversationId = conversations.some(item => item.id === savedId)
        ? savedId
        : conversations[0]?.id ?? null;
      const messages = activeConversationId ? await repository.listChatMessages(activeConversationId) : [];
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
      messages: [],
      error: null,
      conversations: state.conversations.map(item => item.id === id ? opened : item),
    }));
    try {
      await repository.saveChatConversation(opened);
      const messages = await repository.listChatMessages(id);
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
    await repository.saveChatConversation(updated);
    set(state => ({
      conversations: sortConversations(state.conversations.map(item => item.id === id ? updated : item)),
    }));
  },

  deleteConversation: async id => {
    const deletingActive = get().activeConversationId === id;
    const deleteEpoch = deletingActive ? ++selectionEpoch : selectionEpoch;
    invalidateConversation(id);
    let cascadeSucceeded = false;
    let refreshedConversations: ChatConversation[] | null = null;
    try {
      await repository.deleteChatConversation(id);
      cascadeSucceeded = true;
      deletionStates.set(id, 'succeeded');
      settleSuccessfulDeletionIfGenerationFinished(id);
      refreshedConversations = await repository.listChatConversations();
      const conversations = refreshedConversations;
      const selectionUnchanged = deletingActive
        && selectionEpoch === deleteEpoch
        && get().activeConversationId === id;
      if (!selectionUnchanged) {
        set({ conversations });
        cleanupDeletionGuard(id);
        return;
      }
      const activeConversationId = conversations[0]?.id ?? null;
      const messages = activeConversationId ? await repository.listChatMessages(activeConversationId) : [];
      if (selectionEpoch !== deleteEpoch || get().activeConversationId !== id) {
        set({ conversations });
        return;
      }
      persistActiveConversationId(activeConversationId);
      set({
        conversations,
        messages,
        activeConversationId,
        selectedCitation: null,
        loadingConversation: false,
        error: null,
      });
      cleanupDeletionGuard(id);
    } catch (error) {
      if (cascadeSucceeded) {
        deletionStates.set(id, 'succeeded');
        const activeWasDeleted = get().activeConversationId === id;
        if (activeWasDeleted) persistActiveConversationId(null);
        set(state => ({
          conversations: refreshedConversations ?? state.conversations.filter(item => item.id !== id),
          ...(activeWasDeleted ? {
            activeConversationId: null,
            messages: [],
            selectedCitation: null,
            loadingConversation: false,
          } : {}),
          error: `聊天已删除，但刷新列表失败：${errorMessage(error)}`,
        }));
        cleanupDeletionGuard(id);
        return;
      }

      deletionStates.set(id, 'failed');
      let interruptionError: string | null = null;
      try {
        const invalidatedToken = invalidatedGenerations.get(id);
        if (invalidatedToken) {
          await reconcileCancelledAssistant(id, invalidatedToken, false);
        } else {
          await interruptPendingGenerationAfterDeleteFailure(id);
        }
      } catch (interruptError) {
        interruptionError = errorMessage(interruptError);
      }
      cleanupDeletionGuard(id);
      set({
        error: interruptionError
          ? `删除聊天失败：${errorMessage(error)}；中断回答失败：${interruptionError}`
          : `删除聊天失败：${errorMessage(error)}`,
      });
      throw error;
    }
  },

  sendQuestion: async input => {
    if (get().loadingConversation) throw new Error('聊天正在加载，请稍后再试');
    if (input.retryOfMessageId) {
      const existing = get().messages.find(item => item.id === input.retryOfMessageId);
      if (!existing) throw new Error('重试消息已不存在');
      await retryStoredMessage(existing, input.config, input.answerer);
      return;
    }

    const question = input.question.trim();
    if (!question) throw new Error('问题不能为空');
    const selectionAtStart = selectionEpoch;
    let conversationId = get().activeConversationId;
    let conversation = conversationId
      ? get().conversations.find(item => item.id === conversationId)
      : undefined;
    const isNewConversation = !conversationId || !conversation;
    const provisionalReservation = isNewConversation ? reserveProvisionalConversation() : null;
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
    }

    let token: symbol;
    try {
      token = reserveGeneration(conversationId);
    } catch (error) {
      releaseProvisionalConversation(provisionalReservation);
      throw error;
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
    let newConversationPersisted = false;
    try {
      if (isNewConversation) {
        await repository.saveChatConversation(conversation);
        newConversationPersisted = true;
        assertGenerationActive(conversationId, token);
      }
      await repository.saveChatMessage(userMessage);
      assertGenerationActive(conversationId, token);

      if (isNewConversation) {
        const shouldActivate = selectionEpoch === selectionAtStart && get().activeConversationId === null;
        if (shouldActivate) {
          selectionEpoch += 1;
          persistActiveConversationId(conversationId);
        }
        set(state => ({
          conversations: sortConversations([
            conversation,
            ...state.conversations.filter(item => item.id !== conversationId),
          ]),
          ...(shouldActivate ? {
            activeConversationId: conversationId,
            messages: [userMessage],
            selectedCitation: null,
          } : {}),
          initialized: true,
          error: null,
        }));
      } else if (get().activeConversationId === conversationId) {
        set(state => ({ messages: [...state.messages, userMessage], error: null }));
      }
      releaseProvisionalConversation(provisionalReservation);

      await generateAnswer({
        conversationId,
        userMessage,
        token,
        config: input.config,
        answerer: input.answerer,
      });
    } catch (error) {
      if (error instanceof GenerationCancelledError) return;
      if (isNewConversation && newConversationPersisted) {
        await repository.deleteChatConversation(conversationId).catch(() => undefined);
      }
      set({ error: `保存问题失败：${errorMessage(error)}` });
      throw error;
    } finally {
      releaseProvisionalConversation(provisionalReservation);
      releaseGeneration(conversationId, token);
    }
  },

  retryMessage: async (messageId, config, answerer) => {
    const assistant = get().messages.find(item => item.id === messageId);
    if (!assistant) throw new Error('重试消息已不存在');
    await retryStoredMessage(assistant, config, answerer);
  },

  openCitation: citation => set({ selectedCitation: citation }),
  closeCitation: () => set({ selectedCitation: null }),
}));
