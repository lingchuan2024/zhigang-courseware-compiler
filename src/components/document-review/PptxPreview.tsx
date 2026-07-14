import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { loadDocumentSource } from '../../lib/document-source';
import type { PagePreviewHandle } from './PagePreview';

interface PptxPreviewProps {
  sourceKey: string;
  totalPages: number;
  scale: number;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
}

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

interface PptxPreviewerInstance {
  preview: (file: ArrayBuffer) => Promise<unknown>;
  destroy: () => void;
}

export const PptxPreview = forwardRef<PagePreviewHandle, PptxPreviewProps>(
  function PptxPreview(
    { sourceKey, totalPages, scale, currentPage, onCurrentPageChange },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const renderHostRef = useRef<HTMLDivElement>(null);
    const visibilityRatios = useRef(new Map<number, number>());
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [renderVersion, setRenderVersion] = useState(0);

    useImperativeHandle(ref, () => ({
      scrollToPage(page, behavior = 'smooth') {
        const slide = containerRef.current?.querySelector<HTMLElement>(
          `[data-page-number="${page}"]`
        );
        slide?.scrollIntoView({ behavior, block: 'start' });
      },
    }), []);

    useEffect(() => {
      const host = renderHostRef.current;
      if (!host) return;

      let cancelled = false;
      let previewer: PptxPreviewerInstance | null = null;
      setLoadState('loading');
      host.replaceChildren();

      void Promise.all([
        loadDocumentSource(sourceKey),
        import('pptx-preview'),
      ]).then(async ([source, module]) => {
        if (cancelled) return;
        if (!source) {
          setLoadState('missing');
          return;
        }

        previewer = module.init(host, {
          width: Math.round(920 * scale),
          mode: 'list',
        }) as PptxPreviewerInstance;
        await previewer.preview(source);
        if (cancelled) return;

        const wrapper = host.querySelector<HTMLElement>('.pptx-preview-wrapper');
        if (wrapper) {
          wrapper.style.background = 'transparent';
          wrapper.style.height = 'auto';
          wrapper.style.maxWidth = 'none';
          wrapper.setAttribute('aria-label', 'PPTX 幻灯片列表');
        }

        const slides = host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper');
        slides.forEach((slide, index) => {
          const pageNumber = index + 1;
          slide.dataset.pageNumber = String(pageNumber);
          slide.dataset.current = 'false';
          slide.setAttribute('role', 'region');
          slide.setAttribute('aria-label', `第 ${pageNumber} 页`);
          slide.classList.add('zhigang-pptx-slide');
        });

        setLoadState('ready');
        setRenderVersion(version => version + 1);
      }).catch(error => {
        if (!cancelled) {
          console.error('PPTX preview failed:', error);
          setLoadState('error');
        }
      });

      return () => {
        cancelled = true;
        previewer?.destroy();
        host.replaceChildren();
      };
    }, [sourceKey, scale]);

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

      const slides = root.querySelectorAll<HTMLElement>('[data-page-number]');
      slides.forEach(slide => observer.observe(slide));
      return () => observer.disconnect();
    }, [currentPage, loadState, onCurrentPageChange, renderVersion]);

    useEffect(() => {
      if (loadState !== 'ready') return;
      const slides = containerRef.current?.querySelectorAll<HTMLElement>('[data-page-number]');
      slides?.forEach(slide => {
        slide.dataset.current = slide.dataset.pageNumber === String(currentPage) ? 'true' : 'false';
      });
    }, [currentPage, loadState]);

    return (
      <div
        ref={containerRef}
        data-testid="continuous-pptx-viewer"
        className="flex-1 overflow-auto bg-space-900 scroll-smooth overscroll-contain"
        aria-label="PPTX 连续预览"
      >
        <div className="min-h-full py-6 sm:py-8">
          <div ref={renderHostRef} className="pptx-render-host mx-auto" />

          {loadState === 'loading' && (
            <PreviewMessage title="正在加载 PPTX" description={`正在渲染 ${totalPages} 张幻灯片…`} loading />
          )}
          {loadState === 'missing' && (
            <PreviewMessage title="找不到原始 PPTX" description="请返回上传页面重新选择该 PPTX 文件" />
          )}
          {loadState === 'error' && (
            <PreviewMessage title="PPTX 渲染失败" description="该文件可能已损坏，或包含暂不支持的 PowerPoint 功能" />
          )}
        </div>
      </div>
    );
  }
);

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
    <div className="mx-auto mt-20 max-w-sm text-center text-space-muted">
      {loading && (
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-3 border-space-border border-t-celadon" />
      )}
      <p className="font-ui font-medium text-space-text">{title}</p>
      <p className="text-sm mt-2 leading-6 font-ui">{description}</p>
    </div>
  );
}
