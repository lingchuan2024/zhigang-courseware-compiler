interface ReviewToolbarProps {
  fileName: string;
  totalPages: number;
  currentPage: number;
  scale: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPageChange: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onConfirm: () => void;
  onBack: () => void;
  hasModel: boolean;
  isConfirming?: boolean;
}

export function ReviewToolbar({
  fileName,
  totalPages,
  currentPage,
  scale,
  onPrevPage,
  onNextPage,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onConfirm,
  onBack,
  hasModel,
  isConfirming = false,
}: ReviewToolbarProps) {
  return (
    <header className="z-10 flex-shrink-0 border-b border-space-border bg-space-900">
      {/* Row 1: Title and actions */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="flex-shrink-0 rounded p-1.5 text-space-muted hover:bg-space-750 hover:text-white"
            aria-label="返回"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate font-ui text-sm font-semibold text-space-text">
              {fileName}
            </h2>
            <p className="font-ui text-xs text-space-muted">
              {totalPages} 页 · 第 {currentPage} 页
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!hasModel && (
            <span className="text-xs text-amber-600 hidden sm:inline">未配置 MinerU</span>
          )}
          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className="btn-primary px-4 py-1.5 disabled:cursor-wait disabled:opacity-60"
          >
            {isConfirming ? '正在进入...' : '进入 MinerU 解析'}
          </button>
        </div>
      </div>

      {/* Row 2: Toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto border-t border-space-border px-4 py-1.5">
        {/* Page navigation */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="rounded p-1 hover:bg-space-750 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="上一页"
          >
            <svg className="h-4 w-4 text-ink-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={e => {
              const page = parseInt(e.target.value, 10);
              if (page >= 1 && page <= totalPages) onPageChange(page);
            }}
            className="h-8 w-12 rounded border border-space-border bg-space-850 text-center font-mono text-sm text-space-text focus:border-celadon focus:outline-none"
          />
          <span className="font-mono text-xs text-space-muted">/ {totalPages}</span>
          <button
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
            className="rounded p-1 hover:bg-space-750 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="下一页"
          >
            <svg className="h-4 w-4 text-ink-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="h-5 w-px flex-shrink-0 bg-space-border" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onZoomOut}
            className="rounded p-1 hover:bg-space-750"
            aria-label="缩小"
          >
            <svg className="h-4 w-4 text-ink-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 12H4" />
            </svg>
          </button>
          <span className="w-10 text-center font-mono text-xs text-space-muted">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="rounded p-1 hover:bg-space-750"
            aria-label="放大"
          >
            <svg className="h-4 w-4 text-ink-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onFitWidth}
            className="rounded px-2 py-1 text-xs text-ink-light hover:bg-space-750"
            aria-label="适合宽度"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </button>
        </div>

      </div>
    </header>
  );
}
