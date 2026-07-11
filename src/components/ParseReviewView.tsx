import { useState } from 'react';
import { useStore } from '../store/useStore';
import { getEvidencesByPage } from '../lib/evidence';
import { EvidenceType } from '../types';

const typeLabels: Record<EvidenceType, { label: string; color: string }> = {
  title: { label: '标题', color: 'bg-cinnabar text-white' },
  definition: { label: '定义', color: 'bg-celadon text-white' },
  formula: { label: '公式', color: 'bg-ink text-white' },
  derivation: { label: '推导', color: 'bg-indigo-600 text-white' },
  conclusion: { label: '结论', color: 'bg-teal-600 text-white' },
  example: { label: '示例', color: 'bg-amber-600 text-white' },
  procedure: { label: '步骤', color: 'bg-purple-600 text-white' },
  comparison: { label: '比较', color: 'bg-blue-600 text-white' },
  chart: { label: '图表', color: 'bg-pink-600 text-white' },
  assumption: { label: '假设', color: 'bg-orange-600 text-white' },
  condition: { label: '条件', color: 'bg-lime-600 text-white' },
  text: { label: '文本', color: 'bg-gray-500 text-white' },
};

export function ParseReviewView() {
  const document = useStore(s => s.document);
  const evidences = useStore(s => s.evidences);
  const updatePageText = useStore(s => s.updatePageText);
  const regenerateEvidencesForPage = useStore(s => s.regenerateEvidencesForPage);
  const confirmParse = useStore(s => s.confirmParse);
  const setStage = useStore(s => s.setStage);
  const modelConfig = useStore(s => s.modelConfig);

  const [selectedPage, setSelectedPage] = useState(1);
  const [editingText, setEditingText] = useState<string | null>(null);

  if (!document) return null;

  const currentPage = document.pages.find(p => p.pageNumber === selectedPage);
  const pageEvidences = getEvidencesByPage(evidences, selectedPage);
  const warningPages = document.pages.filter(p => p.warning);
  const hasModel = !!modelConfig?.apiKey;

  const handleEditSave = () => {
    if (editingText !== null && currentPage) {
      updatePageText(selectedPage, editingText);
      regenerateEvidencesForPage(selectedPage);
      setEditingText(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* 顶部栏 */}
      <header className="bg-white border-b border-paper-dark px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-song text-xl font-bold text-ink">解析确认</h2>
          <p className="text-sm text-charcoal/60 mt-0.5">
            检查每页文本提取结果，可编辑修正后重新生成证据
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setStage('upload')}
            className="btn-outline"
          >
            返回
          </button>
          <button
            onClick={confirmParse}
            className="btn-primary"
          >
            确认解析，生成学习结构
          </button>
        </div>
      </header>

      {/* 模型未配置警告 */}
      {!hasModel && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">
                未配置 AI 模型 — 知识点提取需要 AI 支持
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                点击"确认解析"后将在生成页面提示配置模型。配置后即可提取知识点。
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 页面列表侧栏 */}
        <div className="w-48 bg-paper-dark/30 border-r border-paper-dark overflow-y-auto flex-shrink-0">
          <div className="p-3">
            <p className="text-xs font-mono text-ink-light uppercase tracking-wider mb-2">
              页面列表 ({document.pages.length})
            </p>
            <div className="space-y-1">
              {document.pages.map(page => (
                <button
                  key={page.pageNumber}
                  onClick={() => {
                    setSelectedPage(page.pageNumber);
                    setEditingText(null);
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                    selectedPage === page.pageNumber
                      ? 'bg-white shadow-sm text-ink'
                      : 'hover:bg-white/50 text-charcoal/70'
                  }`}
                >
                  <span className="font-mono">P{page.pageNumber}</span>
                  {page.warning && (
                    <span className="w-2 h-2 bg-cinnabar rounded-full" title={page.warning}></span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentPage && (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* 页面预览和文本 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 预览 */}
                <div className="card">
                  <h3 className="font-mono text-sm text-ink-light mb-3">
                    页面预览 · P{currentPage.pageNumber}
                  </h3>
                  {currentPage.preview ? (
                    <img
                      src={currentPage.preview}
                      alt={`Page ${currentPage.pageNumber}`}
                      className="w-full border border-paper-dark rounded"
                    />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-paper-dark/50 rounded flex items-center justify-center text-charcoal/40">
                      无预览
                    </div>
                  )}
                </div>

                {/* 文本编辑 */}
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-mono text-sm text-ink-light">
                      提取文本
                    </h3>
                    {editingText !== null ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingText(null)}
                          className="text-xs text-charcoal/60 hover:text-charcoal"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleEditSave}
                          className="text-xs text-celadon font-bold hover:text-celadon-light"
                        >
                          保存并重新生成
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingText(currentPage.text)}
                        className="text-xs text-cinnabar font-bold hover:text-cinnabar-light"
                      >
                        编辑文本
                      </button>
                    )}
                  </div>
                  {currentPage.warning && (
                    <div className="mb-3 p-2 bg-cinnabar/10 border border-cinnabar/30 rounded text-cinnabar text-xs">
                      {currentPage.warning}
                    </div>
                  )}
                  {editingText !== null ? (
                    <textarea
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      className="w-full h-64 p-3 border border-paper-dark rounded font-mono text-sm resize-none focus:outline-none focus:border-celadon"
                      placeholder="页面文本内容..."
                    />
                  ) : (
                    <div className="w-full h-64 p-3 bg-paper-dark/20 rounded overflow-y-auto font-mono text-sm whitespace-pre-wrap text-charcoal/80">
                      {currentPage.text || '(无文本内容)'}
                    </div>
                  )}
                </div>
              </div>

              {/* 证据列表 */}
              <div className="card">
                <h3 className="font-mono text-sm text-ink-light mb-3">
                  证据原子 ({pageEvidences.length})
                </h3>
                {pageEvidences.length === 0 ? (
                  <p className="text-charcoal/50 text-sm">暂无证据，请编辑文本后重新生成。</p>
                ) : (
                  <div className="space-y-3">
                    {pageEvidences.map(ev => (
                      <div
                        key={ev.id}
                        className="p-3 bg-paper-dark/20 rounded border-l-4 border-celadon"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`evidence-tag ${typeLabels[ev.type].color}`}>
                            {typeLabels[ev.type].label}
                          </span>
                          <span className="page-number">
                            P{ev.pageNumber} · 置信度 {Math.round(ev.confidence * 100)}%
                          </span>
                        </div>
                        <p className="text-sm text-charcoal/80 whitespace-pre-wrap">
                          {ev.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 警告汇总 */}
              {warningPages.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded">
                  <h4 className="font-song text-sm font-bold text-amber-800 mb-2">
                    注意：{warningPages.length} 页可能存在问题
                  </h4>
                  <p className="text-xs text-amber-700">
                    页面 {warningPages.map(p => p.pageNumber).join(', ')} 存在警告。
                    扫描版PDF无法提取文本，建议使用文本型PDF以获得最佳效果。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
