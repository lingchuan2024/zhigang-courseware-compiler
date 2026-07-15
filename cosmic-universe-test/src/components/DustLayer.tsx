import { useRef, useEffect } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { usePerformance } from '../hooks/usePerformance'

interface DustParticle {
  x: number
  y: number
  radius: number
  alpha: number
  vx: number
  vy: number
  depth: number
}

/**
 * 前景宇宙尘埃层 — 极少量模糊大粒子
 * 移动速度比远景稍快，数量非常少
 */
export function DustLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const perf = usePerformance()
  const animationRef = useRef<number | null>(null)
  const particlesRef = useRef<DustParticle[]>([])
  const mouseRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!perf.enableDust || reducedMotion) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const initParticles = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const count = perf.isMobile ? 8 : 18
      const particles: DustParticle[] = []

      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          radius: 1.5 + Math.random() * 3,
          alpha: 0.04 + Math.random() * 0.06,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.1 + 0.02,
          depth: 0.6 + Math.random() * 0.4,
        })
      }

      particlesRef.current = particles
    }

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      initParticles()
    }

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }

    let time = 0
    const render = () => {
      time += 1
      const w = window.innerWidth
      const h = window.innerHeight

      ctx.clearRect(0, 0, w, h)

      for (const p of particlesRef.current) {
        p.x += p.vx
        p.y += p.vy

        if (p.x < -20) p.x = w + 20
        if (p.x > w + 20) p.x = -20
        if (p.y < -20) p.y = h + 20
        if (p.y > h + 20) p.y = -20

        const px = p.x + mouseRef.current.x * p.depth * 15
        const py = p.y + mouseRef.current.y * p.depth * 15

        // 虚焦光晕
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, p.radius * 4)
        gradient.addColorStop(0, `rgba(165, 180, 252, ${p.alpha})`)
        gradient.addColorStop(0.4, `rgba(125, 211, 252, ${p.alpha * 0.5})`)
        gradient.addColorStop(1, 'rgba(125, 211, 252, 0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(px, py, p.radius * 4, 0, Math.PI * 2)
        ctx.fill()
      }

      animationRef.current = requestAnimationFrame(render)
    }

    resize()
    render()

    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      } else if (!animationRef.current) {
        render()
      }
    })

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [reducedMotion, perf.enableDust, perf.isMobile])

  if (!perf.enableDust || reducedMotion) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 2 }}
      aria-hidden="true"
    />
  )
}
