import { useRef, useEffect } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { usePerformance } from '../hooks/usePerformance'

interface Star {
  x: number
  y: number
  radius: number
  baseAlpha: number
  twinkleSpeed: number
  twinklePhase: number
  driftX: number
  driftY: number
  depth: number // 0 = 远, 1 = 近
  color: string
}

interface ShootingStarData {
  x: number
  y: number
  vx: number
  vy: number
  length: number
  alpha: number
  life: number
  maxLife: number
}

const STAR_COLORS = [
  '255, 255, 255',
  '224, 242, 254',
  '186, 230, 253',
  '165, 180, 252',
  '199, 210, 254',
]

/**
 * 星空 Canvas — 多层景深星点 + 偶发流星
 * 独立于 React 渲染循环，使用 requestAnimationFrame
 */
export function StarFieldCanvas({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const perf = usePerformance()
  const animationRef = useRef<number | null>(null)
  const starsRef = useRef<Star[]>([])
  const shootingStarsRef = useRef<ShootingStarData[]>([])
  const mouseRef = useRef({ x: 0, y: 0 })
  const scrollRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // ====== 初始化 ======
    const initStars = (w: number, h: number) => {
      const count = perf.starCount
      const stars: Star[] = []

      for (let i = 0; i < count; i++) {
        const depth = Math.random()
        // 远景星点更小更暗，中景稍大
        const radius = depth < 0.7
          ? Math.random() * 0.6 + 0.2
          : Math.random() * 1.2 + 0.5

        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius,
          baseAlpha: 0.3 + depth * 0.6 + Math.random() * 0.1,
          twinkleSpeed: 0.002 + Math.random() * 0.008,
          twinklePhase: Math.random() * Math.PI * 2,
          driftX: (Math.random() - 0.5) * 0.015 * depth,
          driftY: (Math.random() - 0.5) * 0.015 * depth,
          depth,
          color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        })
      }

      starsRef.current = stars
    }

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      if (w <= 0 || h <= 0) return
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      initStars(w, h)
    }

    // ====== 流星 ======
    const spawnShootingStar = () => {
      if (!perf.enableShootingStars) return
      if (shootingStarsRef.current.length >= 2) return

      const w = window.innerWidth
      const h = window.innerHeight
      const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2 // 斜向下
      const speed = 6 + Math.random() * 4
      const startX = Math.random() * w * 0.6
      const startY = Math.random() * h * 0.3

      shootingStarsRef.current.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 80 + Math.random() * 60,
        alpha: 0,
        life: 0,
        maxLife: 60 + Math.random() * 40,
      })
    }

    let shootingStarTimer: ReturnType<typeof setTimeout>
    const scheduleShootingStar = () => {
      const delay = 8000 + Math.random() * 12000
      shootingStarTimer = setTimeout(() => {
        spawnShootingStar()
        scheduleShootingStar()
      }, delay)
    }

    // ====== 鼠标视差（仅桌面端） ======
    const onMouseMove = (e: MouseEvent) => {
      if (window.innerWidth === 0 || window.innerHeight === 0) return
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }

    // ====== 滚动 ======
    const onScroll = () => {
      scrollRef.current = window.scrollY
    }

    // ====== 渲染循环 ======
    let time = 0
    const render = () => {
      time += 1
      const w = window.innerWidth
      const h = window.innerHeight

      // 窗口不可见时跳过渲染
      if (w <= 0 || h <= 0) {
        animationRef.current = requestAnimationFrame(render)
        return
      }

      ctx.clearRect(0, 0, w, h)

      const scrollOffset = scrollRef.current

      // 渲染星点
      for (const star of starsRef.current) {
        // 闪烁
        let alpha = star.baseAlpha
        if (!reducedMotion) {
          alpha = star.baseAlpha + Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.15
        }
        alpha = Math.max(0.1, Math.min(1, alpha))

        // 漂移
        if (!reducedMotion) {
          star.x += star.driftX
          star.y += star.driftY
          // 环绕
          if (star.x < 0) star.x = w
          if (star.x > w) star.x = 0
          if (star.y < 0) star.y = h
          if (star.y > h) star.y = 0
        }

        // 视差偏移
        const parallaxX = mouseRef.current.x * star.depth * 8
        const parallaxY = mouseRef.current.y * star.depth * 8
        const scrollParallaxY = scrollOffset * star.depth * 0.08

        const px = star.x + parallaxX
        const py = star.y + parallaxY - scrollParallaxY

        // 光晕（仅中近景）
        if (star.radius > 0.8) {
          const glowRadius = star.radius * 3
          const gradient = ctx.createRadialGradient(px, py, 0, px, py, glowRadius)
          gradient.addColorStop(0, `rgba(${star.color}, ${alpha * 0.3})`)
          gradient.addColorStop(1, `rgba(${star.color}, 0)`)
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(px, py, glowRadius, 0, Math.PI * 2)
          ctx.fill()
        }

        // 星点
        ctx.fillStyle = `rgba(${star.color}, ${alpha})`
        ctx.beginPath()
        ctx.arc(px, py, star.radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // 渲染流星
      if (!reducedMotion) {
        const shootingStars = shootingStarsRef.current
        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const ss = shootingStars[i]
          ss.life += 1
          ss.x += ss.vx
          ss.y += ss.vy

          // 生命周期透明度
          const lifeRatio = ss.life / ss.maxLife
          if (lifeRatio < 0.2) {
            ss.alpha = lifeRatio / 0.2
          } else if (lifeRatio > 0.7) {
            ss.alpha = (1 - lifeRatio) / 0.3
          } else {
            ss.alpha = 1
          }
          ss.alpha = Math.max(0, Math.min(1, ss.alpha))

          // 尾迹
          const tailX = ss.x - ss.vx * (ss.length / 6)
          const tailY = ss.y - ss.vy * (ss.length / 6)
          const gradient = ctx.createLinearGradient(ss.x, ss.y, tailX, tailY)
          gradient.addColorStop(0, `rgba(224, 242, 254, ${ss.alpha * 0.9})`)
          gradient.addColorStop(0.5, `rgba(125, 211, 252, ${ss.alpha * 0.4})`)
          gradient.addColorStop(1, 'rgba(125, 211, 252, 0)')

          ctx.strokeStyle = gradient
          ctx.lineWidth = 1.2
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(ss.x, ss.y)
          ctx.lineTo(tailX, tailY)
          ctx.stroke()

          // 头部光点
          ctx.fillStyle = `rgba(248, 250, 252, ${ss.alpha})`
          ctx.beginPath()
          ctx.arc(ss.x, ss.y, 1.2, 0, Math.PI * 2)
          ctx.fill()

          if (ss.life >= ss.maxLife || ss.x > w + 100 || ss.y > h + 100) {
            shootingStars.splice(i, 1)
          }
        }
      }

      animationRef.current = requestAnimationFrame(render)
    }

    // ====== 启动 ======
    resize()
    if (!reducedMotion) {
      scheduleShootingStar()
    }
    render()

    // 事件
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      } else {
        // 恢复可见时重新初始化尺寸（处理窗口从 0 恢复的情况）
        resize()
        if (!animationRef.current) {
          render()
        }
      }
    })

    // ====== 清理 ======
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      clearTimeout(shootingStarTimer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [reducedMotion, perf.starCount, perf.enableShootingStars])

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ zIndex: 1 }}
      aria-hidden="true"
      role="img"
      aria-label="深空星空背景，包含多层星点和偶发流星"
    />
  )
}
