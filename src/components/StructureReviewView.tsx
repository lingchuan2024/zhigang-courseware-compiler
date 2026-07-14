import { useState } from 'react';
import { useStore } from '../store/useStore';
import { KnowledgeGraph } from './KnowledgeGraph';
import { summarizeQualityReport } from '../lib/topic-quality';
import { JobProgress } from './progress/JobProgress';
import { JobBlockedState } from './progress/JobBlockedState';
import { JobFailureState } from './progress/JobFailureState';
import type { RecommendedLearningPath, TopicQualityReport } from '../types';

const PATH_SOURCE_LABELS: Record<string, string> = {
  'deterministic': '确定性排序',
  'ai-assisted': 'AI辅助排序',
  'fallback': '降级排序',
};

const PATH_SOURCE_COLORS: Record<string, string> = {
  'deterministic': 'bg-stone-100 text-stone-600',
  'ai-assisted': 'bg-blue-100 text-blue-700',
  'fallback': 'bg-amber-100 text-amber-700',
};

const STRUCTURE_SOURCE_LABELS: Record<string, string> = {
  'ai': 'AI分析',
  'local': '本地规则',
  'ai-fallback': 'AI降级',
  'failed': '提取失败',
};

const STRUCTURE_SOURCE_COLORS: Record<string, string> = {
  'ai': 'bg-blue-100 text-blue-700',
  'local': 'bg-stone-100 text-stone-600',
  'ai-fallback': 'bg-amber-100 text-amber-700',
  'failed': 'bg-red-100 text-red-700',
};

type ViewMode = 'network' | 'chapters' | 'quality';

interface StructureReviewViewProps {
  onOpenSettings: () => void;
}

