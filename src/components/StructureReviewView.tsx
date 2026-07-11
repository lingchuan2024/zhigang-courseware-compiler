import { useState } from 'react';
import { useStore } from '../store/useStore';
import { KnowledgeGraph } from './KnowledgeGraph';
import type { RecommendedLearningPath } from '../types';

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

export function StructureReviewView() {
  const topics = useStore(s => s.topics);
  const relations = useStore(s => s.macroRelations);
  const packages = useStore(s => s.knowledgePackages);
  const orderMode = useStore(s => s.orderMode);
  const structureSource = useStore(s => s.structureSource);
  const structureWarnings = useStore(s => s.structureWarnings);
  const learningPath = useStore(s => s.learningPath);
  const modelConfig = useStore(s => s.modelConfig);
  const setOrderMode = useStore(s => s.setOrderMode);
  const regenerateStructure = useStore(s => s.regenerateKnowledgeStructure);
  const confirmStructure = useStore(s => s.confirmStructure);
  const setStage = useStore(s => s.setStage);
  const regenerateNoteForTopic = useStore(s => s.regenerateNoteForTopic);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  const handleConfirm = async () => {
    setIsGenerating(true);
    try {
      await confirmStructure();
    } finally {
      setIsGenerating(false);
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

  // 如果v2结构还未生成（可能是旧数据或异常），显示降级提示
  if (topics.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-stone-500 mb-4">知识结构尚未生成</p>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="px-4 py-2 bg-stone-800 text-amber-50 rounded hover:bg-stone-700 disabled:opacity-50"
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
      {/* 顶部栏 - 精简版，只保留返回和状态 */}
      <header className="bg-white border-b border-stone-200 px-4 py-2 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStage('parse-review')}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-500"
            disabled={isGenerating || isRegenerating}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <h2 className="text-base font-semibold text-stone-800">知识结构确认</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${sourceColor}`}>
                {sourceLabel}
              </span>
              <span className="text-xs text-stone-500">
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
        {isRegenerating && (
          <span className="text-sm text-stone-500 animate-pulse">重新分析中...</span>
        )}
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
      {hasPathInfo && learningPath && (
        <LearningPathInfo path={learningPath} />
      )}

      <div className="flex-1 overflow-hidden">
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
          onConfirm={handleConfirm}
          onRegenerateNote={regenerateNoteForTopic}
        />
      </div>

      {isGenerating && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl flex items-center gap-4">
            <div className="w-6 h-6 border-3 border-stone-200 border-t-red-600 rounded-full animate-spin"></div>
            <div>
              <p className="text-stone-800 font-medium">正在逐知识点生成自然笔记</p>
              <p className="text-xs text-stone-500 mt-1">这可能需要一些时间，请稍候...</p>
            </div>
          </div>
        </div>
      )}
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
