import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { resolveSourceRanges } from '../lib/source-range-resolver';
import { MarkdownRenderer } from './MarkdownRenderer';

const CARD_STATUS_LABELS: Record<string, string> = {
  pending: '待生成',
  generating: '生成中',
  partial: '需补充',
  completed: '已生成',
  stale: '需要更新',
  failed: '生成失败',
};

function MarkdownKnowledgeCardsView() {
  const documents = useStore(state => state.sourceDocuments);
  const topics = useStore(state => state.knowledgeTopics);
  const cards = useStore(state => state.knowledgeCards);
  const chapterNotes = useStore(state => state.chapterNotes);
  const topicSyntheses = useStore(state => state.topicSyntheses);
  const courseMasterNote = useStore(state => state.courseMasterNote);
  const learningPath = useStore(state => state.courseLearningPath);
  const job = useStore(state => state.job);
  const regenerateKnowledgeCards = useStore(state => state.regenerateKnowledgeCards);
  const navigateToStage = useStore(state => state.navigateToStage);
  const [activeCardId, setActiveCardId] = useState<string | null>(cards[0]?.id ?? null);

  const orderedTopics = useMemo(() => {
    const byId = new Map(topics.map(topic => [topic.id, topic]));
    const seen = new Set<string>();
    return [...(learningPath?.orderedTopicIds ?? []), ...topics.map(topic => topic.id)]
      .filter(id => {
        if (!byId.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(id => byId.get(id)!);
  }, [learningPath?.orderedTopicIds, topics]);
  const activeCard = cards.find(card => card.id === activeCardId) ?? cards[0] ?? null;
  const sources = useMemo(
    () => activeCard ? resolveSourceRanges(activeCard.sourceRanges, documents) : [],
    [activeCard, documents],
  );
  const cardMarkdown = activeCard ? [
    activeCard.conciseSummary ? `> ${activeCard.conciseSummary}` : '',
    activeCard.detailedNote,
    activeCard.keyPoints?.length
      ? `## 关键要点\n\n${activeCard.keyPoints.map(item => `- ${item}`).join('\n')}`
      : '',
    activeCard.applicableConditions?.length
      ? `## 成立条件与适用边界\n\n${activeCard.applicableConditions.map(item => `- ${item}`).join('\n')}`
      : '',
    activeCard.examples?.length
      ? `## 示例\n\n${activeCard.examples.map(item => `- ${item}`).join('\n')}`
      : '',
    activeCard.formulas?.length
      ? `## 公式\n\n${activeCard.formulas.map(formula => `$$\n${formula.formula}\n$$\n\n${formula.description}`).join('\n\n')}`
      : '',
    activeCard.misconceptions?.length
      ? `## 易错点\n\n${activeCard.misconceptions.map(item => `- ${item}`).join('\n')}`
      : '',
    activeCard.selfCheckQuestions?.length
      ? `## 理解检查\n\n${activeCard.selfCheckQuestions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n') : '';
  const hasCompleteNoteData = Boolean(
    courseMasterNote?.markdown.trim() || chapterNotes.length > 0 || topicSyntheses.length > 0,
  );

  if (cards.length === 0) {
    return (
      <div className="grid h-screen flex-1 place-items-center bg-[#f5f1e8] px-8 text-center">
        <div className="max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <h1 className="font-song text-2xl font-bold text-[#173f35]">暂无知识卡片</h1>
          <p className="mt-3 text-sm leading-6 text-stone-500">请先完成知识结构提取，系统会为每个二级知识节点生成可追溯的知识卡片。</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigateToStage('structure')} className="rounded-lg border border-[#173f35] px-4 py-2 text-sm text-[#173f35]">返回知识结构</button>
            {hasCompleteNoteData && (
              <button type="button" onClick={() => navigateToStage('notes')} className="rounded-lg bg-[#173f35] px-4 py-2 text-sm text-white">查看已有完整笔记</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[#f5f1e8]">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-stone-200 bg-[#fffdfa] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('structure')} className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-100" aria-label="返回知识结构">←</button>
          <div>
            <h1 className="font-song text-xl font-bold text-[#173f35]">知识卡片</h1>
            <p className="mt-0.5 text-xs text-stone-500">{cards.length} 张 AI 深化卡片 · 按二级知识网顺序组织 · 每张卡片关联课件原文</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void regenerateKnowledgeCards()}
            disabled={job === 'enriching-knowledge-cards'}
            className="rounded-lg border border-[#173f35]/25 bg-white px-4 py-2 text-sm font-medium text-[#173f35] hover:bg-[#edf4ef] disabled:cursor-wait disabled:opacity-50"
          >
            {job === 'enriching-knowledge-cards' ? '正在深化…' : '重新深化卡片'}
          </button>
          <button type="button" onClick={() => navigateToStage('notes')} disabled={job === 'enriching-knowledge-cards'} className="rounded-lg bg-[#c84b31] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#ae3f2a] disabled:opacity-50">
            生成完整笔记 →
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-stone-200 bg-[#fffdfa] p-3">
          <p className="px-3 pb-3 pt-1 text-[11px] font-semibold tracking-[0.16em] text-stone-400">按一级知识组织</p>
          <div className="space-y-4">
            {orderedTopics.map((topic, topicIndex) => {
              const topicCards = cards.filter(card => card.topicId === topic.id);
              if (topicCards.length === 0) return null;
              return (
                <section key={topic.id}>
                  <div className="mb-1 flex items-center gap-2 px-3 py-1.5">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[#173f35] text-[10px] font-bold text-white">{topicIndex + 1}</span>
                    <h2 className="line-clamp-2 text-xs font-bold text-[#285c50]">{topic.name}</h2>
                  </div>
                  <div className="space-y-1">
                    {topicCards.map((card, cardIndex) => {
                      const active = card.id === activeCard?.id;
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setActiveCardId(card.id)}
                          className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-[#173f35] text-white shadow-sm' : 'text-stone-700 hover:bg-[#edf4ef]'}`}
                        >
                          <div className="flex gap-2.5">
                            <span className={`mt-0.5 text-[10px] font-bold ${active ? 'text-[#f4d8a8]' : 'text-[#4d7c6d]'}`}>{topicIndex + 1}.{cardIndex + 1}</span>
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-medium leading-5">{card.title}</p>
                              <p className={`mt-1 text-[10px] ${active ? 'text-white/55' : 'text-stone-400'}`}>{card.teachingType}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
          {activeCard && (
            <article className="mx-auto max-w-3xl">
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-stone-200 pb-5">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-[#dfece5] px-2.5 py-1 text-[#35695b]">{activeCard.teachingType}</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-stone-500 ring-1 ring-stone-200">{CARD_STATUS_LABELS[activeCard.status ?? 'completed']}</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-stone-500 ring-1 ring-stone-200">置信度 {Math.round(activeCard.confidence * 100)}%</span>
                  </div>
                  <h2 className="font-song text-3xl font-bold leading-tight text-[#173f35]">{activeCard.title}</h2>
                  <p className="mt-2 text-sm text-stone-500">所属一级知识：{activeCard.topicName}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-[#fffdfa] px-8 py-7 shadow-[0_8px_30px_rgba(23,63,53,.05)]">
                <MarkdownRenderer content={cardMarkdown} className="text-[15px] leading-8" />
              </div>
              {activeCard.keywords.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {activeCard.keywords.map(keyword => <span key={keyword} className="rounded-full bg-white px-3 py-1 text-xs text-stone-500 ring-1 ring-stone-200">#{keyword}</span>)}
                </div>
              )}
            </article>
          )}
        </main>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-stone-200 bg-[#fffdfa] p-4">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-[#173f35]">对应课件原文</h2>
            <p className="mt-1 text-xs text-stone-400">仅显示这张卡片直接引用的 MinerU 内容</p>
          </div>
          <div className="space-y-3">
            {sources.length > 0 ? sources.map((source, index) => (
              <section key={`${source.range.startBlockId}-${index}`} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="mb-3 truncate text-[10px] font-medium text-stone-400">{source.documentTitle}{source.headingPath.length ? ` · ${source.headingPath.join(' / ')}` : ''}</p>
                {source.missingReason
                  ? <p className="text-xs text-red-600">{source.missingReason}</p>
                  : <MarkdownRenderer content={source.markdown} className="text-sm leading-7" />}
              </section>
            )) : <p className="rounded-xl border border-dashed border-stone-300 p-4 text-xs leading-6 text-stone-400">该知识卡片没有可定位的原文范围。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function LegacyKnowledgeCardsView() {
  const packages = useStore(state => state.knowledgePackages);
  const evidences = useStore(state => state.evidences);
  const navigateToStage = useStore(state => state.navigateToStage);
  const [activePackageId, setActivePackageId] = useState<string | null>(packages[0]?.id ?? null);
  const activePackage = packages.find(item => item.id === activePackageId) ?? packages[0] ?? null;
  const evidenceMap = useMemo(() => new Map(evidences.map(item => [item.id, item])), [evidences]);
  const activeEvidence = activePackage
    ? activePackage.source.evidenceIds.map(id => evidenceMap.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const content = activePackage?.note?.contentMarkdown.trim()
    || activePackage?.source.combinedOriginalText
    || '该知识卡片暂无正文。';

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[#f5f1e8]">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-stone-200 bg-[#fffdfa] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('structure')} className="grid h-9 w-9 place-items-center rounded-lg text-stone-500 hover:bg-stone-100" aria-label="返回知识结构">←</button>
          <div>
            <h1 className="font-song text-xl font-bold text-[#173f35]">知识卡片</h1>
            <p className="mt-0.5 text-xs text-stone-500">兼容现有课程 · 每个核心知识对应一张可追溯卡片</p>
          </div>
        </div>
        <button type="button" onClick={() => navigateToStage('notes')} className="rounded-lg bg-[#c84b31] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#ae3f2a]">查看完整笔记 →</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-stone-200 bg-[#fffdfa] p-3">
          <p className="px-3 pb-3 pt-1 text-[11px] font-semibold tracking-[0.16em] text-stone-400">核心知识卡片</p>
          <nav className="space-y-1">
            {packages.map((item, index) => {
              const active = item.id === activePackage?.id;
              return (
                <button key={item.id} type="button" onClick={() => setActivePackageId(item.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${active ? 'bg-[#173f35] text-white shadow-sm' : 'text-stone-700 hover:bg-[#edf4ef]'}`}>
                  <div className="flex gap-3">
                    <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold ${active ? 'bg-[#f4d8a8] text-[#173f35]' : 'bg-[#dfece5] text-[#35695b]'}`}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-medium leading-5">{item.topic.title}</p>
                      <p className={`mt-1 text-[11px] ${active ? 'text-white/60' : 'text-stone-400'}`}>{item.topic.type} · {item.source.evidenceIds.length} 处原文</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
          {activePackage && (
            <article className="mx-auto max-w-3xl">
              <div className="mb-6 border-b border-stone-200 pb-5">
                <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full bg-[#dfece5] px-2.5 py-1 text-[#35695b]">{activePackage.topic.type}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-stone-500 ring-1 ring-stone-200">{activePackage.note ? '已有笔记' : '原文卡片'}</span>
                </div>
                <h2 className="font-song text-3xl font-bold leading-tight text-[#173f35]">{activePackage.topic.title}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">{activePackage.topic.learningGoal}</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-[#fffdfa] px-8 py-7 shadow-[0_8px_30px_rgba(23,63,53,.05)]">
                <MarkdownRenderer content={content} className="text-[15px] leading-8" />
              </div>
            </article>
          )}
        </main>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-stone-200 bg-[#fffdfa] p-4">
          <h2 className="text-sm font-bold text-[#173f35]">对应课件原文</h2>
          <p className="mt-1 text-xs text-stone-400">兼容课程中的 EvidenceAtom 原始证据</p>
          <div className="mt-4 space-y-3">
            {activeEvidence.length > 0 ? activeEvidence.map(item => (
              <section key={item.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="mb-2 text-[10px] font-medium text-stone-400">第 {item.pageNumber} 页 · {item.type}</p>
                <MarkdownRenderer content={item.content} className="text-sm leading-7" />
              </section>
            )) : <p className="rounded-xl border border-dashed border-stone-300 p-4 text-xs leading-6 text-stone-400">该卡片没有可定位的原文。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function KnowledgeCardsView() {
  const cardCount = useStore(state => state.knowledgeCards.length);
  const legacyPackageCount = useStore(state => state.knowledgePackages.length);
  return cardCount === 0 && legacyPackageCount > 0
    ? <LegacyKnowledgeCardsView />
    : <MarkdownKnowledgeCardsView />;
}
