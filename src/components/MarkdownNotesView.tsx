import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { KnowledgeTopic, TopicNote } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { resolveSourceRanges } from '../lib/source-range-resolver';

function orderedTopics(topics: KnowledgeTopic[], orderedIds: string[]): KnowledgeTopic[] {
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  const ordered = orderedIds.map(id => byId.get(id)).filter((topic): topic is KnowledgeTopic => Boolean(topic));
  const seen = new Set(ordered.map(topic => topic.id));
  return [...ordered, ...topics.filter(topic => !seen.has(topic.id))];
}

function fallbackMarkdown(topic: KnowledgeTopic, sourceText: string): string {
  const sections = [
    `## ${topic.name}`,
    topic.summary,
    topic.learningObjective ? `**学习目标：** ${topic.learningObjective}` : '',
    sourceText ? `### 课件原文\n\n${sourceText}` : '',
  ].filter(Boolean);
  return sections.join('\n\n');
}

export function MarkdownNotesView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const documents = useStore(state => state.sourceDocuments);
  const topics = useStore(state => state.knowledgeTopics);
  const notes = useStore(state => state.topicNotes);
  const learningPath = useStore(state => state.courseLearningPath);
  const modelConfig = useStore(state => state.modelConfig);
  const navigateToStage = useStore(state => state.navigateToStage);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);

  const sequence = useMemo(
    () => orderedTopics(topics, learningPath?.orderedTopicIds ?? []),
    [learningPath?.orderedTopicIds, topics],
  );
  const noteMap = useMemo(() => new Map(notes.map(note => [note.topicId, note])), [notes]);
  const activeTopic = sequence.find(topic => topic.id === activeTopicId) ?? sequence[0] ?? null;
  const activeNote: TopicNote | null = activeTopic ? noteMap.get(activeTopic.id) ?? null : null;
  const sourceText = useMemo(() => {
    if (!activeTopic) return '';
    return resolveSourceRanges(activeTopic.sourceRanges, documents)
      .flatMap(source => source.blocks.map(block => block.content))
      .join('\n\n');
  }, [activeTopic, documents]);
  const content = activeTopic
    ? activeNote?.markdown.trim() || fallbackMarkdown(activeTopic, sourceText)
    : '';

  const exportMarkdown = () => {
    const body = sequence.map(topic => noteMap.get(topic.id)?.markdown.trim() || fallbackMarkdown(topic, '')).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${documents[0]?.title || '课程'}-学习笔记.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950 text-space-text">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/95 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('structure')} className="grid h-9 w-9 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text" aria-label="返回知识结构">←</button>
          <button type="button" onClick={() => setDirectoryOpen(value => !value)} className="grid h-9 w-9 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text" aria-label="切换笔记目录">☰</button>
          <div className="min-w-0">
            <h1 className="truncate font-song text-xl font-bold text-space-text">{documents[0]?.title || '课程学习笔记'}</h1>
            <p className="mt-0.5 text-xs text-space-muted">{notes.length}/{topics.length} 个知识点已生成笔记</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!modelConfig?.apiKey && notes.length === 0 && (
            <button type="button" onClick={onOpenSettings} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">配置 AI 模型</button>
          )}
          <button type="button" onClick={exportMarkdown} disabled={sequence.length === 0} className="btn-outline disabled:opacity-40">导出 Markdown</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {directoryOpen && (
          <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900 p-3">
            <p className="px-3 pb-2 pt-1 text-[11px] font-semibold tracking-[0.16em] text-space-faint">学习顺序</p>
            <nav className="space-y-1">
              {sequence.map((topic, index) => {
                const active = topic.id === activeTopic?.id;
                const complete = Boolean(noteMap.get(topic.id)?.markdown.trim());
                return (
                  <button key={topic.id} type="button" onClick={() => setActiveTopicId(topic.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${active ? 'bg-celadon/12 text-space-text ring-1 ring-celadon/25' : 'text-space-muted hover:bg-space-750 hover:text-space-text'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${active ? 'bg-celadon text-space-950' : 'bg-space-750 text-space-muted'}`}>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-5">{topic.name}</p>
                        <p className={`mt-1 text-[11px] ${active ? 'text-space-muted' : complete ? 'text-celadon' : 'text-amber-400'}`}>{complete ? '已生成' : '原文降级预览'}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {activeTopic ? (
            <article className="mx-auto max-w-4xl px-10 py-10">
              <div className="mb-7 border-b border-space-border pb-6">
                <div className="mb-3 flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-celadon/10 px-2.5 py-1 text-celadon ring-1 ring-celadon/20">{activeTopic.knowledgeGenre}</span>
                  <span className="rounded-full bg-space-750 px-2.5 py-1 text-space-muted ring-1 ring-space-border">难度 {activeTopic.difficulty}/5</span>
                  {!activeNote?.markdown.trim() && <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-amber-300">当前显示原文降级笔记</span>}
                </div>
                <h2 className="font-song text-3xl font-bold leading-tight text-space-text">{activeTopic.name}</h2>
                <p className="mt-3 text-sm leading-7 text-space-muted">{activeTopic.learningObjective}</p>
              </div>
              <div className="rounded-2xl border border-space-border bg-space-850 px-8 py-7 shadow-nebula-panel">
                <MarkdownRenderer content={content} className="text-[15px] leading-8" />
              </div>
            </article>
          ) : (
            <div className="grid h-full place-items-center text-sm text-space-muted">暂无可显示的知识点</div>
          )}
        </main>
      </div>
    </div>
  );
}
