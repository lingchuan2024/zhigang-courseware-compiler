import { CosmicBackground } from './components/CosmicBackground'
import { NavigationBar } from './components/NavigationBar'
import { HeroSection } from './components/HeroSection'
import { ScrollStorySection } from './components/ScrollStorySection'
import { SpaceNodes } from './components/SpaceNodes'
import { ConvergenceSection } from './components/ConvergenceSection'
import { FooterSection } from './components/FooterSection'
import { ScrollProgressIndicator } from './components/ScrollProgressIndicator'
import { OrbitDecoration } from './components/OrbitDecoration'
import { useScrollProgress } from './hooks/useScroll'
import { useReducedMotion } from './hooks/useReducedMotion'
import { motion } from 'framer-motion'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

export default function App() {
  const scrollProgress = useScrollProgress()
  const reducedMotion = useReducedMotion()

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden">
      {/* 固定背景层 */}
      <CosmicBackground scrollProgress={scrollProgress} />

      {/* 导航栏 */}
      <NavigationBar />

      {/* 滚动进度指示器 */}
      <ScrollProgressIndicator />

      {/* 主内容 */}
      <main className="relative z-10">
        {/* 第一阶段：进入深空 */}
        <HeroSection scrollProgress={scrollProgress} />

        {/* 第二阶段：穿越星云 — 大型视觉与文字交替 */}
        <ScrollStorySection
          label="CHAPTER 01 / 穿越星云"
          coord="NEBULA · 048.21°N"
          title={<>在星云之间<br />寻找路径</>}
          body={
            <>
              星云是宇宙的呼吸，是光与尘埃的交织。
              穿越其中，你会发现混沌之下隐藏着精密的结构——
              每一团气体都在引力中寻找自己的归宿，每一束光都在漫长的旅途中被折射、被吸收、被重新释放。
              <br /><br />
              视觉系统在暗部建立了多层景深，让用户在浏览中感受到空间的真实纵深。
            </>
          }
          visual={
            <div className="relative w-80 h-80">
              {/* 星云视觉 */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `
                    radial-gradient(ellipse at 40% 40%, rgba(109, 40, 217, 0.2) 0%, transparent 40%),
                    radial-gradient(ellipse at 60% 60%, rgba(37, 99, 235, 0.15) 0%, transparent 45%),
                    radial-gradient(ellipse at 50% 30%, rgba(125, 211, 252, 0.08) 0%, transparent 35%)
                  `,
                  filter: 'blur(20px)',
                }}
              />
              <div
                className="absolute inset-[20%] rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgba(248, 250, 252, 0.1) 0%, transparent 60%)',
                  filter: 'blur(10px)',
                }}
              />
              {/* 轨道装饰 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <OrbitDecoration size={300} />
              </div>
            </div>
          }
          accentColor="rgba(109, 40, 217, 0.10)"
        />

        {/* 第三阶段：空间展开 — 反向排列 */}
        <ScrollStorySection
          label="CHAPTER 02 / 空间展开"
          coord="EXPANSION · 112.56°E"
          title={<>空间在静默中<br />缓缓展开</>}
          body={
            <>
              宇宙的膨胀没有声音，却改变了所有距离的定义。
              在这个视觉系统中，每一个模块都像是从深空中浮现的空间坐标——
              它们不在同一时间到达，而是按照各自的节奏，逐次进入观测范围。
              <br /><br />
              滚动是唯一的时间维度。你向下移动的每一像素，都是光年。
            </>
          }
          reverse
          visual={
            <div className="relative w-80 h-80 flex items-center justify-center">
              {/* 展开的网格 */}
              <svg className="w-full h-full" viewBox="0 0 100 100" fill="none">
                {/* 同心圆 */}
                {[15, 25, 35, 45].map((r, i) => (
                  <motion.circle
                    key={r}
                    cx="50"
                    cy="50"
                    r={r}
                    stroke="rgba(125, 211, 252, 0.06)"
                    strokeWidth="0.15"
                    strokeDasharray="0.5 1"
                    initial={reducedMotion ? {} : { scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, delay: i * 0.2, ease: easeOutExpo }}
                    style={{ transformOrigin: 'center' }}
                  />
                ))}
                {/* 放射线 */}
                {Array.from({ length: 8 }).map((_, i) => {
                  const angle = (i / 8) * Math.PI * 2
                  return (
                    <motion.line
                      key={i}
                      x1="50"
                      y1="50"
                      x2={50 + Math.cos(angle) * 45}
                      y2={50 + Math.sin(angle) * 45}
                      stroke="rgba(125, 211, 252, 0.08)"
                      strokeWidth="0.1"
                      initial={reducedMotion ? {} : { pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.2, delay: 0.5 + i * 0.08, ease: easeOutExpo }}
                    />
                  )
                })}
                {/* 中心光点 */}
                <circle cx="50" cy="50" r="1.5" fill="rgba(248, 250, 252, 0.8)" />
                <circle cx="50" cy="50" r="3" fill="rgba(125, 211, 252, 0.2)" />
              </svg>
            </div>
          }
          accentColor="rgba(37, 99, 235, 0.10)"
        />

        {/* 第四阶段：空间节点 */}
        <SpaceNodes />

        {/* 第五阶段：宇宙汇聚 */}
        <ConvergenceSection />

        {/* 页脚 */}
        <FooterSection />
      </main>

      {/* 全局渐隐遮罩 — 底部 */}
      <div
        className="fixed bottom-0 left-0 right-0 h-32 pointer-events-none z-30"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(1, 3, 10, 0.6))',
        }}
        aria-hidden="true"
      />
    </div>
  )
}
