import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { loadDocumentSource } from '../../lib/document-source';
import { loadPdfDocument } from '../../lib/pdf';
import { calculatePdfRenderMetrics } from '../../lib/pdf-render';
import type { PagePreviewHandle } from './PagePreview';

interface PdfPreviewProps {
  sourceKey: string;
  totalPages: number;
  scale: number;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
}

type PdfDocument = Awaited<ReturnType<typeof loadPdfDocument>>;
type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export const PdfPreview = forwardRef<PagePreviewHandle, PdfPreviewProps>(
  function PdfPreview(
    { sourceKey, totalPages, scale, currentPage, onCurrentPageChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const visibilityRatios = useRef(new Map<number, number>());
    const [pdf, setPdf] = useState<PdfDocument | null>(null);
    const [loadState, setLoadState] = useState<LoadState>('loading');

    useImperativeHandle(ref, () => ({
      scrollToPage(page, behavior = 'smooth') {
        containerRef.current?.querySelector<HTMLElement>(
          `[data-page-number="${page}"]`,
        )?.scrollIntoView({ behavior, block: 'start' });
      },
    }), []);

    useEffect(() => {
      let cancelled = false;
      let loadedDocument: PdfDocument | null = null;
      setLoadState('loading');
      setPdf(null);

      void loadDocumentSource(sourceKey)
        .then(async source => {
          if (cancelled) return;
          if (!source) {
            setLoadState('missing');
            return;
          }
          loadedDocument = await loadPdfDocument(source);
          if (cancelled) {
            await loadedDocument.destroy();
            return;
          }
          setPdf(loadedDocument);
          setLoadState('ready');
        })
        .catch(error => {
          if (!cancelled) {
            console.error('PDF preview failed:', error);
            setLoadState('error');
          }
        });

      return () => {
        cancelled = true;
        if (loadedDocument) void loadedDocument.destroy();
      };
    }, [sourceKey]);

    useEffect(() => {
      const root = containerRef.current;
      if (!root || loadState !== 'ready' || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(entries => {
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
      }, {
        root,
        rootMargin: '-12% 0px -48% 0px',
        threshold: [0.05, 0.2, 0.4, 0.6, 0.8],
      });

      root.querySelectorAll<HTMLElement>('[data-page-number]')
        .forEach(section => observer.observe(section));
      return () => observer.disconnect();
    }, [currentPage, loadState, onCurrentPageChange, pdf]);

    const pageCount = pdf?.numPages || totalPages;
    const targetCssWidth = Math.round(920 * scale);

    return (
      <div
        ref={containerRef}
        data-testid="continuous-pdf-viewer"
        className="flex-1 overflow-auto bg-stone-100 scroll-smooth overscroll-contain"
        aria-label="PDF 连续预览"
      >
        <div className="min-h-full py-6 sm:py-8 space-y-6 sm:space-y-8">
          {loadState === 'ready' && pdf && Array.from({ length: pageCount }, (_, index) => (
            <PdfCanvasPage
              key={index + 1}
              pdf={pdf}
              pageNumber={index + 1}
              targetCssWidth={targetCssWidth}
              scrollRootRef={containerRef}
            />
          ))}

          {loadState === 'loading' && (
            <PreviewMessage title="正在加载 PDF" description={`正在准备 ${totalPages} 页高清预览…`} loading />
          )}
          {loadState === 'missing' && (
            <PreviewMessage title="找不到原始 PDF" description="请返回上传页面重新选择该 PDF 文件" />
          )}
          {loadState === 'error' && (
            <PreviewMessage title="PDF 渲染失败" description="无法读取原始 PDF，请重新上传后再试" />
          )}
        </div>
      </div>
    );
  },
);

function PdfCanvasPage({
  pdf,
  pageNumber,
  targetCssWidth,
  scrollRootRef,
}: {
  pdf: PdfDocument;
  pageNumber: number;
  targetCssWidth: number;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting);
    }, {
      root: scrollRootRef.current,
      rootMargin: '1000px 0px',
      threshold: 0,
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [scrollRootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isNearViewport || !canvas) return;

    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    setRenderError(false);

    void pdf.getPage(pageNumber).then(async page => {
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const metrics = calculatePdfRenderMetrics({
        baseWidth: baseViewport.width,
        baseHeight: baseViewport.height,
        targetCssWidth,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      setAspectRatio(metrics.cssWidth / metrics.cssHeight);

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法创建 Canvas 2D 上下文');

      canvas.width = metrics.pixelWidth;
      canvas.height = metrics.pixelHeight;
      canvas.style.width = `${metrics.cssWidth}px`;
      canvas.style.height = `${metrics.cssHeight}px`;

      const viewport = page.getViewport({ scale: metrics.renderScale });
      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;
    }).catch(error => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') {
        console.error(`PDF page ${pageNumber} render failed:`, error);
        setRenderError(true);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [isNearViewport, pageNumber, pdf, targetCssWidth]);

  return (
    <section
      ref={sectionRef}
      data-page-number={pageNumber}
      aria-label={`第 ${pageNumber} 页`}
      className="scroll-mt-4 mx-auto px-4"
    >
      <div
        className="mx-auto"
        style={{ width: `${targetCssWidth}px`, maxWidth: 'calc(100% - 1rem)' }}
      >
        <div
          className="relative bg-white shadow-[0_8px_28px_rgba(28,25,23,0.14)] ring-1 ring-stone-200/80 overflow-hidden"
          style={{ aspectRatio }}
        >
          <canvas ref={canvasRef} className="block max-w-full h-auto bg-white" />
          {!isNearViewport && <div className="absolute inset-0 bg-white" />}
          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-cinnabar bg-white">
              第 {pageNumber} 页渲染失败
            </div>
          )}
        </div>
        <div className="flex justify-center pt-3">
          <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-stone-500 shadow-sm ring-1 ring-stone-200 font-mono">
            第 {pageNumber} 页
          </span>
        </div>
      </div>
    </section>
  );
}

function PreviewMessage({
  title,
  description,
  loading = false,
}: {
  title: string;
  description: string;
  loading?: boolean;
}) {
  return (
    <div className="mx-auto mt-20 max-w-sm text-center text-stone-500">
      {loading && (
        <div className="w-8 h-8 mx-auto mb-4 border-3 border-stone-200 border-t-celadon rounded-full animate-spin" />
      )}
      <p className="font-medium text-stone-700 font-ui">{title}</p>
      <p className="text-sm mt-2 leading-6 font-ui">{description}</p>
    </div>
  );
}
