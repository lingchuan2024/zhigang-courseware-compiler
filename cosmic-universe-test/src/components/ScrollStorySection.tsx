import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useInView } from '../hooks/useScroll'
import type { ReactNode } from 'react'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

interface ScrollStorySectionProps {
  /** 阶段标签 */
  label: string
  /** 阶段标题 */
  title: ReactNode
  /** 阶段正文 */
  body: ReactNode
  /** 坐标编号 */
  coord?: string
  /** 布局方向 */
  reverse?: boolean
  /** 可选的视觉元素 */
  visual?: ReactNode
  /** 背景星云色调变化 */
  accentColor?: string
}

/**
 * 滚动叙事章节 — 大型视觉与文字交替
 * 每一屏只讲一个重点，大量留白
 */
export function ScrollStorySection({
  label,
  title,
  body,
  coord,
  reverse = false,
  visual,
  accentColor = 'rgba(125, 211, 252, 0.08)',
}: ScrollStorySectionProps) {
  const reducedMotion = useReducedMotion()
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.2 })

  return (
    <section
      ref={ref}
      className="relative min-h-screen w-full flex items-center py-32"
      aria-label={typeof title === 'string' ? title : '叙事章节'}
    >
      {/* 章节局部光晕 */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '50vw',
          height: '50vw',
          top: '50%',
          left: reverse ? '10%' : '60%',
          transform: 'translateY(-50%)',
          background: `radial-gradient(ellipse at center, ${accentColor} 0%, transparent 60%)`,
          filter: 'blur(60px)',
        }}
        aria-hidden="true"
      />

      <div
        className={`relative z-10 w-full px-[8%] grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center ${
          reverse ? 'lg:[direction:rtl]' : ''
        }`}
      >
        {/* 文字 */}
        <motion.div
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, x: reverse ? 40 : -40, filter: 'blur(6px)' }}
          animate={inView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
          transition={{ duration: 1, ease: easeOutExpo }}
          className="lg:[direction:ltr]"
        >
          {/* 坐标 + 标签 */}
          <div className="flex items-center gap-4 mb-6">
            <span className="label-tag">{label}</span>
            {coord && (
              <>
                <span className="w-8 h-px bg-ice-blue/20" />
                <span className="font-mono text-[10px] text-gray-blue/60 tracking-wider">{coord}</span>
              </>
            )}
          </div>

          {/* 标题 */}
          <motion.h2
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
            transition={{ duration: 1.2, delay: 0.15, ease: easeOutExpo }}
            className="text-4xl md:text-5xl font-semibold leading-[1.1] tracking-tighter-2 text-star-white text-glow-soft mb-6"
          >
            {title}
          </motion.h2>

          {/* 正文 */}
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 1, delay: 0.35, ease: easeOutExpo }}
            className="text-base md:text-lg leading-relaxed max-w-lg"
            style={{ color: 'rgba(226, 232, 240, 0.72)' }}
          >
            {body}
          </motion.div>

          {/* 极细连接线 */}
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scaleX: 0 }}
            animate={inView ? { opacity: 1, scaleX: 1 } : {}}
            transition={{ duration: 1.2, delay: 0.6, ease: easeOutExpo }}
            className="mt-10 flex items-center gap-3"
          >
            <div className="w-12 h-px bg-gradient-to-r from-ice-blue/40 to-transparent origin-left" />
            <span className="label-tag">EXPLORE MORE</span>
          </motion.div>
        </motion.div>

        {/* 视觉 */}
        {visual && (
          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.92, filter: 'blur(8px)' }}
            animate={inView ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : {}}
            transition={{ duration: 1.4, delay: 0.2, ease: easeOutExpo }}
            className="lg:[direction:ltr] relative flex items-center justify-center min-h-[400px]"
          >
            {visual}
          </motion.div>
        )}
      </div>
    </section>
  )
}
