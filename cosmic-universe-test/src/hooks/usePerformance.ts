import { useState, useEffect } from 'react'

export type PerformanceTier = 'high' | 'medium' | 'low'

interface PerformanceState {
  tier: PerformanceTier
  isMobile: boolean
  starCount: number
  enableParallax: boolean
  enableShootingStars: boolean
  enableDust: boolean
  nebulaBlur: number
}

/**
 * 根据设备性能动态调整视觉效果
 */
export function usePerformance(): PerformanceState {
  const [state, setState] = useState<PerformanceState>(() => {
    if (typeof window === 'undefined') {
      return {
        tier: 'high',
        isMobile: false,
        starCount: 280,
        enableParallax: true,
        enableShootingStars: true,
        enableDust: true,
        nebulaBlur: 80,
      }
    }

    const isMobile = window.matchMedia('(max-width: 768px)').matches
    const dpr = window.devicePixelRatio || 1
    const cores = navigator.hardwareConcurrency || 4
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4

    let tier: PerformanceTier = 'high'
    if (isMobile || cores <= 4 || mem <= 4 || dpr > 2.5) {
      tier = 'medium'
    }
    if (isMobile && (cores <= 4 || mem <= 4)) {
      tier = 'low'
    }

    const config: Record<PerformanceTier, Omit<PerformanceState, 'tier'>> = {
      high: {
        isMobile,
        starCount: 280,
        enableParallax: true,
        enableShootingStars: true,
        enableDust: true,
        nebulaBlur: 80,
      },
      medium: {
        isMobile,
        starCount: 160,
        enableParallax: !isMobile,
        enableShootingStars: true,
        enableDust: true,
        nebulaBlur: 60,
      },
      low: {
        isMobile,
        starCount: 80,
        enableParallax: false,
        enableShootingStars: false,
        enableDust: false,
        nebulaBlur: 40,
      },
    }

    return { tier, ...config[tier] }
  })

  // 监听页面可见性，隐藏时降低
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        setState((prev) => ({ ...prev }))
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return state
}
