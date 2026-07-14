import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getOrderedTopics } from '../lib/knowledge-graph';
import { MarkdownWithCitations } from './MarkdownRenderer';
import { JobProgress } from './progress/JobProgress';
import { JobFailureState } from './progress/JobFailureState';
import type { KnowledgePackage, CourseTopic } from '../types';
import { MasterNoteView } from './MasterNoteView';

const TYPE_LABELS: Record<string, string> = {
  concept: '概念', principle: '原理', method: '方法', formula: '公式',
  problem: '问题', composite: '综合', derivation: '推导', comparison: '对比',
};

/* ------------------------------------------------------------------ */
/* Block-level Markdown splitting (never splits inside code/math/tables) */
/* ------------------------------------------------------------------ */

/**
 * Split Markdown into top-level blocks separated by blank lines.
 * Fenced code blocks (``` or ~~~), math blocks ($$), and GFM tables
 * are kept intact — they are never split by internal blank lines.
 */
function splitMarkdownBlocks(md: string): string[] {
  const blocks: string[] = [];
  const lines = md.split('\n');
  let current: string[] = [];
  let inCodeFence = false;
  let fenceMarker = '';
  let inMathBlock = false;

  const flush = () => {
    if (current.length > 0) {
      const text = current.join('\n').trim();
      if (text) blocks.push(text);
      current = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // --- Code fence detection ---
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = fenceMatch[1][0]; // ` or ~
        current.push(line);
        continue;
      }
      // Check if this line closes the fence
      if (trimmed[0] === fenceMarker) {
        const onlyFence = trimmed.match(new RegExp(`^${fenceMarker}{3,}\\s*$`));
        if (onlyFence) {
          inCodeFence = false;
          fenceMarker = '';
          current.push(line);
          continue;
        }
      }
    }

    if (inCodeFence) {
      current.push(line);
      continue;
    }

    // --- Math block detection ($$ ... $$) ---
    if (trimmed.startsWith('$$')) {
      if (!inMathBlock) {
        inMathBlock = true;
        current.push(line);
        // Single-line $$ ... $$ closes immediately
        if (trimmed.indexOf('$$', 2) !== -1 && trimmed.length > 2) {
          inMathBlock = false;
        }
        continue;
      } else {
        inMathBlock = false;
        current.push(line);
        continue;
      }
    }

    if (inMathBlock) {
      current.push(line);
      continue;
    }

    // --- Blank line = block separator ---
    if (trimmed === '') {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Review view: collapse derivation blocks                             */
/* ------------------------------------------------------------------ */

/**
 * For review view: keep the full content, but visually collapse
 * derivation sections by wrapping them in a Markdown blockquote
 * with a "collapsed" note. Code blocks, math blocks, and tables
 * inside derivation sections are preserved intact.
 */
function collapseDerivationBlocks(md: string): string {
  const blocks = splitMarkdownBlocks(md);
  const result: string[] = [];
  let inDerivation = false;
  let derivationDepth = 0;
  let derivationBlocks: string[] = [];

  const flushDerivation = () => {
    if (derivationBlocks.length > 0) {
      const headingBlock = derivationBlocks[0];
      const headingText = headingBlock.replace(/^#{1,6}\s*/, '').trim();
      const content = derivationBlocks.join('\n\n');
      // Convert to blockquote: prefix every line with "> "
      const quoted = content
        .split('\n')
        .map(l => (l.trim() ? `> ${l}` : '>'))
        .join('\n');
      result.push(
        `> **[复习模式：推导已折叠]** ${headingText}\n>\n> 切换到「初学」模式查看完整推导步骤。\n>\n${quoted}`
      );
      derivationBlocks = [];
    }
    inDerivation = false;
  };

  for (const block of blocks) {
    const headingMatch = block.match(/^(#{1,6})\s+/);

    if (headingMatch) {
      const depth = headingMatch[1].length;
      const isDerivation = /推导|证明|详细|展开/.test(block);

      if (isDerivation) {
        // Flush any previous derivation section
        flushDerivation();
        inDerivation = true;
        derivationDepth = depth;
        derivationBlocks.push(block);
        continue;
      }

      // Encountering a heading at same/higher level ends the derivation section
      if (inDerivation && depth <= derivationDepth) {
        flushDerivation();
      }
    }

    if (inDerivation) {
      derivationBlocks.push(block);
    } else {
      result.push(block);
    }
  }

  flushDerivation();
  return result.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Exam view: project key types from internal structure               */
/* ------------------------------------------------------------------ */

const EXAM_KEY_TYPES = new Set([
  'formula', 'definition', 'conclusion', 'condition', 'comparison', 'misconception',
]);

const EXAM_TYPE_LABELS: Record<string, string> = {
  formula: '公式',
  definition: '定义',
  conclusion: '结论',
  condition: '适用条件',
  comparison: '对比',
  misconception: '易错点',
};

/**
 * For exam view: project only key content types (formula, definition,
 * conclusion, condition, comparison, misconception) from the structured
 * internalStructure.items. Falls back to full content with a warning
 * if internal structure is not available.
 */
function projectExamContent(kp: KnowledgePackage): string {
  const fullContent = kp.note?.contentMarkdown || kp.source.combinedOriginalText;
  const struct = kp.internalStructure;

  // If internal structure is not ready or has no items, fall back
  if (struct.status !== 'ready' || struct.items.length === 0) {
    return `> **备考模式提示**：当前知识点暂无结构化内部数据，以下显示完整内容。建议切换到「初学」模式查看。\n\n${fullContent}`;
  }

  const itemsById = new Map(struct.items.map(i => [i.id, i]));
  const orderedItems = struct.orderedItemIds
    .map(id => itemsById.get(id))
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  const keyItems = orderedItems.filter(i => EXAM_KEY_TYPES.has(i.type));

  // If no key-type items found, fall back
  if (keyItems.length === 0) {
    return `> **备考模式提示**：当前知识点的内部结构中暂无备考关键内容（公式、定义、结论等），以下显示完整内容。\n\n${fullContent}`;
  }

  const sections: string[] = ['## 备考速查'];

  for (const item of keyItems) {
    const label = EXAM_TYPE_LABELS[item.type] || item.type;
    const titleSuffix = item.title ? ` **${item.title}**` : '';
    const pages = item.originalPageNumbers.length > 0
      ? `\n\n> P.${item.originalPageNumbers.join(',')}`
      : '';
    sections.push(`### ${label}${titleSuffix}\n\n${item.content}${pages}`);
  }

  return sections.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Main content filter                                                 */
/* ------------------------------------------------------------------ */

function getFilteredContent(kp: KnowledgePackage, view: 'first-study' | 'review' | 'exam'): string {
  if (!kp.note) return kp.source.combinedOriginalText;
  const md = kp.note.contentMarkdown;

  // first-study: show full content as-is, no filtering
  if (view === 'first-study') return md;

  // review: show full content but collapse derivation blocks
  if (view === 'review') return collapseDerivationBlocks(md);

  // exam: project key types from internal structure
  if (view === 'exam') return projectExamContent(kp);

  return md;
}

function LegacyNotesView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const courseDoc = useStore(s => s.document);
  const topics = useStore(s => s.topics);
  const packages = useStore(s => s.knowledgePackages);
  const evidences = useStore(s => s.evidences);
  const currentView = useStore(s => s.currentView);
  const orderMode = useStore(s => s.orderMode);
  const setCurrentView = useStore(s => s.setCurrentView);
  const setOrderMode = useStore(s => s.setOrderMode);
  const exportNotes = useStore(s => s.exportCurrentNotes);
  const regenerateNote = useStore(s => s.regenerateNoteForTopic);
  const regenerateAll = useStore(s => s.generateAllNotes);
  const reset = useStore(s => s.reset);
  const job = useStore(s => s.job);
  const jobStatus = useStore(s => s.jobStatus);
  const pipelineProgress = useStore(s => s.pipelineProgress);
  const navigateToStage = useStore(s => s.navigateToStage);
  const staleMarker = useStore(s => s.staleMarker);
  const modelConfig = useStore(s => s.modelConfig);

  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ============== 内联生成进度状态 ==============

  const isGenerating = jobStatus === 'running' && [
    'generating-topic-notes', 'assembling-master-note'
  ].includes(job || '');

  const failedPackages = packages.filter(p => p.topic.noteStatus === 'failed');
  const hasAnyFailures = failedPackages.length > 0;
  const completedCount = packages.filter(p => p.note).length;
  const hasAnyCompleted = completedCount > 0;
  const isAllFailed = hasAnyFailures && !hasAnyCompleted && !isGenerating;

  // Hooks must be called before any early returns
  const kpMap = useMemo(() => new Map(packages.map(p => [p.topic.id, p])), [packages]);
  const orderedTopics = useMemo(() => getOrderedTopics(topics, orderMode), [topics, orderMode]);
  const citationEvidences = useMemo(() => {
    return evidences.map(e => ({
      id: e.id,
      pageNumber: e.pageNumber,
      content: e.content,
    }));
  }, [evidences]);

  if (isGenerating) {
    return (
      <JobProgress
        title="正在生成学习笔记"
        progress={pipelineProgress}
      />
    );
  }

  if (isAllFailed) {
    return (
      <JobFailureState
        title="笔记生成失败"
        message={`所有 ${packages.length} 个知识点的笔记生成均失败`}
        errors={failedPackages.map(p => `${p.topic.title}: 生成失败`)}
        onRetry={() => regenerateAll()}
        onBack={() => navigateToStage('structure')}
        backLabel="返回知识结构"
      />
    );
  }

  const activeTopic: CourseTopic | null = activeTopicId
    ? topics.find(t => t.id === activeTopicId) || orderedTopics[0] || null
    : orderedTopics[0] || null;
  const activeKp = activeTopic ? kpMap.get(activeTopic.id) : undefined;

  const views: Array<{ key: 'first-study' | 'review' | 'exam'; label: string; desc: string }> = [
    { key: 'first-study', label: '初学', desc: '完整推导与解释' },
    { key: 'review', label: '复习', desc: '核心概念与结论' },
    { key: 'exam', label: '备考', desc: '公式与易错点' },
  ];

  const content = activeKp ? getFilteredContent(activeKp, currentView) : '';
  const citations = activeKp?.note?.citations || [];

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-stone-50">
      {/* 顶部栏 */}
      <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigateToStage('structure')}
            className="p-1.5 rounded hover:bg-stone-100 transition-colors"
            title="返回知识结构"
            aria-label="返回知识结构"
          >
            <svg className="w-5 h-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded hover:bg-stone-100 transition-colors"
            title="切换目录"
          >
            <svg className="w-5 h-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="font-song text-lg font-bold text-stone-900">{courseDoc?.title || '课件笔记'}</h1>
            <div className="flex items-center gap-3 text-xs text-stone-500 mt-0.5">
              <span>{orderedTopics.length} 个知识点</span>
              <span>·</span>
              <span>{completedCount}/{packages.length} 已生成笔记</span>
              {hasAnyFailures && (
                <>
                  <span>·</span>
                  <span className="text-cinnabar">{failedPackages.length} 个失败</span>
                </>
              )}
              <span>·</span>
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${orderMode === 'ai-recommended' ? 'bg-cinnabar' : 'bg-stone-400'}`}></span>
                {orderMode === 'ai-recommended' ? 'AI推荐顺序' : 'PPT原顺序'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 部分失败时提供重试 */}
          {hasAnyFailures && (
            <button
              onClick={() => {
                failedPackages.forEach(p => regenerateNote(p.topic.id));
              }}
              className="px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
            >
              重试失败项 ({failedPackages.length})
            </button>
          )}
          {!modelConfig?.apiKey && (
            <button
              onClick={onOpenSettings}
              className="px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
            >
              配置AI模型
            </button>
          )}
          {/* 视图切换 */}
          <div className="flex bg-stone-100 rounded-lg p-0.5">
            {views.map(v => (
              <button
                key={v.key}
                onClick={() => setCurrentView(v.key)}
                className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                  currentView === v.key
                    ? 'bg-white text-stone-900 shadow-sm font-medium'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
                title={v.desc}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-stone-200"></div>

          <button
            onClick={() => setOrderMode(orderMode === 'original' ? 'ai-recommended' : 'original')}
            className="px-3 py-1.5 text-xs border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors flex items-center gap-1"
          >
            {orderMode === 'original' ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI推荐顺序
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                PPT原顺序
              </>
            )}
          </button>

          <button
            onClick={() => exportNotes()}
            className="px-3 py-1.5 text-xs border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            导出MD
          </button>

          <button
            onClick={regenerateAll}
            className="px-3 py-1.5 text-xs border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
          >重新生成</button>

          <button
            onClick={() => { if (confirm('确定重置所有数据？此操作不可撤销。')) reset(); }}
            className="px-3 py-1.5 text-xs text-stone-500 hover:text-cinnabar transition-colors"
          >重置</button>
        </div>
      </header>

      {staleMarker && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between flex-shrink-0">
          <span className="text-sm text-amber-700">
            {staleMarker.reason === 'structure-edited'
              ? '知识结构已修改，笔记需要重新生成'
              : staleMarker.reason === 'evidence-edited'
              ? '课件证据已修改，笔记需要重新生成'
              : '数据已修改，笔记需要重新生成'}
          </span>
          <button
            onClick={() => regenerateAll()}
            className="text-xs text-amber-700 font-medium hover:text-amber-900 px-3 py-1 rounded hover:bg-amber-100"
          >
            重新生成
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧目录 */}
        {sidebarOpen && (
          <aside className="w-64 border-r border-stone-200 bg-white overflow-y-auto flex-shrink-0">
            <div className="p-3">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3 px-2 flex items-center justify-between">
                <span>目录</span>
                <span className="text-stone-300 font-normal normal-case tracking-normal">{orderedTopics.length}</span>
              </div>
              <nav className="space-y-0.5">
                {orderedTopics.map((topic) => {
                  const kp = kpMap.get(topic.id);
                  const isActive = activeTopic?.id === topic.id;
                  const orderNum = orderMode === 'ai-recommended' ? topic.recommendedOrder : topic.originalOrder;
                  return (
                    <button
                      key={topic.id}
                      onClick={() => setActiveTopicId(topic.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                        isActive
                          ? 'bg-stone-900 text-white shadow-sm'
                          : 'hover:bg-stone-100 text-stone-700'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`font-mono text-xs flex-shrink-0 mt-0.5 w-6 text-center ${
                          isActive ? 'text-cinnabar' : 'text-stone-400'
                        }`}>
                          {String(orderNum + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate leading-snug">{topic.title}</div>
                          <div className={`text-xs mt-1 flex items-center gap-1.5 ${
                            isActive ? 'text-white/60' : 'text-stone-400'
                          }`}>
                            <span>P.{topic.originalPageNumbers.join(',')}</span>
                            {kp?.note ? (
                              <span className={isActive ? 'text-green-400' : 'text-green-500'}>✓ 已完成</span>
                            ) : kp?.topic.noteStatus === 'failed' ? (
                              <span className={isActive ? 'text-red-400' : 'text-red-500'}>! 失败</span>
                            ) : kp?.topic.noteStatus === 'generating' ? (
                              <span className={isActive ? 'text-amber-400' : 'text-amber-500'}>生成中...</span>
                            ) : (
                              <span className={isActive ? 'text-white/30' : 'text-stone-300'}>待生成</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        )}

        {/* 主内容区 */}
        <main className="flex-1 overflow-y-auto">
          {activeKp && activeTopic ? (
            <div className="max-w-3xl mx-auto px-8 py-8">
              {/* 知识点标题 */}
              <div className="mb-8 pb-6 border-b border-stone-200">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-xs px-2.5 py-1 bg-stone-100 text-stone-600 rounded-md font-medium">
                    {TYPE_LABELS[activeTopic.type] || activeTopic.type}
                  </span>
                  {activeTopic.importance === 'core' && (
                    <span className="text-xs px-2.5 py-1 bg-cinnabar/10 text-cinnabar rounded-md font-medium">核心知识点</span>
                  )}
                  <span className="text-xs text-stone-400 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    第 {activeTopic.originalPageNumbers.join(', ')} 页
                  </span>
                  {activeKp.note && (
                    <span className="text-xs text-stone-400 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      置信度 {Math.round(activeTopic.confidence * 100)}%
                    </span>
                  )}
                </div>
                <h1 className="font-song text-3xl font-bold text-stone-900 mb-3 leading-tight">
                  {activeKp.note?.title || activeTopic.title}
                </h1>
                <p className="text-stone-500 text-base leading-relaxed">
                  {activeTopic.learningGoal}
                </p>
                {activeKp.note?.shortSummary && (
                  <div className="mt-4 p-4 bg-stone-50 rounded-lg border-l-4 border-cinnabar/30">
                    <p className="text-stone-600 italic text-sm leading-relaxed">
                      <span className="font-medium not-italic text-stone-500">摘要：</span>
                      {activeKp.note.shortSummary}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {activeKp.topic.noteStatus === 'failed' && (
                    <button
                      onClick={() => regenerateNote(activeTopic.id)}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      重新生成
                    </button>
                  )}
                  {activeKp.note?.warnings && activeKp.note.warnings.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      {activeKp.note.warnings.length} 条注意事项
                    </div>
                  )}
                </div>
              </div>

              {/* 笔记正文 */}
              <MarkdownWithCitations
                content={content}
                citations={citations}
                evidences={citationEvidences}
              />

              {/* 知识点导航 */}
              <div className="mt-12 pt-6 border-t border-stone-200">
                <div className="flex justify-between items-stretch gap-4">
                  {(() => {
                    const idx = orderedTopics.findIndex(t => t.id === activeTopic.id);
                    const prev = idx > 0 ? orderedTopics[idx - 1] : null;
                    const next = idx < orderedTopics.length - 1 ? orderedTopics[idx + 1] : null;
                    return (
                      <>
                        {prev ? (
                          <button
                            onClick={() => setActiveTopicId(prev.id)}
                            className="flex-1 group p-4 rounded-xl border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-all text-left"
                          >
                            <div className="text-xs text-stone-400 mb-1 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                              上一个知识点
                            </div>
                            <div className="font-medium text-stone-700 group-hover:text-cinnabar transition-colors">
                              {prev.title}
                            </div>
                            <div className="text-xs text-stone-400 mt-1">
                              P.{prev.originalPageNumbers.join(',')}
                            </div>
                          </button>
                        ) : (
                          <div className="flex-1 p-4 rounded-xl border border-stone-100 bg-stone-50/50">
                            <div className="text-xs text-stone-300">这是第一个知识点</div>
                          </div>
                        )}
                        {next ? (
                          <button
                            onClick={() => setActiveTopicId(next.id)}
                            className="flex-1 group p-4 rounded-xl border border-stone-200 hover:border-cinnabar/30 hover:bg-cinnabar/5 transition-all text-right"
                          >
                            <div className="text-xs text-stone-400 mb-1 flex items-center gap-1 justify-end">
                              下一个知识点
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                            <div className="font-medium text-stone-700 group-hover:text-cinnabar transition-colors">
                              {next.title}
                            </div>
                            <div className="text-xs text-stone-400 mt-1">
                              P.{next.originalPageNumbers.join(',')}
                            </div>
                          </button>
                        ) : (
                          <div className="flex-1 p-4 rounded-xl border border-stone-100 bg-stone-50/50 text-right">
                            <div className="text-xs text-stone-300">这是最后一个知识点</div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-stone-400 gap-4">
              <svg className="w-16 h-16 text-stone-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <div className="text-center">
                <p className="text-lg text-stone-500">
                  {packages.length === 0 ? '暂无笔记' : '选择一个知识点开始学习'}
                </p>
                <p className="text-sm text-stone-400 mt-1">
                  {packages.length === 0
                    ? '请先上传课件并生成知识结构'
                    : '从左侧目录选择知识点'
                  }
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export function NotesView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const usesMarkdownPipeline = useStore(state => state.sourceDocuments.length > 0 || state.knowledgeTopics.length > 0);
  return usesMarkdownPipeline
    ? <MasterNoteView onOpenSettings={onOpenSettings} />
    : <LegacyNotesView onOpenSettings={onOpenSettings} />;
}
