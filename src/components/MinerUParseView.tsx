import { useState } from 'react';
import { useStore } from '../store/useStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { formatMinerUError } from '../lib/mineru-client';

interface MinerUParseViewProps {
  onOpenSettings: () => void;
}

const STATUS_TEXT = {
  idle: '等待开始解析',
  uploading: '正在上传课件',
  queued: '等待 MinerU 处理',
  parsing: '正在解析课件内容',
  downloading: '正在下载解析结果',
  normalizing: '正在整理 Markdown',
  completed: '解析完成',
  failed: '解析失败',
} as const;

export function MinerUParseView({ onOpenSettings }: MinerUParseViewProps) {
  const document = useStore(state => state.document);
  const mineruConfig = useStore(state => state.mineruConfig);
  const modelConfig = useStore(state => state.modelConfig);
  const result = useStore(state => state.mineruParseResult);
  const sourceDocuments = useStore(state => state.sourceDocuments);
  const startMinerUParse = useStore(state => state.startMinerUParse);
  const startKnowledgePipeline = useStore(state => state.startKnowledgePipeline);
  const navigateToStage = useStore(state => state.navigateToStage);
  const [tab, setTab] = useState<'preview' | 'cleaned' | 'raw'>('preview');
  const [extracting, setExtracting] = useState(false);

  const cleanedMarkdown = sourceDocuments[0]?.markdown ?? result?.markdown ?? '';
  const rawMarkdown = result?.markdown ?? cleanedMarkdown;
  const markdown = tab === 'raw' ? rawMarkdown : cleanedMarkdown;
  const removedCharacters = Math.max(0, rawMarkdown.length - cleanedMarkdown.length);
  const isRunning = Boolean(result && ['uploading', 'queued', 'parsing', 'downloading', 'normalizing'].includes(result.status));
  const isCompleted = result?.status === 'completed' && Boolean(markdown);
  const isDirectMarkdown = document?.fileType === 'markdown';

  const handleExtract = async () => {
    if (!modelConfig?.apiKey) {
      onOpenSettings();
      return;
    }
    setExtracting(true);
    try {
      await startKnowledgePipeline();
    } finally {
      setExtracting(false);
    }
  };

  if (!document) {
    return (
      <div className="flex-1 grid place-items-center bg-paper">
        <button className="btn-primary" onClick={() => navigateToStage('upload')}>返回上传课件</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-space-950/[0.76]">
      <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/[0.94] px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigateToStage('document')} className="text-space-muted hover:text-ink">←</button>
          <div className="min-w-0">
            <h2 className="font-song font-bold text-ink truncate">MinerU 解析</h2>
            <p className="truncate text-xs text-space-muted">{document.fileName} · 将原始课件转换为知识处理使用的 Markdown</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-1 text-xs ${mineruConfig?.apiKey ? 'border-celadon/25 bg-celadon/10 text-celadon-light' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}`}>
            MinerU {mineruConfig?.apiKey ? '已配置' : '未配置'}
          </span>
          {isCompleted && (
            <button className="btn-primary text-sm" onClick={handleExtract} disabled={extracting}>
              {extracting ? '正在提取...' : '确认并提取知识结构'}
            </button>
          )}
        </div>
      </header>

      {!isCompleted ? (
        <main className="flex-1 grid place-items-center p-8">
          <section className="w-full max-w-xl rounded-2xl border border-space-border bg-space-850 p-8 shadow-2xl">
            <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-celadon/10 text-xl text-celadon-light">M</div>
            <h3 className="font-song text-2xl font-bold text-ink mb-2">
              {result ? STATUS_TEXT[result.status] : isDirectMarkdown ? 'Markdown 已就绪' : '开始解析课件'}
            </h3>
            <p className="mb-6 text-sm leading-6 text-space-muted">
              {isDirectMarkdown
                ? '当前文件已经是 MinerU Markdown，无需再次调用解析服务。'
                : 'MinerU 会识别标题、正文、公式、表格和图片，并生成可检查的 Markdown。'}
            </p>

            {isRunning && (
              <div className="mb-6">
                <div className="h-2 overflow-hidden rounded-full bg-space-750">
                  <div className="h-full bg-celadon rounded-full transition-all duration-500" style={{ width: `${Math.min(result?.progress ?? 0, 95)}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-space-muted">
                  <span>{result ? STATUS_TEXT[result.status] : ''}</span>
                  <span>{Math.round(result?.progress ?? 0)}%</span>
                </div>
              </div>
            )}

            {result?.status === 'failed' && (
              <div className="mb-6 rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-4 text-sm text-cinnabar-light">
                {formatMinerUError(result.error)}
              </div>
            )}

            {!mineruConfig?.apiKey && !isDirectMarkdown && (
              <button className="btn-outline mr-3" onClick={onOpenSettings}>配置 MinerU API</button>
            )}
            <button
              className="btn-primary"
              disabled={isRunning || (!mineruConfig?.apiKey && !isDirectMarkdown)}
              onClick={startMinerUParse}
            >
              {result?.status === 'failed' ? '重新解析' : isDirectMarkdown ? '确认 Markdown' : '开始解析'}
            </button>
          </section>
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex">
          <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.94] p-5 backdrop-blur-xl">
            <p className="mb-4 text-xs uppercase tracking-wider text-space-muted">解析摘要</p>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-space-muted">状态</dt><dd className="mt-1 text-celadon-light">解析完成</dd></div>
              <div><dt className="text-space-muted">内容块</dt><dd className="mt-1 text-ink-light">{sourceDocuments[0]?.blocks.length ?? 0}</dd></div>
              <div><dt className="text-space-muted">清洗前</dt><dd className="mt-1 text-ink-light">{rawMarkdown.length.toLocaleString()} 字符</dd></div>
              <div><dt className="text-space-muted">清洗后</dt><dd className="mt-1 text-ink-light">{cleanedMarkdown.length.toLocaleString()} 字符</dd></div>
              <div><dt className="text-space-muted">整理减少</dt><dd className="mt-1 text-celadon-light">{removedCharacters.toLocaleString()} 字符</dd></div>
              <div><dt className="text-space-muted">资源文件</dt><dd className="mt-1 text-ink-light">{result?.assets.length ?? 0}</dd></div>
              {result?.batchId && <div><dt className="text-space-muted">任务 ID</dt><dd className="mt-1 break-all font-mono text-xs text-space-muted">{result.batchId}</dd></div>}
            </dl>
            {!isDirectMarkdown && <button className="mt-6 text-sm text-space-muted hover:text-cinnabar-light" onClick={startMinerUParse}>重新解析</button>}
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex h-12 flex-shrink-0 items-center gap-1 border-b border-space-border bg-space-900 px-6">
              <button onClick={() => setTab('preview')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'preview' ? 'bg-celadon/15 text-celadon-light' : 'text-space-muted hover:bg-space-750'}`}>渲染预览</button>
              <button onClick={() => setTab('cleaned')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'cleaned' ? 'bg-celadon/15 text-celadon-light' : 'text-space-muted hover:bg-space-750'}`}>清洗后 Markdown</button>
              {rawMarkdown !== cleanedMarkdown && (
                <button onClick={() => setTab('raw')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'raw' ? 'bg-celadon/15 text-celadon-light' : 'text-space-muted hover:bg-space-750'}`}>MinerU 原始输出</button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              <article className="mx-auto max-w-4xl rounded-xl border border-space-border bg-space-850 p-8 shadow-2xl">
                {tab === 'preview'
                  ? <div className="prose-content"><MarkdownRenderer content={markdown} /></div>
                  : <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-ink-light">{markdown}</pre>}
              </article>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
