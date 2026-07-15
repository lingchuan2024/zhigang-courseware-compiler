import { StarFieldCanvas } from './StarFieldCanvas'
import { NebulaLayer } from './NebulaLayer'
import { DustLayer } from './DustLayer'

/**
 * 宇宙背景 — 统一管理多层视觉景深
 * 层级：深空底色 → 星云 → 星点 → 尘埃
 */
export function CosmicBackground({ scrollProgress = 0 }: { scrollProgress?: number }) {
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      {/* 第一层：深空底色 + 星云 */}
      <NebulaLayer scrollProgress={scrollProgress} />

      {/* 第三层：星点 */}
      <StarFieldCanvas />

      {/* 第五层：前景尘埃 */}
      <DustLayer />
    </div>
  )
}
