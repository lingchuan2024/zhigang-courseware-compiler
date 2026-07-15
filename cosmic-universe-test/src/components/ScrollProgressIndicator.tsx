import { motion } from 'framer-motion'
import { useScrollProgress } from '../hooks/useScroll'
import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * 滚动进度指示器 — 固定在右侧的极细进度线
 */
export function ScrollProgressIndicator() {
  const progress = useScrollProgress()
  const reducedMotion = useReducedMotion()

  return (
    <div
      className="fixed right-6 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col items-center gap-3"
      aria-hidden="true"
    >
      {/* 进度线 */}
      <div className="relative w-px h-32 bg-white/5 overflow-hidden rounded-full">
        <motion.div
          className="absolute top-0 left-0 w-full"
          style={{
            height: `${progress * 100}%`,
            background: 'linear-gradient(180deg, rgba(125, 211, 252, 0.6), rgba(125, 211, 252, 0.2))',
          }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.1 }}
        />
      </div>

      {/* 百分比 */}
      <span className="font-mono text-[9px] tracking-wider text-gray-blue/60 rotate-90 origin-center whitespace-nowrap mt-2">
        {String(Math.round(progress * 100)).padStart(3, '0')}%
      </span>
    </div>
  )
}
