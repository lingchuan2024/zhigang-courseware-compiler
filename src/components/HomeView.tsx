import { useLibraryStore } from '../store/useLibraryStore';
import { KnowledgeNebulaBackground } from './nebula/KnowledgeNebulaBackground';
import { ProjectMark } from './nebula/ProjectMark';

interface HomeViewProps {
  onOpenSettings: () => void;
}

export function HomeView({ onOpenSettings }: HomeViewProps) {
  const nebulaSummaries = useLibraryStore(state => state.nebulaSummaries);
  const navigate = useLibraryStore(state => state.navigate);
  const openCourse = useLibraryStore(state => state.openCourse);
  const hasKnowledge = nebulaSummaries.some(summary => summary.knowledgeCount > 0);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#010207] text-[#edf7fc]">
      <KnowledgeNebulaBackground
        summaries={nebulaSummaries}
        onCourseOpen={courseId => void openCourse(courseId)}
      />

      <ProjectMark />

      <button
        type="button"
        onClick={onOpenSettings}
        className="absolute right-6 top-6 z-40 rounded-full border border-white/10 bg-[#040914]/55 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#7890a3] backdrop-blur-xl transition hover:border-[#6fd7e8]/35 hover:text-[#dff8fc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8] md:right-10 md:top-8"
      >
        服务配置
      </button>

      {hasKnowledge ? (
        <section className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-24 pt-36 md:px-10 md:pb-14 lg:w-[55rem] lg:bg-[linear-gradient(90deg,rgba(1,2,7,.82)_0%,rgba(1,2,7,.46)_58%,transparent_100%)] lg:pr-36">
          <div className="pointer-events-auto max-w-2xl">
            <p className="mb-4 font-mono text-[10px] tracking-[0.32em] text-[#63bfce] md:text-xs">
              YOUR KNOWLEDGE, OBSERVED
            </p>
            <h1 className="font-song text-4xl font-bold leading-[1.14] tracking-[-0.02em] text-[#f3f8fa] drop-shadow-[0_4px_30px_rgba(0,0,0,.75)] md:text-6xl lg:text-7xl">
              知识被观测，<br className="hidden sm:block" />星云才会发光。
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#91a8b8] md:text-base md:leading-8">
              每门课程聚成一团独特星云，每个被课件证明的知识点才会成为一颗亮星。知识越丰富，宇宙越绚烂。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate('library')}
                className="rounded-xl border border-[#82dfeb]/40 bg-[#b8edf3] px-5 py-3 text-sm font-semibold text-[#031018] shadow-[0_0_32px_rgba(91,207,224,.16)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]"
              >
                进入课件库
              </button>
              <button
                type="button"
                onClick={() => navigate('qa')}
                className="rounded-xl border border-white/12 bg-white/[0.045] px-5 py-3 text-sm font-medium text-[#b5c8d4] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.09] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]"
              >
                全库知识问答
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="absolute inset-x-0 bottom-10 z-30 flex justify-center px-6 md:bottom-12">
          <button
            type="button"
            onClick={() => navigate('library')}
            className="rounded-xl border border-[#82dfeb]/30 bg-[#050b16]/70 px-6 py-3 text-sm font-semibold text-[#d9f5f8] shadow-[0_10px_36px_rgba(0,0,0,.32)] backdrop-blur-md transition hover:border-[#82dfeb]/50 hover:bg-[#091522]/85 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]"
          >
            添加课件
          </button>
        </div>
      )}

      {hasKnowledge ? (
        <p className="pointer-events-none absolute bottom-7 right-7 z-10 hidden font-mono text-[9px] tracking-[0.2em] text-[#41586b] xl:block">
          滚轮缩放 · 拖拽或靠近边缘移动视野
        </p>
      ) : null}
    </main>
  );
}
