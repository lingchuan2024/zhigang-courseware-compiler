interface JobBlockedStateProps {
  title: string;
  message: string;
  onConfigureModel: () => void;
  onGoBack: () => void;
  goBackLabel?: string;
}

/**
 * 阻塞状态 — 模型未配置等场景
 */
export function JobBlockedState({
  title,
  message,
  onConfigureModel,
  onGoBack,
  goBackLabel = '返回上一步',
}: JobBlockedStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <div className="bg-white border border-paper-dark rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-amber-50 rounded-xl flex-shrink-0">
                <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-song text-xl font-bold text-ink">{title}</h2>
                <p className="text-sm text-charcoal/50 font-ui mt-0.5">{message}</p>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 pt-2 flex flex-wrap gap-3">
            <button onClick={onConfigureModel} className="btn-primary">
              配置 AI 模型
            </button>
            <button onClick={onGoBack} className="btn-outline">
              {goBackLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
