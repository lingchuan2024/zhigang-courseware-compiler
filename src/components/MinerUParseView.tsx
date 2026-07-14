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
    <div className="flex-1 flex flex-col min-h-0 bg-[#f7f4ed]">
      <header className="h-16 px-6 bg-white border-b border-stone-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigateToStage('document')} className="text-stone-500 hover:text-ink">←</button>
          <div className="min-w-0">
            <h2 className="font-song font-bold text-ink truncate">MinerU 解析</h2>
            <p className="text-xs text-stone-500 truncate">{document.fileName} · 将原始课件转换为知识处理使用的 Markdown</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${mineruConfig?.apiKey ? 'bg-celadon/10 text-celadon-dark' : 'bg-amber-50 text-amber-700'}`}>
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
          <section className="w-full max-w-xl bg-white border border-stone-200 rounded-2xl shadow-sm p-8">
            <div className="w-12 h-12 rounded-xl bg-celadon/10 text-celadon-dark grid place-items-center text-xl mb-5">M</div>
            <h3 className="font-song text-2xl font-bold text-ink mb-2">
              {result ? STATUS_TEXT[result.status] : isDirectMarkdown ? 'Markdown 已就绪' : '开始解析课件'}
            </h3>
            <p className="text-sm text-stone-500 leading-6 mb-6">
              {isDirectMarkdown
                ? '当前文件已经是 MinerU Markdown，无需再次调用解析服务。'
                : 'MinerU 会识别标题、正文、公式、表格和图片，并生成可检查的 Markdown。'}
            </p>

            {isRunning && (
              <div className="mb-6">
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-celadon rounded-full transition-all duration-500" style={{ width: `${Math.min(result?.progress ?? 0, 95)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-stone-500 mt-2">
                  <span>{result ? STATUS_TEXT[result.status] : ''}</span>
                  <span>{Math.round(result?.progress ?? 0)}%</span>
                </div>
              </div>
            )}

            {result?.status === 'failed' && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
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
          <aside className="w-64 flex-shrink-0 bg-white border-r border-stone-200 p-5 overflow-y-auto">
            <p className="text-xs uppercase tracking-wider text-stone-400 mb-4">解析摘要</p>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-stone-400">状态</dt><dd className="text-celadon-dark mt-1">解析完成</dd></div>
              <div><dt className="text-stone-400">内容块</dt><dd className="text-stone-700 mt-1">{sourceDocuments[0]?.blocks.length ?? 0}</dd></div>
              <div><dt className="text-stone-400">清洗前</dt><dd className="text-stone-700 mt-1">{rawMarkdown.length.toLocaleString()} 字符</dd></div>
              <div><dt className="text-stone-400">清洗后</dt><dd className="text-stone-700 mt-1">{cleanedMarkdown.length.toLocaleString()} 字符</dd></div>
              <div><dt className="text-stone-400">整理减少</dt><dd className="text-celadon-dark mt-1">{removedCharacters.toLocaleString()} 字符</dd></div>
              <div><dt className="text-stone-400">资源文件</dt><dd className="text-stone-700 mt-1">{result?.assets.length ?? 0}</dd></div>
              {result?.batchId && <div><dt className="text-stone-400">任务 ID</dt><dd className="text-stone-500 mt-1 break-all font-mono text-xs">{result.batchId}</dd></div>}
            </dl>
            {!isDirectMarkdown && <button className="mt-6 text-sm text-stone-500 hover:text-cinnabar" onClick={startMinerUParse}>重新解析</button>}
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="h-12 px-6 border-b border-stone-200 bg-white flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setTab('preview')} className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'preview' ? 'bg-ink text-white' : 'text-stone-500 hover:bg-stone-100'}`}>渲染预览</button>
              <button onClick={() => setTab('cleaned')} className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'cleaned' ? 'bg-ink text-white' : 'text-stone-500 hover:bg-stone-100'}`}>清洗后 Markdown</button>
              {rawMarkdown !== cleanedMarkdown && (
                <button onClick={() => setTab('raw')} className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'raw' ? 'bg-ink text-white' : 'text-stone-500 hover:bg-stone-100'}`}>MinerU 原始输出</button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              <article className="max-w-4xl mx-auto bg-white border border-stone-200 rounded-xl shadow-sm p-8">
                {tab === 'preview'
                  ? <div className="prose-content"><MarkdownRenderer content={markdown} /></div>
                  : <pre className="whitespace-pre-wrap break-words text-sm leading-6 font-mono text-stone-700">{markdown}</pre>}
              </article>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
