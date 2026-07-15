import { motion } from 'framer-motion'
import { CosmicObject } from './CosmicObject'
import { OrbitDecoration } from './OrbitDecoration'
import { useReducedMotion } from '../hooks/useReducedMotion'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

/**
 * 首屏 Hero — 电影开场镜头
 * 左侧主标题 + 右侧宇宙主体
 */
export function HeroSection({ scrollProgress = 0 }: { scrollProgress?: number }) {
  const reducedMotion = useReducedMotion()

  // 首屏滚动时标题淡出、主体微放大
  const titleOpacity = Math.max(0, 1 - scrollProgress * 3)
  const titleTranslate = scrollProgress * -40

  return (
    <section
      className="relative min-h-screen w-full flex items-center overflow-hidden"
      aria-label="深空首屏"
    >
      {/* 极细坐标线 — 左侧 */}
      <div
        className="absolute left-[8%] top-0 bottom-0 w-px pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent, rgba(125, 211, 252, 0.04) 30%, rgba(125, 211, 252, 0.04) 70%, transparent)',
        }}
        aria-hidden="true"
      />

      {/* 坐标编号 — 左上角 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.5, ease: easeOutExpo }}
        className="absolute top-28 left-[8%] hidden md:block"
      >
        <span className="label-tag">COORD · 048.21°N / 112.56°E</span>
      </motion.div>

      {/* 右上角状态 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 0.7, ease: easeOutExpo }}
        className="absolute top-28 right-[8%] hidden md:flex items-center gap-2"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-cyan-glow" style={{ boxShadow: '0 0 6px rgba(34, 211, 238, 0.8)' }} />
        <span className="label-tag">SIGNAL · STABLE</span>
      </motion.div>

      {/* 主内容 */}
      <div className="relative z-10 w-full px-[8%] flex items-center justify-between gap-8">
        {/* 左侧文字 */}
        <motion.div
          style={{
            opacity: titleOpacity,
            transform: reducedMotion ? 'none' : `translateY(${titleTranslate}px)`,
          }}
          className="flex-1 max-w-xl"
        >
          {/* 标签 */}
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: easeOutExpo }}
            className="mb-8"
          >
            <span className="label-tag">STELLAR VISUAL SYSTEM / 001</span>
          </motion.div>

          {/* 主标题 */}
          <motion.h1
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1.6, delay: 0.5, ease: easeOutExpo }}
            className="text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.05] tracking-tighter-2 text-star-white text-glow-soft"
          >
            穿越深空
            <br />
            <span className="text-gradient-cosmic">探索未知</span>
          </motion.h1>

          {/* 副标题 */}
          <motion.p
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.4, delay: 0.9, ease: easeOutExpo }}
            className="mt-8 text-base md:text-lg leading-relaxed max-w-md"
            style={{ color: 'rgba(226, 232, 240, 0.72)' }}
          >
            在星云与引力之间，寻找秩序的轨迹。
            一套以宇宙空间为语言的视觉系统，
            让每一次浏览都成为一次深空航行。
          </motion.p>

          {/* 按钮组 */}
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.4, delay: 1.2, ease: easeOutExpo }}
            className="mt-10 flex items-center gap-4"
          >
            <button className="btn-cosmic group" aria-label="开始探索">
              <span>开始探索</span>
              <svg
                className="btn-arrow"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path
                  d="M2 7h10M7 2l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <button
              className="text-sm font-medium tracking-wide text-gray-blue hover:text-star-white transition-colors duration-300 flex items-center gap-2"
              aria-label="观看演示"
            >
              <span>观看演示</span>
            </button>
          </motion.div>
        </motion.div>

        {/* 右侧宇宙主体 */}
        <motion.div
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, delay: 0.4, ease: easeOutExpo }}
          className="hidden lg:block flex-1 max-w-[600px] relative"
          style={{ height: '600px' }}
        >
          <CosmicObject scrollProgress={scrollProgress} />

          {/* 轨道装饰 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <OrbitDecoration size={560} />
          </div>
        </motion.div>
      </div>

      {/* 底部滚动提示 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: Math.max(0, 1 - scrollProgress * 5) }}
        transition={{ duration: 1, delay: 1.8, ease: easeOutExpo }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
      >
        <span className="label-tag">SCROLL TO EXPLORE</span>
        <div className="relative w-px h-12 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, transparent, rgba(125, 211, 252, 0.4), transparent)',
              animation: reducedMotion ? 'none' : 'scroll-hint 2.5s ease-in-out infinite',
            }}
          />
        </div>
      </motion.div>

      <style>{`
        @keyframes scroll-hint {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </section>
  )
}
