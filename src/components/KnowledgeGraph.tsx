import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { CourseTopic, MacroKnowledgeRelation, KnowledgePackage, OrderMode } from '../types';
import { getOrderedTopics, getTopicRelations } from '../lib/knowledge-graph';
import { layoutKnowledgeGraph, fitViewport, Viewport } from '../lib/graph-layout';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  packages: KnowledgePackage[];
  orderMode: OrderMode;
  structureSource: 'ai' | 'local' | 'ai-fallback' | 'failed';
  structureWarnings: string[];
  hasModelConfig: boolean;
  onOrderModeChange: (mode: OrderMode) => void;
  onRegenerate: () => void;
  onConfirm: () => void;
  onRegenerateNote: (topicId: string) => void;
}

type TabType = 'evidence' | 'note' | 'relations' | 'structure';
type RelationFilter = 'all' | 'prerequisite' | 'recommended' | 'other';

// 第二层内容类型标签
const INTERNAL_TYPE_LABELS: Record<string, string> = {
  motivation: '动机',
  problem: '问题',
  prerequisite: '前置提醒',
  assumption: '假设条件',
  intuition: '直观理解',
  definition: '定义',
  formula: '公式',
  derivation: '推导',
  procedure: '步骤',
  example: '例子',
  chart: '图表',
  comparison: '对比',
  condition: '适用条件',
  limitation: '局限',
  misconception: '误区',
  conclusion: '总结',
};

// 第二层内容类型颜色
const INTERNAL_TYPE_COLORS: Record<string, string> = {
  motivation: 'bg-blue-100 text-blue-700',
  problem: 'bg-orange-100 text-orange-700',
  prerequisite: 'bg-purple-100 text-purple-700',
  assumption: 'bg-amber-100 text-amber-700',
  intuition: 'bg-cyan-100 text-cyan-700',
  definition: 'bg-indigo-100 text-indigo-700',
  formula: 'bg-red-100 text-red-700',
  derivation: 'bg-teal-100 text-teal-700',
  procedure: 'bg-green-100 text-green-700',
  example: 'bg-lime-100 text-lime-700',
  chart: 'bg-pink-100 text-pink-700',
  comparison: 'bg-violet-100 text-violet-700',
  condition: 'bg-yellow-100 text-yellow-700',
  limitation: 'bg-stone-100 text-stone-700',
  misconception: 'bg-rose-100 text-rose-700',
  conclusion: 'bg-emerald-100 text-emerald-700',
};

// 微观关系类型标签
const MICRO_RELATION_LABELS: Record<string, string> = {
  explains: '解释',
  defines: '定义',
  derived_from: '推导自',
  step_before: '前置步骤',
  example_of: '例子',
  illustrates: '说明',
  supports: '支持',
  contrasts_with: '对比',
  qualifies: '限定',
};

// 内部结构来源标签
const INTERNAL_SOURCE_LABELS: Record<string, string> = {
  'local': '本地',
  'ai': 'AI',
  'ai-fallback': '降级',
};

const INTERNAL_SOURCE_COLORS: Record<string, string> = {
  'local': 'bg-stone-100 text-stone-600',
  'ai': 'bg-blue-100 text-blue-700',
  'ai-fallback': 'bg-amber-100 text-amber-700',
};

const RELATION_COLORS: Record<string, { stroke: string; label: string; dash?: string }> = {
  hard_prerequisite: { stroke: '#dc2626', label: '硬前置' },
  soft_prerequisite: { stroke: '#f97316', label: '软前置', dash: '6,3' },
  recommended_before: { stroke: '#81b29a', label: '推荐顺序', dash: '4,4' },
  contains: { stroke: '#3d405b', label: '包含' },
  derives_to: { stroke: '#2563eb', label: '推导至' },
  used_by: { stroke: '#6b7280', label: '被使用' },
  contrasts_with: { stroke: '#9c6644', label: '对比', dash: '2,3' },
};

const TYPE_LABELS: Record<string, string> = {
  concept: '概念',
  principle: '原理',
  method: '方法',
  formula: '公式',
  problem: '问题',
  composite: '综合',
  derivation: '推导',
  comparison: '对比',
  definition: '定义',
};

const NODE_WIDTH = 200;
const NODE_HEIGHT = 88;

