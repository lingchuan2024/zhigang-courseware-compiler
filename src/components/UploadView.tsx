import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { validateFile, parsePdf, PPTX_MIME_TYPE } from '../lib/pdf';
import { parsePptxBuffer } from '../lib/pptx';
import { saveDocumentSource } from '../lib/document-source';
import { generateId } from '../lib/utils';
import { useLibraryStore } from '../store/useLibraryStore';

export function UploadView() {
  const setDocument = useStore(s => s.setDocument);
  const loadExample = useStore(s => s.loadExampleCourse);
  const activeCourseId = useLibraryStore(s => s.activeCourseId);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ========== 课件上传（旧流程兼容） ==========

  const handleCoursewareFile = useCallback(async (file: File) => {
    setError(null);
    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || '文件无效');
      return;
    }
    setIsProcessing(true);
    setProgress({ current: 0, total: 0 });
    try {
      const docId = generateId('doc');
      const isPptx = file.name.toLowerCase().endsWith('.pptx') || file.type === PPTX_MIME_TYPE;
      let pages;
      const source = await file.arrayBuffer();
      if (isPptx) {
        pages = await parsePptxBuffer(source, (current, total) => {
          setProgress({ current, total });
        });
      } else {
        const pdfFile = new File([source], file.name, { type: file.type || 'application/pdf' });
        pages = await parsePdf(pdfFile, (current, total) => {
          setProgress({ current, total });
        });
      }
      await saveDocumentSource(docId, source);
      setDocument({
        id: docId,
        courseId: activeCourseId ?? undefined,
        title: file.name.replace(/\.(pdf|pptx)$/i, ''),
        fileName: file.name,
        fileType: isPptx ? 'pptx' as const : 'pdf' as const,
        sourceKey: docId,
        pages,
        uploadedAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '课件解析失败');
    } finally {
      setIsProcessing(false);
    }
  }, [activeCourseId, setDocument]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleCoursewareFile(files[0]);
  }, [handleCoursewareFile]);

  return (
    <div className="flex-1 overflow-y-auto bg-space-950 p-8 flex items-center justify-center">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h2 className="font-song text-3xl font-bold text-ink mb-3">上传课件</h2>
          <p className="text-space-muted">
            上传 PDF/PPTX 后先预览课件，再通过 MinerU 转换为 Markdown
          </p>
        </div>

        {/* PDF/PPTX 上传区域 */}
        <div
          className={`card border-2 border-dashed transition-colors cursor-pointer ${
            isDragging
              ? 'border-cinnabar bg-cinnabar/5'
              : 'border-space-border-strong hover:border-celadon hover:bg-celadon/5'
          }`}
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={`.pdf,.pptx,application/pdf,${PPTX_MIME_TYPE}`}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleCoursewareFile(f);
            }}
            disabled={isProcessing}
          />
          <div className="py-12 text-center">
            {isProcessing ? (
              <div>
                <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-space-border border-t-celadon"></div>
                <p className="font-song text-lg text-ink mb-2">正在准备课件预览...</p>
                {progress.total > 0 && (
                  <p className="font-mono text-sm text-ink-light">
                    第 {progress.current} / {progress.total} 页
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded border border-space-border bg-space-800">
                  <svg className="w-8 h-8 text-ink-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="font-song text-lg text-ink mb-2">
                  拖拽 PDF 或 PPTX 文件到此处，或点击选择文件
                </p>
                <p className="text-sm text-space-muted">
                  支持 PDF 与 PPTX，最大 20MB
                </p>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-cinnabar/10 border border-cinnabar/30 rounded text-cinnabar text-sm">
            {error}
          </div>
        )}

        {/* 示例课程按钮 */}
        <div className="mt-8 text-center">
          <p className="mb-3 text-sm text-space-muted">或者</p>
          <button onClick={loadExample} className="btn-outline">
            体验示例课程
          </button>
        </div>

        {/* 说明 */}
        <div className="mt-8 rounded border border-space-border bg-space-850 p-4">
          <h3 className="font-song text-sm font-bold text-ink mb-2">关于知识编译过程</h3>
          <ul className="space-y-1 text-sm text-ink-light">
            <li>1. 将 Markdown 标准化为结构块和章节大纲</li>
            <li>2. 按内容窗口识别候选知识点</li>
            <li>3. 全局合并消歧，生成知识结构</li>
            <li>4. 提取每个知识的讲解结构</li>
            <li>5. 生成双层学习顺序和知识卡片</li>
            <li>6. 生成结构化笔记</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
