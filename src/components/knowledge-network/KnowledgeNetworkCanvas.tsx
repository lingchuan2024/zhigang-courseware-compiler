import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeNetworkModel, KnowledgeNetworkNode } from '../../lib/knowledge-network-adapter';
import { layoutKnowledgeNetwork } from '../../lib/knowledge-network-layout';

interface KnowledgeNetworkCanvasProps {
  model: KnowledgeNetworkModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  relationTypes?: string[];
  onCollapseExpandedGroup?: () => void;
  /** 需要重提取的节点（重解析后原文有变化的知识点）。 */
  staleNodeIds?: ReadonlySet<string>;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_COLORS: Record<string, string> = {
  hard_prerequisite: '#c63d2f',
  helpful_before: '#d97706',
  derived_from: '#356fa3',
  part_of: '#4b5563',
  application_of: '#5e7f68',
  extension_of: '#6d5b8c',
  contrast_with: '#9a5b42',
  parallel_with: '#7c766d',
  should_explain_before: '#c63d2f',
  defines: '#3f5d8a',
  explains: '#4d7c68',
  example_of: '#8a6d3b',
  supports: '#637a50',
  contrasts_with: '#9a5b42',
  qualifies: '#7c5b74',
  contains_internal: '#1f7667',
};

const CATEGORY_LABELS: Record<string, string> = {
  concept: '概念', mathematical_derivation: '数学推导', algorithm: '算法', system_mechanism: '机制',
  comparison: '对比', case_study: '案例', mixed: '综合', motivation: '动机', problem: '问题',
  prior_knowledge: '前置', intuition: '直觉', definition: '定义', property: '性质', formula: '公式',
  derivation: '推导', proof: '证明', procedure: '步骤', example: '案例', visualization: '图示',
  application: '应用', condition: '条件', limitation: '局限', misconception: '误区', conclusion: '结论', exercise: '练习',
};

function nodePalette(node: KnowledgeNetworkNode, selected: boolean): { fill: string; stroke: string; accent: string } {
  if (selected) return { fill: '#102238', stroke: '#78cde3', accent: '#ed8880' };
  if (node.kind === 'topic' && node.importance === 'core') return { fill: '#0d2132', stroke: '#4fa7bd', accent: '#ffbd72' };
  if (node.kind === 'topic') return { fill: '#0a1a2a', stroke: '#31536d', accent: '#78cde3' };
  if (node.kind === 'teaching') {
    if (['formula', 'derivation', 'proof'].includes(node.category)) return { fill: '#0b1727', stroke: '#587ba1', accent: '#8fb9e8' };
    if (['example', 'application', 'visualization'].includes(node.category)) return { fill: '#18160f', stroke: '#8f7542', accent: '#e2ba65' };
    if (['limitation', 'misconception', 'condition'].includes(node.category)) return { fill: '#1d1117', stroke: '#8f5559', accent: '#ed8880' };
  }
  return { fill: '#0a1625', stroke: '#31536d', accent: '#78cde3' };
}

function titleLines(label: string): string[] {
  if (label.length <= 12) return [label];
  if (label.length <= 24) return [label.slice(0, 12), label.slice(12)];
  return [label.slice(0, 12), `${label.slice(12, 23)}…`];
}

export function KnowledgeNetworkCanvas({
  model,
  selectedId,
  onSelect,
  search,
  relationTypes,
  onCollapseExpandedGroup,
  staleNodeIds,
}: KnowledgeNetworkCanvasProps) {
  const filteredEdges = useMemo(() => {
    if (!relationTypes || relationTypes.length === 0) return model.edges;
    const allowed = new Set(relationTypes);
    return model.edges.filter(edge => allowed.has(edge.type));
  }, [model.edges, relationTypes]);
  const layout = useMemo(
    () => layoutKnowledgeNetwork(model.nodes, filteredEdges),
    [model.nodes, filteredEdges],
  );
  const [viewBox, setViewBox] = useState<ViewBox>(layout.bounds);
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);
  useEffect(() => {
    const focusIds = model.focusNodeIds ?? [];
    const positions = focusIds
      .map(id => layout.positions.get(id))
      .filter((position): position is NonNullable<typeof position> => Boolean(position));
    if (positions.length === 0) {
      setViewBox(layout.bounds);
      return;
    }
    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    const maxX = Math.max(...positions.map(position => position.x + position.width));
    const maxY = Math.max(...positions.map(position => position.y + position.height));
    const paddingX = Math.max(100, (maxX - minX) * 0.18);
    const paddingY = Math.max(80, (maxY - minY) * 0.24);
    setViewBox({
      x: minX - paddingX,
      y: minY - paddingY,
      width: Math.max(420, maxX - minX + paddingX * 2),
      height: Math.max(300, maxY - minY + paddingY * 2),
    });
  }, [layout.bounds, layout.positions, model.focusNodeIds]);