// 截断标题，支持两行显示
function wrapTitle(title: string, maxCharsPerLine: number = 11): { line1: string; line2: string; truncated: boolean } {
  if (title.length <= maxCharsPerLine) {
    return { line1: title, line2: '', truncated: false };
  }
  if (title.length <= maxCharsPerLine * 2) {
    // 尝试在合适位置断开
    const mid = Math.min(maxCharsPerLine, Math.floor(title.length / 2));
    let breakPoint = mid;
    for (let i = mid; i < title.length && i < maxCharsPerLine + 3; i++) {
      if (/[的与和及、，\s]/.test(title[i])) {
        breakPoint = i + 1;
        break;
      }
    }
    return {
      line1: title.substring(0, breakPoint),
      line2: title.substring(breakPoint, maxCharsPerLine * 2),
      truncated: title.length > maxCharsPerLine * 2,
    };
  }
  return {
    line1: title.substring(0, maxCharsPerLine),
    line2: title.substring(maxCharsPerLine, maxCharsPerLine * 2 - 1) + '…',
    truncated: true,
  };
}

// 内部结构标签页组件
function InternalStructureTab({ selectedKp }: { selectedKp?: KnowledgePackage }) {
  if (!selectedKp) {
    return (
      <div className="text-sm text-stone-400 text-center py-6">
        内部结构将在确认结构后可用
      </div>
    );
  }

  const { internalStructure: struct } = selectedKp;
  const itemsById = new Map(struct.items.map(i => [i.id, i]));
  const orderedItems = struct.orderedItemIds
    .map(id => itemsById.get(id))
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  const sourceLabel = INTERNAL_SOURCE_LABELS[struct.source] || struct.source;
  const sourceColor = INTERNAL_SOURCE_COLORS[struct.source] || 'bg-stone-100 text-stone-600';

  return (
    <div className="space-y-3">
      {/* 来源和状态 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${sourceColor}`}>
          {sourceLabel}
        </span>
        <span className="text-xs text-stone-500">
          {struct.items.length} 个内容项 · {struct.relations.length} 个微观关系
        </span>
        {struct.status !== 'ready' && (
          <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded">
            {struct.status === 'pending' ? '待生成' : struct.status === 'failed' ? '失败' : '过期'}
          </span>
        )}
      </div>

      {/* 警告 */}
      {struct.warnings.length > 0 && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs">
          <div className="font-medium text-amber-700 mb-1">注意</div>
          <ul className="text-amber-600 space-y-0.5 list-disc list-inside">
            {struct.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* 内容项列表（按 orderedItemIds 排序） */}
      <div>
        <h4 className="text-xs font-semibold text-stone-500 mb-2">内容项</h4>
        <div className="space-y-2">
          {orderedItems.map((item, idx) => {
            const typeLabel = INTERNAL_TYPE_LABELS[item.type] || item.type;
            const typeColor = INTERNAL_TYPE_COLORS[item.type] || 'bg-stone-100 text-stone-600';
            const contentPreview = item.content.length > 120
              ? item.content.substring(0, 120) + '...'
              : item.content;
            const pages = item.originalPageNumbers.length > 0
              ? item.originalPageNumbers.join(',')
              : '-';

            return (
              <div key={item.id} className="p-2 bg-stone-50 rounded border border-stone-200">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-stone-400 font-mono flex-shrink-0 mt-0.5">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColor}`}>
                        {typeLabel}
                      </span>
                      {item.title && (
                        <span className="text-xs font-medium text-stone-700">{item.title}</span>
                      )}
                      <span className="text-xs text-stone-400">P.{pages}</span>
                      {item.confidence < 0.5 && (
                        <span className="text-xs text-amber-500" title={`置信度 ${Math.round(item.confidence * 100)}%`}>
                          !
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-wrap">
                      {contentPreview}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
          {orderedItems.length === 0 && (
            <div className="text-sm text-stone-400 text-center py-4">暂无内容项</div>
          )}
        </div>
      </div>

      {/* 微观关系 */}
      {struct.relations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-stone-500 mb-2">内部关系</h4>
          <div className="space-y-1">
            {struct.relations.map(rel => {
              const src = itemsById.get(rel.sourceItemId);
              const tgt = itemsById.get(rel.targetItemId);
              const relLabel = MICRO_RELATION_LABELS[rel.type] || rel.type;
              const srcLabel = src ? (src.title || INTERNAL_TYPE_LABELS[src.type] || src.type) : '?';
              const tgtLabel = tgt ? (tgt.title || INTERNAL_TYPE_LABELS[tgt.type] || tgt.type) : '?';
              return (
                <div key={rel.id} className="text-xs text-stone-600 p-1.5 bg-stone-50 rounded border border-stone-200">
                  <span className="font-medium text-stone-700">{srcLabel}</span>
                  <span className="text-stone-400 mx-1">--{relLabel}--&gt;</span>
                  <span className="font-medium text-stone-700">{tgtLabel}</span>
                  {rel.reason && (
                    <span className="text-stone-400 ml-1">({rel.reason})</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 内部排序 */}
      {struct.orderedItemIds.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-stone-500 mb-1">教学顺序</h4>
          <div className="flex flex-wrap gap-1">
            {orderedItems.map((item, idx) => (
              <span key={item.id} className="text-xs text-stone-400">
                {idx > 0 && <span className="mx-0.5 text-stone-300">&rarr;</span>}
                <span className="px-1 py-0.5 bg-stone-100 rounded">
                  {INTERNAL_TYPE_LABELS[item.type] || item.type}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function KnowledgeGraph({
  topics, relations, packages, orderMode,
  structureSource, structureWarnings, hasModelConfig,
  onOrderModeChange, onRegenerate, onConfirm, onRegenerateNote,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('evidence');
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [search, setSearch] = useState('');
  const [showRecommendedPath, setShowRecommendedPath] = useState(false);
  const [showWarnings, setShowWarnings] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);

  // 视口状态
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, width: 800, height: 500 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const orderedTopics = useMemo(() => getOrderedTopics(topics, orderMode), [topics, orderMode]);
  const kpMap = useMemo(() => new Map(packages.map(p => [p.topic.id, p])), [packages]);

  // 布局计算（纯函数）
  const layout = useMemo(() => {
    return layoutKnowledgeGraph(topics, relations, orderMode, {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    });
  }, [topics, relations, orderMode]);

  // topics变化时，确保selectedId有效
  useEffect(() => {
    const validIds = new Set(topics.map(t => t.id));
    if (selectedId && !validIds.has(selectedId)) {
      setSelectedId(orderedTopics[0]?.id || null);
      setRightCollapsed(false);
    } else if (!selectedId && orderedTopics.length > 0) {
      setSelectedId(orderedTopics[0].id);
      setRightCollapsed(false);
    }
  }, [topics, orderedTopics, selectedId]);

  // 自动适应画布
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    const newViewport = fitViewport(layout.bounds, clientWidth, clientHeight, 50);
    setViewport(newViewport);
  }, [layout.bounds]);

  // 首次加载、布局变化、容器尺寸变化时自动适应
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // ResizeObserver处理容器尺寸变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => fitToView());
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToView]);

  const selectedTopic = topics.find(t => t.id === selectedId) || null;
  const selectedKp = selectedId ? kpMap.get(selectedId) : undefined;

  // 过滤关系
  const filteredRelations = useMemo(() => {
    return relations.filter(r => {
      if (relationFilter === 'all') return true;
      if (relationFilter === 'prerequisite') return r.type === 'hard_prerequisite' || r.type === 'soft_prerequisite';
      if (relationFilter === 'recommended') return r.type === 'recommended_before';
      return !['hard_prerequisite', 'soft_prerequisite', 'recommended_before'].includes(r.type);
    });
  }, [relations, relationFilter]);

  // 当前存在的关系类型（用于动态图例）
  const presentRelationTypes = useMemo(() => {
    const types = new Set(relations.map(r => r.type));
    return Array.from(types);
  }, [relations]);

  // 搜索过滤
  const visibleTopics = useMemo(() => {
    if (!search.trim()) return topics;
    const q = search.toLowerCase();
    return topics.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.aliases.some(a => a.toLowerCase().includes(q))
    );
  }, [topics, search]);

  const visibleIds = useMemo(() => new Set(visibleTopics.map(t => t.id)), [visibleTopics]);
  const searchHitIds = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    return new Set(visibleTopics.map(t => t.id));
  }, [search, visibleTopics]);

  // 邻域信息
  const neighborIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const s = new Set<string>([selectedId]);
    for (const r of filteredRelations) {
      if (r.sourceTopicId === selectedId) s.add(r.targetTopicId);
      if (r.targetTopicId === selectedId) s.add(r.sourceTopicId);
    }
    return s;
  }, [selectedId, filteredRelations]);

  // 推荐路径边（按recommendedOrder连接相邻节点）
  const recommendedPathEdges = useMemo(() => {
    if (!showRecommendedPath) return [];
    const edges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < orderedTopics.length - 1; i++) {
      edges.push({ from: orderedTopics[i].id, to: orderedTopics[i + 1].id });
    }
    return edges;
  }, [orderedTopics, showRecommendedPath]);

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 鼠标在视口中的位置
    const viewX = viewport.x + (mouseX / rect.width) * viewport.width;
    const viewY = viewport.y + (mouseY / rect.height) * viewport.height;

    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
    const minWidth = layout.bounds.width * 0.2;
    const maxWidth = layout.bounds.width * 4;

    let newWidth = viewport.width * zoomFactor;
    let newHeight = viewport.height * zoomFactor;

    // 限制缩放范围
    if (newWidth < minWidth) { newWidth = minWidth; newHeight = viewport.height * (minWidth / viewport.width); }
    if (newWidth > maxWidth) { newWidth = maxWidth; newHeight = viewport.height * (maxWidth / viewport.width); }

    // 保持鼠标锚点
    const newX = viewX - (mouseX / rect.width) * newWidth;
    const newY = viewY - (mouseY / rect.height) * newHeight;

    setViewport({ x: newX, y: newY, width: newWidth, height: newHeight });
  }, [viewport, layout.bounds]);

  // 拖动平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只在点击空白或SVG背景时开始拖动
    const target = e.target as SVGElement;
    if (target.closest('g[data-node]') || target.closest('g[data-edge]')) {
      return; // 点击节点或边时不拖动
    }
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y });
  }, [viewport]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !panStart) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) * (viewport.width / rect.width);
    const dy = (e.clientY - panStart.y) * (viewport.height / rect.height);
    setViewport(v => ({ ...v, x: panStart.vx - dx, y: panStart.vy - dy }));
  }, [isPanning, panStart, viewport.width, viewport.height]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  // 重置到100%
  const resetZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scale = Math.min(container.clientWidth / layout.bounds.width, container.clientHeight / layout.bounds.height);
    const viewWidth = container.clientWidth / Math.min(scale, 1);
    const viewHeight = container.clientHeight / Math.min(scale, 1);
    setViewport({
      x: layout.bounds.x + (layout.bounds.width - viewWidth) / 2,
      y: layout.bounds.y + (layout.bounds.height - viewHeight) / 2,
      width: viewWidth,
      height: viewHeight,
    });
  }, [layout.bounds]);

  // 导航
  const currentIndex = selectedId ? orderedTopics.findIndex(t => t.id === selectedId) : -1;
  const selectTopic = useCallback((id: string) => {
    setSelectedId(id);
    setRightCollapsed(false);
  }, []);
  const goPrev = () => {
    if (currentIndex > 0) selectTopic(orderedTopics[currentIndex - 1].id);
  };
  const goNext = () => {
    if (currentIndex >= 0 && currentIndex < orderedTopics.length - 1) selectTopic(orderedTopics[currentIndex + 1].id);
  };

  const sourceLabel = structureSource === 'ai' ? 'AI分析' : structureSource === 'ai-fallback' ? '本地规则（AI降级）' : structureSource === 'failed' ? '提取失败' : '本地规则';

  return (
    <div className="flex h-full bg-stone-50">
      {/* 左侧控制面板 */}
      <div className={`${leftCollapsed ? 'w-10' : 'w-56'} border-r border-stone-200 bg-white flex flex-col overflow-hidden transition-all duration-200 flex-shrink-0`}>
        {!leftCollapsed ? (
          <>
            <div className="p-3 border-b border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold text-stone-800">知识结构</h2>
                <button onClick={() => setLeftCollapsed(true)} className="p-1 hover:bg-stone-100 rounded text-stone-400">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
              </div>

              <div className="text-xs text-stone-500 mb-2">
                来源：{sourceLabel} · {topics.length} 个知识点
              </div>

              {structureWarnings.length > 0 && showWarnings && (
                <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-amber-700">注意</span>
                    <button onClick={() => setShowWarnings(false)} className="text-amber-500 hover:text-amber-700">×</button>
                  </div>
                  <ul className="text-amber-600 space-y-0.5 list-disc list-inside">
                    {structureWarnings.slice(0, 3).map((w, i) => <li key={i} className="truncate">{w}</li>)}
                    {structureWarnings.length > 3 && <li>...共{structureWarnings.length}条</li>}
                  </ul>
                </div>
              )}

              <div className="mb-2">
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索知识点..."
                  className="w-full px-2 py-1.5 text-sm border border-stone-300 rounded focus:ring-1 focus:ring-stone-800 focus:border-stone-800 outline-none"
                />
              </div>

              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => onOrderModeChange('original')}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    orderMode === 'original' ? 'bg-stone-800 text-amber-50 border-stone-800' : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                  }`}
                >课件顺序</button>
                <button
                  onClick={() => onOrderModeChange('ai-recommended')}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    orderMode === 'ai-recommended' ? 'bg-stone-800 text-amber-50 border-stone-800' : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                  }`}
                >{hasModelConfig ? 'AI推荐' : '推荐顺序'}</button>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox" id="showPath" checked={showRecommendedPath}
                  onChange={e => setShowRecommendedPath(e.target.checked)}
                  className="rounded border-stone-300"
                />
                <label htmlFor="showPath" className="text-xs text-stone-600">显示学习路径</label>
              </div>

              <div className="mb-2">
                <select
                  value={relationFilter} onChange={e => setRelationFilter(e.target.value as RelationFilter)}
                  className="w-full px-2 py-1 text-xs border border-stone-300 rounded bg-white"
                >
                  <option value="all">全部关系</option>
                  <option value="prerequisite">前置关系</option>
                  <option value="recommended">推荐顺序</option>
                  <option value="other">其他关系</option>
                </select>
              </div>

              <div className="flex gap-1 mb-2">
                <button onClick={fitToView} className="flex-1 py-1 text-xs border border-stone-300 rounded hover:bg-stone-50">适应画布</button>
                <button onClick={resetZoom} className="flex-1 py-1 text-xs border border-stone-300 rounded hover:bg-stone-50">100%</button>
              </div>

              <div className="flex gap-1 mb-2">
                <button onClick={onRegenerate} className="flex-1 py-1 text-xs border border-stone-300 rounded hover:bg-stone-50">
                  {hasModelConfig ? '重新AI分析' : '重新分析'}
                </button>
              </div>

              <button
                onClick={onConfirm}
                className="w-full py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors font-medium"
              >确认结构并生成笔记</button>
            </div>

            {/* 节点列表 */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="text-xs text-stone-400 px-2 py-1 flex justify-between">
                <span>{visibleTopics.length}/{topics.length}</span>
              </div>
              {orderedTopics.map((t, i) => {
                const kp = kpMap.get(t.id);
                const isSel = t.id === selectedId;
                const isVisible = visibleIds.has(t.id);
                const isHit = searchHitIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTopic(t.id)}
                    className={`w-full text-left px-2 py-1.5 rounded mb-0.5 transition-colors ${
                      isSel ? 'bg-stone-800 text-amber-50' :
                      isHit ? 'bg-yellow-100 hover:bg-yellow-200 text-stone-700' :
                      isVisible ? 'hover:bg-stone-100 text-stone-700' : 'text-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-xs opacity-60 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-sm font-medium truncate flex-1">{t.title}</span>
                      {t.importance === 'core' && (
                        <span className={`text-xs px-1 rounded flex-shrink-0 ${isSel ? 'bg-red-700' : 'bg-red-100 text-red-600'}`}>核</span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 flex items-center gap-1 ${isSel ? 'text-amber-200/70' : 'text-stone-400'}`}>
                      <span>P{t.originalPageNumbers[0]}</span>
                      {kp?.note && <span className="text-green-500">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <button onClick={() => setLeftCollapsed(false)} className="p-3 hover:bg-stone-100 flex flex-col items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            <span className="text-xs writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>知识结构</span>
          </button>
        )}
      </div>

      {/* 中间画布 */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-stone-50 select-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #d6d3d1 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          cursor: isPanning ? 'grabbing' : 'grab',
          minWidth: '300px',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        >
          <defs>
            {Object.entries(RELATION_COLORS).map(([type, c]) => (
              <marker
                key={type}
                id={`arrow-${type}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={c.stroke} />
              </marker>
            ))}
          </defs>

          {/* 推荐路径（下层，低透明度） */}
          {recommendedPathEdges.map((edge, i) => {
            const from = layout.positions.get(edge.from);
            const to = layout.positions.get(edge.to);
            if (!from || !to) return null;
            if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return null;
            // 简单贝塞尔路径用于推荐路径
            const x1 = from.x + from.width, y1 = from.y + from.height / 2;
            const x2 = to.x, y2 = to.y + to.height / 2;
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={`rec-path-${i}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                stroke="#94a3b8"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                opacity={0.25}
                strokeDasharray="6,4"
                data-edge="recommended"
              />
            );
          })}

          {/* 关系边 */}
          {filteredRelations.map(r => {
            const ep = layout.edgePaths.get(r.id);
            if (!ep) return null;
            if (!visibleIds.has(r.sourceTopicId) || !visibleIds.has(r.targetTopicId)) return null;

            const color = RELATION_COLORS[r.type] || { stroke: '#999', label: r.type };
            const isInNeighborhood = selectedId && neighborIds.has(r.sourceTopicId) && neighborIds.has(r.targetTopicId);
            const isSelected = selectedId && (r.sourceTopicId === selectedId || r.targetTopicId === selectedId);
            const opacity = selectedId ? (isSelected ? 0.9 : isInNeighborhood ? 0.5 : 0.08) : 0.5;

            return (
              <g key={r.id} data-edge="relation">
                <path
                  d={ep.path}
                  stroke={color.stroke}
                  strokeWidth={isSelected ? 2 : 1.3}
                  fill="none"
                  strokeDasharray={color.dash}
                  opacity={opacity}
                  strokeLinecap="round"
                  markerEnd={`url(#arrow-${r.type})`}
                />
              </g>
            );
          })}

          {/* 节点 */}
          {topics.map(t => {
            const pos = layout.positions.get(t.id);
            if (!pos) return null;
            const kp = kpMap.get(t.id);
            const isSel = t.id === selectedId;
            const isNeighbor = neighborIds.has(t.id);
            const isVisible = visibleIds.has(t.id);
            const isHit = searchHitIds.has(t.id);
            const orderNum = orderMode === 'ai-recommended' ? t.recommendedOrder : t.originalOrder;

            const opacity = selectedId ? (isSel ? 1 : isNeighbor ? 0.8 : 0.2) : (isVisible ? 1 : 0.3);
            const { line1, line2 } = wrapTitle(t.title, 10);

            // 页码显示
            const pages = t.originalPageNumbers;
            let pageLabel = `P${pages[0]}`;
            if (pages.length > 1) {
              pageLabel = pages.length > 3 ? `P${pages[0]}-${pages[pages.length-1]}` : `P${pages.join(',')}`;
            }

            return (
              <g
                key={t.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                style={{ cursor: 'pointer', opacity, transition: 'opacity 0.15s' }}
                onClick={(e) => { e.stopPropagation(); selectTopic(t.id); }}
                data-node="true"
              >
                {/* 搜索命中高亮 */}
                {isHit && !isSel && (
                  <rect
                    width={pos.width + 8} height={pos.height + 8}
                    x={-4} y={-4} rx="12"
                    fill="none"
                    stroke="#eab308"
                    strokeWidth="3"
                    strokeDasharray="4,2"
                  />
                )}
                <rect
                  width={pos.width} height={pos.height} rx="10"
                  fill={isSel ? '#1c1917' : t.importance === 'core' ? '#fef2f2' : '#ffffff'}
                  stroke={isSel ? '#dc2626' : isHit ? '#eab308' : t.importance === 'core' ? '#fca5a5' : '#d6d3d1'}
                  strokeWidth={isSel ? 2.5 : isHit ? 2 : 1}
                  filter="drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))"
                />
                <title>{t.title}</title>

                {/* 序号 */}
                <text x={pos.width - 10} y={20} fontSize="11" fontWeight="700" fill={isSel ? '#fbbf24' : '#dc2626'} textAnchor="end">
                  {String(orderNum + 1).padStart(2, '0')}
                </text>

                {/* 标题（两行） */}
                <text x={12} y={26} fontSize="13" fontWeight="600" fill={isSel ? '#fef3c7' : '#1c1917'}>
                  {line1}
                </text>
                {line2 && (
                  <text x={12} y={43} fontSize="12" fontWeight="500" fill={isSel ? '#fef3c7' : '#44403c'}>
                    {line2}
                  </text>
                )}

                {/* 类型和重要性 */}
                <text x={12} y={pos.height - 22} fontSize="10" fill={isSel ? '#fef3c7aa' : '#78716c'}>
                  {TYPE_LABELS[t.type] || t.type}
                </text>

                {/* 页码和证据数 */}
                <text x={12} y={pos.height - 8} fontSize="10" fill={isSel ? '#fef3c770' : '#a8a29e'}>
                  {pageLabel} · {t.evidenceIds.length}证据
                </text>

                {/* 笔记状态 */}
                {kp?.note && (
                  <circle cx={pos.width - 12} cy={pos.height - 16} r="4.5" fill="#22c55e" />
                )}
                {kp?.topic.noteStatus === 'failed' && (
                  <circle cx={pos.width - 12} cy={pos.height - 16} r="4.5" fill="#ef4444" />
                )}
              </g>
            );
          })}
        </svg>

        {/* 动态图例 */}
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur rounded-lg p-2 border border-stone-200 text-xs shadow-sm">
          <div className="font-medium text-stone-600 mb-1">关系</div>
          <div className="space-y-0.5">
            {presentRelationTypes.map(type => {
              const c = RELATION_COLORS[type];
              if (!c) return null;
              return (
                <div key={type} className="flex items-center gap-2">
                  <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke={c.stroke} strokeWidth="2" strokeDasharray={c.dash} /></svg>
                  <span className="text-stone-500">{c.label}</span>
                </div>
              );
            })}
            {showRecommendedPath && (
              <div className="flex items-center gap-2">
                <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4,3" opacity={0.5} /></svg>
                <span className="text-stone-400">学习路径</span>
              </div>
            )}
          </div>
        </div>

        {/* 缩放提示 */}
        <div className="absolute top-3 right-3 text-xs text-stone-400 bg-white/80 px-2 py-1 rounded">
          滚轮缩放 · 拖拽平移
        </div>
      </div>

      {/* 右侧详情面板 */}
      <div className={`${rightCollapsed ? 'w-10' : 'w-72'} border-l border-stone-200 bg-white flex flex-col overflow-hidden transition-all duration-200 flex-shrink-0`}>
        {!rightCollapsed ? (
          <>
            {selectedTopic ? (
              <>
                <div className="p-3 border-b border-stone-200">
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={() => setRightCollapsed(true)} className="p-1 hover:bg-stone-100 rounded text-stone-400">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                    <button
                      onClick={goPrev} disabled={currentIndex <= 0}
                      className="p-1 rounded hover:bg-stone-100 disabled:opacity-30"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <div className="text-xs text-stone-500">
                      {currentIndex + 1} / {orderedTopics.length}
                    </div>
                    <button
                      onClick={goNext} disabled={currentIndex < 0 || currentIndex >= orderedTopics.length - 1}
                      className="p-1 rounded hover:bg-stone-100 disabled:opacity-30"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  </div>
                  <h3 className="text-base font-semibold text-stone-800">{selectedTopic.title}</h3>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded">{TYPE_LABELS[selectedTopic.type]}</span>
                    {selectedTopic.importance === 'core' && (
                      <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded">核心</span>
                    )}
                    <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded">P.{selectedTopic.originalPageNumbers.join(',')}</span>
                    <span className="text-xs px-2 py-0.5 bg-stone-100 text-stone-600 rounded">{Math.round(selectedTopic.confidence * 100)}%</span>
                  </div>
                  <p className="text-sm text-stone-600 mt-2">{selectedTopic.learningGoal}</p>

                  <div className="flex gap-1 mt-3 border-b border-stone-200 overflow-x-auto">
                    {(['evidence', 'note', 'relations', 'structure'] as TabType[]).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
                          activeTab === tab ? 'border-stone-800 text-stone-800 font-medium' : 'border-transparent text-stone-500 hover:text-stone-700'
                        }`}
                      >
                        {tab === 'evidence' ? '原文' : tab === 'note' ? '笔记' : tab === 'relations' ? '关系' : '内部结构'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                  {activeTab === 'evidence' && (
                    <div className="space-y-2">
                      <div className="text-xs text-stone-500">
                        {selectedKp ? `共 ${selectedKp.source.evidence.length} 条原文证据` : `${selectedTopic.evidenceIds.length} 条证据`}
                      </div>
                      {(selectedKp?.source.evidence || []).map((ev, i) => (
                        <div key={ev.evidenceId} className="p-2 bg-stone-50 rounded border border-stone-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-stone-500">
                              [P.{ev.pageNumber}] · {ev.type}
                            </span>
                            <span className="text-xs text-stone-400">#{i + 1}</span>
                          </div>
                          <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                            {ev.originalText}
                          </p>
                        </div>
                      ))}
                      {!selectedKp && (
                        <div className="text-sm text-stone-400 text-center py-4">加载中...</div>
                      )}
                    </div>
                  )}

                  {activeTab === 'note' && selectedKp && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          selectedKp.topic.noteStatus === 'completed' ? 'bg-green-100 text-green-700' :
                          selectedKp.topic.noteStatus === 'failed' ? 'bg-red-100 text-red-700' :
                          selectedKp.topic.noteStatus === 'generating' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-stone-100 text-stone-600'
                        }`}>
                          {selectedKp.topic.noteStatus === 'completed' ? '已生成' :
                           selectedKp.topic.noteStatus === 'failed' ? '失败' :
                           selectedKp.topic.noteStatus === 'generating' ? '生成中' : '待生成'}
                        </span>
                        {(selectedKp.topic.noteStatus === 'failed' || selectedKp.topic.noteStatus === 'completed') && (
                          <button
                            onClick={() => onRegenerateNote(selectedTopic.id)}
                            className="text-xs text-red-600 hover:underline"
                          >重新生成</button>
                        )}
                      </div>
                      {selectedKp.note ? (
                        <div className="prose prose-sm max-w-none">
                          <div className="text-sm">
                            <MarkdownRenderer content={selectedKp.note.contentMarkdown} />
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-stone-400 text-center py-6">
                          确认结构后将生成笔记
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'note' && !selectedKp && (
                    <div className="text-sm text-stone-400 text-center py-6">加载中...</div>
                  )}

                  {activeTab === 'relations' && (
                    <div className="space-y-3">
                      {(() => {
                        const rels = getTopicRelations(selectedTopic.id, relations);
                        return (
                          <>
                            {rels.prerequisites.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-stone-500 mb-1">前置知识</h4>
                                {rels.prerequisites.map(r => {
                                  const src = topics.find(t => t.id === r.sourceTopicId);
                                  return (
                                    <button
                                      key={r.id}
                                      onClick={() => src && selectTopic(src.id)}
                                      className="block w-full text-left p-2 mb-1 rounded hover:bg-stone-100 border border-stone-200"
                                    >
                                      <div className="text-sm font-medium text-stone-700">{src?.title}</div>
                                      <div className="text-xs text-stone-400 mt-0.5">{RELATION_COLORS[r.type]?.label || r.type}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {rels.dependents.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-stone-500 mb-1">后续知识</h4>
                                {rels.dependents.map(r => {
                                  const tgt = topics.find(t => t.id === r.targetTopicId);
                                  return (
                                    <button
                                      key={r.id}
                                      onClick={() => tgt && selectTopic(tgt.id)}
                                      className="block w-full text-left p-2 mb-1 rounded hover:bg-stone-100 border border-stone-200"
                                    >
                                      <div className="text-sm font-medium text-stone-700">{tgt?.title}</div>
                                      <div className="text-xs text-stone-400 mt-0.5">{RELATION_COLORS[r.type]?.label || r.type}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {rels.related.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-stone-500 mb-1">相关知识</h4>
                                {rels.related.map(r => {
                                  const otherId = r.sourceTopicId === selectedTopic.id ? r.targetTopicId : r.sourceTopicId;
                                  const other = topics.find(t => t.id === otherId);
                                  return (
                                    <button
                                      key={r.id}
                                      onClick={() => other && selectTopic(other.id)}
                                      className="block w-full text-left p-2 mb-1 rounded hover:bg-stone-100 border border-stone-200"
                                    >
                                      <div className="text-sm font-medium text-stone-700">{other?.title}</div>
                                      <div className="text-xs text-stone-400 mt-0.5">{RELATION_COLORS[r.type]?.label || r.type}</div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {rels.prerequisites.length === 0 && rels.dependents.length === 0 && rels.related.length === 0 && (
                              <div className="text-sm text-stone-400 text-center py-4">暂无知识关系</div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {activeTab === 'structure' && (
                    <InternalStructureTab selectedKp={selectedKp} />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-stone-400 text-sm p-4 text-center">
                点击左侧列表或图中节点查看详情
              </div>
            )}
          </>
        ) : (
          <button onClick={() => setRightCollapsed(false)} className="p-3 hover:bg-stone-100 flex flex-col items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            <span className="text-xs" style={{ writingMode: 'vertical-rl' }}>详情</span>
          </button>
        )}
      </div>
    </div>
  );
}
