import { useRef, useEffect } from 'react'

/**
 * 鼠标视差 hook
 * 返回一个 ref，其值随鼠标位置平滑插值
 * 仅桌面端生效
 */
export function useMouseParallax(strength: number = 20) {
  const offsetRef = useRef({ x: 0, y: 0 })
  const targetRef = useRef({ x: 0, y: 0 })
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    // 移动端不启用
    if (window.matchMedia('(hover: none)').matches) return

    const handleMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      targetRef.current = {
        x: ((e.clientX - cx) / cx) * strength,
        y: ((e.clientY - cy) / cy) * strength,
      }
    }

    const handleLeave = () => {
      targetRef.current = { x: 0, y: 0 }
    }

    const animate = () => {
      // 平滑插值
      offsetRef.current.x += (targetRef.current.x - offsetRef.current.x) * 0.05
      offsetRef.current.y += (targetRef.current.y - offsetRef.current.y) * 0.05
      frameRef.current = requestAnimationFrame(animate)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseleave', handleLeave)
    frameRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseleave', handleLeave)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [strength])

  return offsetRef
}
