import { AstronomyBackdrop } from '../backgrounds/AstronomyBackdrop';
import { RevealSection } from './RevealSection';

interface DormantHomeLandingProps {
  onOpenLibrary: () => void;
  onOpenQa: () => void;
  onOpenSettings: () => void;
}

const CAPABILITIES = [
  ['01', '知识结构', '从章节与课件证据中识别概念、层级与关系。'],
  ['02', '知识卡片', '把复杂内容整理为可复习、可检索的知识单元。'],
  ['03', '完整笔记', '围绕课程结构生成连续、可阅读的知识文档。'],
  ['04', '全库知识问答', '跨课程检索，并把回答追溯到原始课件。'],
] as const;

const STEPS = [
  ['01', '导入课程材料', '上传 PDF、PPTX 或 Markdown，让不同资料进入同一课程空间。'],
  ['02', '解析并组织知识', '从原始课件中提取知识点、证据、结构、卡片与笔记。'],
  ['03', '持续探索与提问', '在知识宇宙中浏览课程，也可以向整个知识库发问。'],
] as const;

const primaryButton = 'rounded-xl border border-[#c7f5f8]/30 bg-[#b8edf3] px-6 py-3 text-sm font-semibold text-[#031018] shadow-[0_12px_42px_rgba(83,199,218,.13)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]';
const secondaryButton = 'rounded-xl border border-white/[0.14] bg-white/[0.05] px-6 py-3 text-sm font-medium text-[#c6d7df] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]';

export function DormantHomeLanding({ onOpenLibrary, onOpenQa, onOpenSettings }: DormantHomeLandingProps) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#010207] text-[#edf7fc]">
      <div className="fixed inset-0">
        <AstronomyBackdrop variant="dormant" />
      </div>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(1,2,7,.04),rgba(1,2,7,.45)_45%,rgba(1,2,7,.9)_86%,#010207)]" />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 opacity-[0.16] [background-image:radial-gradient(rgba(255,255,255,.65)_0.6px,transparent_0.8px)] [background-size:47px_43px]" />

      <header className="relative z-20 mx-auto flex max-w-[90rem] items-center justify-between px-6 py-6 md:px-10 md:py-8">
        <a href="#top" className="font-song text-4xl font-bold tracking-[0.16em] text-white drop-shadow-[0_0_28px_rgba(112,216,235,.17)] md:text-5xl">
          知纲
        </a>
        <nav aria-label="首页导航" className="flex items-center gap-3 md:gap-5">
          <button type="button" onClick={onOpenLibrary} className="hidden text-sm text-[#9db2bf] transition hover:text-white sm:block">课件库</button>
          <button type="button" onClick={onOpenQa} className="hidden text-sm text-[#9db2bf] transition hover:text-white md:block">全库知识问答</button>
          <button type="button" onClick={onOpenSettings} className="rounded-full border border-white/10 bg-[#040914]/55 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#8ca3b3] backdrop-blur-xl transition hover:border-[#6fd7e8]/35 hover:text-white">服务配置</button>
        </nav>
      </header>

      <div id="top" className="relative z-10 mx-auto max-w-[90rem] px-6 md:px-10">
        <section className="flex min-h-[78vh] max-w-3xl flex-col justify-center pb-24 pt-14 md:min-h-[82vh] md:pt-20">
          <p className="font-mono text-[10px] tracking-[0.32em] text-[#68c9d8] md:text-xs">FROM COURSEWARE TO KNOWLEDGE</p>
          <h1 className="mt-5 font-song text-5xl font-bold leading-[1.08] tracking-[-0.035em] text-white drop-shadow-[0_8px_40px_rgba(0,0,0,.75)] md:text-7xl lg:text-8xl">
            让每一份课件，<br />成为可探索的知识宇宙。
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-[#9cb0bd] md:text-lg">
            知纲把分散的课程材料转化为知识结构、知识卡片、完整笔记和可追溯问答，让课程不再只是文件，而是持续生长的知识资产。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button type="button" onClick={onOpenLibrary} className={primaryButton}>添加第一份课件</button>
            <button type="button" onClick={onOpenQa} className={secondaryButton}>全库知识问答</button>
            <a href="#workflow" className="rounded-xl px-3 py-3 text-sm text-[#839aa9] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8]">了解如何工作 ↓</a>
          </div>
        </section>

        <RevealSection className="border-y border-white/10 py-20 md:py-28">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">01 · KNOWLEDGE SYSTEM</p>
          <div className="mt-10 grid gap-px border-y border-white/10 md:grid-cols-2 xl:grid-cols-4">
            {CAPABILITIES.map(([number, title, description]) => (
              <article key={title} className="border-white/10 px-0 py-8 md:px-7 md:[&:not(:nth-child(2n+1))]:border-l xl:[&:not(:first-child)]:border-l">
                <span className="font-mono text-[10px] text-[#5faab7]">{number}</span>
                <h2 className="mt-5 font-song text-2xl font-bold text-white">{title}</h2>
                <p className="mt-4 text-sm leading-7 text-[#8fa4b2]">{description}</p>
              </article>
            ))}
          </div>
        </RevealSection>

        <RevealSection id="workflow" className="py-20 md:py-32">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#d98586]">02 · FROM MATERIAL TO UNIVERSE</p>
          <h2 className="mt-5 max-w-3xl font-song text-4xl font-bold leading-tight text-white md:text-6xl">从课件到星云，只需要三次观测。</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map(([number, title, description]) => (
              <article key={title} className="border-t border-white/[0.12] pt-6">
                <span className="font-mono text-[10px] text-[#d98586]">{number}</span>
                <h3 className="mt-5 font-song text-2xl font-bold text-white">{title}</h3>
                <p className="mt-4 text-sm leading-7 text-[#8fa4b2]">{description}</p>
              </article>
            ))}
          </div>
        </RevealSection>

        <RevealSection className="grid gap-10 border-y border-white/10 py-20 md:grid-cols-[0.9fr_1.1fr] md:py-32">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">03 · HOW THE UNIVERSE GLOWS</p>
          <div>
            <h2 className="font-song text-4xl font-bold leading-tight text-white md:text-6xl">课程聚成星云，知识点成为亮星。</h2>
            <p className="mt-7 max-w-2xl text-base leading-8 text-[#9cb0bd]">每门课程聚成一团独特星云，每个被课件证据支持的知识点才会亮起。知识越丰富，你的宇宙越绚烂。</p>
          </div>
        </RevealSection>

        <RevealSection className="py-24 text-center md:py-40">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">BEGIN THE FIRST OBSERVATION</p>
          <h2 className="mx-auto mt-6 max-w-4xl font-song text-4xl font-bold text-white md:text-7xl">你的知识宇宙，等待第一次观测。</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={onOpenLibrary} className={primaryButton}>添加第一份课件</button>
            <button type="button" onClick={onOpenQa} className={secondaryButton}>全库知识问答</button>
          </div>
        </RevealSection>
      </div>

      <footer className="relative z-10 border-t border-white/[0.08] px-6 py-7 text-center font-mono text-[9px] tracking-[0.24em] text-[#4e6575]">
        知纲 · KNOWLEDGE UNIVERSE
      </footer>
    </main>
  );
}
