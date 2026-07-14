import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { JobProgress } from './progress/JobProgress';
import { JobBlockedState } from './progress/JobBlockedState';
import { JobFailureState } from './progress/JobFailureState';
import { KnowledgeNetworkCanvas } from './knowledge-network/KnowledgeNetworkCanvas';
import { SourceEvidencePanel } from './knowledge-network/SourceEvidencePanel';
import {
  buildCourseNetwork,
  buildExpandedKnowledgeNetwork,
  buildLegacyCourseNetwork,
  buildLegacySourceDocuments,
  buildLegacyTeachingNetwork,
  buildTeachingNetwork,
  type KnowledgeNetworkModel,
} from '../lib/knowledge-network-adapter';

interface KnowledgeStructureViewProps {
  onOpenSettings: () => void;
}

function NetworkEmptyState({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-[#f5f1e8]/88 px-8 text-center backdrop-blur-sm">
      <div className="max-w-sm rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#edf4ef] text-xl text-[#35695b]">网</div>
        <h3 className="font-song text-xl font-bold text-[#173f35]">该知识暂无内部结构</h3>
        <p className="mt-2 text-sm leading-6 text-stone-500">当前核心知识没有可展示的第二层节点。收起后可以继续查看其他节点。</p>
        <button type="button" onClick={onBack} className="mt-5 rounded-lg bg-[#173f35] px-4 py-2 text-sm font-medium text-white hover:bg-[#235549]">收起内部网</button>
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
  const document = useStore(state => state.document);
  const evidences = useStore(state => state.evidences);
  const legacyTopics = useStore(state => state.topics);
  const legacyRelations = useStore(state => state.macroRelations);
  const legacyPackages = useStore(state => state.knowledgePackages);
  const legacyLearningPath = useStore(state => state.learningPath);
  const structureExtractionStatus = useStore(state => state.structureExtractionStatus);
  const extractionErrors = useStore(state => state.extractionErrors);
  const jobStatus = useStore(state => state.jobStatus);
  const pipelineProgress = useStore(state => state.pipelineProgress);
  const navigateToStage = useStore(state => state.navigateToStage);

  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [relationType, setRelationType] = useState('all');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);

  const usesMarkdownArchitecture = sourceDocuments.length > 0 || knowledgeTopics.length > 0;
  const isRunning = jobStatus === 'running';
  const isBlocked = usesMarkdownArchitecture
    ? knowledgePipelineStatus === 'model-required'
    : structureExtractionStatus === 'model-required';
  const isFailed = usesMarkdownArchitecture
    ? knowledgePipelineStatus === 'failed'
    : structureExtractionStatus === 'failed';

  const courseNetwork = useMemo(
    () => usesMarkdownArchitecture
      ? buildCourseNetwork(knowledgeTopics, topicRelations, courseLearningPath)
      : buildLegacyCourseNetwork(legacyTopics, legacyRelations, legacyLearningPath, evidences),
    [courseLearningPath, evidences, knowledgeTopics, legacyLearningPath, legacyRelations, legacyTopics, topicRelations, usesMarkdownArchitecture],
  );
  const sourcePanelDocuments = useMemo(
    () => usesMarkdownArchitecture ? sourceDocuments : buildLegacySourceDocuments(evidences, document),
    [document, evidences, sourceDocuments, usesMarkdownArchitecture],
  );
  const selectedTopicLabel = expandedTopicId
    ? courseNetwork.nodes.find(node => node.id === expandedTopicId)?.label ?? null
    : null;
  const teachingNetwork = useMemo(
    () => expandedTopicId
      ? usesMarkdownArchitecture
        ? buildTeachingNetwork(
            expandedTopicId,
            teachingBlocks,
            teachingRelations,
            narrativePaths[expandedTopicId] ?? null,
          )
        : buildLegacyTeachingNetwork(expandedTopicId, legacyPackages, evidences)
      : { nodes: [], edges: [], pathEdges: [], warnings: [] },
    [evidences, expandedTopicId, legacyPackages, narrativePaths, teachingBlocks, teachingRelations, usesMarkdownArchitecture],
  );
  const currentNetwork: KnowledgeNetworkModel = useMemo(
    () => expandedTopicId
      ? buildExpandedKnowledgeNetwork(courseNetwork, teachingNetwork, expandedTopicId)
      : courseNetwork,
    [courseNetwork, expandedTopicId, teachingNetwork],
  );
  const selectedNode = currentNetwork.nodes.find(node => node.id === selectedNodeId) ?? null;
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
      <div className="flex-1 grid place-items-center bg-[#f5f1e8]">
        <div className="text-center">
          <p className="mb-4 text-stone-500">暂无知识结构数据</p>
          <button className="btn-primary" onClick={() => navigateToStage('mineru')}>返回 MinerU 解析</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-screen min-w-0 flex-col overflow-hidden bg-[#f5f1e8]">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-[#fffdfa] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('mineru')} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-[#173f35]" aria-label="返回 MinerU 解析">←</button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-song font-bold text-[#173f35]">课程知识网</span>
              {expandedTopicId && selectedTopicLabel && (
                <>
                  <span className="text-stone-300">/</span>
                  <span className="max-w-48 truncate font-song font-bold text-[#173f35]">{selectedTopicLabel}</span>
                  <span className="text-stone-300">/</span>
                  <span className="text-stone-500">内部网已展开</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {courseNetwork.nodes.length} 个核心知识 · {courseNetwork.edges.length} 个课程关系
              {expandedTopicId && ` · 展开 ${teachingNetwork.nodes.length} 个内部节点`}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <div className="relative w-full max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">⌕</span>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索课程与内部知识"
              className="h-9 w-full rounded-xl border border-stone-200 bg-white pl-8 pr-3 text-sm text-stone-700 outline-none transition focus:border-[#6f998b] focus:ring-2 focus:ring-[#6f998b]/15"
              aria-label="搜索知识节点"
            />
          </div>
          <select
            value={relationType}
            onChange={event => setRelationType(event.target.value)}
            className="h-9 max-w-36 rounded-xl border border-stone-200 bg-white px-3 text-xs text-stone-600 outline-none focus:border-[#6f998b]"
            aria-label="筛选关系类型"
          >
            <option value="all">全部关系</option>
            {presentRelationTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </select>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {currentNetwork.warnings.length > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700" title={currentNetwork.warnings.join('\n')}>{currentNetwork.warnings.length} 条数据警告</span>
          )}
          {!sourcePanelOpen && (
            <button type="button" onClick={() => setSourcePanelOpen(true)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-50">显示原文</button>
          )}
          <button type="button" onClick={() => navigateToStage('cards')} className="rounded-lg bg-[#c84b31] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#ae3f2a]">查看知识卡片</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <KnowledgeNetworkCanvas
            model={currentNetwork}
            selectedId={selectedNodeId}
            onSelect={selectNode}
            search={search}
            relationTypes={relationType === 'all' ? undefined : [relationType]}
            onCollapseExpandedGroup={expandedTopicId ? collapseTeachingNetwork : undefined}
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
