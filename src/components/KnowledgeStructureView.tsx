import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { JobProgress } from './progress/JobProgress';
import { JobBlockedState } from './progress/JobBlockedState';
import { JobFailureState } from './progress/JobFailureState';
import { KnowledgeNetworkCanvas } from './knowledge-network/KnowledgeNetworkCanvas';
import { SourceEvidencePanel } from './knowledge-network/SourceEvidencePanel';
import {
  buildCourseNetwork,
  buildTeachingNetwork,
  type KnowledgeNetworkModel,
} from '../lib/knowledge-network-adapter';

interface KnowledgeStructureViewProps {
  onOpenSettings: () => void;
}

function NetworkEmptyState({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-space-950/80 px-8 text-center backdrop-blur-sm">
      <div className="max-w-sm rounded-2xl border border-space-border bg-space-850 p-7 shadow-2xl">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-celadon/10 text-xl text-celadon-light">网</div>
        <h3 className="font-song text-xl font-bold text-space-text">该知识暂无内部结构</h3>
        <p className="mt-2 text-sm leading-6 text-space-muted">当前核心知识没有可展示的第二层节点。收起后可以继续查看其他节点。</p>
        <button type="button" onClick={onBack} className="btn-primary mt-5">收起内部网</button>
      </div>
    </div>
  );
}

