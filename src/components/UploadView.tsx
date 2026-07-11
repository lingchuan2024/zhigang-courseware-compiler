import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { validateFile, parsePdf } from '../lib/pdf';
import { generateId } from '../lib/utils';

export function UploadView() {
  const setDocument = useStore(s => s.setDocument);
  const loadExample = useStore(s => s.loadExampleCourse);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    const validation = validateFile(file);
    if (!validation.valid) {
      setError(validation.error || '文件无效');
      return;
    }

    setIsProcessing(true);
    setProgress({ current: 0, total: 0 });

    try {
      const pages = await parsePdf(file, (current, total) => {
        setProgress({ current, total });
      });

      const doc = {
        id: generateId('doc'),
        title: file.name.replace(/\.pdf$/i, ''),
        fileName: file.name,
        pages,
        uploadedAt: Date.now(),
      };

      setDocument(doc);
    } catch (err) {
      console.error('PDF parsing error:', err);
      setError('PDF解析失败，请确保文件是有效的文本型PDF');
    } finally {
      setIsProcessing(false);
    }
  }, [setDocument]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h2 className="font-song text-3xl font-bold text-ink mb-3">上传课件</h2>
          <p className="text-charcoal/60">
            上传文本型PDF课件，知纲将为你编译成结构化学习笔记
          </p>
        </div>

        {/* 上传区域 */}
        <div
          className={`card border-2 border-dashed transition-colors cursor-pointer ${
            isDragging
              ? 'border-cinnabar bg-cinnabar/5'
              : 'border-paper-dark hover:border-celadon hover:bg-celadon/5'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleInputChange}
            disabled={isProcessing}
          />

          <div className="py-12 text-center">
            {isProcessing ? (
              <div>
                <div className="w-16 h-16 mx-auto mb-4 border-4 border-paper-dark border-t-celadon rounded-full animate-spin"></div>
                <p className="font-song text-lg text-ink mb-2">正在解析课件...</p>
                {progress.total > 0 && (
                  <p className="font-mono text-sm text-ink-light">
                    第 {progress.current} / {progress.total} 页
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="w-16 h-16 mx-auto mb-4 bg-paper-dark/50 rounded flex items-center justify-center">
                  <svg className="w-8 h-8 text-ink-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="font-song text-lg text-ink mb-2">
                  拖拽PDF文件到此处，或点击选择文件
                </p>
                <p className="text-sm text-charcoal/50">
                  支持文本型PDF，最大20MB
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
          <p className="text-charcoal/50 text-sm mb-3">或者</p>
          <button
            onClick={loadExample}
            className="btn-outline"
          >
            体验示例课程（无需PDF）
          </button>
        </div>

        {/* 说明 */}
        <div className="mt-8 p-4 bg-paper-dark/30 rounded">
          <h3 className="font-song text-sm font-bold text-ink mb-2">关于"编译"过程</h3>
          <ul className="text-sm text-charcoal/70 space-y-1">
            <li>1. 提取课件文本作为可信证据层</li>
            <li>2. 将内容原子化为可引用的证据单元</li>
            <li>3. 基于证据组织学习结构</li>
            <li>4. 生成三种视图的学习笔记</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
