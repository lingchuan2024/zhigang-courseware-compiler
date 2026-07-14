import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { listRetrievalRecords } from '../lib/library-repository';
import { useLibraryStore } from '../store/useLibraryStore';
import { useQaStore, type QaAnswerer } from '../store/useQaStore';
import { useStore } from '../store/useStore';
import type { ChatCitationSnapshot, ChatConversation, ChatMessage, RetrievalRecord } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

export type KnowledgeQaAnswerer = QaAnswerer;

interface KnowledgeQaViewProps {
  onOpenSettings: () => void;
  answerer?: QaAnswerer;
}

interface ConversationGroup {
  label: string;
  conversations: ChatConversation[];
}

/** Groups already-sorted conversations without mutating them. */
function groupConversationsByDate(
  conversations: ChatConversation[],
  now = Date.now(),
): ConversationGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const buckets: Array<ConversationGroup & { test: (timestamp: number) => boolean }> = [
    { label: '今天', conversations: [], test: timestamp => timestamp >= today.getTime() },
    { label: '昨天', conversations: [], test: timestamp => timestamp >= today.getTime() - day },
    { label: '更早', conversations: [], test: () => true },
  ];

  for (const conversation of conversations) {
    buckets.find(bucket => bucket.test(conversation.updatedAt))!.conversations.push(conversation);
  }
  return buckets
    .filter(bucket => bucket.conversations.length > 0)
    .map(({ label, conversations: items }) => ({ label, conversations: items }));
}

function messageSections(message: ChatMessage) {
  if (message.answer?.sections.length) return message.answer.sections;
  return message.content
    ? [{ source: 'general' as const, content: message.content, cardIds: [] }]
    : [];
}

function IconDots() {
  return <span aria-hidden="true" className="tracking-[2px]">···</span>;
}

