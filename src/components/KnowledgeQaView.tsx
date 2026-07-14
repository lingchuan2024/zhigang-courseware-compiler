import { useEffect, useMemo, useState } from 'react';
import type { RagAnswer } from '../lib/card-rag';
import { answerWithKnowledgeCards } from '../lib/card-rag';
import { searchKnowledgeCards, type KnowledgeCardSearchHit } from '../lib/card-retrieval';
import { listLibraryCourses, listLibraryDocuments, listRetrievalRecords } from '../lib/library-repository';
import type { LibraryCourse, LibraryDocument, ModelConfig, RetrievalRecord } from '../types';
import { useStore } from '../store/useStore';
import { useLibraryStore } from '../store/useLibraryStore';

export type KnowledgeQaAnswerer = (
  config: ModelConfig,
  question: string,
  hits: KnowledgeCardSearchHit[],
) => Promise<RagAnswer>;

interface KnowledgeQaViewProps {
  onOpenSettings: () => void;
  answerer?: KnowledgeQaAnswerer;
}

export function KnowledgeQaView({ onOpenSettings, answerer = answerWithKnowledgeCards }: KnowledgeQaViewProps) {
  const modelConfig = useStore(state => state.modelConfig);
  const openDocument = useLibraryStore(state => state.openDocument);
  const [courses, setCourses] = useState<LibraryCourse[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [records, setRecords] = useState<RetrievalRecord[]>([]);
  const [courseId, setCourseId] = useState('all');
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<RetrievalRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listLibraryCourses(), listLibraryDocuments(), listRetrievalRecords()])
      .then(([nextCourses, nextDocuments, nextRecords]) => {
        if (!active) return;
        setCourses(nextCourses);
        setDocuments(nextDocuments);
        setRecords(nextRecords);
      })
      .catch(loadError => active && setError(loadError instanceof Error ? loadError.message : String(loadError)));
    return () => { active = false; };
  }, []);

  const recordByCardId = useMemo(() => new Map(records.map(record => [record.cardId, record])), [records]);
  const courseById = useMemo(() => new Map(courses.map(course => [course.id, course])), [courses]);
  const documentById = useMemo(() => new Map(documents.map(document => [document.id, document])), [documents]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    if (!modelConfig?.apiKey) {
      onOpenSettings();
      return;
    }
    setLoading(true);
    setError(null);
    setSubmittedQuestion(trimmed);
    try {
      const hits = searchKnowledgeCards(trimmed, records, {
        courseIds: courseId === 'all' ? undefined : [courseId],
        limit: 8,
      });
      const nextAnswer = await answerer(modelConfig, trimmed, hits);
      setAnswer(nextAnswer);
      const firstCardId = nextAnswer.sections.flatMap(section => section.cardIds)[0];
      setSelectedRecord(firstCardId ? recordByCardId.get(firstCardId) ?? null : null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-4rem)] bg-[#f3eee4] lg:grid-cols-[240px_1fr_340px]">
      <aside className="border-r border-[#ddd3c5] bg-[#eee7db] p-6">
        <p className="font-mono text-[10px] tracking-[0.22em] text-cinnabar">SEARCH SCOPE</p>
        <h2 className="mt-2 font-song text-xl font-bold text-ink">问答范围</h2>
        <label className="mt-6 block text-xs text-stone-500" htmlFor="qa-course">课程空间</label>
        <select
          id="qa-course"
          value={courseId}
          onChange={event => setCourseId(event.target.value)}
          className="mt-2 w-full rounded-xl border border-[#d5cab9] bg-[#faf7f0] px-3 py-2.5 text-sm text-ink outline-none focus:border-celadon"
        >
          <option value="all">全部课程</option>
          {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
        <div className="mt-8 border-t border-[#d5cab9] pt-5 text-xs leading-6 text-stone-500">
          <p>{records.length} 条知识卡片索引</p>
          <p>{documents.length} 份可追溯课件</p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        <div className="border-b border-[#ddd3c5] bg-[#faf7f0]/70 px-7 py-6">
          <p className="font-mono text-[10px] tracking-[0.22em] text-cinnabar">KNOWLEDGE CARD RAG</p>
          <h1 className="mt-2 font-song text-3xl font-bold text-ink">全库知识问答</h1>
          <p className="mt-2 text-sm text-stone-500">优先检索所有课件中的知识卡片；未命中时由模型直接回答并明确标记。</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
          {!answer && !submittedQuestion ? (
            <div className="mx-auto mt-16 max-w-xl text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-celadon/20 bg-celadon/10 font-song text-2xl text-ink">问</div>
              <h2 className="mt-6 font-song text-2xl font-bold text-ink">从全部课程知识卡片开始提问</h2>
              <p className="mt-3 text-sm leading-7 text-stone-500">答案中的卡片索引可以打开右侧详情，并继续进入对应课件。</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {submittedQuestion && <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-ink px-5 py-4 text-sm leading-7 text-white">{submittedQuestion}</div>}
              {loading && <div className="rounded-2xl border border-[#ded5c7] bg-[#faf8f3] p-5 text-sm text-stone-500">正在检索知识卡片并组织回答…</div>}
              {answer?.sections.map((section, index) => (
                <section key={`${section.source}-${index}`} className="rounded-2xl border border-[#ded5c7] bg-[#faf8f3] p-6 shadow-sm">
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${section.source === 'cards' ? 'bg-celadon/10 text-ink' : 'bg-amber-100 text-amber-800'}`}>
                    {section.source === 'cards' ? '基于知识卡片' : 'AI 通用回答'}
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-8 text-stone-700">{section.content}</p>
                  {section.cardIds.length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-[#e4dccf] pt-4">
                      {section.cardIds.map(cardId => {
                        const record = recordByCardId.get(cardId);
                        if (!record) return null;
                        return (
                          <button
                            type="button"
                            key={cardId}
                            data-card-id={cardId}
                            onClick={() => setSelectedRecord(record)}
                            className="rounded-lg border border-celadon/30 bg-celadon/5 px-3 py-2 text-xs text-ink hover:bg-celadon/10"
                          >
                            {courseById.get(record.courseId)?.name ?? '课程'} / {record.title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
          {error && <div className="mx-auto mt-5 max-w-3xl rounded-xl border border-cinnabar/20 bg-cinnabar/5 p-4 text-sm text-cinnabar">{error}</div>}
        </div>

        <form onSubmit={submit} className="border-t border-[#ddd3c5] bg-[#faf7f0] p-5">
          <div className="mx-auto flex max-w-3xl gap-3">
            <input
              value={question}
              onChange={event => setQuestion(event.target.value)}
              placeholder="询问全部课件中的知识…"
              className="min-w-0 flex-1 rounded-xl border border-[#d5cab9] bg-white px-4 py-3 text-sm outline-none focus:border-celadon focus:ring-2 focus:ring-celadon/10"
            />
            <button type="submit" disabled={loading || !question.trim()} className="rounded-xl bg-ink px-6 py-3 text-sm text-white hover:bg-ink-light disabled:opacity-40">发送</button>
          </div>
        </form>
      </main>

      <aside className="border-l border-[#ddd3c5] bg-[#faf8f3] p-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cinnabar">CARD INDEX</p>
        <h2 className="mt-2 font-song text-xl font-bold text-ink">知识卡片索引</h2>
        {selectedRecord ? (
          <div className="mt-6 rounded-2xl border border-[#ded5c7] bg-white p-5">
            <p className="text-xs text-stone-400">{courseById.get(selectedRecord.courseId)?.name ?? '课程'} · {documentById.get(selectedRecord.documentId)?.title ?? '课件'}</p>
            <h3 className="mt-3 font-song text-xl font-bold text-ink">{selectedRecord.title}</h3>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-600">{selectedRecord.content}</p>
            <button type="button" onClick={() => void openDocument(selectedRecord.documentId)} className="mt-5 w-full rounded-xl border border-ink/20 px-4 py-2.5 text-sm text-ink hover:bg-ink hover:text-white">打开对应课件</button>
          </div>
        ) : (
          <p className="mt-6 text-sm leading-7 text-stone-500">点击答案下方的卡片索引，在这里查看知识卡片内容和对应课件。</p>
        )}
      </aside>
    </div>
  );
}
