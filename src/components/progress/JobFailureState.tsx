interface JobFailureStateProps {
  title?: string;
  message?: string;
  errors?: string[];
  failedStage?: string;
  failedWindowIndex?: number;
  onRetry?: () => void;
  onBack?: () => void;
  backLabel?: string;
}

const STAGE_LABELS: Record<string, string> = {
  'candidate-extraction': '候选知识点提取',
  'local-merge': '局部合并',
  'global-merge': '全局合并',
  'quality-check': '质量检查',
  'targeted-repair': '定向修复',
  'relation-extraction': '关系提取',
  'internal-structure': '内部结构生成',
  'note-generation': '笔记生成',
  'unknown': '处理',
};

export function JobFailureState({
  title = '处理失败',
  message,
  errors = [],
  failedStage,
  failedWindowIndex,
  onRetry,
  onBack,
  backLabel = '返回上一步',
}: JobFailureStateProps) {
  const stageLabel = failedStage ? (STAGE_LABELS[failedStage] || failedStage) : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        {/* Error icon */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cinnabar/15">
          <svg className="h-6 w-6 text-cinnabar" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-cinnabar">{title}</h2>
        {message && (
          <p className="max-w-md text-center text-sm text-charcoal/60">{message}</p>
        )}
      </div>

      {/* Failed stage info */}
      {stageLabel && (
        <div className="rounded-lg border border-cinnabar/20 bg-cinnabar/5 px-4 py-2 text-center">
          <p className="text-sm text-charcoal/70">
            失败阶段：<span className="font-medium text-cinnabar">{stageLabel}</span>
            {failedWindowIndex !== undefined && (
              <span className="ml-2 text-charcoal/50">
                （窗口 {failedWindowIndex + 1}）
              </span>
            )}
          </p>
        </div>
      )}

      {/* Error details */}
      {errors.length > 0 && (
        <div className="w-full max-w-md">
          <p className="mb-2 text-xs font-medium text-charcoal/50">错误详情：</p>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-cinnabar/15 bg-cinnabar/5 p-3">
            <ul className="space-y-1">
              {errors.map((err, i) => (
                <li key={i} className="text-xs text-charcoal/70">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-lg bg-celadon px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-celadon/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-celadon/40"
          >
            重新提取
          </button>
        )}
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-lg border border-charcoal/20 px-4 py-2 text-sm text-charcoal/70 transition-colors hover:bg-charcoal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/20"
          >
            {backLabel}
          </button>
        )}
      </div>
    </div>
  );
}
