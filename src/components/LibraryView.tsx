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
  const navigate = useLibraryStore(state => state.navigate);
  const error = useLibraryStore(state => state.error);
  const [name, setName] = useState('');
  const activeCourse = courses.find(course => course.id === activeCourseId) ?? null;
  const courseDocuments = documents.filter(document => document.courseId === activeCourseId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await createCourse(name);
    setName('');
  };

  return (
    <AppShell
      onHome={() => navigate('home')}
      action={<button type="button" onClick={() => navigate('home')} className="text-sm text-ink/70 hover:text-ink">← 返回首页</button>}
    >
      <main className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl md:grid-cols-[280px_1fr]">
        <aside className="border-r border-[#ddd3c5] bg-[#eee7db] p-5 md:p-7">
          <div className="flex items-center justify-between">
            <h1 className="font-song text-2xl font-bold text-ink">课程空间</h1>
            <span className="font-mono text-xs text-stone-400">{courses.length}</span>
          </div>
          <form onSubmit={submit} className="mt-6 space-y-2">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="例如：机器学习"
              className="w-full rounded-xl border border-[#d5cab9] bg-[#faf7f0] px-3 py-2.5 text-sm outline-none focus:border-celadon"
            />
            <button type="submit" className="w-full rounded-xl bg-ink px-3 py-2.5 text-sm text-white hover:bg-ink-light">创建课程</button>
          </form>
          <div className="mt-7 space-y-2">
            {courses.map(course => (
              <button
                type="button"
                key={course.id}
                onClick={() => void openCourse(course.id)}
                className={`w-full rounded-xl px-4 py-3 text-left transition ${course.id === activeCourseId ? 'bg-ink text-white shadow-lg' : 'text-ink hover:bg-white/60'}`}
              >
                <div className="font-song font-bold">{course.name}</div>
                <div className={`mt-1 text-xs ${course.id === activeCourseId ? 'text-white/55' : 'text-stone-500'}`}>{course.documentIds.length} 份课件</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="p-6 md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#ddd3c5] pb-6">
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-cinnabar">COURSEWARE LIBRARY</p>
              <h2 className="mt-2 font-song text-3xl font-bold text-ink">课程与课件</h2>
              <p className="mt-2 text-sm text-stone-500">{activeCourse ? `${activeCourse.name} · 独立保存每份课件的解析与知识产物` : '先创建一个课程空间'}</p>
            </div>
            <button
              type="button"
              disabled={!activeCourseId}
              onClick={() => startNewDocument()}
              className="rounded-xl bg-celadon px-5 py-3 text-sm font-medium text-white hover:bg-celadon-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              ＋ 添加课件
            </button>
          </div>

          {error && <div className="mt-5 rounded-xl border border-cinnabar/20 bg-cinnabar/5 p-4 text-sm text-cinnabar">{error}</div>}

          {!activeCourse ? (
            <div className="grid min-h-[420px] place-items-center text-center text-stone-500">创建课程空间后，可以连续添加多份 PDF 或 PPTX。</div>
          ) : courseDocuments.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-[#cfc3b2] bg-white/35 px-8 py-20 text-center">
              <p className="font-song text-xl font-bold text-ink">这个课程空间还没有课件</p>
              <p className="mt-2 text-sm text-stone-500">添加第一份 PDF 或 PPTX，处理结果会作为独立课件保存。</p>
            </div>
          ) : (
            <div className="mt-7 grid gap-4 lg:grid-cols-2">
              {courseDocuments.map(document => (
                <button
                  type="button"
                  key={document.id}
                  onClick={() => void openDocument(document.id)}
                  className="group rounded-2xl border border-[#ded5c7] bg-[#faf8f3] p-5 text-left transition hover:-translate-y-0.5 hover:border-celadon/50 hover:shadow-[0_12px_30px_rgba(23,63,53,.09)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="rounded-md bg-[#ebe5da] px-2 py-1 font-mono text-[10px] uppercase text-stone-500">{document.fileType}</span>
                      <h3 className="mt-4 font-song text-xl font-bold text-ink group-hover:text-ink-light">{document.title}</h3>
                      <p className="mt-1 text-xs text-stone-400">{document.fileName}</p>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${document.status === 'ready' ? 'bg-celadon' : document.status === 'failed' ? 'bg-cinnabar' : 'bg-amber-400'}`} />
                  </div>
                  <div className="mt-6 flex items-center gap-4 border-t border-[#e5ddd1] pt-4 text-xs text-stone-500">
                    <span>{document.pageCount} 页</span>
                    <span>{document.cardCount ?? 0} 张卡片</span>
                    <span className="ml-auto">{document.stage}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
