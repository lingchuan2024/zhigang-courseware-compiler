import { useState } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { AppShell } from './AppShell';

export function LibraryView() {
  const courses = useLibraryStore(state => state.courses);
  const documents = useLibraryStore(state => state.documents);
  const activeCourseId = useLibraryStore(state => state.activeCourseId);
  const createCourse = useLibraryStore(state => state.createCourse);
  const openCourse = useLibraryStore(state => state.openCourse);
  const openDocument = useLibraryStore(state => state.openDocument);
  const startNewDocument = useLibraryStore(state => state.startNewDocument);
  const deleteDocument = useLibraryStore(state => state.deleteDocument);
  const deleteCourse = useLibraryStore(state => state.deleteCourse);
  const navigate = useLibraryStore(state => state.navigate);
  const error = useLibraryStore(state => state.error);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'document'; id: string; title: string }
    | { kind: 'course'; id: string; title: string; documentCount: number }
    | null
  >(null);
  const activeCourse = courses.find(course => course.id === activeCourseId) ?? null;
  const courseDocuments = documents.filter(document => document.courseId === activeCourseId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await createCourse(name);
    setName('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'document') await deleteDocument(deleteTarget.id);
      else await deleteCourse(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell
      onHome={() => navigate('home')}
      action={<button type="button" onClick={() => navigate('home')} className="text-sm text-ink/70 hover:text-ink">← 返回首页</button>}
      backdrop="library"
    >
      <main className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl md:grid-cols-[280px_1fr]">
        <aside className="border-r border-space-border bg-space-900 p-5 md:p-7">
          <div className="flex items-center justify-between">
            <h1 className="font-song text-2xl font-bold text-ink">课程空间</h1>
            <span className="font-mono text-xs text-space-muted">{courses.length}</span>
          </div>
          <form onSubmit={submit} className="mt-6 space-y-2">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="例如：机器学习"
              className="config-input rounded-xl"
            />
            <button type="submit" className="btn-primary w-full rounded-xl">创建课程</button>
          </form>
          <div className="mt-7 space-y-2">
            {courses.map(course => (
              <button
                type="button"
                key={course.id}
                onClick={() => void openCourse(course.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${course.id === activeCourseId ? 'border-celadon/35 bg-celadon/10 text-space-text shadow-[0_12px_30px_rgba(0,0,0,.18)]' : 'border-transparent text-ink-light hover:border-space-border hover:bg-space-850'}`}
              >
                <div className="font-song font-bold">{course.name}</div>
                <div className={`mt-1 text-xs ${course.id === activeCourseId ? 'text-celadon/65' : 'text-space-muted'}`}>{course.documentIds.length} 份课件</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="p-6 md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-space-border pb-6">
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-cinnabar">COURSEWARE LIBRARY</p>
              <h2 className="mt-2 font-song text-3xl font-bold text-ink">课程与课件</h2>
              <p className="mt-2 text-sm text-space-muted">{activeCourse ? `${activeCourse.name} · 独立保存每份课件的解析与知识产物` : '先创建一个课程空间'}</p>
            </div>
            <div className="flex items-center gap-2">
              {activeCourse && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ kind: 'course', id: activeCourse.id, title: activeCourse.name, documentCount: courseDocuments.length })}
                  className="btn-danger rounded-xl px-4 py-3"
                >
                  删除课程
                </button>
              )}
              <button
                type="button"
                disabled={!activeCourseId}
                onClick={() => startNewDocument()}
                className="btn-primary rounded-xl px-5 py-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ＋ 添加课件
              </button>
            </div>
          </div>

          {error && <div className="mt-5 rounded-xl border border-cinnabar/20 bg-cinnabar/5 p-4 text-sm text-cinnabar">{error}</div>}

          {!activeCourse ? (
            <div className="grid min-h-[420px] place-items-center text-center text-space-muted">创建课程空间后，可以连续添加多份 PDF 或 PPTX。</div>
          ) : courseDocuments.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-space-border-strong bg-space-900/50 px-8 py-20 text-center">
              <p className="font-song text-xl font-bold text-ink">这个课程空间还没有课件</p>
              <p className="mt-2 text-sm text-space-muted">添加第一份 PDF 或 PPTX，处理结果会作为独立课件保存。</p>
            </div>
          ) : (
            <div className="mt-7 grid gap-4 lg:grid-cols-2">
              {courseDocuments.map(document => (
                <article key={document.id} className="group relative rounded-2xl border border-space-border bg-space-850 transition hover:-translate-y-0.5 hover:border-celadon/45 hover:shadow-[0_18px_38px_rgba(0,0,0,.28)]">
                  <button type="button" onClick={() => void openDocument(document.id)} className="w-full p-5 text-left">
                    <div className="flex items-start justify-between gap-4 pr-16">
                      <div>
                        <span className="rounded-md border border-space-border bg-space-900 px-2 py-1 font-mono text-[10px] uppercase text-space-muted">{document.fileType}</span>
                        <h3 className="mt-4 font-song text-xl font-bold text-ink group-hover:text-ink-light">{document.title}</h3>
                        <p className="mt-1 text-xs text-space-muted">{document.fileName}</p>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${document.status === 'ready' ? 'bg-celadon' : document.status === 'failed' ? 'bg-cinnabar' : 'bg-amber-400'}`} />
                    </div>
                    <div className="mt-6 flex items-center gap-4 border-t border-space-border pt-4 text-xs text-space-muted">
                      <span>{document.pageCount} 页</span>
                      <span>{document.cardCount ?? 0} 张卡片</span>
                      <span className="ml-auto">{document.stage}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ kind: 'document', id: document.id, title: document.title })}
                    className="absolute right-4 top-4 rounded-lg border border-transparent px-2.5 py-1.5 text-xs text-space-muted hover:border-cinnabar/30 hover:bg-cinnabar/10 hover:text-cinnabar-light"
                  >
                    删除课件
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
          <section className="w-full max-w-lg rounded-2xl border border-space-border-strong bg-space-850 p-6 shadow-2xl">
            <p className="font-mono text-[11px] tracking-[0.18em] text-cinnabar">DESTRUCTIVE ACTION</p>
            <h2 className="mt-3 font-song text-2xl font-bold text-ink">
              {deleteTarget.kind === 'document' ? `删除课件“${deleteTarget.title}”？` : `删除整个课程空间“${deleteTarget.title}”？`}
            </h2>
            {deleteTarget.kind === 'document' ? (
              <p className="mt-4 text-sm leading-7 text-ink-light">此操作会同时删除 MinerU 解析、知识结构、知识卡片、完整笔记和检索索引，且无法撤销。</p>
            ) : (
              <p className="mt-4 text-sm leading-7 text-ink-light">该课程包含 {deleteTarget.documentCount} 份课件。删除后，全部课件及其 MinerU 解析、知识网络、卡片、笔记和索引都会被清理；聊天历史仍会保留。</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} className="btn-outline rounded-xl px-4 py-2.5 disabled:opacity-50">取消</button>
              <button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="rounded-xl border border-cinnabar/50 bg-cinnabar px-4 py-2.5 text-sm font-medium text-white hover:bg-cinnabar-light disabled:opacity-50">
                {deleting ? '正在删除…' : deleteTarget.kind === 'document' ? '确认删除课件' : '确认删除课程'}
              </button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
