import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useInView } from '../hooks/useScroll'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

/**
 * 宇宙汇聚 — 页面末尾的视觉收束
 * 多个光点逐渐汇聚到核心位置
 */
export function ConvergenceSection() {
  const reducedMotion = useReducedMotion()
  const { ref, inView } = useInView<HTMLElement>({ threshold: 0.2 })

  return (
    <section
      ref={ref}
      className="relative min-h-screen flex items-center justify-center px-[8%] py-32 overflow-hidden"
      aria-label="宇宙汇聚"
    >
      {/* 汇聚光点 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {Array.from({ length: 7 }).map((_, i) => {
          const angle = (i / 7) * Math.PI * 2
          const distance = 200 + i * 30
          return (
            <motion.div
              key={i}
              initial={reducedMotion ? {} : {
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance,
                opacity: 0,
              }}
              animate={inView ? {
                x: Math.cos(angle) * distance * 0.3,
                y: Math.sin(angle) * distance * 0.3,
                opacity: [0, 0.8, 0.3],
              } : {}}
              transition={{
                duration: 2.5,
                delay: i * 0.15,
                ease: easeOutExpo,
              }}
              className="absolute w-1 h-1 rounded-full"
              style={{
                background: 'rgba(125, 211, 252, 0.8)',
                boxShadow: '0 0 8px rgba(125, 211, 252, 0.6)',
              }}
            />
          )
        })}
      </div>

      {/* 连接线 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        {Array.from({ length: 7 }).map((_, i) => {
          const angle = (i / 7) * Math.PI * 2
          const distance = 200 + i * 30
          return (
            <motion.line
              key={i}
              x1="50%"
              y1="50%"
              x2={`calc(50% + ${Math.cos(angle) * distance * 0.3}px)`}
              y2={`calc(50% + ${Math.sin(angle) * distance * 0.3}px)`}
              stroke="rgba(125, 211, 252, 0.08)"
              strokeWidth="0.5"
              initial={reducedMotion ? {} : { pathLength: 0, opacity: 0 }}
              animate={inView ? { pathLength: 1, opacity: 1 } : {}}
              transition={{ duration: 1.5, delay: 0.5 + i * 0.1, ease: easeOutExpo }}
            />
          )
        })}
      </svg>

      {/* 中心核心 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.5 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 2, delay: 0.8, ease: easeOutExpo }}
        className="relative z-10 text-center max-w-xl"
      >
        {/* 核心光体 */}
        <div className="relative mx-auto mb-12 w-16 h-16">
          <motion.div
            animate={reducedMotion ? {} : { scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(248, 250, 252, 0.15) 0%, rgba(125, 211, 252, 0.05) 50%, transparent 70%)',
              filter: 'blur(8px)',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full"
            style={{
              background: 'var(--star-white)',
              boxShadow: '0 0 20px rgba(125, 211, 252, 0.6), 0 0 60px rgba(125, 211, 252, 0.3)',
            }}
          />
        </div>

        <span className="label-tag mb-6 block">CONVERGENCE / 宇宙汇聚</span>

        <motion.h2
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, filter: 'blur(8px)' }}
          animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
          transition={{ duration: 1.4, delay: 1, ease: easeOutExpo }}
          className="text-4xl md:text-5xl font-semibold leading-[1.1] tracking-tighter-2 text-star-white text-glow-soft mb-6"
        >
          万物归于一处
        </motion.h2>

        <motion.p
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 1.2, ease: easeOutExpo }}
          className="text-base md:text-lg leading-relaxed max-w-md mx-auto"
          style={{ color: 'rgba(226, 232, 240, 0.72)' }}
        >
          所有的轨迹、信号与坐标，
          最终都汇聚到同一个核心。
          这是宇宙的秩序，也是系统的归宿。
        </motion.p>
      </motion.div>
    </section>
  )
}
