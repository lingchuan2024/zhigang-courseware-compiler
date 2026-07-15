import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * 轨道装饰 — 极细圆形轨道线 + 刻度
 * 用于辅助空间导航界面感
 */
export function OrbitDecoration({
  className = '',
  size = 200,
}: {
  className?: string
  size?: number
}) {
  const reducedMotion = useReducedMotion()

  return (
    <div
      className={`relative pointer-events-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 主轨道 */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        fill="none"
      >
        <circle
          cx="50"
          cy="50"
          r="48"
          stroke="rgba(125, 211, 252, 0.08)"
          strokeWidth="0.15"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          stroke="rgba(125, 211, 252, 0.05)"
          strokeWidth="0.1"
        />
        <circle
          cx="50"
          cy="50"
          r="32"
          stroke="rgba(125, 211, 252, 0.04)"
          strokeWidth="0.1"
          strokeDasharray="0.5 1"
        />

        {/* 刻度 */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180
          const x1 = 50 + Math.cos(angle) * 47
          const y1 = 50 + Math.sin(angle) * 47
          const x2 = 50 + Math.cos(angle) * 49
          const y2 = 50 + Math.sin(angle) * 49
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(125, 211, 252, 0.15)"
              strokeWidth="0.2"
            />
          )
        })}

        {/* 十字定位 */}
        <line x1="50" y1="2" x2="50" y2="6" stroke="rgba(125, 211, 252, 0.2)" strokeWidth="0.15" />
        <line x1="50" y1="94" x2="50" y2="98" stroke="rgba(125, 211, 252, 0.2)" strokeWidth="0.15" />
        <line x1="2" y1="50" x2="6" y2="50" stroke="rgba(125, 211, 252, 0.2)" strokeWidth="0.15" />
        <line x1="94" y1="50" x2="98" y2="50" stroke="rgba(125, 211, 252, 0.2)" strokeWidth="0.15" />
      </svg>

      {/* 缓慢旋转的小光点 */}
      {!reducedMotion && (
        <div
          className="absolute inset-0"
          style={{
            animation: 'spin 40s linear infinite',
          }}
        >
          <div
            className="absolute w-1 h-1 rounded-full"
            style={{
              top: '4%',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(125, 211, 252, 0.6)',
              boxShadow: '0 0 6px rgba(125, 211, 252, 0.8)',
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
