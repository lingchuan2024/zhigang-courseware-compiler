import { useStore } from '../store/useStore';
import { computeProgressPercent } from '../lib/pipeline-progress';
import type { PipelineProgressStep } from '../types';

interface GeneratingViewProps {
  onOpenSettings: () => void;
}

export function GeneratingView({ onOpenSettings }: GeneratingViewProps) {
  const job = useStore(s => s.job);
  const pipelineProgress = useStore(s => s.pipelineProgress);
  const errors = useStore(s => s.extractionErrors);
  const warnings = useStore(s => s.structureWarnings);
  const regenerate = useStore(s => s.regenerateKnowledgeStructure);
  const setStage = useStore(s => s.setStage);
  const knowledgePackages = useStore(s => s.knowledgePackages);

  const isStructureExtraction = job === 'extracting-topics' || job === 'repairing-topics' || job === 'extracting-relations' || job === 'building-internal-structure';
  const isNoteGeneration = job === 'generating-topic-notes' || job === 'assembling-master-note';
  const isBlocked = pipelineProgress.status === 'blocked';
  const isFailed = pipelineProgress.status === 'failed';
  const isRunning = pipelineProgress.status === 'running';
  const isCompleted = pipelineProgress.status === 'completed';

  const percent = computeProgressPercent(pipelineProgress);
  const title = isStructureExtraction
    ? '提取知识结构'
    : isNoteGeneration
    ? '生成知识笔记'
    : '处理中';

  // 检测失败的知识点
  const failedTopics = isNoteGeneration
    ? knowledgePackages.filter(kp => kp.topic.noteStatus === 'failed')
    : [];

  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <div className="bg-white border border-paper-dark rounded-xl shadow-sm overflow-hidden">
          {/* 头部 */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-4 mb-4">
              <StatusIcon
                isRunning={isRunning}
                isBlocked={isBlocked}
                isFailed={isFailed}
                isCompleted={isCompleted}
              />
              <div className="flex-1 min-w-0">
                <h2 className="font-song text-xl font-bold text-ink">{title}</h2>
                <p className="text-sm text-charcoal/50 font-ui mt-0.5">
                  {isBlocked && pipelineProgress.message}
                  {isFailed && (pipelineProgress.message || '处理失败')}
                  {isRunning && getCurrentStepLabel(pipelineProgress.steps)}
                  {isCompleted && '已完成'}
                </p>
              </div>
            </div>

            {/* 总体进度条 */}
            {(isRunning || isCompleted) && (
              <div className="mb-1">
                <div className="flex items-center justify-between text-xs font-mono text-charcoal/40 mb-1.5">
                  <span>总进度</span>
                  <span>{Math.round(percent)}%</span>
                </div>
                <div className="h-1.5 bg-paper-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-celadon rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 内部步骤列表 */}
          {(isRunning || isCompleted) && pipelineProgress.steps.length > 0 && (
            <div className="px-6 pb-4">
              <div className="space-y-2">
                {pipelineProgress.steps.map(step => (
                  <ProgressStepItem key={step.id} step={step} />
                ))}
              </div>
            </div>
          )}

          {/* 当前知识点进度 */}
          {isRunning &&
            pipelineProgress.currentItem !== undefined &&
            pipelineProgress.totalItems !== undefined &&
            pipelineProgress.totalItems > 0 && (
              <div className="px-6 pb-4">
                <div className="bg-paper/50 rounded-lg px-4 py-3 border border-paper-dark/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-charcoal/50">
                      {pipelineProgress.currentItemTitle
                        ? `当前：${pipelineProgress.currentItemTitle}`
                        : '准备中...'}
                    </span>
                    <span className="text-sm font-mono font-medium text-ink">
                      {pipelineProgress.currentItem} / {pipelineProgress.totalItems}
                    </span>
                  </div>
                  <div className="h-1 bg-paper-dark rounded-full overflow-hidden">
                    <div
                      className="h-full bg-ink-light rounded-full transition-all duration-300"
                      style={{
                        width: `${((pipelineProgress.currentItem / pipelineProgress.totalItems) * 100).toFixed(0)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

          {/* 最近警告 */}
          {isRunning && warnings.length > 0 && (
            <div className="px-6 pb-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                <p className="text-xs font-ui text-amber-700 mb-1">最近警告</p>
                <p className="text-xs text-amber-600 truncate">
                  {warnings[warnings.length - 1]}
                </p>
              </div>
            </div>
          )}

          {/* 完成但有失败项 */}
          {isCompleted && failedTopics.length > 0 && (
            <div className="px-6 pb-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <p className="text-sm font-ui text-amber-800">
                  完成但有 {failedTopics.length} 个知识点生成失败
                </p>
                <p className="text-xs text-amber-600 mt-1 font-mono truncate">
                  {failedTopics.map(t => t.topic.title).join('、')}
                </p>
              </div>
            </div>
          )}

          {/* 错误详情 */}
          {isFailed && errors.length > 0 && (
            <div className="px-6 pb-4">
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm font-ui text-red-800 mb-2">错误详情</p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {errors.map((err, i) => (
                    <li key={i} className="text-xs text-red-700 font-mono">• {err}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="px-6 pb-6 pt-2 flex flex-wrap gap-3">
            {isBlocked && (
              <>
                <button onClick={onOpenSettings} className="btn-primary">
                  配置 AI 模型
                </button>
                <button
                  onClick={() => setStage('parse-review')}
                  className="btn-outline"
                >
                  返回证据确认
                </button>
              </>
            )}

            {isFailed && isStructureExtraction && (
              <>
                <button
                  onClick={async () => {
                    await regenerate();
                  }}
                  className="btn-primary"
                >
                  重新开始提取
                </button>
                <button
                  onClick={() => setStage('parse-review')}
                  className="btn-outline"
                >
                  返回证据确认
                </button>
              </>
            )}

            {isCompleted && isNoteGeneration && (
              <>
                <button
                  onClick={() => setStage('notes')}
                  className="btn-primary"
                >
                  进入笔记视图
                </button>
                {failedTopics.length > 0 && (
                  <button
                    onClick={async () => {
                      for (const kp of failedTopics) {
                        await useStore.getState().regenerateNoteForTopic(kp.topic.id);
                      }
                    }}
                    className="btn-outline"
                  >
                    重试失败项
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 底部说明 */}
        {(isRunning || isBlocked) && (
          <p className="text-center text-xs text-charcoal/35 font-mono mt-4">
            {isBlocked
              ? '配置模型后，系统会从当前证据继续处理，不需要重新上传课件'
              : 'AI 正在处理课件证据，请耐心等待'}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatusIcon({
  isRunning,
  isBlocked,
  isFailed,
  isCompleted,
}: {
  isRunning: boolean;
  isBlocked: boolean;
  isFailed: boolean;
  isCompleted: boolean;
}) {
  if (isRunning) {
    return (
      <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
        <div className="w-7 h-7 border-2 border-paper-dark border-t-celadon rounded-full animate-spin" />
      </div>
    );
  }
  if (isBlocked) {
    return (
      <div className="w-12 h-12 flex items-center justify-center bg-amber-50 rounded-xl flex-shrink-0">
        <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
    );
  }
  if (isFailed) {
    return (
      <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl flex-shrink-0">
        <svg className="w-6 h-6 text-cinnabar" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (isCompleted) {
    return (
      <div className="w-12 h-12 flex items-center justify-center bg-celadon/10 rounded-xl flex-shrink-0">
        <svg className="w-6 h-6 text-celadon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  return null;
}

function ProgressStepItem({ step }: { step: PipelineProgressStep }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
        {step.status === 'completed' && (
          <svg className="w-4 h-4 text-celadon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {step.status === 'running' && (
          <span className="w-2 h-2 bg-celadon rounded-full animate-pulse-soft" />
        )}
        {step.status === 'skipped' && (
          <svg className="w-4 h-4 text-charcoal/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {step.status === 'failed' && (
          <svg className="w-4 h-4 text-cinnabar" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {step.status === 'pending' && (
          <span className="w-2 h-2 bg-paper-dark rounded-full" />
        )}
        {step.status === 'blocked' && (
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        )}
      </span>
      <span
        className={`text-sm font-ui ${
          step.status === 'completed'
            ? 'text-charcoal/50 line-through'
            : step.status === 'running'
            ? 'text-ink font-medium'
            : step.status === 'skipped'
            ? 'text-charcoal/30'
            : step.status === 'failed'
            ? 'text-cinnabar'
            : step.status === 'blocked'
            ? 'text-amber-600'
            : 'text-charcoal/35'
        }`}
      >
        {step.label}
      </span>
      {step.detail && (
        <span className="text-xs text-charcoal/40 font-mono truncate">{step.detail}</span>
      )}
    </div>
  );
}

function getCurrentStepLabel(steps: PipelineProgressStep[]): string {
  const running = steps.find(s => s.status === 'running');
  return running ? running.label : '处理中...';
}
