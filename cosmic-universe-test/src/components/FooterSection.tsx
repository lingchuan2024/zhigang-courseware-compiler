import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useInView } from '../hooks/useScroll'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

/**
 * 页脚 — 星光逐渐减少，回归安静和留白
 */
export function FooterSection() {
  const reducedMotion = useReducedMotion()
  const { ref, inView } = useInView<HTMLElement>({ threshold: 0.15 })

  return (
    <footer
      ref={ref}
      className="relative min-h-[70vh] flex flex-col items-center justify-center px-[8%] py-32 overflow-hidden"
    >
      {/* 中心远景星体 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 2, ease: easeOutExpo }}
        className="relative mb-16"
      >
        <div
          className="w-3 h-3 rounded-full bg-star-white"
          style={{
            boxShadow: `
              0 0 20px rgba(125, 211, 252, 0.4),
              0 0 60px rgba(125, 211, 252, 0.2),
              0 0 120px rgba(109, 40, 217, 0.1)
            `,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            width: 80,
            height: 80,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, rgba(125, 211, 252, 0.06) 0%, transparent 70%)',
          }}
        />
      </motion.div>

      {/* 收束文字 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, filter: 'blur(6px)' }}
        animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
        transition={{ duration: 1.4, delay: 0.3, ease: easeOutExpo }}
        className="text-center max-w-md mb-8"
      >
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-star-white mb-4">
          回归静谧
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(226, 232, 240, 0.56)' }}>
          每一次探索的终点，都是新的起点。
          星光在远处安静地闪烁。
        </p>
      </motion.div>

      {/* 按钮收束 */}
      <motion.button
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1, delay: 0.6, ease: easeOutExpo }}
        className="btn-cosmic group mb-20"
        aria-label="返回起点"
      >
        <span>返回起点</span>
        <svg className="btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M12 7H2M7 2L2 7l5 5"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </motion.button>

      {/* 极简页脚信息 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 1.2, delay: 1, ease: easeOutExpo }}
        className="w-full max-w-4xl flex flex-col md:flex-row items-center justify-between gap-4 pt-8"
        style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}
      >
        <div className="flex items-center gap-3">
          <div className="relative w-5 h-5">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(125, 211, 252, 0.3) 0%, transparent 70%)',
              }}
            />
            <div
              className="absolute inset-[35%] rounded-full bg-star-white"
              style={{ boxShadow: '0 0 6px rgba(125, 211, 252, 0.5)' }}
            />
          </div>
          <span className="text-xs font-semibold tracking-wider text-gray-blue">STELLAR</span>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-[10px] font-mono tracking-wider text-gray-blue/50">© 2026 STELLAR SYSTEM</span>
          <span className="text-[10px] font-mono tracking-wider text-gray-blue/50">v0.1.0</span>
        </div>
      </motion.div>
    </footer>
  )
}
