import { useRef, useState, useEffect } from 'react'

/**
 * 滚动进度 hook
 * 返回当前页面滚动百分比 (0-1)
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let frame: number | null = null

    const update = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      setProgress(docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0)
      frame = null
    }

    const onScroll = () => {
      if (frame === null) {
        frame = requestAnimationFrame(update)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    update()

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return progress
}

/**
 * 元素进入视口检测
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: IntersectionObserverInit = { threshold: 0.15 }
) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer.unobserve(entry.target)
      }
    }, options)

    observer.observe(el)
    return () => observer.disconnect()
  }, [options])

  return { ref, inView }
}

/**
 * 滚动方向检测
 */
export function useScrollDirection() {
  const ref = useRef<'down' | 'up' | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    let lastY = window.scrollY
    let frame: number | null = null

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        const y = window.scrollY
        ref.current = y > lastY ? 'down' : 'up'
        lastY = y
        force((n) => n + 1)
        frame = null
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return ref.current
}
