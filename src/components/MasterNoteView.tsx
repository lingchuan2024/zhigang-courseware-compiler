import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { planFallbackChapters } from '../lib/course-master-note';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ChapterNote, ChapterPlanItem } from '../types';

function chapterStateLabel(chapter: ChapterNote | undefined): string {
  if (!chapter) return '待生成';
  if (chapter.status === 'completed' && chapter.markdown.trim()) return '已完成';
  if (chapter.status === 'generating') return '生成中';
  if (chapter.status === 'failed') return '生成失败';
  return '待生成';
}

function outlineMarkdown(plan: ChapterPlanItem[]): string {
  return [
    '## 课程框架',
    ...plan.flatMap((chapter, index) => [
      `### ${index + 1}. ${chapter.title}`,
      chapter.objective,
      ...chapter.framework.map(item => `- ${item}`),
    ]),
  ].filter(Boolean).join('\n\n');
}

function coursePreamble(title: string, plan: ChapterPlanItem[]): string {
  const chapterNames = plan.map(chapter => `“${chapter.title}”`).join('、');
  return [
    `# ${title}`,
    '## 课程概述',
    chapterNames
      ? `本课程围绕${chapterNames}展开。建议先把握下面的课程框架，再沿各章内部的二级知识顺序理解概念、方法与推导。`
      : '本课程的章节内容尚未完成规划。',
    outlineMarkdown(plan),
  ].join('\n\n');
}

