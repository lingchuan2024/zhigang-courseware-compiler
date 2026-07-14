import { useStore } from '../store/useStore';
import {
  deriveProductSteps,
  getLatestStage,
  STAGE_LABELS,
} from '../lib/workflow-navigation';
import type { ProductStage } from '../types';

interface SidebarProps {
  onOpenSettings: () => void;
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const stage = useStore(s => s.stage);
  const jobStatus = useStore(s => s.jobStatus);
  const reset = useStore(s => s.reset);
  const document = useStore(s => s.document);
  const loadExample = useStore(s => s.loadExampleCourse);
  const modelConfig = useStore(s => s.modelConfig);
  const mineruConfig = useStore(s => s.mineruConfig);
  const mineruParseResult = useStore(s => s.mineruParseResult);
  const topics = useStore(s => s.topics);
  const knowledgePackages = useStore(s => s.knowledgePackages);
  const navigateToStage = useStore(s => s.navigateToStage);
  const returnToLatestStage = useStore(s => s.returnToLatestStage);
  const staleMarker = useStore(s => s.staleMarker);
  const structureExtractionStatus = useStore(s => s.structureExtractionStatus);
  const evidences = useStore(s => s.evidences);
  const viewMode = useStore(s => s.viewMode);
  const sourceDocuments = useStore(s => s.sourceDocuments);
  const knowledgeTopics = useStore(s => s.knowledgeTopics);
  const topicNotes = useStore(s => s.topicNotes);
  const knowledgeCards = useStore(s => s.knowledgeCards);
  const topicSyntheses = useStore(s => s.topicSyntheses);
  const chapterPlan = useStore(s => s.chapterPlan);
  const chapterNotes = useStore(s => s.chapterNotes);
  const courseMasterNote = useStore(s => s.courseMasterNote);
  const knowledgeBaseVersions = useStore(s => s.knowledgeBaseVersions);

  const hasModel = !!modelConfig?.apiKey;
  const hasTopics = topics.length > 0 || knowledgeTopics.length > 0;

  const steps = deriveProductSteps(stage, {
    document,
    evidences,
    topics,
    knowledgePackages,
    structureExtractionStatus,
    jobStatus,
    staleMarker,
    sourceDocuments,
    knowledgeTopics,
    topicNotes,
    knowledgeCards,
    topicSyntheses,
    chapterPlan,
    chapterNotes,
    courseMasterNote,
    knowledgeBaseVersions,
    mineruParseResult,
  });

  // 检测是否在查看较早步骤
  const latestStage = getLatestStage({
    document,
    evidences,
    topics,
    knowledgePackages,
    structureExtractionStatus,
    jobStatus,
    staleMarker,
    sourceDocuments,
    knowledgeTopics,
    topicNotes,
    knowledgeCards,
    topicSyntheses,
    chapterPlan,
    chapterNotes,
    courseMasterNote,
    knowledgeBaseVersions,
    mineruParseResult,
  });
  const isViewingEarlier = viewMode === 'view' && stage !== latestStage &&
    PRODUCT_STAGE_ORDER.indexOf(stage) < PRODUCT_STAGE_ORDER.indexOf(latestStage);

  const handleStepClick = (targetStage: ProductStage) => {
    navigateToStage(targetStage);
  };

