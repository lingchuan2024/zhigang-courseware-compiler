import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { loadDocumentSource } from '../../lib/document-source';
import { parsePdf } from '../../lib/pdf';
import type { CoursePage } from '../../types';
import { ReviewToolbar } from './ReviewToolbar';
import { PageNavigator } from './PageNavigator';
import { PagePreview, type PagePreviewHandle } from './PagePreview';
import { PdfPreview } from './PdfPreview';
import { PptxPreview } from './PptxPreview';
import { ReviewEmptyState } from './ReviewEmptyState';
import { MarkdownRenderer } from '../MarkdownRenderer';

const NO_SEARCH_HITS = new Set<number>();

export function DocumentReviewWorkspace() {
  const document = useStore(state => state.document);
  const mineruConfig = useStore(state => state.mineruConfig);
  const staleMarker = useStore(state => state.staleMarker);
  const sourceDocuments = useStore(state => state.sourceDocuments);
  const navigateToStage = useStore(state => state.navigateToStage);

  const previewRef = useRef<PagePreviewHandle>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [isConfirming, setIsConfirming] = useState(false);
  const [displayPages, setDisplayPages] = useState<CoursePage[]>(document?.pages || []);

  const totalPages = displayPages.length;
  const isPptx = document?.fileType === 'pptx' || document?.fileName.toLowerCase().endsWith('.pptx');
  const isMarkdown = document?.fileType === 'markdown' || document?.fileName.toLowerCase().endsWith('.md');
  const hasSourceDocs = sourceDocuments.length > 0;

  useEffect(() => {
    setDisplayPages(document?.pages || []);
    setCurrentPage(1);
  }, [document?.id, document?.pages]);

  useEffect(() => {
    if (!document || isPptx || document.pages.some(page => page.preview) || !document.sourceKey) return;

    let cancelled = false;
    void loadDocumentSource(document.sourceKey).then(async source => {
      if (!source || cancelled) return;
      const file = new File([source], document.fileName, { type: 'application/pdf' });
      const recoveredPages = await parsePdf(file);
      if (!cancelled) setDisplayPages(recoveredPages);
    }).catch(error => {
      console.error('PDF preview recovery failed:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [document, isPptx]);

  const handlePageSelect = useCallback((page: number, behavior: ScrollBehavior = 'smooth') => {
    const nextPage = Math.max(1, Math.min(totalPages, page));
    setCurrentPage(nextPage);
    previewRef.current?.scrollToPage(nextPage, behavior);
  }, [totalPages]);

  const handlePrevPage = useCallback(() => {
    handlePageSelect(currentPage - 1);
  }, [currentPage, handlePageSelect]);

  const handleNextPage = useCallback(() => {
    handlePageSelect(currentPage + 1);
  }, [currentPage, handlePageSelect]);

  const handleVisiblePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale(value => Math.min(2, Number((value + 0.1).toFixed(1))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(value => Math.max(0.5, Number((value - 0.1).toFixed(1))));
  }, []);

  const handleFitWidth = useCallback(() => setScale(1), []);

  const handleConfirm = useCallback(async () => {
    setIsConfirming(true);
    try {
      navigateToStage('mineru');
    } finally {
      setIsConfirming(false);
    }
  }, [navigateToStage]);

  if (!document || (document.pages.length === 0 && !isMarkdown && !hasSourceDocs)) {
    return (
      <ReviewEmptyState
        title="尚未加载课件"
        description="请返回上传页面选择 Markdown、PDF 或 PPT 课件"
        icon="upload"
      />
    );
  }

  // Markdown 预览模式
  if (isMarkdown || hasSourceDocs) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900 px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              className="text-sm text-charcoal/60 hover:text-ink"
              onClick={() => navigateToStage('upload')}
            >
              ← 返回
            </button>
            <span className="text-sm text-ink font-medium">
              {sourceDocuments[0]?.title ?? document?.title ?? 'Markdown 文档'}
            </span>
            <span className="text-xs text-charcoal/50">
              {sourceDocuments.reduce((sum, d) => sum + d.blocks.length, 0)} 个内容块
            </span>
          </div>
          <button
            className="btn-primary text-sm"
            onClick={handleConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? '正在进入...' : '查看 MinerU 结果'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-paper">
          <div className="max-w-4xl mx-auto p-8">
            {sourceDocuments.map(doc => (
              <div key={doc.id} className="mb-8">
                <h2 className="font-song text-xl font-bold text-ink mb-4">{doc.title}</h2>
                <div className="prose-content">
                  <MarkdownRenderer content={doc.markdown} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {isConfirming && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="flex items-center gap-4 rounded-xl border border-space-border bg-space-850 p-6 shadow-xl">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-space-border border-t-celadon" />
              <div>
                <p className="font-ui font-medium text-space-text">正在提取知识结构...</p>
                <p className="mt-1 text-xs text-space-muted">AI 正在分析 Markdown 内容，请稍候</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950">
      <ReviewToolbar
        fileName={document.fileName || document.title}
        totalPages={totalPages}
        currentPage={currentPage}
        scale={scale}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onPageChange={handlePageSelect}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitWidth={handleFitWidth}
        onConfirm={handleConfirm}
        onBack={() => navigateToStage('upload')}
        hasModel={!!mineruConfig?.apiKey}
      />

      {staleMarker && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>课件内容已更新，知识结构和笔记需要重新生成</span>
          </div>
          <span className="text-xs text-amber-600 whitespace-nowrap">
            {staleMarker.affectedTopicIds.length} 个知识点受影响
          </span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {!isPptx && (
          <aside className="hidden w-[148px] flex-shrink-0 overflow-hidden border-r border-space-border bg-space-900 lg:block xl:w-[168px]">
            <PageNavigator
            pages={displayPages}
              currentPage={currentPage}
              showWarningOnly={false}
              searchHitPages={NO_SEARCH_HITS}
              onPageSelect={handlePageSelect}
            />
          </aside>
        )}

        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {isPptx ? (
            <PptxPreview
              ref={previewRef}
              sourceKey={document.sourceKey || document.id}
              totalPages={totalPages}
              scale={scale}
              currentPage={currentPage}
              onCurrentPageChange={handleVisiblePageChange}
            />
          ) : document.sourceKey ? (
            <PdfPreview
              ref={previewRef}
              sourceKey={document.sourceKey}
              totalPages={totalPages}
              scale={scale}
              currentPage={currentPage}
              onCurrentPageChange={handleVisiblePageChange}
            />
          ) : (
            <PagePreview
              ref={previewRef}
              pages={displayPages}
              scale={scale}
              currentPage={currentPage}
              onCurrentPageChange={handleVisiblePageChange}
            />
          )}
        </main>
      </div>

      {isConfirming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="flex items-center gap-4 rounded-xl border border-space-border bg-space-850 p-6 shadow-xl">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-space-border border-t-celadon" />
            <div>
              <p className="font-ui font-medium text-space-text">正在进入 MinerU 解析...</p>
              <p className="mt-1 text-xs text-space-muted">下一步将把原始课件转换为 Markdown</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
