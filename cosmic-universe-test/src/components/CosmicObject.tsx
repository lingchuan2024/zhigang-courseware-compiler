import { useRef, useEffect } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { usePerformance } from '../hooks/usePerformance'

interface Particle {
  // 3D 球面坐标（单位向量）
  x: number
  y: number
  z: number
  // 原始半径比例（用于纹理变化）
  r: number
  // 亮度
  brightness: number
}

interface OrbitParticle {
  angle: number
  radius: number
  speed: number
  size: number
  tilt: number
  alpha: number
}

/**
 * 宇宙视觉主体 — 粒子球体
 * 特性：
 * - 球面粒子分布（Fibonacci 球面）
 * - 缓慢自转
 * - 柔和呼吸光
 * - 多层光晕
 * - 内部粒子运动
 * - 轨道线
 * - 鼠标靠近偏转
 * - 滚动景深变化
 */
export function CosmicObject({
  scrollProgress = 0,
  className = '',
}: {
  scrollProgress?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const perf = usePerformance()
  const animationRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const orbitParticlesRef = useRef<OrbitParticle[]>([])
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const tiltRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // ====== 初始化球面粒子（Fibonacci 球面分布） ======
    const initParticles = () => {
      const count = perf.isMobile ? 400 : 900
      const particles: Particle[] = []
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))

      for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2 // y 从 1 到 -1
        const radius = Math.sqrt(1 - y * y)
        const theta = goldenAngle * i

        particles.push({
          x: Math.cos(theta) * radius,
          y: y,
          z: Math.sin(theta) * radius,
          r: 0.7 + Math.random() * 0.3,
          brightness: 0.4 + Math.random() * 0.6,
        })
      }

      particlesRef.current = particles
    }

    // ====== 轨道粒子 ======
    const initOrbitParticles = () => {
      const orbits: OrbitParticle[] = []
      const orbitCount = perf.isMobile ? 8 : 16
      for (let i = 0; i < orbitCount; i++) {
        orbits.push({
          angle: Math.random() * Math.PI * 2,
          radius: 1.15 + Math.random() * 0.35,
          speed: 0.001 + Math.random() * 0.002,
          size: 0.5 + Math.random() * 1,
          tilt: (Math.random() - 0.5) * 0.6,
          alpha: 0.3 + Math.random() * 0.4,
        })
      }
      orbitParticlesRef.current = orbits
    }

    // ====== 尺寸 ======
    const resize = () => {
      const rect = container.getBoundingClientRect()
      const size = Math.max(1, Math.min(rect.width, rect.height))
      canvas.width = size * dpr
      canvas.height = size * dpr
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // ====== 鼠标 ======
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      mouseRef.current.x = (e.clientX - cx) / (rect.width / 2)
      mouseRef.current.y = (e.clientY - cy) / (rect.height / 2)
      mouseRef.current.inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
    }

    let rotationY = 0
    let rotationX = 0
    let time = 0

    const render = () => {
      time += 1
      const rect = container.getBoundingClientRect()
      const size = Math.min(rect.width, rect.height)

      // 容器不可见时跳过渲染
      if (size <= 0) {
        animationRef.current = requestAnimationFrame(render)
        return
      }

      const cx = size / 2
      const cy = size / 2

      // 基础半径随滚动变化（景深效果）
      const scrollScale = 1 + scrollProgress * 0.15
      const baseRadius = Math.max(1, size * 0.28 * scrollScale)

      // 呼吸效果
      const breathe = reducedMotion ? 1 : 1 + Math.sin(time * 0.012) * 0.015

      ctx.clearRect(0, 0, size, size)

      // ====== 多层光晕 ======
      const glowLayers = [
        { r: baseRadius * 3.5, alpha: 0.03, color: '109, 40, 217' },
        { r: baseRadius * 2.8, alpha: 0.05, color: '37, 99, 235' },
        { r: baseRadius * 2.2, alpha: 0.07, color: '125, 211, 252' },
        { r: baseRadius * 1.6, alpha: 0.10, color: '224, 242, 254' },
      ]

      for (const glow of glowLayers) {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow.r)
        gradient.addColorStop(0, `rgba(${glow.color}, ${glow.alpha * breathe})`)
        gradient.addColorStop(0.5, `rgba(${glow.color}, ${glow.alpha * 0.3 * breathe})`)
        gradient.addColorStop(1, `rgba(${glow.color}, 0)`)
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(cx, cy, glow.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // ====== 旋转 ======
      if (!reducedMotion) {
        rotationY += 0.0015
        rotationX += 0.0005
      }

      // 鼠标偏转（平滑插值）
      const targetTiltX = mouseRef.current.inside ? mouseRef.current.y * 0.3 : 0
      const targetTiltY = mouseRef.current.inside ? mouseRef.current.x * 0.3 : 0
      tiltRef.current.x += (targetTiltX - tiltRef.current.x) * 0.03
      tiltRef.current.y += (targetTiltY - tiltRef.current.y) * 0.03

      const rotY = rotationY + tiltRef.current.y
      const rotX = rotationX + tiltRef.current.x
      const cosY = Math.cos(rotY)
      const sinY = Math.sin(rotY)
      const cosX = Math.cos(rotX)
      const sinX = Math.sin(rotX)

      // ====== 球面粒子 ======
      const particles = particlesRef.current
      // 按深度排序（从远到近）
      const projected: { px: number; py: number; brightness: number; depth: number; size: number }[] = []

      for (const p of particles) {
        // Y 轴旋转
        const x1 = p.x * cosY - p.z * sinY
        const z1 = p.x * sinY + p.z * cosY
        // X 轴旋转
        const y2 = p.y * cosX - z1 * sinX
        const z2 = p.y * sinX + z1 * cosX

        // 透视投影
        const perspective = 2.5
        const scale = perspective / (perspective + z2)
        const r = baseRadius * breathe * p.r * scale
        const px = cx + x1 * r
        const py = cy + y2 * r

        // 深度影响亮度（前面的粒子更亮）
        const depthAlpha = (z2 + 1) / 2 // 0~1
        const brightness = p.brightness * (0.3 + depthAlpha * 0.7)
        const size = scale * (0.6 + p.r * 0.4)

        projected.push({ px, py, brightness, depth: z2, size })
      }

      // 按深度排序
      projected.sort((a, b) => a.depth - b.depth)

      // 绘制
      for (const p of projected) {
        const alpha = p.brightness * (0.4 + ((p.depth + 1) / 2) * 0.6)

        // 光晕（仅近距离粒子）
        if (p.depth > 0.3) {
          const glowR = p.size * 2.5
          const gradient = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, glowR)
          gradient.addColorStop(0, `rgba(125, 211, 252, ${alpha * 0.15})`)
          gradient.addColorStop(1, 'rgba(125, 211, 252, 0)')
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(p.px, p.py, glowR, 0, Math.PI * 2)
          ctx.fill()
        }

        // 粒子核心
        const color = p.depth > 0.5 ? '224, 242, 254' : '125, 211, 252'
        ctx.fillStyle = `rgba(${color}, ${alpha})`
        ctx.beginPath()
        ctx.arc(p.px, p.py, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // ====== 轨道线 ======
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.06)'
      ctx.lineWidth = 0.5
      const orbitTilts = [
        { tilt: 0.3, radius: 1.3 },
        { tilt: -0.5, radius: 1.5 },
        { tilt: 0.8, radius: 1.15 },
      ]
      for (const orbit of orbitTilts) {
        const r = baseRadius * orbit.radius * scrollScale
        ctx.beginPath()
        ctx.ellipse(cx, cy, r, r * Math.abs(Math.sin(orbit.tilt + rotX * 0.5)), 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // ====== 轨道粒子 ======
      if (!reducedMotion) {
        for (const op of orbitParticlesRef.current) {
          op.angle += op.speed
          const r = baseRadius * op.radius * scrollScale
          const x = Math.cos(op.angle) * r
          const y = Math.sin(op.angle) * r * Math.sin(op.tilt + rotX * 0.3)
          const z = Math.sin(op.angle) * r * Math.cos(op.tilt)

          // 透视
          const scale = 2.5 / (2.5 + z / baseRadius)
          const px = cx + x * scale
          const py = cy + y * scale
          const alpha = op.alpha * ((z / baseRadius + 1) / 2)

          ctx.fillStyle = `rgba(125, 211, 252, ${alpha})`
          ctx.beginPath()
          ctx.arc(px, py, op.size * scale, 0, Math.PI * 2)
          ctx.fill()

          // 微光晕
          const gradient = ctx.createRadialGradient(px, py, 0, px, py, op.size * 4 * scale)
          gradient.addColorStop(0, `rgba(125, 211, 252, ${alpha * 0.3})`)
          gradient.addColorStop(1, 'rgba(125, 211, 252, 0)')
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(px, py, op.size * 4 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ====== 中心核心光 ======
      const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.4)
      coreGradient.addColorStop(0, `rgba(248, 250, 252, ${0.15 * breathe})`)
      coreGradient.addColorStop(0.5, `rgba(125, 211, 252, ${0.08 * breathe})`)
      coreGradient.addColorStop(1, 'rgba(125, 211, 252, 0)')
      ctx.fillStyle = coreGradient
      ctx.beginPath()
      ctx.arc(cx, cy, baseRadius * 0.4, 0, Math.PI * 2)
      ctx.fill()

      animationRef.current = requestAnimationFrame(render)
    }

    initParticles()
    initOrbitParticles()
    resize()
    render()

    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      } else {
        resize()
        if (!animationRef.current) {
          render()
        }
      }
    })

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [reducedMotion, perf.isMobile, scrollProgress])

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex items-center justify-center ${className}`}
    >
      <canvas
        ref={canvasRef}
        className="block"
        aria-hidden="true"
        role="img"
        aria-label="由粒子构成的缓慢自转宇宙球体，带有光晕和轨道线"
      />
    </div>
  )
}