export function MasterNoteView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const topics = useStore(state => state.knowledgeTopics);
  const cards = useStore(state => state.knowledgeCards);
  const learningPath = useStore(state => state.courseLearningPath);
  const modelConfig = useStore(state => state.modelConfig);
  const chapterPlan = useStore(state => state.chapterPlan);
  const chapterNotes = useStore(state => state.chapterNotes);
  const masterNote = useStore(state => state.courseMasterNote);
  const jobStatus = useStore(state => state.jobStatus);
  const progress = useStore(state => state.pipelineProgress);
  const navigateToStage = useStore(state => state.navigateToStage);
  const startGeneration = useStore(state => state.startMasterNoteGeneration);
  const retryChapter = useStore(state => state.retryChapterNote);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const fallbackPlan = useMemo(
    () => planFallbackChapters(topics, learningPath?.orderedTopicIds ?? topics.map(topic => topic.id)),
    [learningPath?.orderedTopicIds, topics],
  );
  const plan = chapterPlan.length > 0 ? chapterPlan : masterNote?.outline.length ? masterNote.outline : fallbackPlan;
  const noteById = useMemo(() => new Map(chapterNotes.map(chapter => [chapter.id, chapter])), [chapterNotes]);
  const chapters = plan.map(item => noteById.get(item.id) ?? masterNote?.chapters.find(chapter => chapter.id === item.id));
  const activePlan = plan.find(item => item.id === activeChapterId) ?? plan[0] ?? null;
  const activeChapter = activePlan
    ? noteById.get(activePlan.id) ?? masterNote?.chapters.find(chapter => chapter.id === activePlan.id)
    : undefined;
  const usableMaster = Boolean(masterNote?.markdown.trim());
  const generatedCount = chapters.filter(chapter => chapter?.status === 'completed' && chapter.markdown.trim()).length;
  const isRunning = jobStatus === 'running';
  const estimatedProgress = progress.estimatedProgress ?? 0;
  const isPartial = usableMaster && masterNote?.status === 'partial';
  const activeCards = activeChapter
    ? cards.filter(card => activeChapter.sourceCardIds.includes(card.id))
    : [];

  const jumpToChapter = (chapterId: string) => {
    setActiveChapterId(chapterId);
    const target = document.getElementById(`note-${chapterId}`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (!usableMaster || typeof IntersectionObserver === 'undefined') return;
    const sections = plan
      .map(chapter => document.getElementById(`note-${chapter.id}`))
      .filter((section): section is HTMLElement => Boolean(section));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target instanceof HTMLElement) {
        setActiveChapterId(visible.target.dataset.chapterId ?? null);
      }
    }, { rootMargin: '-15% 0px -65% 0px', threshold: [0.05, 0.25, 0.5] });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [plan, usableMaster]);

  const exportMarkdown = () => {
    if (!usableMaster || !masterNote) return;
    const url = URL.createObjectURL(new Blob([masterNote.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${masterNote.title || '课程'}-完整笔记.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950/[0.82] text-space-text">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/[0.97] px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('cards')} className="grid h-9 w-9 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text" aria-label="返回知识卡片">←</button>
          <button type="button" onClick={() => setDirectoryOpen(value => !value)} className="grid h-9 w-9 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text" aria-label="切换章节目录">☰</button>
          <div className="min-w-0">
            <h1 className="truncate font-song text-xl font-bold text-space-text">完整笔记</h1>
            <p className="mt-0.5 text-xs text-space-muted">
              {usableMaster ? `已完成 ${generatedCount}/${plan.length} 章` : '先确认课程框架，再按章生成并组装'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!modelConfig?.apiKey && <button type="button" onClick={onOpenSettings} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">配置 AI 模型</button>}
          {!usableMaster && !isRunning && (
            <button type="button" onClick={() => void startGeneration()} className="btn-primary">生成完整笔记</button>
          )}
          {usableMaster && (
            <>
              {!isRunning && masterNote?.status !== 'completed' && (
                <button type="button" onClick={() => void startGeneration()} className="btn-primary">续跑未完成章节</button>
              )}
              <button type="button" onClick={() => setEvidenceOpen(true)} className="btn-outline">查看本章依据</button>
              <button type="button" onClick={exportMarkdown} className="btn-outline">导出 Markdown</button>
            </>
          )}
        </div>
      </header>

      {isRunning && (
        <div className="border-b border-celadon/20 bg-celadon/5 px-5 py-3 text-sm text-celadon">
          <div className="flex items-center justify-between gap-4">
            <span>{progress.message || '正在生成完整笔记'}</span>
            <span className="font-mono text-xs">{Math.round(estimatedProgress)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-space-750"><div className="h-full rounded-full bg-celadon transition-all" style={{ width: `${Math.max(3, estimatedProgress)}%` }} /></div>
        </div>
      )}

      {isPartial && (
        <div className="border-b border-amber-400/20 bg-amber-400/10 px-5 py-2.5 text-xs text-amber-300">部分章节生成失败，已完成内容会保留；可在左侧选择失败章节单独重试。</div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {directoryOpen && (
          <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.96] p-3 backdrop-blur-xl">
            <p className="px-3 pb-2 pt-1 text-[11px] font-semibold tracking-[0.16em] text-space-faint">课程框架</p>
            <nav className="space-y-1">
              {plan.map((chapter, index) => {
                const note = noteById.get(chapter.id) ?? masterNote?.chapters.find(item => item.id === chapter.id);
                const active = chapter.id === activePlan?.id;
                return (
                  <button key={chapter.id} type="button" onClick={() => jumpToChapter(chapter.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${active ? 'bg-celadon/12 text-space-text ring-1 ring-celadon/25' : 'text-space-muted hover:bg-space-750 hover:text-space-text'}`}>
                    <div className="flex gap-3">
                      <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${active ? 'bg-celadon text-space-950' : 'bg-space-750 text-space-muted'}`}>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-5">{chapter.title}</p>
                        <p className={`mt-1 text-[11px] ${note?.status === 'failed' ? 'text-red-400' : active ? 'text-space-muted' : 'text-space-faint'}`}>
                          {chapterStateLabel(note)}
                          {note?.status === 'completed' && note.sourceCardIds.length > 0 && (
                            <span className="ml-1.5 text-space-faint">· 引用 {note.sourceCardIds.length} 张卡片</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
          <article className="mx-auto max-w-4xl">
            {!usableMaster && !isRunning && (
              <div className="mb-5 rounded-2xl border border-celadon/20 bg-celadon/5 p-5">
                <h2 className="font-song text-xl font-bold text-space-text">尚未生成完整笔记</h2>
                <p className="mt-2 text-sm leading-6 text-space-muted">下面是根据两层知识结构和学习顺序形成的固定课程框架。完整正文由知识卡片可靠组装，AI 只补充简短导语与过渡；每章完成后会立即保存并显示。</p>
              </div>
            )}
            {!usableMaster ? (
              <div className="rounded-2xl border border-space-border bg-space-850 px-8 py-7 shadow-nebula-panel">
                <MarkdownRenderer content={outlineMarkdown(plan)} className="text-[15px] leading-8" />
              </div>
            ) : (
              <div className="space-y-6">
                <section className="rounded-2xl border border-space-border bg-space-850 px-8 py-7 shadow-nebula-panel">
                  <MarkdownRenderer content={coursePreamble(masterNote?.title || '课程', plan)} className="text-[15px] leading-8" />
                </section>
                {chapters.map((chapter, index) => {
                  const chapterPlan = plan[index];
                  if (!chapterPlan) return null;
                  return (
                    <section
                      id={`note-${chapterPlan.id}`}
                      data-chapter-id={chapterPlan.id}
                      key={chapterPlan.id}
                      className="scroll-mt-6 rounded-2xl border border-space-border bg-space-850 px-8 py-7 shadow-nebula-panel"
                    >
                      {chapter?.status === 'completed' && chapter.markdown.trim() ? (
                        <MarkdownRenderer content={chapter.markdown} className="text-[15px] leading-8" />
                      ) : chapter?.status === 'failed' ? (
                        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-5">
                          <h2 className="font-song text-xl font-bold text-red-300">{chapterPlan.title}生成失败</h2>
                          <p className="mt-2 text-sm text-red-300/85">{chapter.error || '模型没有返回有效正文'}</p>
                          <button type="button" disabled={isRunning} onClick={() => void retryChapter(chapterPlan.id)} className="btn-primary mt-4 disabled:opacity-50">重试本章</button>
                        </div>
                      ) : (
                        <div className="text-sm text-space-muted">{chapterPlan.title}尚未生成。</div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </article>
        </main>

        {evidenceOpen && (
          <div className="absolute inset-0 z-20 flex justify-end bg-space-950/70 backdrop-blur-sm" onClick={() => setEvidenceOpen(false)}>
            <aside className="h-full w-80 overflow-y-auto border-l border-space-border bg-space-900 p-4 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-space-text">本章依据</h2>
                <button type="button" onClick={() => setEvidenceOpen(false)} aria-label="关闭本章依据" className="grid h-8 w-8 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text">×</button>
              </div>
              <p className="mt-1 text-xs leading-5 text-space-faint">当前阅读章节使用的知识卡片；原始证据仍保留在卡片页。</p>
              <div className="mt-4 space-y-3">
                {activeCards.length > 0 ? activeCards.map(item => (
                  <section key={item.id} className="rounded-xl border border-space-border bg-space-850 p-4">
                    <p className="text-xs font-semibold text-celadon">{item.topicName}</p>
                    <h3 className="mt-1 text-sm font-medium text-space-text">{item.title}</h3>
                    <p className="mt-2 text-xs leading-6 text-space-muted">{item.conciseSummary}</p>
                  </section>
                )) : (
                  <div className="rounded-xl border border-dashed border-space-border p-4 text-xs leading-6 text-space-faint">
                    {activeChapter?.status === 'failed' ? '本章尚未成功绑定知识卡片。' : '当前章节没有可显示的知识卡片。'}
                  </div>
                )}
              </div>
              {masterNote && (
                <div className="mt-5 rounded-xl bg-space-750 p-4 text-xs text-space-muted">
                  卡片覆盖 {masterNote.coverage.coveredCardIds.length}/{masterNote.coverage.totalCardIds.length}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
