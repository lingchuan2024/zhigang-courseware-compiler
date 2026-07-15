import { useState, useEffect } from 'react'

/**
 * 顶部导航栏 — 默认透明，滚动后变为半透明玻璃
 */
export function NavigationBar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 60)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navItems = ['概览', '探索', '坐标', '档案']

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{
        paddingTop: scrolled ? '12px' : '24px',
        paddingBottom: scrolled ? '12px' : '24px',
        paddingLeft: 'clamp(24px, 5vw, 80px)',
        paddingRight: 'clamp(24px, 5vw, 80px)',
        background: scrolled ? 'rgba(2, 6, 23, 0.6)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid transparent',
      }}
    >
      <div className="flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative w-7 h-7">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(125, 211, 252, 0.4) 0%, transparent 70%)',
              }}
            />
            <div
              className="absolute inset-[35%] rounded-full bg-star-white"
              style={{ boxShadow: '0 0 8px rgba(125, 211, 252, 0.6)' }}
            />
          </div>
          <span className="text-sm font-semibold tracking-wider text-star-white">
            STELLAR
          </span>
        </div>

        {/* 导航项 */}
        <div className="hidden md:flex items-center gap-10">
          {navItems.map((item) => (
            <button
              key={item}
              className="text-xs font-medium tracking-wide text-gray-blue hover:text-star-white transition-colors duration-300 relative group"
              aria-label={`导航到 ${item}`}
            >
              {item}
              <span
                className="absolute -bottom-1 left-0 w-0 h-px bg-ice-blue/40 transition-all duration-400 group-hover:w-full"
              />
            </button>
          ))}
        </div>

        {/* 右侧操作 */}
        <button
          className="text-xs font-medium tracking-wide text-ice-blue/80 hover:text-ice-blue transition-colors duration-300 flex items-center gap-2"
          aria-label="进入控制台"
        >
          <span className="hidden sm:inline">进入控制台</span>
          <span className="sm:hidden">进入</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-transform duration-300 group-hover:translate-x-0.5">
            <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </nav>
  )
}
