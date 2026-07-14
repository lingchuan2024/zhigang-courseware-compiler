import { useState } from 'react';
import { EvidenceAtom, KnowledgePackage } from '../../types';
import { EVIDENCE_TYPE_LABELS } from './evidence-types';

interface EvidenceCardProps {
  evidence: EvidenceAtom;
  isSelected: boolean;
  isEdited: boolean;
  affectedPackages: KnowledgePackage[];
  onSelect: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
  onSplit: (splitContent: string) => void;
  onMergeWithNext: () => void;
  canMergeWithNext: boolean;
}

export function EvidenceCard({
  evidence,
  isSelected,
  isEdited,
  affectedPackages,
  onSelect,
  onEdit,
  onDelete,
  onSplit,
  onMergeWithNext,
  canMergeWithNext,
}: EvidenceCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(evidence.content);
  const [showActions, setShowActions] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [splitContent, setSplitContent] = useState('');

  const typeInfo = EVIDENCE_TYPE_LABELS[evidence.type];
  const isLowConfidence = evidence.confidence < 0.5;

  const handleSaveEdit = () => {
    onEdit(editContent);
    setIsEditing(false);
  };

  const handleSaveSplit = () => {
    if (splitContent.trim()) {
      onSplit(splitContent);
    }
    setSplitMode(false);
    setSplitContent('');
  };

  if (isEditing) {
    return (
      <div
        className={`rounded-lg border p-3 transition-colors ${
          isSelected ? 'border-celadon ring-1 ring-celadon/30' : 'border-space-border bg-space-850'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeInfo.bgColor} ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { setIsEditing(false); setEditContent(evidence.content); }}
              className="rounded px-2 py-1 text-xs text-space-muted hover:bg-space-750 hover:text-space-text"
            >
              取消
            </button>
            <button
              onClick={handleSaveEdit}
              className="text-xs text-celadon font-medium hover:text-celadon-light px-2 py-1 rounded hover:bg-celadon/10"
            >
              保存
            </button>
          </div>
        </div>
        <textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          className="h-24 w-full resize-none rounded border border-space-border bg-space-900 p-2 font-mono text-sm text-space-text focus:border-celadon focus:outline-none"
          autoFocus
        />
      </div>
    );
  }

  if (splitMode) {
    return (
      <div className="rounded-lg border border-amber-400/35 bg-amber-400/10 p-3">
        <p className="text-xs text-amber-700 mb-2">
          选择要拆分出的内容（将作为新证据）：
        </p>
        <div className="mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-space-border bg-space-900 p-2 text-sm text-ink-light">
          {evidence.content}
        </div>
        <textarea
          value={splitContent}
          onChange={e => setSplitContent(e.target.value)}
          placeholder="输入要拆分出的内容..."
          className="h-16 w-full resize-none rounded border border-amber-400/40 bg-space-900 p-2 font-mono text-sm text-space-text focus:border-amber-400 focus:outline-none"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => { setSplitMode(false); setSplitContent(''); }}
            className="rounded px-2 py-1 text-xs text-space-muted hover:bg-space-750 hover:text-space-text"
          >
            取消
          </button>
          <button
            onClick={handleSaveSplit}
            className="text-xs text-amber-700 font-medium hover:text-amber-800 px-2 py-1 rounded hover:bg-amber-100"
          >
            确认拆分
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={`group rounded-lg border p-3 cursor-pointer transition-all ${
        isSelected
          ? 'border-celadon ring-1 ring-celadon/30 bg-celadon/5'
          : isEdited
          ? 'border-amber-400/40 bg-amber-400/10'
          : 'border-space-border bg-space-850 hover:border-space-border-strong hover:shadow-sm'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeInfo.bgColor} ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <span className="font-mono text-xs text-space-muted">
            P{evidence.pageNumber} · B{evidence.blockIndex}
          </span>
          {isLowConfidence && (
            <span className="text-xs text-amber-600 flex items-center gap-0.5" title={`置信度 ${Math.round(evidence.confidence * 100)}%`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {Math.round(evidence.confidence * 100)}%
            </span>
          )}
          {isEdited && (
            <span className="text-xs text-amber-600 font-medium">已修改</span>
          )}
        </div>
        <span className="max-w-24 truncate font-mono text-xs text-space-muted/65" title={evidence.id}>
          {evidence.id.slice(0, 12)}…
        </span>
      </div>

      {/* Content */}
      <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-light">
        {evidence.content}
      </p>

      {/* Actions */}
      {showActions && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-space-border pt-2">
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            className="rounded px-2 py-1 text-xs text-space-muted transition-colors hover:bg-celadon/10 hover:text-celadon"
          >
            编辑
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSplitMode(true); }}
            className="rounded px-2 py-1 text-xs text-space-muted transition-colors hover:bg-amber-400/10 hover:text-amber-300"
          >
            拆分
          </button>
          {canMergeWithNext && (
            <button
              onClick={(e) => { e.stopPropagation(); onMergeWithNext(); }}
              className="rounded px-2 py-1 text-xs text-space-muted transition-colors hover:bg-blue-400/10 hover:text-blue-300"
            >
              合并下条
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setShowImpact(!showImpact); }}
            className="rounded px-2 py-1 text-xs text-space-muted transition-colors hover:bg-space-750 hover:text-ink"
          >
            影响
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="ml-auto rounded px-2 py-1 text-xs text-space-muted transition-colors hover:bg-cinnabar/10 hover:text-cinnabar"
          >
            删除
          </button>
        </div>
      )}

      {/* Impact view */}
      {showImpact && (
        <div className="mt-2 space-y-1 border-t border-space-border pt-2 text-xs">
          {affectedPackages.length > 0 ? (
            <>
              <p className="font-medium text-space-muted">影响知识点与笔记：</p>
              {affectedPackages.map(kp => (
                <div key={kp.id} className="flex items-center gap-2 text-ink-light">
                  <span className={`w-1.5 h-1.5 rounded-full ${kp.note ? 'bg-celadon' : 'bg-stone-300'}`} />
                  <span>{kp.topic.title}</span>
                  {kp.note && <span className="text-space-muted">· 有笔记</span>}
                </div>
              ))}
            </>
          ) : (
            <p className="text-space-muted">未被任何知识点引用</p>
          )}
        </div>
      )}
    </div>
  );
}
