import { motion } from 'framer-motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useInView } from '../hooks/useScroll'

const easeOutExpo = [0.16, 1, 0.3, 1] as const

interface SpaceNode {
  id: string
  label: string
  coord: string
  title: string
  body: string
  metric: string
  unit: string
}

const nodes: SpaceNode[] = [
  {
    id: 'node-1',
    label: 'NODE / 001',
    coord: '048.21°N',
    title: '引力场',
    body: '在质量的弯曲时空中，一切轨迹都被悄然引导。系统通过多层引力模型，将分散的信息汇聚为有序的结构。',
    metric: '0.98',
    unit: 'c',
  },
  {
    id: 'node-2',
    label: 'NODE / 002',
    coord: '112.56°E',
    title: '星图网络',
    body: '每一个节点都是一颗恒星，每一条连线都是引力关系的映射。网络在暗处生长，在光处显现。',
    metric: '1,247',
    unit: 'stars',
  },
  {
    id: 'node-3',
    label: 'NODE / 003',
    coord: '312.04°S',
    title: '深空信号',
    body: '来自远方的微弱信号，经过漫长旅途抵达观测站。系统在噪声中提取秩序，在沉默中识别模式。',
    metric: '3.7',
    unit: 'σ',
  },
]

/**
 * 空间节点 — 每个模块表现为宇宙坐标
 * 滚动时节点逐渐靠近、内容逐渐清晰
 */
export function SpaceNodes() {
  const reducedMotion = useReducedMotion()

  return (
    <section className="relative w-full py-32 px-[8%]" aria-label="空间节点">
      {/* 章节标题 */}
      <SectionHeader
        label="SPATIAL NODES / 空间节点"
        title="在坐标之间穿行"
        body="每一个空间节点都是一个独立的信息坐标系。它们在深空中沉默地运转，等待被观测、被连接、被理解。"
      />

      {/* 节点列表 */}
      <div className="mt-24 space-y-32">
        {nodes.map((node, i) => (
          <SpaceNodeItem key={node.id} node={node} index={i} reducedMotion={reducedMotion} />
        ))}
      </div>
    </section>
  )
}

function SpaceNodeItem({
  node,
  index,
  reducedMotion,
}: {
  node: SpaceNode
  index: number
  reducedMotion: boolean
}) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.25 })
  const isEven = index % 2 === 0

  return (
    <div
      ref={ref}
      className={`relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center ${
        isEven ? '' : 'lg:[direction:rtl]'
      }`}
    >
      {/* 节点视觉 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.85 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 1.2, ease: easeOutExpo }}
        className="lg:col-span-5 lg:[direction:ltr] flex items-center justify-center"
      >
        <div className="relative w-64 h-64">
          {/* 节点光晕 */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, rgba(125, 211, 252, 0.08) 0%, transparent 60%)`,
            }}
          />

          {/* 节点核心 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <motion.div
              animate={reducedMotion ? {} : { scale: [1, 1.08, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-3 h-3 rounded-full"
              style={{
                background: 'var(--star-white)',
                boxShadow: '0 0 16px rgba(125, 211, 252, 0.5), 0 0 40px rgba(125, 211, 252, 0.2)',
              }}
            />
          </div>

          {/* 轨道环 */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="44" stroke="rgba(125, 211, 252, 0.08)" strokeWidth="0.15" />
            <circle cx="50" cy="50" r="36" stroke="rgba(125, 211, 252, 0.05)" strokeWidth="0.1" strokeDasharray="0.5 1" />
            <circle cx="50" cy="50" r="28" stroke="rgba(125, 211, 252, 0.03)" strokeWidth="0.1" />

            {/* 连接线 */}
            <line x1="50" y1="6" x2="50" y2="14" stroke="rgba(125, 211, 252, 0.15)" strokeWidth="0.15" />
            <line x1="50" y1="86" x2="50" y2="94" stroke="rgba(125, 211, 252, 0.15)" strokeWidth="0.15" />
            <line x1="6" y1="50" x2="14" y2="50" stroke="rgba(125, 211, 252, 0.15)" strokeWidth="0.15" />
            <line x1="86" y1="50" x2="94" y2="50" stroke="rgba(125, 211, 252, 0.15)" strokeWidth="0.15" />
          </svg>

          {/* 数据 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-12 text-center">
            <div className="text-3xl font-semibold text-star-white tracking-tight">{node.metric}</div>
            <div className="label-tag mt-1">{node.unit}</div>
          </div>
        </div>
      </motion.div>

      {/* 节点信息 */}
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, x: isEven ? 40 : -40, filter: 'blur(6px)' }}
        animate={inView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
        transition={{ duration: 1, delay: 0.2, ease: easeOutExpo }}
        className="lg:col-span-7 lg:[direction:ltr]"
      >
        <div className="flex items-center gap-4 mb-4">
          <span className="label-tag">{node.label}</span>
          <span className="w-8 h-px bg-ice-blue/20" />
          <span className="font-mono text-[10px] text-gray-blue/60 tracking-wider">{node.coord}</span>
        </div>

        <h3 className="text-3xl md:text-4xl font-semibold tracking-tight text-star-white mb-4 text-glow-soft">
          {node.title}
        </h3>

        <p className="text-base leading-relaxed max-w-md" style={{ color: 'rgba(226, 232, 240, 0.72)' }}>
          {node.body}
        </p>
      </motion.div>
    </div>
  )
}

function SectionHeader({ label, title, body }: { label: string; title: string; body: string }) {
  const reducedMotion = useReducedMotion()
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.2 })

  return (
    <div ref={ref} className="max-w-2xl">
      <motion.div
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1, ease: easeOutExpo }}
        className="mb-6"
      >
        <span className="label-tag">{label}</span>
      </motion.div>

      <motion.h2
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 20, filter: 'blur(8px)' }}
        animate={inView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
        transition={{ duration: 1.2, delay: 0.15, ease: easeOutExpo }}
        className="text-4xl md:text-5xl font-semibold leading-[1.1] tracking-tighter-2 text-star-white text-glow-soft mb-6"
      >
        {title}
      </motion.h2>

      <motion.p
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 1, delay: 0.35, ease: easeOutExpo }}
        className="text-base md:text-lg leading-relaxed max-w-lg"
        style={{ color: 'rgba(226, 232, 240, 0.72)' }}
      >
        {body}
      </motion.p>
    </div>
  )
}