export function StructureReviewView({ onOpenSettings }: StructureReviewViewProps) {
  const topics = useStore(s => s.topics);
  const relations = useStore(s => s.macroRelations);
  const packages = useStore(s => s.knowledgePackages);
  const orderMode = useStore(s => s.orderMode);
  const structureSource = useStore(s => s.structureSource);
  const structureWarnings = useStore(s => s.structureWarnings);
  const learningPath = useStore(s => s.learningPath);
  const modelConfig = useStore(s => s.modelConfig);
  const qualityReport = useStore(s => s.qualityReport);
  const setOrderMode = useStore(s => s.setOrderMode);
  const regenerateStructure = useStore(s => s.regenerateKnowledgeStructure);
  const startNoteGeneration = useStore(s => s.startNoteGeneration);
  const navigateToStage = useStore(s => s.navigateToStage);
  const regenerateNoteForTopic = useStore(s => s.regenerateNoteForTopic);
  const evidences = useStore(s => s.evidences);
  const job = useStore(s => s.job);
  const jobStatus = useStore(s => s.jobStatus);
  const structureExtractionStatus = useStore(s => s.structureExtractionStatus);
  const extractionErrors = useStore(s => s.extractionErrors);
  const pipelineProgress = useStore(s => s.pipelineProgress);

  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('network');

  const isStructureRunning = jobStatus === 'running' && [
    'extracting-topics', 'repairing-topics', 'extracting-relations', 'building-internal-structure'
  ].includes(job || '');
  const isBlocked = structureExtractionStatus === 'model-required' || (jobStatus === 'blocked' && !topics.length);
  const isFailed = structureExtractionStatus === 'failed' && topics.length === 0;

  const handleGenerateNotes = async () => {
    setIsGeneratingNotes(true);
    try {
      await startNoteGeneration();
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await regenerateStructure();
    } finally {
      setIsRegenerating(false);
    }
  };

  // ============== 内联进度状态 ==============

  if (isStructureRunning) {
    return (
      <JobProgress
        title="正在构建知识结构"
        progress={pipelineProgress}
        warnings={structureWarnings}
      />
    );
  }

  if (isBlocked) {
    return (
      <JobBlockedState
        title="知识结构尚未开始"
        message="请先配置 AI 模型"
        onConfigureModel={onOpenSettings}
        onGoBack={() => navigateToStage('document')}
        goBackLabel="返回课件预览"
      />
    );
  }

  if (isFailed) {
    return (
      <JobFailureState
        title="知识结构提取失败"
        message={extractionErrors[0] || 'AI知识点提取失败，请检查模型配置后重试'}
        errors={extractionErrors}
        failedStage={pipelineProgress.failedStage}
        failedWindowIndex={pipelineProgress.failedWindowIndex}
        onRetry={handleRegenerate}
        onBack={() => navigateToStage('document')}
        backLabel="返回课件预览"
      />
    );
  }

  if (topics.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-stone-500 mb-4">知识结构尚未生成</p>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="px-4 py-2 bg-celadon text-white rounded hover:bg-celadon/90 disabled:opacity-50 font-ui font-medium transition-colors"
          >
            {isRegenerating ? '生成中...' : '生成知识结构'}
          </button>
        </div>
      </div>
    );
  }

  const sourceLabel = STRUCTURE_SOURCE_LABELS[structureSource] || structureSource;
  const sourceColor = STRUCTURE_SOURCE_COLORS[structureSource] || 'bg-stone-100 text-stone-600';
  const hasWarnings = structureWarnings.length > 0;
  const hasPathInfo = learningPath !== null;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* 顶部栏 */}
      <header className="bg-white border-b border-stone-200 px-4 py-2 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToStage('document')}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-500"
            disabled={isGeneratingNotes || isRegenerating}
            aria-label="返回课件预览"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <h2 className="text-base font-semibold text-stone-800 font-ui">知识结构</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${sourceColor}`}>
                {sourceLabel}
              </span>
              <span className="text-xs text-stone-500 font-ui">
                {topics.length} 个知识点 · {relations.length} 个关系
              </span>
              {hasWarnings && (
                <button
                  onClick={() => setShowWarnings(!showWarnings)}
                  className="text-xs px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                >
                  {structureWarnings.length} 条警告 {showWarnings ? '▲' : '▼'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 视图切换 */}
        <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-0.5">
          <ViewTab label="知识网" active={viewMode === 'network'} onClick={() => setViewMode('network')} />
          <ViewTab label="章节目录" active={viewMode === 'chapters'} onClick={() => setViewMode('chapters')} />
          <ViewTab
            label="质量诊断"
            active={viewMode === 'quality'}
            onClick={() => setViewMode('quality')}
            badge={qualityReport?.needsRepair ? '!' : undefined}
          />
        </div>

        <div className="flex items-center gap-2">
          {isRegenerating && (
            <span className="text-sm text-stone-500 animate-pulse">重新分析中...</span>
          )}
          {/* 主按钮：生成学习笔记 */}
          <button
            onClick={handleGenerateNotes}
            disabled={isGeneratingNotes || isRegenerating}
            className="px-4 py-1.5 bg-celadon text-white rounded-lg text-sm font-medium hover:bg-celadon/90 transition-colors disabled:opacity-50 font-ui"
          >
            {isGeneratingNotes ? '生成中...' : '生成学习笔记'}
          </button>
        </div>
      </header>

      {/* 警告折叠区 */}
      {hasWarnings && showWarnings && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex-shrink-0">
          <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
            {structureWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* 学习路径信息 */}
      {hasPathInfo && learningPath && viewMode === 'network' && (
        <LearningPathInfo path={learningPath} />
      )}

      {/* Stale 提示 */}
      {useStore.getState().staleMarker && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-sm text-amber-700">
            证据已修改，当前知识结构需要更新
          </span>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="text-xs text-amber-700 font-medium hover:text-amber-900 px-3 py-1 rounded hover:bg-amber-100 disabled:opacity-50"
          >
            {isRegenerating ? '更新中...' : '重新提取'}
          </button>
        </div>
      )}

      {/* 辅助操作栏 */}
      <div className="bg-white border-b border-stone-100 px-4 py-1.5 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-100 disabled:opacity-50 font-ui"
        >
          重新提取
        </button>
        <button
          onClick={() => setViewMode('network')}
          className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-100 font-ui"
        >
          调整结构
        </button>
        <button
          onClick={() => navigateToStage('document')}
          className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-100 font-ui"
        >
          查看来源
        </button>
      </div>

      {/* 视图内容 */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'network' && (
          <KnowledgeGraph
            topics={topics}
            relations={relations}
            packages={packages}
            orderMode={orderMode}
            structureSource={structureSource}
            structureWarnings={structureWarnings}
            hasModelConfig={!!modelConfig?.apiKey}
            onOrderModeChange={setOrderMode}
            onRegenerate={handleRegenerate}
            onConfirm={handleGenerateNotes}
            onRegenerateNote={regenerateNoteForTopic}
          />
        )}
        {viewMode === 'chapters' && (
          <ChapterDirectoryView topics={topics} packages={packages} evidences={evidences} />
        )}
        {viewMode === 'quality' && (
          <QualityDiagnosticsView report={qualityReport} topics={topics} evidences={evidences} />
        )}
      </div>

      {isGeneratingNotes && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl flex items-center gap-4">
            <div className="w-6 h-6 border-3 border-stone-200 border-t-celadon rounded-full animate-spin"></div>
            <div>
              <p className="text-stone-800 font-medium font-ui">正在生成学习笔记...</p>
              <p className="text-xs text-stone-500 mt-1">AI 正在逐知识点生成笔记，请稍候</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View Tab                                                            */
/* ------------------------------------------------------------------ */

function ViewTab({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-ui rounded-md transition-colors relative ${
        active ? 'bg-white text-ink shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
      }`}
    >
      {label}
      {badge && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-cinnabar text-white text-xs rounded-full flex items-center justify-center font-mono">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter Directory View                                              */
/* ------------------------------------------------------------------ */

function ChapterDirectoryView({
  topics,
  packages,
  evidences,
}: {
  topics: import('../types').CourseTopic[];
  packages: import('../types').KnowledgePackage[];
  evidences: import('../types').EvidenceAtom[];
}) {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const toggleTopic = (id: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 按重要性分组
  const coreTopics = topics.filter(t => t.importance === 'core');
  const supplementaryTopics = topics.filter(t => t.importance !== 'core');
  const packageMap = new Map(packages.map(p => [p.topic.id, p]));

  // 获取知识点覆盖的页码范围
  const getTopicPages = (topic: import('../types').CourseTopic): string => {
    const pages = new Set<number>();
    for (const evId of topic.evidenceIds) {
      const ev = evidences.find(e => e.id === evId);
      if (ev) pages.add(ev.pageNumber);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    if (sorted.length === 0) return '无';
    if (sorted.length <= 3) return sorted.map(p => `P${p}`).join(', ');
    return `P${sorted[0]}-P${sorted[sorted.length - 1]} (${sorted.length}页)`;
  };

  return (
    <div className="h-full overflow-y-auto bg-paper/30">
      <div className="max-w-3xl mx-auto p-6">
        {/* 核心知识点 */}
        {coreTopics.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-ui font-medium text-ink mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-ink rounded-full" />
              核心知识点 ({coreTopics.length})
            </h3>
            <div className="space-y-2">
              {coreTopics.map(topic => {
                const kp = packageMap.get(topic.id);
                const isExpanded = expandedTopics.has(topic.id);
                const internalCount = kp?.internalStructure.items.length || 0;
                return (
                  <div key={topic.id} className="bg-white rounded-lg border border-stone-200 overflow-hidden">
                    <button
                      onClick={() => toggleTopic(topic.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-stone-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <svg
                          className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                        <span className="font-ui font-medium text-ink truncate">{topic.title}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-stone-500 font-mono flex-shrink-0">
                        <span>{topic.evidenceIds.length} 证据</span>
                        <span>{internalCount} 内部内容</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 pl-11 space-y-2">
                        <div className="text-xs text-stone-500 font-ui">
                          <span className="text-stone-400">学习目标：</span>
                          {topic.learningGoal || '未设置'}
                        </div>
                        <div className="text-xs text-stone-500 font-mono">
                          <span className="text-stone-400">覆盖页码：</span>
                          {getTopicPages(topic)}
                        </div>
                        {kp && kp.internalStructure.items.length > 0 && (
                          <div className="text-xs text-stone-500">
                            <span className="text-stone-400 font-ui">内部内容：</span>
                            <div className="mt-1 space-y-0.5">
                              {kp.internalStructure.items.slice(0, 8).map((item, i) => (
                                <div key={i} className="font-ui text-stone-600 pl-2">
                                  · {item.title}
                                </div>
                              ))}
                              {kp.internalStructure.items.length > 8 && (
                                <div className="text-stone-400 pl-2">...共 {kp.internalStructure.items.length} 项</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 辅助知识点 */}
        {supplementaryTopics.length > 0 && (
          <div>
            <h3 className="text-sm font-ui font-medium text-stone-500 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-stone-300 rounded-full" />
              辅助知识点 ({supplementaryTopics.length})
            </h3>
            <div className="space-y-1">
              {supplementaryTopics.map(topic => {
                const kp = packageMap.get(topic.id);
                const internalCount = kp?.internalStructure.items.length || 0;
                return (
                  <div key={topic.id} className="bg-white rounded-lg border border-stone-200 px-4 py-2 flex items-center justify-between">
                    <span className="font-ui text-stone-600 text-sm">{topic.title}</span>
                    <div className="flex items-center gap-3 text-xs text-stone-400 font-mono">
                      <span>{topic.evidenceIds.length} 证据</span>
                      <span>{internalCount} 内部内容</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quality Diagnostics View                                            */
/* ------------------------------------------------------------------ */

function QualityDiagnosticsView({
  report,
  topics,
  evidences,
}: {
  report: TopicQualityReport | null;
  topics: import('../types').CourseTopic[];
  evidences: import('../types').EvidenceAtom[];
}) {
  if (!report) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-stone-400 font-ui">暂无质量诊断数据</p>
      </div>
    );
  }

  const errors = report.issues.filter(i => i.severity === 'error');
  const warnings = report.issues.filter(i => i.severity === 'warning');

  // 计算每个知识点覆盖的页码
  const getTopicPages = (topic: import('../types').CourseTopic): number[] => {
    const pages = new Set<number>();
    for (const evId of topic.evidenceIds) {
      const ev = evidences.find(e => e.id === evId);
      if (ev) pages.add(ev.pageNumber);
    }
    return [...pages].sort((a, b) => a - b);
  };

  return (
    <div className="h-full overflow-y-auto bg-paper/30">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {/* 质量摘要 */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h3 className="text-sm font-ui font-medium text-ink mb-3">质量摘要</h3>
          <p className="text-xs text-stone-500 font-mono mb-3">{summarizeQualityReport(report)}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="核心知识点" value={topics.filter(t => t.importance === 'core').length} />
            <StatCard
              label="证据覆盖率"
              value={`${(report.stats.coverageRate * 100).toFixed(0)}%`}
              tone={report.stats.coverageRate >= 0.8 ? 'good' : report.stats.coverageRate >= 0.5 ? 'warning' : 'bad'}
            />
            <StatCard
              label="最大知识点覆盖"
              value={`${(report.stats.maxTopicCoverage * 100).toFixed(0)}%`}
              tone={report.stats.maxTopicCoverage <= 0.35 ? 'good' : 'bad'}
            />
            <StatCard
              label="未覆盖证据"
              value={report.stats.orphanEvidenceIds.length}
              tone={report.stats.orphanEvidenceIds.length === 0 ? 'good' : 'warning'}
            />
          </div>
        </div>

        {/* 错误列表 */}
        {errors.length > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-4">
            <h3 className="text-sm font-ui font-medium text-red-800 mb-2">错误 ({errors.length})</h3>
            <ul className="space-y-1">
              {errors.map((err, i) => (
                <li key={i} className="text-xs font-ui text-red-700">
                  <span className="font-mono text-red-400">[{err.type}]</span> {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 警告列表 */}
        {warnings.length > 0 && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
            <h3 className="text-sm font-ui font-medium text-amber-800 mb-2">警告 ({warnings.length})</h3>
            <ul className="space-y-1">
              {warnings.map((warn, i) => (
                <li key={i} className="text-xs font-ui text-amber-700">
                  <span className="font-mono text-amber-400">[{warn.type}]</span> {warn.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 每个知识点覆盖页数 */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h3 className="text-sm font-ui font-medium text-ink mb-3">知识点覆盖详情</h3>
          <div className="space-y-2">
            {topics.map(topic => {
              const pages = getTopicPages(topic);
              const coverage = report.stats.evidenceCount > 0
                ? topic.evidenceIds.length / report.stats.evidenceCount
                : 0;
              const isBroad = report.stats.broadTopicIds.includes(topic.id);
              return (
                <div key={topic.id} className="flex items-center gap-3 text-xs font-ui">
                  <span className={`flex-1 truncate ${isBroad ? 'text-red-600 font-medium' : 'text-stone-600'}`}>
                    {isBroad && <span className="text-red-400 mr-1">⚠</span>}
                    {topic.title}
                  </span>
                  <span className="text-stone-400 font-mono w-20 text-right">
                    {topic.evidenceIds.length} 证据
                  </span>
                  <span className="text-stone-400 font-mono w-16 text-right">
                    {(coverage * 100).toFixed(0)}%
                  </span>
                  <span className="text-stone-400 font-mono w-32 text-right">
                    {pages.length > 0 ? `P${pages[0]}-P${pages[pages.length - 1]}` : '无'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 无问题提示 */}
        {errors.length === 0 && warnings.length === 0 && (
          <div className="bg-celadon/10 rounded-xl border border-celadon/30 p-4 text-center">
            <p className="text-sm font-ui text-celadon">质量检测通过，未发现问题</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'good' | 'warning' | 'bad' | 'neutral' }) {
  const toneColors = {
    good: 'text-celadon',
    warning: 'text-amber-600',
    bad: 'text-cinnabar',
    neutral: 'text-ink',
  };
  return (
    <div className="bg-paper/50 rounded-lg p-3">
      <p className="text-xs text-stone-400 font-ui mb-1">{label}</p>
      <p className={`text-lg font-mono font-medium ${toneColors[tone]}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Learning path info bar                                              */
/* ------------------------------------------------------------------ */

function LearningPathInfo({ path }: { path: RecommendedLearningPath }) {
  const topics = useStore(s => s.topics);
  const [expanded, setExpanded] = useState(false);
  const sourceLabel = PATH_SOURCE_LABELS[path.source] || path.source;
  const sourceColor = PATH_SOURCE_COLORS[path.source] || 'bg-stone-100 text-stone-600';
  const hasPathWarnings = path.warnings.length > 0;

  const topicMap = new Map(topics.map(t => [t.id, t]));

  return (
    <div className="bg-white border-b border-stone-200 px-4 py-1.5 flex-shrink-0">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-stone-400">学习路径</span>
        <span className={`px-1.5 py-0.5 rounded font-medium ${sourceColor}`}>
          {sourceLabel}
        </span>
        <span className="text-stone-500">{path.topicIds.length} 步</span>
        {hasPathWarnings && (
          <span className="text-amber-600">{path.warnings.length} 条注意</span>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-stone-400 hover:text-stone-600 ml-1"
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {hasPathWarnings && (
            <ul className="text-xs text-amber-600 space-y-0.5 list-disc list-inside mb-1">
              {path.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <ol className="text-xs text-stone-500 space-y-0.5 list-decimal list-inside">
            {path.steps.map(step => {
              const topic = topicMap.get(step.topicId);
              return (
                <li key={step.topicId} className="truncate">
                  <span className="font-medium text-stone-600">{topic?.title || step.topicId}</span>
                  {step.reason && <span className="text-stone-400"> — {step.reason}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
