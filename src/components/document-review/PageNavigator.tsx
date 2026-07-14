import { useRef, useEffect, useState, memo } from 'react';
import { CoursePage } from '../../types';

interface PageNavigatorProps {
  pages: CoursePage[];
  currentPage: number;
  showWarningOnly: boolean;
  searchHitPages: Set<number>;
  onPageSelect: (page: number) => void;
}

interface PageCardProps {
  page: CoursePage;
  isActive: boolean;
  isSearchHit: boolean;
  onSelect: () => void;
}

const PageCard = memo(function PageCard({
  page,
  isActive,
  isSearchHit,
  onSelect,
}: PageCardProps) {
  const [showThumbnail, setShowThumbnail] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShowThumbnail(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasWarning = !!page.warning;
  const isEmpty = !page.text || page.text.trim().length === 0;

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`w-full text-left rounded-lg border transition-all overflow-hidden ${
        isActive
          ? 'border-celadon ring-1 ring-celadon/30 bg-celadon/5'
          : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[3/4] bg-stone-100 overflow-hidden">
        {showThumbnail && page.preview ? (
          <img
            src={page.preview}
            alt={`Page ${page.pageNumber}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : showThumbnail && !page.preview ? (
          <div className="w-full h-full flex items-center justify-center">
            {isEmpty ? (
              <span className="text-xs text-stone-400">空白页</span>
            ) : (
              <span className="text-xs text-stone-400">文本页</span>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-stone-200 border-t-stone-400 rounded-full animate-spin" />
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-1 right-1 flex flex-col gap-1">
          {hasWarning && (
            <span className="w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center" title={page.warning}>
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01" />
              </svg>
            </span>
          )}
          {isSearchHit && (
            <span className="w-4 h-4 bg-celadon rounded-full flex items-center justify-center" title="搜索命中">
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6" strokeWidth={3} />
              </svg>
            </span>
          )}
        </div>

        {/* Page number */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
          <span className="text-xs text-white font-mono font-medium">P{page.pageNumber}</span>
        </div>
      </div>

    </button>
  );
});

export function PageNavigator({
  pages,
  currentPage,
  showWarningOnly,
  searchHitPages,
  onPageSelect,
}: PageNavigatorProps) {
  const filteredPages = showWarningOnly
    ? pages.filter(p => p.warning)
    : pages;

  if (filteredPages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-stone-400 text-center">
          {showWarningOnly ? '没有问题页面' : '无页面'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1.5 space-y-1.5">
      {filteredPages.map(page => (
        <PageCard
          key={page.pageNumber}
          page={page}
          isActive={page.pageNumber === currentPage}
          isSearchHit={searchHitPages.has(page.pageNumber)}
          onSelect={() => onPageSelect(page.pageNumber)}
        />
      ))}
    </div>
  );
}
