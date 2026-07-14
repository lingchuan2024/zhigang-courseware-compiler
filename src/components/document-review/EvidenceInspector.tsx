import { useMemo, useState } from 'react';
import { EvidenceAtom, EvidenceType, KnowledgePackage, CoursePage } from '../../types';
import { EvidenceCard } from './EvidenceCard';
import { EVIDENCE_TYPE_LABELS, EVIDENCE_TYPE_LIST } from './evidence-types';

interface EvidenceInspectorProps {
  evidences: EvidenceAtom[];
  currentPage: CoursePage | undefined;
  knowledgePackages: KnowledgePackage[];
  selectedEvidenceId: string | null;
  editedEvidenceIds: Set<string>;
  searchQuery: string;
  onSelectEvidence: (id: string | null) => void;
  onEditEvidence: (id: string, content: string) => void;
  onDeleteEvidence: (id: string) => void;
  onSplitEvidence: (id: string, splitContent: string) => void;
  onMergeEvidences: (id1: string, id2: string) => void;
  onRegeneratePage: () => void;
}

export function EvidenceInspector({
  evidences,
  currentPage,
  knowledgePackages,
  selectedEvidenceId,
  editedEvidenceIds,
  searchQuery,
  onSelectEvidence,
  onEditEvidence,
  onDeleteEvidence,
  onSplitEvidence,
  onMergeEvidences,
  onRegeneratePage,
}: EvidenceInspectorProps) {
  const [typeFilter, setTypeFilter] = useState<EvidenceType | 'all'>('all');

  const pageEvidences = useMemo(() => {
    if (!currentPage) return [];
    return evidences.filter(e => e.pageNumber === currentPage.pageNumber);
  }, [evidences, currentPage]);

  const filteredEvidences = useMemo(() => {
    let result = pageEvidences;
    if (typeFilter !== 'all') {
      result = result.filter(e => e.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e => e.content.toLowerCase().includes(q));
    }
    return result;
  }, [pageEvidences, typeFilter, searchQuery]);

  // Type summary
  const typeSummary = useMemo(() => {
    const counts = new Map<EvidenceType, number>();
    let lowConfidenceCount = 0;
    for (const ev of pageEvidences) {
      counts.set(ev.type, (counts.get(ev.type) || 0) + 1);
      if (ev.confidence < 0.5) lowConfidenceCount++;
    }
    return { counts, lowConfidenceCount };
  }, [pageEvidences]);

  // Find packages that use a given evidence
  const getAffectedPackages = (evidenceId: string): KnowledgePackage[] => {
    return knowledgePackages.filter(kp => kp.source.evidenceIds.includes(evidenceId));
  };

  // Check if evidence can merge with next
  const canMergeWithNext = (index: number): boolean => {
    if (index >= filteredEvidences.length - 1) return false;
    const current = filteredEvidences[index];
    const next = filteredEvidences[index + 1];
    return current.pageNumber === next.pageNumber;
  };

  return (
    <div className="h-full flex flex-col bg-white border-l border-stone-200">
      {/* Summary bar */}
      <div className="px-3 py-2 border-b border-stone-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-stone-700 font-ui">
            证据检查器
          </h3>
          <button
            onClick={onRegeneratePage}
            className="text-xs text-celadon hover:text-celadon-light font-medium px-2 py-1 rounded hover:bg-celadon/10 transition-colors"
            title="重新生成本页证据"
          >
            重新生成
          </button>
        </div>
        {currentPage && (
          <div className="text-xs text-stone-500 space-y-0.5">
            <p>
              本页 <span className="font-medium text-stone-700">{pageEvidences.length}</span> 条证据
              {typeSummary.lowConfidenceCount > 0 && (
                <span className="text-amber-600"> · {typeSummary.lowConfidenceCount} 条低置信度</span>
              )}
            </p>
            {pageEvidences.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {EVIDENCE_TYPE_LIST
                  .filter(t => typeSummary.counts.has(t))
                  .map(t => (
                    <span
                      key={t}
                      className={`text-xs px-1.5 py-0.5 rounded ${EVIDENCE_TYPE_LABELS[t].bgColor} ${EVIDENCE_TYPE_LABELS[t].color}`}
                    >
                      {EVIDENCE_TYPE_LABELS[t].label} {typeSummary.counts.get(t)}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Type filter */}
      {pageEvidences.length > 0 && (
        <div className="px-3 py-2 border-b border-stone-100 flex items-center gap-1 overflow-x-auto flex-shrink-0">
          <button
            onClick={() => setTypeFilter('all')}
            className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
              typeFilter === 'all'
                ? 'bg-stone-700 text-white'
                : 'text-stone-500 hover:bg-stone-100'
            }`}
          >
            全部 ({pageEvidences.length})
          </button>
          {EVIDENCE_TYPE_LIST
            .filter(t => typeSummary.counts.has(t))
            .map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                  typeFilter === t
                    ? `${EVIDENCE_TYPE_LABELS[t].bgColor} ${EVIDENCE_TYPE_LABELS[t].color} ring-1 ring-current`
                    : 'text-stone-500 hover:bg-stone-100'
                }`}
              >
                {EVIDENCE_TYPE_LABELS[t].label}
              </button>
            ))}
        </div>
      )}

      {/* Evidence list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredEvidences.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-stone-400">
              {pageEvidences.length === 0
                ? '本页暂无证据'
                : '没有匹配筛选条件的证据'}
            </p>
            {pageEvidences.length === 0 && currentPage && (
              <p className="text-xs text-stone-400 mt-2">
                可编辑页面文本后重新生成
              </p>
            )}
          </div>
        ) : (
          filteredEvidences.map((ev, index) => (
            <EvidenceCard
              key={ev.id}
              evidence={ev}
              isSelected={selectedEvidenceId === ev.id}
              isEdited={editedEvidenceIds.has(ev.id)}
              affectedPackages={getAffectedPackages(ev.id)}
              onSelect={() => onSelectEvidence(selectedEvidenceId === ev.id ? null : ev.id)}
              onEdit={(content) => {
                onEditEvidence(ev.id, content);
                onSelectEvidence(null);
              }}
              onDelete={() => {
                onDeleteEvidence(ev.id);
                onSelectEvidence(null);
              }}
              onSplit={(splitContent) => {
                onSplitEvidence(ev.id, splitContent);
                onSelectEvidence(null);
              }}
              onMergeWithNext={() => {
                if (canMergeWithNext(index)) {
                  onMergeEvidences(ev.id, filteredEvidences[index + 1].id);
                  onSelectEvidence(null);
                }
              }}
              canMergeWithNext={canMergeWithNext(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