  const resetView = useCallback(() => setViewBox(layout.bounds), [layout.bounds]);
  const zoom = useCallback((factor: number) => {
    setViewBox(current => {
      const width = Math.max(layout.bounds.width * 0.22, Math.min(layout.bounds.width * 4, current.width * factor));
      const height = current.height * (width / current.width);
      return {
        x: current.x + (current.width - width) / 2,
        y: current.y + (current.height - height) / 2,
        width,
        height,
      };
    });
  }, [layout.bounds.width]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const searchHits = useMemo(() => new Set(model.nodes
    .filter(node => !normalizedSearch || `${node.label} ${node.description}`.toLocaleLowerCase().includes(normalizedSearch))
    .map(node => node.id)), [model.nodes, normalizedSearch]);
  const neighbors = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    for (const edge of filteredEdges) {
      if (edge.sourceId === selectedId) ids.add(edge.targetId);
      if (edge.targetId === selectedId) ids.add(edge.sourceId);
    }
    return ids;
  }, [filteredEdges, selectedId]);
  const relationLegend = useMemo(() => {
    const map = new Map<string, string>();
    filteredEdges.forEach(edge => map.set(edge.type, edge.label));
    return Array.from(map.entries());
  }, [filteredEdges]);
  const expandedGroupBounds = useMemo(() => {
    if (!model.expandedGroup) return null;
    const positions = model.expandedGroup.nodeIds
      .map(id => layout.positions.get(id))
      .filter((position): position is NonNullable<typeof position> => Boolean(position));
    if (positions.length === 0) return null;
    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    const maxX = Math.max(...positions.map(position => position.x + position.width));
    const maxY = Math.max(...positions.map(position => position.y + position.height));
    return {
      x: minX - 34,
      y: minY - 62,
      width: maxX - minX + 68,
      height: maxY - minY + 96,
    };
  }, [layout.positions, model.expandedGroup]);

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden bg-space-950"
      data-testid="knowledge-network-canvas"
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,205,227,.09) 1px, transparent 0)',
        backgroundSize: '22px 22px',
      }}
    >
      {model.nodes.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-space-muted">当前层没有可展示的知识节点</div>
      ) : (
        <svg
          className="w-full h-full select-none"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          aria-label="知识网络画布"
          onWheel={event => {
            event.preventDefault();
            zoom(event.deltaY > 0 ? 1.12 : 0.88);
          }}
          onMouseDown={event => {
            if ((event.target as Element).closest('[data-node], [data-expanded-group-control]')) return;
            dragRef.current = { x: event.clientX, y: event.clientY, viewX: viewBox.x, viewY: viewBox.y };
          }}
          onMouseMove={event => {
            if (!dragRef.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dx = (event.clientX - dragRef.current.x) * (viewBox.width / rect.width);
            const dy = (event.clientY - dragRef.current.y) * (viewBox.height / rect.height);
            setViewBox(current => ({ ...current, x: dragRef.current!.viewX - dx, y: dragRef.current!.viewY - dy }));
          }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; }}
        >
          <defs>
            <marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
            <filter id="selected-node-glow" x="-30%" y="-40%" width="160%" height="180%">
              <feDropShadow dx="0" dy="3" stdDeviation="7" floodColor="#78cde3" floodOpacity="0.24" />
            </filter>
          </defs>

          {model.expandedGroup && expandedGroupBounds && (
            <g data-testid="expanded-network-group">
              <rect
                x={expandedGroupBounds.x}
                y={expandedGroupBounds.y}
                width={expandedGroupBounds.width}
                height={expandedGroupBounds.height}
                rx="28"
                fill="#07101d"
                fillOpacity="0.94"
                stroke="#31536d"
                strokeWidth="1.8"
                strokeDasharray="7 5"
              />
              <g
                role="button"
                tabIndex={0}
                aria-label="收起内部知识网"
                data-expanded-group-control
                className="cursor-pointer outline-none"
                onClick={event => {
                  event.stopPropagation();
                  onCollapseExpandedGroup?.();
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  onCollapseExpandedGroup?.();
                }}
              >
                <circle
                  cx={expandedGroupBounds.x + 23}
                  cy={expandedGroupBounds.y + 24}
                  r="14"
                  fill="#102238"
                  stroke="#78cde3"
                  strokeWidth="1.5"
                />
                <text
                  x={expandedGroupBounds.x + 23}
                  y={expandedGroupBounds.y + 29}
                  textAnchor="middle"
                  fontSize="17"
                  fontWeight="700"
                  fill="#edf7fc"
                >×</text>
              </g>
              <text
                x={expandedGroupBounds.x + 46}
                y={expandedGroupBounds.y + 29}
                fontSize="12"
                fontWeight="700"
                fill="#b1c3d1"
              >{model.expandedGroup.label}</text>
            </g>
          )}

          {filteredEdges.map(edge => {
            const path = layout.edgePaths.get(edge.id);
            if (!path) return null;
            const connected = Boolean(selectedId) && (edge.sourceId === selectedId || edge.targetId === selectedId);
            const color = EDGE_COLORS[edge.type] ?? '#7b807c';
            const source = layout.positions.get(edge.sourceId);
            const target = layout.positions.get(edge.targetId);
            const labelX = source && target ? (source.x + source.width / 2 + target.x + target.width / 2) / 2 : 0;
            const labelY = source && target ? (source.y + source.height / 2 + target.y + target.height / 2) / 2 - 7 : 0;
            return (
              <g key={edge.id} opacity={selectedId ? (connected ? 0.9 : 0.08) : 0.34} data-edge={edge.id}>
                <path d={path} fill="none" stroke={color} strokeWidth={connected && selectedId ? 2.4 : 1.6} markerEnd="url(#network-arrow)" />
                {connected && selectedId && (
                  <text x={labelX} y={labelY} textAnchor="middle" fontSize="10" fill={color} paintOrder="stroke" stroke="#010207" strokeWidth="4">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {model.nodes.map(node => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            const selected = selectedId === node.id;
            const inNeighborhood = !selectedId || neighbors.has(node.id);
            const isSearchHit = !normalizedSearch || searchHits.has(node.id);
            const opacity = (inNeighborhood && isSearchHit) ? 1 : 0.32;
            const palette = nodePalette(node, selected);
            const lines = titleLines(node.label);
            return (
              <g
                key={node.id}
                data-node={node.id}
                data-network-layer={node.kind === 'topic' ? 'course' : 'internal'}
                role="button"
                tabIndex={0}
                aria-label={node.label}
                aria-selected={selected}
                transform={`translate(${position.x} ${position.y})`}
                opacity={opacity}
                className="outline-none cursor-pointer"
                style={{ transition: 'opacity 160ms ease' }}
                filter={selected ? 'url(#selected-node-glow)' : undefined}
                onClick={event => { event.stopPropagation(); onSelect(node.id); }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect(node.id);
                }}
              >
                <rect
                  x={node.kind === 'teaching' ? 7 : 0}
                  y={node.kind === 'teaching' ? 5 : 0}
                  width={position.width - (node.kind === 'teaching' ? 14 : 0)}
                  height={position.height - (node.kind === 'teaching' ? 10 : 0)}
                  rx={node.kind === 'topic' ? 15 : 12}
                  fill={palette.fill}
                  stroke={palette.stroke}
                  strokeWidth={selected ? 3 : node.kind === 'topic' ? 2 : 1.5}
                />
                <rect x={node.kind === 'teaching' ? 7 : 0} y={node.kind === 'teaching' ? 5 : 0} width="6" height={position.height - (node.kind === 'teaching' ? 10 : 0)} rx="3" fill={palette.accent} opacity={selected ? 1 : 0.78} />
                {node.sequence !== undefined && (
                  <g aria-label={`遍历顺序 ${node.sequenceLabel ?? node.sequence}`}>
                    <circle cx="22" cy="21" r={node.sequenceLabel ? 13 : 11} fill={node.kind === 'topic' || selected ? '#f4d8a8' : palette.accent} opacity={selected ? 1 : 0.92} />
                    <text x="22" y="25" textAnchor="middle" fontSize={node.sequenceLabel ? 9 : 10} fontWeight="800" fill="#07101d">{node.sequenceLabel ?? node.sequence}</text>
                  </g>
                )}
                <text x={node.sequence !== undefined ? 43 : 17} y="25" fontSize="13" fontWeight="700" fill="#edf7fc">
                  {lines[0]}
                </text>
                {lines[1] && <text x="17" y="43" fontSize="12" fontWeight="600" fill="#b1c3d1">{lines[1]}</text>}
                <text x="17" y={position.height - 13} fontSize="10" fill={selected || node.kind === 'topic' ? '#8ea6b7' : palette.accent}>
                  {CATEGORY_LABELS[node.category] ?? node.category} · {node.sourceRanges.length} 处原文
                </text>
                {node.kind === 'topic' && node.importance === 'core' && (
                  <text x={position.width - 12} y="18" textAnchor="end" fontSize="10" fontWeight="700" fill="#f4d8a8">核心</text>
                )}
                {staleNodeIds?.has(node.id) && (
                  <text
                    x={position.width - 10}
                    y={node.kind === 'topic' && node.importance === 'core' ? 34 : 20}
                    textAnchor="end"
                    fontSize="10"
                    fontWeight="700"
                    fill="#f5b544"
                    aria-label={`${node.label} 需更新`}
                  >
                    需更新
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-space-border bg-space-850/90 p-1 shadow-sm backdrop-blur">
        <button type="button" className="h-8 w-8 rounded-lg text-ink-light hover:bg-space-750" onClick={() => zoom(0.82)} aria-label="放大知识网">＋</button>
        <button type="button" className="h-8 w-8 rounded-lg text-ink-light hover:bg-space-750" onClick={() => zoom(1.22)} aria-label="缩小知识网">－</button>
        <button type="button" className="h-8 rounded-lg px-2 text-xs text-ink-light hover:bg-space-750" onClick={resetView} aria-label="适应画布">适应</button>
      </div>

      {filteredEdges.length === 0 && model.nodes.length > 0 && (
        <div className="absolute left-3 top-3 rounded-lg border border-amber-400/30 bg-space-850/95 px-3 py-2 text-xs text-amber-300 shadow-sm">
          当前仅提取到内容节点，尚无可显示的关系
        </div>
      )}

      {relationLegend.length > 0 && (
        <div className="absolute bottom-3 left-3 max-w-[70%] rounded-xl border border-space-border bg-space-850/92 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-space-muted">
            {relationLegend.map(([type, label]) => (
              <span key={type} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded" style={{ backgroundColor: EDGE_COLORS[type] ?? '#7b807c' }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
