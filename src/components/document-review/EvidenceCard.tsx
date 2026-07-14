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
          isSelected ? 'border-celadon ring-1 ring-celadon/30' : 'border-stone-200'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeInfo.bgColor} ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { setIsEditing(false); setEditContent(evidence.content); }}
              className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-100"
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
          className="w-full h-24 p-2 text-sm border border-stone-200 rounded resize-none focus:outline-none focus:border-celadon font-mono"
          autoFocus
        />
      </div>
    );
  }

  if (splitMode) {
    return (
      <div className="rounded-lg border border-amber-300 p-3 bg-amber-50/50">
        <p className="text-xs text-amber-700 mb-2">
          选择要拆分出的内容（将作为新证据）：
        </p>
        <div className="text-sm text-stone-600 mb-2 p-2 bg-white rounded border border-stone-200 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {evidence.content}
        </div>
        <textarea
          value={splitContent}
          onChange={e => setSplitContent(e.target.value)}
          placeholder="输入要拆分出的内容..."
          className="w-full h-16 p-2 text-sm border border-amber-300 rounded resize-none focus:outline-none focus:border-amber-500 font-mono bg-white"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => { setSplitMode(false); setSplitContent(''); }}
            className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded hover:bg-stone-100"
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
          ? 'border-amber-300 bg-amber-50/30'
          : 'border-stone-200 hover:border-stone-300 hover:shadow-sm'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeInfo.bgColor} ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <span className="text-xs text-stone-400 font-mono">
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
        <span className="text-xs text-stone-300 font-mono truncate max-w-24" title={evidence.id}>
          {evidence.id.slice(0, 12)}…
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-stone-700 whitespace-pre-wrap line-clamp-4 leading-relaxed">
        {evidence.content}
      </p>

      {/* Actions */}
      {showActions && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-stone-100">
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            className="text-xs text-stone-600 hover:text-celadon px-2 py-1 rounded hover:bg-celadon/10 transition-colors"
          >
            编辑
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSplitMode(true); }}
            className="text-xs text-stone-600 hover:text-amber-600 px-2 py-1 rounded hover:bg-amber-50 transition-colors"
          >
            拆分
          </button>
          {canMergeWithNext && (
            <button
              onClick={(e) => { e.stopPropagation(); onMergeWithNext(); }}
              className="text-xs text-stone-600 hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
            >
              合并下条
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setShowImpact(!showImpact); }}
            className="text-xs text-stone-600 hover:text-ink px-2 py-1 rounded hover:bg-stone-100 transition-colors"
          >
            影响
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-xs text-stone-600 hover:text-cinnabar px-2 py-1 rounded hover:bg-cinnabar/10 transition-colors ml-auto"
          >
            删除
          </button>
        </div>
      )}

      {/* Impact view */}
      {showImpact && (
        <div className="mt-2 pt-2 border-t border-stone-100 text-xs space-y-1">
          {affectedPackages.length > 0 ? (
            <>
              <p className="text-stone-500 font-medium">影响知识点与笔记：</p>
              {affectedPackages.map(kp => (
                <div key={kp.id} className="flex items-center gap-2 text-stone-600">
                  <span className={`w-1.5 h-1.5 rounded-full ${kp.note ? 'bg-celadon' : 'bg-stone-300'}`} />
                  <span>{kp.topic.title}</span>
                  {kp.note && <span className="text-stone-400">· 有笔记</span>}
                </div>
              ))}
            </>
          ) : (
            <p className="text-stone-400">未被任何知识点引用</p>
          )}
        </div>
      )}
    </div>
  );
}
