import { useMemo, useState } from 'react';
import type { KnowledgeNetworkNode } from '../../lib/knowledge-network-adapter';
import { resolveSourceRanges } from '../../lib/source-range-resolver';
import type { SourceDocument } from '../../types';
import { prepareSourceBlockPreview } from '../../lib/source-preview';
import { MarkdownRenderer } from '../MarkdownRenderer';

interface SourceEvidencePanelProps {
  node: KnowledgeNetworkNode | null;
  documents: SourceDocument[];
  relationCount: number;
  onClose?: () => void;
  onDrillDown?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  concept: '概念', mathematical_derivation: '数学推导', algorithm: '算法', system_mechanism: '系统机制',
  comparison: '对比', case_study: '案例分析', mixed: '综合', motivation: '动机', problem: '问题',
  prior_knowledge: '前置知识', intuition: '直觉', definition: '定义', property: '性质', formula: '公式',
  derivation: '推导', proof: '证明', procedure: '步骤', example: '案例', visualization: '图示',
  application: '应用', condition: '条件', limitation: '局限', misconception: '误区', conclusion: '结论', exercise: '练习',
};

export function SourceEvidencePanel({
  node,
  documents,
  relationCount,
  onClose,
  onDrillDown,
}: SourceEvidencePanelProps) {
  const [mode, setMode] = useState<'preview' | 'raw'>('preview');
  const sources = useMemo(
    () => resolveSourceRanges(node?.sourceRanges ?? [], documents),
    [documents, node?.sourceRanges],
  );

  return (
    <aside className="w-[360px] max-w-[42vw] flex-shrink-0 border-l border-stone-200 bg-[#fffdfa] flex flex-col min-h-0" aria-label="节点原文">
      {!node ? (
        <div className="flex-1 grid place-items-center px-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full border border-[#b9c9bf] bg-[#edf4ef] text-[#35695b]">原</div>
            <h3 className="font-song text-base font-bold text-ink">选择知识节点</h3>
            <p className="mt-2 text-sm leading-6 text-stone-500">点击网络中的节点，在这里查看它直接引用的 MinerU 原文。</p>
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-stone-200 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-[0.16em] text-[#6e8178]">节点原文</p>
                <h3 className="mt-1 font-song text-xl font-bold leading-7 text-[#173f35]">{node.label}</h3>
              </div>
              {onClose && <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="收起原文面板">×</button>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-[#edf4ef] px-2.5 py-1 text-[#35695b]">{CATEGORY_LABELS[node.category] ?? node.category}</span>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{relationCount} 个关系</span>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">置信度 {Math.round(node.confidence * 100)}%</span>
            </div>
            {node.kind === 'topic' && onDrillDown && (
              <button type="button" onClick={onDrillDown} className="mt-3 w-full rounded-lg bg-[#173f35] px-3 py-2 text-sm font-medium text-white hover:bg-[#235549]">
                查看内部知识网 →
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
            <span className="text-xs text-stone-500">{sources.length} 个来源区间</span>
            <div className="flex rounded-lg bg-stone-100 p-0.5 text-xs">
              <button type="button" onClick={() => setMode('preview')} className={`rounded-md px-2.5 py-1 ${mode === 'preview' ? 'bg-white text-[#173f35] shadow-sm' : 'text-stone-500'}`}>渲染预览</button>
              <button type="button" onClick={() => setMode('raw')} className={`rounded-md px-2.5 py-1 ${mode === 'raw' ? 'bg-white text-[#173f35] shadow-sm' : 'text-stone-500'}`}>原始 Markdown</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {sources.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                该节点缺少可定位原文。系统不会使用摘要或笔记替代课件原文。
              </div>
            )}
            {sources.map((source, index) => (
              <section key={`${source.range.documentId}-${source.range.startBlockId}-${source.range.endBlockId}-${index}`} data-testid="source-range-card" className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(23,63,53,.04)]">
                <header className="border-b border-stone-100 bg-[#faf8f2] px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[#355b50]">{source.documentTitle}</p>
                      <p className="mt-1 truncate text-[11px] text-stone-400">{source.headingPath.length ? source.headingPath.join(' / ') : '未识别标题路径'}</p>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-medium text-stone-500 shadow-sm ring-1 ring-stone-200">
                      {source.blocks.length} 个原文块
                    </span>
                  </div>
                </header>
                {source.missingReason ? (
                  <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-700">
                    <strong className="block">缺少可定位原文</strong>
                    {source.missingReason}
                  </div>
                ) : mode === 'preview' ? (
                  <div className="divide-y divide-stone-100">
                    {source.blocks.map((block, blockIndex) => (
                      <div
                        key={block.id}
                        data-testid="source-block-preview"
                        className="px-4 py-3.5"
                      >
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-medium tracking-[0.08em] text-stone-400">
                          <span>{block.type === 'formula' ? '公式' : block.type === 'heading' ? '标题' : '原文'}</span>
                          <span aria-hidden="true">·</span>
                          <span>片段 {blockIndex + 1}</span>
                        </div>
                        <MarkdownRenderer content={prepareSourceBlockPreview(block)} className="text-[14px] leading-7" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-6 text-stone-700">{source.markdown}</pre>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
