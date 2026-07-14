import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { CoursePage } from '../../types';

interface PagePreviewProps {
  pages: CoursePage[];
  scale: number;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
}

export interface PagePreviewHandle {
  scrollToPage: (page: number, behavior?: ScrollBehavior) => void;
}

type PreviewState = 'ready' | 'no-image' | 'ocr-fallback' | 'blank' | 'error';

function getPreviewState(page: CoursePage, imageFailed: boolean): PreviewState {
  if (page.preview && !imageFailed) return 'ready';
  if (imageFailed) return page.text?.trim() ? 'no-image' : 'error';
  if (!page.text || page.text.trim().length === 0) return 'blank';
  if (page.warning) return 'ocr-fallback';
  return 'no-image';
}

export const PagePreview = forwardRef<PagePreviewHandle, PagePreviewProps>(
  function PagePreview({ pages, scale, currentPage, onCurrentPageChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const visibilityRatios = useRef(new Map<number, number>());
    const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

    useImperativeHandle(ref, () => ({
      scrollToPage(page, behavior = 'smooth') {
        const element = containerRef.current?.querySelector<HTMLElement>(
          `[data-page-number="${page}"]`
        );
        element?.scrollIntoView({ behavior, block: 'start' });
      },
    }), []);

    useEffect(() => {
      const root = containerRef.current;
      if (!root || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageNumber);
            visibilityRatios.current.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
          }

          let mostVisiblePage = currentPage;
          let highestRatio = 0;
          for (const [page, ratio] of visibilityRatios.current) {
            if (ratio > highestRatio) {
              mostVisiblePage = page;
              highestRatio = ratio;
            }
          }

          if (highestRatio > 0 && mostVisiblePage !== currentPage) {
            onCurrentPageChange(mostVisiblePage);
          }
        },
        {
          root,
          rootMargin: '-12% 0px -48% 0px',
          threshold: [0.05, 0.2, 0.4, 0.6, 0.8],
        }
      );

      const pageElements = root.querySelectorAll<HTMLElement>('[data-page-number]');
      pageElements.forEach(element => observer.observe(element));
      return () => observer.disconnect();
    }, [pages, currentPage, onCurrentPageChange]);

    if (pages.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center bg-stone-100">
          <p className="text-stone-400 text-sm">暂无可预览页面</p>
        </div>
      );
    }

    const pageWidth = Math.round(920 * scale);

    return (
      <div
        ref={containerRef}
        data-testid="continuous-page-viewer"
        className="flex-1 overflow-auto bg-stone-100 scroll-smooth overscroll-contain"
        aria-label="课件连续预览"
      >
        <div className="min-h-full py-6 sm:py-8 space-y-6 sm:space-y-8">
          {pages.map(page => {
            const state = getPreviewState(page, imageErrors.has(page.pageNumber));
            return (
              <section
                key={page.pageNumber}
                data-page-number={page.pageNumber}
                data-current={page.pageNumber === currentPage ? 'true' : 'false'}
                aria-label={`第 ${page.pageNumber} 页`}
                className="scroll-mt-4 mx-auto px-4"
              >
                <div
                  className="mx-auto"
                  style={{
                    width: `${pageWidth}px`,
                    maxWidth: scale === 1 ? 'calc(100% - 1rem)' : undefined,
                  }}
                >
                  <div className="bg-white shadow-[0_8px_28px_rgba(28,25,23,0.14)] ring-1 ring-stone-200/80 overflow-hidden">
                    {state === 'ready' && page.preview && (
                      <img
                        src={page.preview}
                        alt={`第 ${page.pageNumber} 页`}
                        className="block w-full h-auto"
                        loading="lazy"
                        draggable={false}
                        onError={() => {
                          setImageErrors(previous => {
                            const next = new Set(previous);
                            next.add(page.pageNumber);
                            return next;
                          });
                        }}
                      />
                    )}

                    {state === 'no-image' && <StructuredTextFallback page={page} />}

                    {state === 'ocr-fallback' && (
                      <div>
                        <div className="flex items-center gap-2 px-6 py-3 text-amber-700 bg-amber-50 border-b border-amber-100">
                          <WarningIcon />
                          <span className="text-sm font-medium">{page.warning}</span>
                        </div>
                        <StructuredTextFallback page={page} />
                      </div>
                    )}

                    {state === 'blank' && (
                      <div className="aspect-[4/3] min-h-[420px] flex flex-col items-center justify-center text-stone-400">
                        <PageIcon />
                        <p className="text-sm mt-3">空白页面</p>
                      </div>
                    )}

                    {state === 'error' && (
                      <div className="aspect-[4/3] min-h-[420px] flex flex-col items-center justify-center text-cinnabar">
                        <WarningIcon className="w-10 h-10" />
                        <p className="text-sm mt-3">页面加载失败</p>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center pt-3">
                    <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-stone-500 shadow-sm ring-1 ring-stone-200 font-mono">
                      第 {page.pageNumber} 页
                    </span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }
);

function StructuredTextFallback({ page }: { page: CoursePage }) {
  return (
    <div className="min-h-[520px] p-8 sm:p-10">
      <div className="text-xs text-stone-400 mb-6 pb-3 border-b border-stone-200 font-ui">
        结构化文本预览（无页面图像）
      </div>
      {page.blocks && page.blocks.length > 0 ? (
        <div className="space-y-4">
          {page.blocks.map((block, index) => (
            <div
              key={index}
              className="text-stone-700 leading-relaxed whitespace-pre-wrap"
              style={{ fontSize: `${Math.max(13, Math.min(20, block.avgFontSize))}px` }}
            >
              {block.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-stone-700 leading-7 whitespace-pre-wrap font-ui">
          {page.text || '(无文本内容)'}
        </div>
      )}
    </div>
  );
}

function WarningIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`${className} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
