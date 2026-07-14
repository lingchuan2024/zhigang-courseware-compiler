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
}: ReviewToolbarProps) {
  return (
    <header className="bg-white border-b border-stone-200 flex-shrink-0 z-10">
      {/* Row 1: Title and actions */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-stone-100 rounded text-stone-500 flex-shrink-0"
            aria-label="返回"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-800 truncate font-ui">
              {fileName}
            </h2>
            <p className="text-xs text-stone-500 font-ui">
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
            className="px-4 py-1.5 bg-celadon text-white rounded-lg text-sm font-medium hover:bg-celadon/90 transition-colors disabled:opacity-50 font-ui"
          >
            进入 MinerU 解析
          </button>
        </div>
      </div>

      {/* Row 2: Toolbar */}
      <div className="px-4 py-1.5 border-t border-stone-100 flex items-center gap-2 overflow-x-auto">
        {/* Page navigation */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="上一页"
          >
            <svg className="w-4 h-4 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            className="w-12 h-8 text-center text-sm border border-stone-200 rounded font-mono focus:outline-none focus:border-celadon"
          />
          <span className="text-xs text-stone-400 font-mono">/ {totalPages}</span>
          <button
            onClick={onNextPage}
            disabled={currentPage >= totalPages}
            className="p-1 rounded hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="下一页"
          >
            <svg className="w-4 h-4 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="w-px h-5 bg-stone-200 flex-shrink-0" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onZoomOut}
            className="p-1 rounded hover:bg-stone-100"
            aria-label="缩小"
          >
            <svg className="w-4 h-4 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 12H4" />
            </svg>
          </button>
          <span className="text-xs text-stone-500 font-mono w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="p-1 rounded hover:bg-stone-100"
            aria-label="放大"
          >
            <svg className="w-4 h-4 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onFitWidth}
            className="p-1 rounded hover:bg-stone-100 text-xs text-stone-600 px-2"
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