export function KnowledgeStructureView({ onOpenSettings }: KnowledgeStructureViewProps) {
  const sourceDocuments = useStore(state => state.sourceDocuments);
  const knowledgeTopics = useStore(state => state.knowledgeTopics);
  const topicRelations = useStore(state => state.topicRelations);
  const teachingBlocks = useStore(state => state.teachingBlocks);
  const teachingRelations = useStore(state => state.teachingRelations);
  const courseLearningPath = useStore(state => state.courseLearningPath);
  const narrativePaths = useStore(state => state.narrativePaths);
  const knowledgePipelineStatus = useStore(state => state.knowledgePipelineStatus);
  const structureExtractionStatus = useStore(state => state.structureExtractionStatus);
  const extractionErrors = useStore(state => state.extractionErrors);
  const jobStatus = useStore(state => state.jobStatus);
  const pipelineProgress = useStore(state => state.pipelineProgress);
  const navigateToStage = useStore(state => state.navigateToStage);
  const staleMarker = useStore(state => state.staleMarker);
  const structureQuality = useStore(state => state.structureQuality);

  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [relationType, setRelationType] = useState('all');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);

  const isRunning = jobStatus === 'running';
  const isBlocked = knowledgePipelineStatus === 'model-required';
  const isFailed = knowledgePipelineStatus === 'failed' || structureExtractionStatus === 'failed';

  const courseNetwork = useMemo(
    () => buildCourseNetwork(knowledgeTopics, topicRelations, courseLearningPath),
    [courseLearningPath, knowledgeTopics, topicRelations],
  );
  const sourcePanelDocuments = sourceDocuments;
  const selectedTopicLabel = expandedTopicId
    ? courseNetwork.nodes.find(node => node.id === expandedTopicId)?.label ?? null
    : null;
  const teachingNetwork = useMemo(
    () => expandedTopicId
      ? buildTeachingNetwork(
          expandedTopicId,
          teachingBlocks,
          teachingRelations,
          narrativePaths[expandedTopicId] ?? null,
        )
      : { nodes: [], edges: [], pathEdges: [], warnings: [] },
    [expandedTopicId, narrativePaths, teachingBlocks, teachingRelations],
  );
  const staleNodeIds = useMemo(
    () => new Set(staleMarker?.affectedTopicIds ?? []),
    [staleMarker],
  );
  const currentNetwork: KnowledgeNetworkModel = useMemo(
    () => expandedTopicId ? teachingNetwork : courseNetwork,
    [courseNetwork, expandedTopicId, teachingNetwork],
  );
  const canvasSelectedNodeId = selectedNodeId && currentNetwork.nodes.some(node => node.id === selectedNodeId)
    ? selectedNodeId
    : null;
  const selectedNode = currentNetwork.nodes.find(node => node.id === selectedNodeId)
    ?? courseNetwork.nodes.find(node => node.id === selectedNodeId)
    ?? null;
  const selectedRelationCount = selectedNode
    ? currentNetwork.edges.filter(edge => edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id).length
    : 0;
  const presentRelationTypes = useMemo(() => {
    const labels = new Map<string, string>();
    currentNetwork.edges.forEach(edge => labels.set(edge.type, edge.label));
    return Array.from(labels.entries());
  }, [currentNetwork.edges]);

  useEffect(() => {
    if (expandedTopicId && !courseNetwork.nodes.some(topic => topic.id === expandedTopicId)) {
      setExpandedTopicId(null);
      setSelectedNodeId(null);
    }
  }, [courseNetwork.nodes, expandedTopicId]);

  useEffect(() => {
    setRelationType('all');
    setSearch('');
  }, [expandedTopicId]);

  const selectNode = (id: string) => {
    setSelectedNodeId(id);
    if (courseNetwork.nodes.some(topic => topic.id === id)) {
      setExpandedTopicId(id);
    }
    setSourcePanelOpen(true);
  };

  const collapseTeachingNetwork = () => {
    setSelectedNodeId(expandedTopicId);
    setExpandedTopicId(null);
    setSourcePanelOpen(true);
  };

  if (isRunning) return <JobProgress progress={pipelineProgress} />;

  if (isBlocked) {
    return (
      <JobBlockedState
        title="需要配置 AI 模型"
        message="请先配置 AI 模型后再提取知识结构"
        onConfigureModel={onOpenSettings}
        onGoBack={() => navigateToStage('mineru')}
        goBackLabel="返回 MinerU 解析"
      />
    );
  }

  if (isFailed) {
    return (
      <JobFailureState
        errors={extractionErrors.length > 0 ? extractionErrors : pipelineProgress.message ? [pipelineProgress.message] : ['知识提取失败']}
        failedStage={pipelineProgress.failedStage}
        failedWindowIndex={pipelineProgress.failedWindowIndex}
        onBack={() => navigateToStage('mineru')}
        backLabel="返回 MinerU 解析"
      />
    );
  }

  if (courseNetwork.nodes.length === 0) {
    return (
      <div className="grid flex-1 place-items-center bg-space-950/[0.56]">
        <div className="text-center">
          <p className="mb-4 text-space-muted">暂无知识结构数据</p>
          <button className="btn-primary" onClick={() => navigateToStage('mineru')}>返回 MinerU 解析</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950/[0.54]">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between gap-4 border-b border-space-border bg-space-900/[0.94] px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('mineru')} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-white" aria-label="返回 MinerU 解析">←</button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-song font-bold text-space-text">课程知识网</span>
              {expandedTopicId && selectedTopicLabel && (
                <>
                  <span className="text-space-border-strong">/</span>
                  <span className="max-w-48 truncate font-song font-bold text-space-text">{selectedTopicLabel}</span>
                  <span className="text-space-border-strong">/</span>
                  <span className="text-space-muted">二级知识网</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-space-muted">
              {courseNetwork.nodes.length} 个核心知识 · {courseNetwork.edges.length} 个课程关系
              {structureQuality && (
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${structureQuality.coverageRate >= 0.9 ? 'bg-celadon/12 text-celadon-light' : 'bg-amber-400/12 text-amber-300'}`}
                  title={`内容块分配到知识结构的比例（${structureQuality.assignedBlocks}/${structureQuality.totalBlocks} 块）`}
                >
                  内容覆盖率 {Math.round(structureQuality.coverageRate * 100)}%
                </span>
              )}
              {staleMarker?.reason === 'source-reparsed' && staleNodeIds.size > 0 && (
                <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-300">
                  重解析：{staleNodeIds.size} 个知识点需更新
                </span>
              )}
              {expandedTopicId && ` · ${teachingNetwork.nodes.length} 个二级节点`}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <div className="relative w-full max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-space-muted">⌕</span>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={expandedTopicId ? '搜索二级知识' : '搜索课程知识'}
              className="h-9 w-full rounded-xl border border-space-border bg-space-850 pl-8 pr-3 text-sm text-space-text outline-none transition placeholder:text-space-muted/60 focus:border-celadon/60 focus:ring-2 focus:ring-celadon/10"
              aria-label="搜索知识节点"
            />
          </div>
          <select
            value={relationType}
            onChange={event => setRelationType(event.target.value)}
            className="h-9 max-w-36 rounded-xl border border-space-border bg-space-850 px-3 text-xs text-ink-light outline-none focus:border-celadon/60"
            aria-label="筛选关系类型"
          >
            <option value="all">全部关系</option>
            {presentRelationTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </select>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {currentNetwork.warnings.length > 0 && (
            <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300" title={currentNetwork.warnings.join('\n')}>{currentNetwork.warnings.length} 条数据警告</span>
          )}
          {!sourcePanelOpen && (
            <button type="button" onClick={() => setSourcePanelOpen(true)} className="rounded-lg border border-space-border px-3 py-2 text-xs text-ink-light hover:bg-space-750">显示原文</button>
          )}
          <button type="button" onClick={() => navigateToStage('cards')} className="btn-primary">查看知识卡片</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {expandedTopicId && (
            <button
              type="button"
              aria-label="关闭二级知识网"
              onClick={collapseTeachingNetwork}
              className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-xl border border-celadon/35 bg-space-850/95 px-3 py-2 text-sm font-medium text-celadon-light shadow-sm backdrop-blur hover:bg-space-750"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-celadon/10 text-lg leading-none">×</span>
              <span className="max-w-52 truncate">{selectedTopicLabel}</span>
            </button>
          )}
          <KnowledgeNetworkCanvas
            model={currentNetwork}
            selectedId={canvasSelectedNodeId}
            onSelect={selectNode}
            search={search}
            relationTypes={relationType === 'all' ? undefined : [relationType]}
            staleNodeIds={staleNodeIds}
          />
          {expandedTopicId && teachingNetwork.nodes.length === 0 && <NetworkEmptyState onBack={collapseTeachingNetwork} />}
        </main>

        {sourcePanelOpen && (
          <SourceEvidencePanel
            node={selectedNode}
            documents={sourcePanelDocuments}
            relationCount={selectedRelationCount}
            onClose={() => setSourcePanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
