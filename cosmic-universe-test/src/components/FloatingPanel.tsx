import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { ReactNode } from 'react'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

interface FloatingPanelProps {
  children: ReactNode
  className?: string
  /** 入场延迟 */
  delay?: number
  /** 是否在视口内 */
  inView?: boolean
}

/**
 * 漂浮内容面板 — 深色半透明玻璃材质
 * 像漂浮在宇宙中的信息界面
 */
export function FloatingPanel({
  children,
  className = '',
  delay = 0,
  inView = true,
}: FloatingPanelProps) {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 30, filter: 'blur(6px)' }}
      animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
      transition={{ duration: 0.9, delay, ease: easeOutExpo }}
      className={`glass-panel p-7 md:p-8 ${className}`}
    >
      {children}
    </motion.div>
  )
}

/**
 * 面板标签 — 坐标编号风格
 */
export function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-1 rounded-full bg-ice-blue" style={{ boxShadow: '0 0 4px rgba(125, 211, 252, 0.6)' }} />
      <span className="label-tag">{children}</span>
    </div>
  )
}

/**
 * 面板标题
 */
export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-star-white mb-3 leading-tight">
      {children}
    </h3>
  )
}

/**
 * 面板正文
 */
export function PanelBody({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm md:text-base leading-relaxed" style={{ color: 'rgba(226, 232, 240, 0.72)' }}>
      {children}
    </p>
  )
}
