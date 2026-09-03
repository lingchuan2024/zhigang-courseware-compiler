import { useMemo, useState } from 'react';
import type { KnowledgeCard } from '../types';
import { useStore } from '../store/useStore';
import { resolveSourceRanges } from '../lib/source-range-resolver';
import { prepareGeneratedMarkdown } from '../lib/generated-markdown';
import { MarkdownRenderer } from './MarkdownRenderer';

const CARD_STATUS_LABELS: Record<string, string> = {
  pending: '待生成',
  generating: '生成中',
  partial: '需补充',
  completed: '已生成',
  stale: '需要更新',
  failed: '生成失败',
};

function normalizeHeadingLabel(value: string): string {
  return value
    .replace(/\s+#+\s*$/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function hasHeading(markdown: string, title: string): boolean {
  const expected = normalizeHeadingLabel(title);
  return markdown.split('\n').some(line => {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    return Boolean(match && normalizeHeadingLabel(match[1]) === expected);
  });
}

function structuredSection(markdown: string, title: string, body: string): string {
  if (!body || hasHeading(markdown, title)) return '';
  return `## ${title}\n\n${body}`;
}

function buildCardMarkdown(card: KnowledgeCard): string {
  const detailedNote = prepareGeneratedMarkdown(card.detailedNote);
  const parts = [
    card.conciseSummary ? `> ${card.conciseSummary}` : '',
    detailedNote,
    structuredSection(
      detailedNote,
      '关键要点',
      card.keyPoints?.map(item => `- ${item}`).join('\n') ?? '',
    ),
    structuredSection(
      detailedNote,
      '成立条件与适用边界',
      card.applicableConditions?.map(item => `- ${item}`).join('\n') ?? '',
    ),
    structuredSection(
      detailedNote,
      '示例',
      card.examples?.map(item => `- ${item}`).join('\n') ?? '',
    ),
    structuredSection(
      detailedNote,
      '公式',
      card.formulas?.map(formula => `$$\n${formula.formula}\n$$\n\n${formula.description}`).join('\n\n') ?? '',
    ),
    structuredSection(
      detailedNote,
      '易错点',
      card.misconceptions?.map(item => `- ${item}`).join('\n') ?? '',
    ),
    structuredSection(
      detailedNote,
      '理解检查',
      card.selfCheckQuestions?.map((item, index) => `${index + 1}. ${item}`).join('\n') ?? '',
    ),
  ];
  return prepareGeneratedMarkdown(parts.filter(Boolean).join('\n\n'));
}

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
  const startMasterNoteGeneration = useStore(state => state.startMasterNoteGeneration);
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
  const cardMarkdown = useMemo(
    () => activeCard ? buildCardMarkdown(activeCard) : '',
    [activeCard],
  );
  const hasCompleteNoteData = Boolean(
    courseMasterNote?.markdown.trim() || chapterNotes.length > 0 || topicSyntheses.length > 0,
  );
  const completedCardCount = cards.filter(card => card.status === 'completed').length;
  const allCardsCompleted = cards.length > 0 && completedCardCount === cards.length;

  if (cards.length === 0) {
    return (
      <div className="grid h-screen flex-1 place-items-center bg-space-950/[0.58] px-8 text-center">
        <div className="max-w-md rounded-2xl border border-space-border bg-space-850/90 p-8 shadow-nebula-panel backdrop-blur-xl">
          <h1 className="font-song text-2xl font-bold text-space-text">暂无知识卡片</h1>
          <p className="mt-3 text-sm leading-6 text-space-muted">请先完成知识结构提取，系统会为每个二级知识节点生成可追溯的知识卡片。</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigateToStage('structure')} className="btn-outline">返回知识结构</button>
            {hasCompleteNoteData && (
              <button type="button" onClick={() => navigateToStage('notes')} className="btn-primary">查看已有完整笔记</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950/[0.54] text-space-text">
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/95 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigateToStage('structure')} className="grid h-9 w-9 place-items-center rounded-lg text-space-muted hover:bg-space-750 hover:text-space-text" aria-label="返回知识结构">←</button>
          <div>
            <h1 className="font-song text-xl font-bold text-space-text">知识卡片</h1>
            <p className="mt-0.5 text-xs text-space-muted">
              {allCardsCompleted
                ? `${cards.length} 张 AI 深化卡片`
                : `${cards.length} 张基础卡片 · ${cards.length - completedCardCount} 张待深化`}
              {' · 按二级知识网顺序组织 · 每张卡片关联课件原文'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void regenerateKnowledgeCards()}
            disabled={job === 'enriching-knowledge-cards'}
            className="btn-outline disabled:cursor-wait disabled:opacity-50"
          >
            {job === 'enriching-knowledge-cards' ? '正在深化…' : allCardsCompleted ? '重新深化卡片' : '深化知识卡片'}
          </button>
          <button type="button" onClick={() => void startMasterNoteGeneration()} disabled={job === 'enriching-knowledge-cards'} className="btn-primary disabled:opacity-50">
            生成完整笔记 →
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.94] p-3 backdrop-blur-xl">
          <p className="px-3 pb-3 pt-1 text-[11px] font-semibold tracking-[0.16em] text-space-faint">按一级知识组织</p>
          <div className="space-y-4">
            {orderedTopics.map((topic, topicIndex) => {
              const topicCards = cards.filter(card => card.topicId === topic.id);
              if (topicCards.length === 0) return null;
              return (
                <section key={topic.id}>
                  <div className="mb-1 flex items-center gap-2 px-3 py-1.5">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-celadon/15 text-[10px] font-bold text-celadon ring-1 ring-celadon/25">{topicIndex + 1}</span>
                    <h2 className="line-clamp-2 text-xs font-bold text-space-text">{topic.name}</h2>
                  </div>
                  <div className="space-y-1">
                    {topicCards.map((card, cardIndex) => {
                      const active = card.id === activeCard?.id;
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setActiveCardId(card.id)}
                          className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-celadon/12 text-space-text ring-1 ring-celadon/25' : 'text-space-muted hover:bg-space-750 hover:text-space-text'}`}
                        >
                          <div className="flex gap-2.5">
                            <span className={`mt-0.5 text-[10px] font-bold ${active ? 'text-celadon' : 'text-space-faint'}`}>{topicIndex + 1}.{cardIndex + 1}</span>
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-medium leading-5">{card.title}</p>
                              <p className={`mt-1 text-[10px] ${active ? 'text-space-muted' : 'text-space-faint'}`}>{card.teachingType}</p>
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
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-space-border pb-5">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-celadon/10 px-2.5 py-1 text-celadon ring-1 ring-celadon/20">{activeCard.teachingType}</span>
                    <span className="rounded-full bg-space-750 px-2.5 py-1 text-space-muted ring-1 ring-space-border">{CARD_STATUS_LABELS[activeCard.status ?? 'partial']}</span>
                    <span className="rounded-full bg-space-750 px-2.5 py-1 text-space-muted ring-1 ring-space-border">置信度 {Math.round(activeCard.confidence * 100)}%</span>
                  </div>
                  <h2 className="font-song text-3xl font-bold leading-tight text-space-text">{activeCard.title}</h2>
                  <p className="mt-2 text-sm text-space-muted">所属一级知识：{activeCard.topicName}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-space-border bg-space-850 px-8 py-7 shadow-nebula-panel">
                <MarkdownRenderer content={cardMarkdown} className="text-[15px] leading-8" />
              </div>
              {activeCard.keywords.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {activeCard.keywords.map(keyword => <span key={keyword} className="rounded-full bg-space-750 px-3 py-1 text-xs text-space-muted ring-1 ring-space-border">#{keyword}</span>)}
                </div>
              )}
            </article>
          )}
        </main>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-space-border bg-space-900/[0.94] p-4 backdrop-blur-xl">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-space-text">对应课件原文</h2>
            <p className="mt-1 text-xs text-space-faint">仅显示这张卡片直接引用的 MinerU 内容</p>
          </div>
          <div className="space-y-3">
            {sources.length > 0 ? sources.map((source, index) => (
              <section key={`${source.range.startBlockId}-${index}`} className="rounded-xl border border-space-border bg-space-850 p-4">
                <p className="mb-3 truncate text-[10px] font-medium text-space-faint">{source.documentTitle}{source.headingPath.length ? ` · ${source.headingPath.join(' / ')}` : ''}</p>
                {source.missingReason
                  ? <p className="text-xs text-red-600">{source.missingReason}</p>
                  : <MarkdownRenderer content={source.markdown} className="text-sm leading-7" />}
              </section>
            )) : <p className="rounded-xl border border-dashed border-space-border p-4 text-xs leading-6 text-space-faint">该知识卡片没有可定位的原文范围。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function KnowledgeCardsView() {
  return <MarkdownKnowledgeCardsView />;
}
