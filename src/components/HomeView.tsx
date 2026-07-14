import { useLibraryStore } from '../store/useLibraryStore';
import { AppShell } from './AppShell';

interface HomeViewProps {
  onOpenSettings: () => void;
}

export function HomeView({ onOpenSettings }: HomeViewProps) {
  const courses = useLibraryStore(state => state.courses);
  const documents = useLibraryStore(state => state.documents);
  const navigate = useLibraryStore(state => state.navigate);
  const cardCount = documents.reduce((total, document) => total + (document.cardCount ?? 0), 0);

  return (
    <AppShell
      onHome={() => navigate('home')}
      action={<button type="button" onClick={onOpenSettings} className="text-sm text-ink/70 hover:text-ink">服务配置</button>}
    >
      <main className="relative overflow-hidden px-6 pb-16 pt-14 md:px-12 md:pt-20">
        <div className="pointer-events-none absolute -right-28 top-10 h-80 w-80 rounded-full border border-celadon/20 bg-celadon/5" />
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
            <section>
              <p className="mb-5 font-mono text-xs tracking-[0.24em] text-cinnabar">COURSE KNOWLEDGE STUDIO</p>
              <h1 className="max-w-3xl font-song text-5xl font-bold leading-[1.12] text-ink md:text-7xl">
                从课件到知识网络，<br />再到真正可学的笔记。
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-8 text-stone-600 md:text-lg">
                在一个课程空间中整理多份 PDF 与 PPTX，建立相互独立的两层知识网，并让所有知识卡片成为可检索、可追溯的课程记忆。
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button type="button" onClick={() => navigate('library')} className="rounded-xl bg-ink px-6 py-3 text-sm font-medium text-white shadow-[0_10px_30px_rgba(23,63,53,.18)] hover:bg-ink-light">进入课件库</button>
                <button type="button" onClick={() => navigate('qa')} className="rounded-xl border border-ink/25 bg-white/60 px-6 py-3 text-sm font-medium text-ink hover:border-ink/50 hover:bg-white">全库知识问答</button>
              </div>
            </section>

            <aside className="border-l border-[#d8cdbd] pl-7">
              <p className="font-song text-lg font-bold text-ink">知识库概览</p>
              <div className="mt-6 grid grid-cols-3 gap-3 lg:grid-cols-1">
                {[
                  ['课程空间', courses.length],
                  ['已收录课件', documents.length],
                  ['知识卡片', cardCount],
                ].map(([label, value]) => (
                  <div key={String(label)} className="border-t border-[#d8cdbd] py-4">
                    <div className="font-song text-3xl font-bold text-ink">{value}</div>
                    <div className="mt-1 text-xs tracking-wider text-stone-500">{label}</div>
                  </div>
                ))}
              </div>
            </aside>
          </div>

          <section className="mt-20 grid gap-4 md:grid-cols-3">
            {[
              ['01', '多课件归档', '同一课程下保留每份课件的独立来源与处理状态。'],
              ['02', '两层知识网络', '课程主题与知识内部结构分开浏览，边界始终清楚。'],
              ['03', '卡片索引问答', '先检索课程知识卡片，再给出可点击、可回溯的回答。'],
            ].map(([number, title, description]) => (
              <article key={number} className="rounded-2xl border border-[#ded5c7] bg-[#faf7f0] p-6">
                <span className="font-mono text-xs text-cinnabar">{number}</span>
                <h2 className="mt-8 font-song text-xl font-bold text-ink">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-600">{description}</p>
              </article>
            ))}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