export function KnowledgeQaView({ onOpenSettings, answerer }: KnowledgeQaViewProps) {
  const modelConfig = useStore(state => state.modelConfig);
  const openDocument = useLibraryStore(state => state.openDocument);
  const {
    conversations,
    messages,
    activeConversationId,
    selectedCitation,
    initialized,
    loadingConversation,
    activeRequestConversationIds,
    error,
    initialize,
    startNewChat,
    selectConversation,
    renameConversation,
    deleteConversation,
    sendQuestion,
    retryMessage,
    openCitation,
    closeCitation,
  } = useQaStore();

  const [draft, setDraft] = useState('');
  const [records, setRecords] = useState<RetrievalRecord[]>([]);
  const [recordsStatus, setRecordsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordsValidatedFor, setRecordsValidatedFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const draftRevisionRef = useRef(0);
  const recordsLoadedOnMountRef = useRef(false);
  const citationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!initialized) void initialize();
  }, [initialize, initialized]);

  const selectedCitationKey = selectedCitation
    ? `${selectedCitation.cardId}:${selectedCitation.documentId}`
    : '__library__';
  useEffect(() => {
    if (!selectedCitation && recordsLoadedOnMountRef.current) return;
    recordsLoadedOnMountRef.current = true;
    let active = true;
    setRecordsStatus('loading');
    setRecordsError(null);
    setRecordsValidatedFor(null);
    void listRetrievalRecords()
      .then(nextRecords => {
        if (!active) return;
        setRecords(nextRecords);
        setRecordsStatus('ready');
        setRecordsValidatedFor(selectedCitationKey);
      })
      .catch(caught => {
        if (!active) return;
        setRecordsStatus('error');
        setRecordsError(caught instanceof Error ? caught.message : String(caught));
        setRecordsValidatedFor(selectedCitationKey);
      });
    return () => { active = false; };
  }, [selectedCitation, selectedCitationKey]);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background) return;
    if (selectedCitation) background.setAttribute('inert', '');
    else background.removeAttribute('inert');
  }, [selectedCitation]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [messages],
  );
  const conversationGroups = useMemo(() => groupConversationsByDate(conversations), [conversations]);
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
  const activeInFlight = activeConversationId !== null
    && activeRequestConversationIds.includes(activeConversationId);
  const sendDisabled = !draft.trim() || loadingConversation || activeInFlight;

  const lastMessage = orderedMessages[orderedMessages.length - 1];
  const lastMessageScrollKey = lastMessage
    ? `${lastMessage.id}:${lastMessage.status}:${lastMessage.updatedAt}`
    : `empty:${activeConversationId ?? 'draft'}`;
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !nearBottomRef.current) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [lastMessageScrollKey, activeConversationId]);

  const reportActionError = (caught: unknown) => {
    setActionError(caught instanceof Error ? caught.message : String(caught));
  };

  const submitQuestion = async () => {
    const submittedDraft = draft;
    const question = draft.trim();
    if (!question || loadingConversation || activeInFlight) return;
    if (!modelConfig?.apiKey) {
      onOpenSettings();
      return;
    }
    const submittedRevision = draftRevisionRef.current;
    setActionError(null);
    try {
      await sendQuestion({ config: modelConfig, question, answerer });
      if (draftRevisionRef.current === submittedRevision) {
        draftRevisionRef.current += 1;
        setDraft(currentDraft => currentDraft === submittedDraft ? '' : currentDraft);
      }
    } catch (caught) {
      reportActionError(caught);
    }
  };

  const clearDraftForNavigation = () => {
    draftRevisionRef.current += 1;
    setDraft('');
  };

  const closeCitationDrawer = () => {
    const background = backgroundRef.current;
    background?.removeAttribute('inert');
    background?.removeAttribute('aria-hidden');
    const trigger = citationTriggerRef.current;
    closeCitation();
    const restoreFocus = () => {
      if (trigger?.isConnected) trigger.focus();
    };
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(restoreFocus);
    } else {
      globalThis.setTimeout(restoreFocus, 0);
    }
  };

  const saveRename = async (id: string) => {
    if (renamingId !== id) return;
    const nextTitle = renameDraft.trim();
    setRenamingId(null);
    if (!nextTitle) return;
    try {
      await renameConversation(id, nextTitle);
    } catch (caught) {
      reportActionError(caught);
    }
  };

  const requestDelete = async (id: string) => {
    if (!globalThis.confirm('确定删除这个聊天及其全部消息吗？')) return;
    try {
      await deleteConversation(id);
    } catch (caught) {
      reportActionError(caught);
    }
  };

  const retry = async (messageId: string) => {
    if (!modelConfig?.apiKey) {
      onOpenSettings();
      return;
    }
    setActionError(null);
    try {
      await retryMessage(messageId, modelConfig, answerer);
    } catch (caught) {
      reportActionError(caught);
    }
  };

  const exactRecord = selectedCitation
    ? records.find(record => (
      record.cardId === selectedCitation.cardId
      && record.documentId === selectedCitation.documentId
    )) ?? null
    : null;
  const citationRecordsStatus = recordsValidatedFor === selectedCitationKey
    ? recordsStatus
    : 'loading';

  return (
    <div className="relative h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-[#f5f0e7]">
    <div
      ref={backgroundRef}
      data-testid="qa-two-column-layout"
      aria-hidden={selectedCitation ? true : undefined}
      className="grid h-[calc(100dvh-4rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[#f5f0e7] text-ink md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-1"
    >
      <aside className="z-10 flex max-h-[220px] min-h-0 flex-col border-b border-[#d8cebf] bg-[#eae2d5] md:max-h-none md:border-b-0 md:border-r">
        <div className="border-b border-[#d8cebf] p-4 md:p-5">
          <button
            type="button"
            onClick={() => {
              nearBottomRef.current = true;
              clearDraftForNavigation();
              startNewChat();
            }}
            className="w-full rounded-xl border border-ink/20 bg-[#faf7f0] px-4 py-3 text-left font-song text-sm font-bold text-ink shadow-[0_2px_0_rgba(29,65,56,0.08)] transition hover:-translate-y-px hover:border-celadon/70 hover:bg-white"
          >
            <span className="mr-2 text-cinnabar">＋</span>新建聊天
          </button>
        </div>

        <nav aria-label="聊天历史" className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3 md:overflow-x-hidden md:overflow-y-auto md:p-4">
          {conversationGroups.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-6 text-stone-500">尚无历史聊天，第一个问题将自动创建。</p>
          ) : (
            <div className="flex gap-3 md:block md:space-y-5">
              {conversationGroups.map(group => (
                <section key={group.label} className="min-w-[210px] md:min-w-0">
                  <h2 className="mb-2 px-2 font-mono text-[10px] tracking-[0.16em] text-stone-400">{group.label}</h2>
                  <div className="space-y-1.5">
                    {group.conversations.map(conversation => {
                      const active = conversation.id === activeConversationId;
                      const renaming = conversation.id === renamingId;
                      return (
                        <div
                          key={conversation.id}
                          className={`group relative rounded-xl border transition ${active ? 'border-celadon/25 bg-celadon/10' : 'border-transparent hover:border-[#d8cebf] hover:bg-[#f4eee4]'}`}
                        >
                          {renaming ? (
                            <input
                              autoFocus
                              data-rename-input={conversation.id}
                              value={renameDraft}
                              onChange={event => setRenameDraft(event.target.value)}
                              onBlur={() => { void saveRename(conversation.id); }}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveRename(conversation.id);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setRenamingId(null);
                                }
                              }}
                              aria-label="重命名聊天"
                              className="m-1.5 w-[calc(100%-0.75rem)] rounded-lg border border-celadon bg-white px-2.5 py-2 text-xs outline-none ring-2 ring-celadon/10"
                            />
                          ) : (
                            <button
                              type="button"
                              data-conversation-id={conversation.id}
                              onClick={() => {
                                if (active) return;
                                nearBottomRef.current = true;
                                clearDraftForNavigation();
                                void selectConversation(conversation.id).catch(reportActionError);
                              }}
                              className="w-full truncate px-3 py-3 pr-16 text-left text-sm text-stone-700"
                              aria-current={active ? 'page' : undefined}
                            >
                              {conversation.title}
                            </button>
                          )}
                          {!renaming && (
                            <div className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center rounded-lg bg-inherit ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
                              <button
                                type="button"
                                data-rename-conversation={conversation.id}
                                aria-label={`重命名 ${conversation.title}`}
                                onClick={() => {
                                  setRenameDraft(conversation.title);
                                  setRenamingId(conversation.id);
                                }}
                                className="grid h-8 w-7 place-items-center text-xs text-stone-500 hover:text-ink"
                              >
                                <IconDots />
                              </button>
                              <button
                                type="button"
                                data-delete-conversation={conversation.id}
                                aria-label={`删除 ${conversation.title}`}
                                onClick={() => { void requestDelete(conversation.id); }}
                                className="grid h-8 w-7 place-items-center text-base text-stone-400 hover:text-cinnabar"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </nav>

        <div className="hidden border-t border-[#d8cebf] px-5 py-4 text-[11px] leading-5 text-stone-500 md:block">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-celadon" />
          聊天保存在本机 · 默认全部课件
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.86),transparent_42%)]">
        <header className="flex items-center justify-between border-b border-[#ded5c8] bg-[#faf7f1]/90 px-5 py-4 backdrop-blur md:px-8">
          <div>
            <p className="font-mono text-[9px] tracking-[0.22em] text-cinnabar">KNOWLEDGE CARD CHAT</p>
            <h1 data-testid="qa-chat-title" className="mt-1 max-w-[52vw] truncate font-song text-xl font-bold text-ink">
              {activeConversation?.title ?? '全库知识问答'}
            </h1>
          </div>
          <span className="rounded-full border border-celadon/20 bg-celadon/5 px-3 py-1.5 text-xs text-ink">全部课件</span>
        </header>

        <div
          data-testid="qa-timeline"
          ref={timelineRef}
          onScroll={event => {
            const element = event.currentTarget;
            nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-10"
        >
          {!initialized || loadingConversation ? (
            <div className="mx-auto mt-16 max-w-xl text-center text-sm text-stone-500">正在打开聊天…</div>
          ) : orderedMessages.length === 0 ? (
            <div className="mx-auto mt-[8vh] max-w-xl text-center">
              <div className="mx-auto grid h-16 w-16 rotate-3 place-items-center rounded-[22px] border border-celadon/20 bg-[#edf3ef] font-song text-2xl font-bold text-ink shadow-[5px_5px_0_rgba(183,77,58,0.09)]">问</div>
              <h2 className="mt-7 font-song text-2xl font-bold text-ink">从全部课件知识卡片开始提问</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-stone-500">我会沿着知识网检索相关卡片，并保留可追溯的课件索引。</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-7">
              {orderedMessages.map(message => (
                <article key={message.id} className={message.role === 'user' ? 'flex justify-end' : ''}>
                  {message.role === 'user' ? (
                    <div className="max-w-[88%] whitespace-pre-wrap rounded-[20px] rounded-tr-[5px] bg-ink px-5 py-3.5 text-sm leading-7 text-[#fffdf8] shadow-sm md:max-w-[76%]">
                      {message.content}
                    </div>
                  ) : (
                    <div className="w-full border-l-2 border-celadon/35 pl-4 md:pl-6">
                      {message.status === 'pending' && (
                        <div role="status" aria-live="polite" className="flex items-center gap-3 py-3 text-sm text-stone-500">
                          <span className="inline-flex gap-1" aria-hidden="true">
                            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cinnabar" />
                            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cinnabar [animation-delay:150ms]" />
                            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cinnabar [animation-delay:300ms]" />
                          </span>
                          正在检索知识卡片并组织回答…
                        </div>
                      )}

                      {message.status === 'completed' && messageSections(message).map((section, index) => (
                        <section key={`${message.id}-${index}`} className={index > 0 ? 'mt-6 border-t border-[#e2d9cd] pt-6' : ''}>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${section.source === 'cards' ? 'bg-celadon/10 text-ink' : 'bg-amber-100 text-amber-800'}`}>
                            {section.source === 'cards' ? '基于知识卡片' : 'AI 通用回答'}
                          </span>
                          <MarkdownRenderer content={section.content} className="mt-3 text-[15px] leading-8 text-stone-700" />
                        </section>
                      ))}

                      {(message.status === 'failed' || message.status === 'interrupted') && (
                        <div className="rounded-2xl border border-cinnabar/20 bg-cinnabar/5 p-4">
                          <p className="font-song text-base font-bold text-cinnabar">回答未完成</p>
                          <p className="mt-1 text-sm leading-6 text-stone-600">{message.error ?? '本次生成已中断'}</p>
                          <button
                            type="button"
                            onClick={() => { void retry(message.id); }}
                            disabled={activeInFlight}
                            className="mt-3 rounded-lg border border-cinnabar/25 bg-white px-3 py-2 text-xs font-medium text-cinnabar hover:bg-cinnabar hover:text-white disabled:opacity-40"
                          >
                            重新生成
                          </button>
                        </div>
                      )}

                      {message.citations && message.citations.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2 border-t border-[#e2d9cd] pt-4">
                          {message.citations.map((citation, index) => (
                            <button
                              type="button"
                              key={`${citation.cardId}-${citation.documentId}-${index}`}
                              data-card-id={citation.cardId}
                              onClick={event => {
                                citationTriggerRef.current = event.currentTarget;
                                openCitation(citation);
                              }}
                              className="rounded-lg border border-celadon/25 bg-[#fbf9f4] px-3 py-2 text-left text-xs text-ink transition hover:-translate-y-px hover:border-celadon hover:bg-white"
                            >
                              <span className="mr-1.5 font-mono text-[10px] text-cinnabar">[{index + 1}]</span>
                              {citation.courseName} / {citation.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {(actionError || error) && (
            <div role="alert" className="mx-auto mt-6 max-w-3xl rounded-xl border border-cinnabar/20 bg-[#fff8f5] px-4 py-3 text-sm text-cinnabar">
              {actionError || error}
            </div>
          )}
        </div>

        <div className="border-t border-[#ded5c8] bg-[#faf7f1]/95 p-3 md:px-8 md:py-5">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-[#d5cab9] bg-white p-2 shadow-[0_8px_28px_rgba(48,42,34,0.07)] focus-within:border-celadon focus-within:ring-2 focus-within:ring-celadon/10">
              <textarea
                value={draft}
                onChange={event => {
                  draftRevisionRef.current += 1;
                  setDraft(event.target.value);
                }}
                onKeyDown={event => {
                  const nativeEvent = event.nativeEvent;
                  const composing = nativeEvent.isComposing
                    || nativeEvent.keyCode === 229
                    || nativeEvent.which === 229;
                  if (event.key === 'Enter' && !event.shiftKey && !composing) {
                    event.preventDefault();
                    void submitQuestion();
                  }
                }}
                rows={1}
                placeholder="询问全部课件中的知识…"
                className="max-h-36 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-stone-700 outline-none placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => { void submitQuestion(); }}
                disabled={sendDisabled}
                aria-label="发送消息"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-lg text-white transition hover:bg-ink-light disabled:cursor-not-allowed disabled:opacity-30"
              >
                ↑
              </button>
            </div>
            <p className="mt-2 text-center font-mono text-[9px] tracking-wide text-stone-400">ENTER 发送 · SHIFT + ENTER 换行</p>
          </div>
        </div>
      </main>

    </div>

      {selectedCitation && (
        <CitationDrawer
          citation={selectedCitation}
          record={citationRecordsStatus === 'ready' ? exactRecord : null}
          recordsStatus={citationRecordsStatus}
          recordsError={recordsError}
          onClose={closeCitationDrawer}
          onOpenDocument={() => { void openDocument(selectedCitation.documentId); }}
        />
      )}
    </div>
  );
}

interface CitationDrawerProps {
  citation: ChatCitationSnapshot;
  record: RetrievalRecord | null;
  recordsStatus: 'loading' | 'ready' | 'error';
  recordsError: string | null;
  onClose: () => void;
  onOpenDocument: () => void;
}

function CitationDrawer({
  citation,
  record,
  recordsStatus,
  recordsError,
  onClose,
  onOpenDocument,
}: CitationDrawerProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const displayingSnapshot = recordsStatus === 'ready' && !record;
  const content = record?.content ?? citation.content;
  const sourceExcerpt = record?.sourceExcerpt ?? citation.sourceExcerpt;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        ref={dialogRef}
        data-testid="citation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="citation-drawer-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l border-[#d8cebf] bg-[#faf7f0] shadow-[-18px_0_55px_rgba(29,65,56,0.14)]"
      >
        <header className="flex items-start justify-between border-b border-[#ded5c8] px-6 py-5">
          <div className="min-w-0 pr-4">
            <p className="font-mono text-[9px] tracking-[0.2em] text-cinnabar">CITATION SNAPSHOT</p>
            <h2 id="citation-drawer-title" className="mt-1 font-song text-xl font-bold text-ink">知识卡片索引</h2>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="关闭引用详情"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d8cebf] text-xl text-stone-500 hover:border-ink hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {recordsStatus === 'loading' && (
            <div role="status" className="mb-5 rounded-xl border border-celadon/20 bg-celadon/5 px-3 py-2.5 text-xs leading-5 text-stone-600">
              正在核对最新知识卡片…
            </div>
          )}
          {displayingSnapshot && (
            <div className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
              卡片已更新或不可用，显示历史引用
            </div>
          )}
          {recordsStatus === 'error' && (
            <div className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
              暂时无法核对最新卡片，显示历史引用
              {recordsError ? <span className="mt-1 block text-amber-700">{recordsError}</span> : null}
            </div>
          )}
          <p className="text-xs leading-5 text-stone-400">{citation.courseName} · {citation.documentTitle}</p>
          <h3 className="mt-3 font-song text-2xl font-bold leading-tight text-ink">{record?.title ?? citation.title}</h3>
          <div className="mt-5 rounded-2xl border border-[#ded5c8] bg-white p-5 shadow-sm">
            <MarkdownRenderer content={content} className="text-sm leading-7 text-stone-700" />
          </div>
          {sourceExcerpt && (
            <section className="mt-6 border-t border-[#ded5c8] pt-5">
              <p className="font-mono text-[9px] tracking-[0.18em] text-cinnabar">SOURCE EXCERPT</p>
              <h4 className="mt-1 font-song text-base font-bold text-ink">课件原文摘要</h4>
              <MarkdownRenderer content={sourceExcerpt} className="mt-3 text-xs leading-6 text-stone-600" />
            </section>
          )}
        </div>

        <div className="border-t border-[#ded5c8] p-5">
          <button
            type="button"
            onClick={onOpenDocument}
            className="w-full rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-ink-light"
          >
            打开对应课件
          </button>
        </div>
      </aside>
    </div>
  );
}
