import { usePerformance } from '../hooks/usePerformance'

/**
 * 星云层 — 大范围低透明度蓝紫色模糊渐变
 * 随页面滚动产生缓慢视差
 */
export function NebulaLayer({ scrollProgress = 0 }: { scrollProgress?: number }) {
  const perf = usePerformance()

  const blur = perf.nebulaBlur

  // 不同星云随滚动进度在不同位置呈现
  const nebulae = [
    {
      // 主星云 — 蓝紫色，首屏右上方
      style: {
        width: '70vw',
        height: '70vw',
        top: `${-5 - scrollProgress * 8}%`,
        right: '-15vw',
        background: `radial-gradient(ellipse at center,
          rgba(109, 40, 217, 0.14) 0%,
          rgba(37, 99, 235, 0.10) 30%,
          rgba(30, 58, 138, 0.05) 55%,
          transparent 70%)`,
        filter: `blur(${blur}px)`,
      },
    },
    {
      // 冰蓝星云 — 中部偏左
      style: {
        width: '50vw',
        height: '50vw',
        top: `${40 + scrollProgress * 5}%`,
        left: '-10vw',
        background: `radial-gradient(ellipse at center,
          rgba(34, 211, 238, 0.06) 0%,
          rgba(125, 211, 252, 0.05) 35%,
          rgba(37, 99, 235, 0.03) 55%,
          transparent 70%)`,
        filter: `blur(${blur * 0.8}px)`,
      },
    },
    {
      // 深紫色星云 — 滚动到中段
      style: {
        width: '60vw',
        height: '60vw',
        top: `${80 - scrollProgress * 3}%`,
        right: '-5vw',
        background: `radial-gradient(ellipse at center,
          rgba(139, 92, 246, 0.08) 0%,
          rgba(109, 40, 217, 0.05) 35%,
          transparent 65%)`,
        filter: `blur(${blur * 1.1}px)`,
      },
    },
    {
      // 尾部 — 极淡靛蓝
      style: {
        width: '55vw',
        height: '55vw',
        top: `${140 + scrollProgress * 4}%`,
        left: '20vw',
        background: `radial-gradient(ellipse at center,
          rgba(30, 64, 175, 0.07) 0%,
          rgba(37, 99, 235, 0.04) 40%,
          transparent 65%)`,
        filter: `blur(${blur}px)`,
      },
    },
  ]

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {nebulae.map((nebula, i) => (
        <div
          key={i}
          className="absolute rounded-full will-change-transform"
          style={{
            ...nebula.style,
            transform: `translate3d(0, 0, 0)`,
          }}
        />
      ))}

      {/* 深空底色渐变 — 增加暗部层次 */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 70% 30%, rgba(7, 20, 38, 0.4) 0%, transparent 50%),
            radial-gradient(ellipse at 20% 80%, rgba(5, 8, 22, 0.5) 0%, transparent 50%),
            linear-gradient(180deg, #01030A 0%, #020617 50%, #01030A 100%)
          `,
        }}
      />
    </div>
  )
}