  return (
    <aside className="w-56 md:w-64 bg-ink text-paper flex flex-col h-screen flex-shrink-0 transition-transform duration-300 -translate-x-full md:translate-x-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-ink-light/30">
        <h1 className="font-song text-2xl font-bold tracking-wider">知纲</h1>
        <p className="text-paper/50 text-xs mt-1 font-mono">课件编译器 v0.1</p>
      </div>

      {/* 流程导航 */}
      <nav className="flex-1 px-4 py-4 overflow-y-auto">
        <p className="text-paper/30 text-xs font-mono mb-4 uppercase tracking-widest">编译流程</p>
        <div className="relative">
          {/* 竖向连接线 */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-ink-light/30" aria-hidden="true" />

          <div className="space-y-1">
            {steps.map((step) => {
              const stepStatusText = getStepStatusLabel(step.status, step.statusLabel);
              return (
                <button
                  key={step.stage}
                  disabled={!step.canClick}
                  onClick={() => handleStepClick(step.stage)}
                  aria-disabled={!step.canClick}
                  aria-current={step.status === 'active' ? 'step' : undefined}
                  className={`flex items-center gap-3 w-full px-2 py-2 rounded-lg transition-colors text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-celadon/40 ${
                    step.status === 'active'
                      ? 'bg-celadon/15 text-celadon-light'
                      : step.status === 'completed'
                      ? 'text-paper/70 hover:bg-ink-light/20'
                      : step.status === 'stale'
                      ? 'text-amber-400/90 hover:bg-ink-light/20'
                      : step.status === 'blocked'
                      ? 'text-amber-400/80 hover:bg-ink-light/20'
                      : step.status === 'failed'
                      ? 'text-cinnabar-light hover:bg-ink-light/20'
                      : 'text-paper/35'
                  } ${step.canClick ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  {/* 步骤指示器 */}
                  <span className="relative z-10 flex-shrink-0 w-6 h-6 flex items-center justify-center" aria-hidden="true">
                    {step.status === 'completed' && (
                      <svg className="w-4 h-4 text-celadon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {step.status === 'active' && (
                      <span className="w-2.5 h-2.5 bg-celadon-light rounded-full animate-pulse-soft motion-reduce:animate-none" />
                    )}
                    {step.status === 'stale' && (
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                    {step.status === 'blocked' && (
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )}
                    {step.status === 'failed' && (
                      <svg className="w-4 h-4 text-cinnabar-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {step.status === 'pending' && (
                      <span className="w-2 h-2 bg-ink-light/40 rounded-full" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-ui">{step.label}</div>
                    {stepStatusText && (
                      <div className={`text-xs font-mono mt-0.5 truncate ${
                        step.status === 'stale' ? 'text-amber-400/60'
                        : step.status === 'failed' ? 'text-cinnabar-light/70'
                        : step.status === 'blocked' ? 'text-amber-400/60'
                        : step.status === 'active' ? 'text-celadon-light/60'
                        : 'text-paper/30'
                      }`}>
                        {stepStatusText}
                      </div>
                    )}
                  </div>
                  {step.status === 'stale' && (
                    <span className="text-xs font-mono text-amber-400/60 flex-shrink-0">需更新</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 返回最新步骤提示 */}
        {isViewingEarlier && (
          <div className="mt-4 bg-celadon/10 border border-celadon/30 rounded-lg p-3">
            <p className="text-xs font-ui text-celadon-light/90 mb-2">
              正在查看较早步骤
            </p>
            <button
              onClick={returnToLatestStage}
              className="text-xs text-celadon hover:text-celadon-light font-medium px-2 py-1 rounded hover:bg-celadon/10 transition-colors w-full text-left"
            >
              → 返回{STAGE_LABELS[latestStage]}
            </button>
          </div>
        )}

        {/* Stale 提示 */}
        {staleMarker && (
          <div className="mt-4 bg-amber-400/10 border border-amber-400/30 rounded-lg p-3">
            <p className="text-xs font-ui text-amber-400/90 mb-1">数据已修改</p>
            <p className="text-xs text-amber-400/60">
              {staleMarker.reason === 'evidence-edited' && '课件证据已修改，知识结构和笔记需要重新生成'}
              {staleMarker.reason === 'structure-edited' && '知识结构已修改，笔记需要重新生成'}
              {staleMarker.reason === 'topic-edited' && '知识点已修改，相关笔记需要重新生成'}
            </p>
          </div>
        )}

        {/* 当前文档信息 */}
        {document && (
          <div className="mt-8">
            <p className="text-paper/30 text-xs font-mono mb-3 uppercase tracking-widest">当前课件</p>
            <div className="bg-ink-light/15 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-paper/50 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-song truncate text-paper/90" title={document.title}>
                    {document.title}
                  </p>
                  <p className="text-paper/40 text-xs mt-1 font-mono">
                    {document.pages.length} 页
                    {hasTopics && ` · ${knowledgeTopics.length || topics.length} 个知识点`}
                    {staleMarker && ' · 需更新'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* 底部操作 */}
      <div className="px-4 py-4 border-t border-ink-light/30 space-y-1">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm font-ui text-paper/70 hover:text-white hover:bg-ink-light/20 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-light/30"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>服务配置</span>
          <span className="ml-auto flex items-center gap-1" title={`MinerU ${mineruConfig?.apiKey ? '已配置' : '未配置'}，知识模型 ${hasModel ? '已配置' : '未配置'}`}>
            <span className={`w-2 h-2 rounded-full ${mineruConfig?.apiKey ? 'bg-celadon' : 'bg-amber-400'}`} />
            <span className={`w-2 h-2 rounded-full ${hasModel ? 'bg-celadon' : 'bg-amber-400'}`} />
          </span>
        </button>
        <button
          onClick={loadExample}
          className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm font-ui text-paper/70 hover:text-white hover:bg-ink-light/20 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span>加载示例</span>
        </button>
        <button
          onClick={() => {
            if (confirm('确定要重置所有数据吗？此操作不可撤销。')) {
              reset();
            }
          }}
          className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm font-ui text-paper/50 hover:text-cinnabar-light hover:bg-cinnabar/10 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
          </svg>
          <span>重置</span>
        </button>
      </div>
    </aside>
  );
}

// ============== 常量 ==============

const PRODUCT_STAGE_ORDER: ProductStage[] = ['upload', 'document', 'mineru', 'structure', 'cards', 'notes'];

function getStepStatusLabel(status: string, statusLabel?: string): string | undefined {
  if (statusLabel) return statusLabel;
  switch (status) {
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '需要配置';
    case 'pending': return undefined;
    default: return undefined;
  }
}
