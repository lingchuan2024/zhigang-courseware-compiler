import { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkCitation } from '../lib/markdown-citation-plugin';
import { createMarkdownComponents, isSafeUrl } from './markdown-components';
import 'katex/dist/katex.min.css';
import './markdown.css';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CitationClickHandler = (marker: string) => void;

interface MarkdownRendererProps {
  content: string;
  onCitationClick?: CitationClickHandler;
  validMarkers?: Set<string>;
  className?: string;
}

interface CitationEntry {
  marker: string;
  evidenceIds: string[];
}

interface EvidenceEntry {
  id: string;
  pageNumber: number;
  content: string;
}

interface MarkdownWithCitationsProps extends MarkdownRendererProps {
  citations?: CitationEntry[];
  evidences?: EvidenceEntry[];
}

/* ------------------------------------------------------------------ */
/* MarkdownRenderer                                                    */
/* ------------------------------------------------------------------ */

/**
 * Render markdown using the standard react-markdown + remark-gfm +
 * remark-math + rehype-katex pipeline, plus a custom `remarkCitation`
 * plugin that turns `[cite-N]` markers into clickable buttons.
 *
 * Security:
 *  - `skipHtml` is on: no raw HTML from model output is rendered.
 *  - `urlTransform` + the custom `a` component only allow http/https/mailto
 *    (and safe relative URLs); javascript:/data:/etc. are dropped.
 */
export function MarkdownRenderer({
  content,
  onCitationClick,
  validMarkers,
  className = '',
}: MarkdownRendererProps) {
  const components = useMemo(
    () => createMarkdownComponents(onCitationClick, validMarkers),
    [onCitationClick, validMarkers]
  );

  const urlTransform = useCallback((url: string) => {
    return isSafeUrl(url) ? url : '';
  }, []);

  return (
    <div className={`prose-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCitation]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        urlTransform={urlTransform}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MarkdownWithCitations (HOC)                                         */
/* ------------------------------------------------------------------ */

export function MarkdownWithCitations({
  content,
  citations = [],
  evidences = [],
  className = '',
}: MarkdownWithCitationsProps) {
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  const evidenceMap = useMemo(() => {
    const map = new Map<string, EvidenceEntry>();
    evidences.forEach((e) => map.set(e.id, e));
    return map;
  }, [evidences]);

  const handleCitationClick = useCallback((marker: string) => {
    setActiveCitation(marker);
    const el = document.getElementById(`citation-${marker}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-amber-400/10');
      setTimeout(() => el.classList.remove('bg-amber-400/10'), 2000);
    }
  }, []);

  const validMarkers = useMemo(
    () => new Set(citations.map(c => c.marker)),
    [citations]
  );

  return (
    <div className={className}>
      <MarkdownRenderer
        content={content}
        onCitationClick={handleCitationClick}
        validMarkers={validMarkers}
      />

      {citations.length > 0 && (
        <div className="mt-10 border-t border-space-border pt-6">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-space-faint">
            引用来源
          </h3>
          <div className="space-y-3">
            {citations.map((c) => {
              const pages = c.evidenceIds
                .map((id) => evidenceMap.get(id)?.pageNumber)
                .filter((p): p is number => p !== undefined);
              const uniquePages = Array.from(new Set(pages)).sort((a, b) => a - b);
              const pageRange =
                uniquePages.length > 0
                  ? uniquePages.length === 1
                    ? `P.${uniquePages[0]}`
                    : `P.${uniquePages[0]}-${uniquePages[uniquePages.length - 1]}`
                  : '';

              const firstEvidence =
                c.evidenceIds.length > 0 ? evidenceMap.get(c.evidenceIds[0]) : null;
              const preview =
                firstEvidence
                  ? firstEvidence.content.slice(0, 150) +
                    (firstEvidence.content.length > 150 ? '...' : '')
                  : '';

              return (
                <div
                  key={c.marker}
                  id={`citation-${c.marker}`}
                  className={`p-3 rounded-lg border transition-colors duration-300 ${
                    activeCitation === c.marker
                      ? 'border-cinnabar bg-cinnabar/5'
                      : 'border-space-border bg-space-850 hover:bg-space-750'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveCitation(c.marker)}
                      className="font-mono text-cinnabar text-sm font-medium flex-shrink-0 hover:underline"
                    >
                      [{c.marker}]
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {pageRange && (
                          <span className="rounded bg-space-750 px-2 py-0.5 text-xs text-space-muted">
                            {pageRange}
                          </span>
                        )}
                        <span className="text-xs text-space-faint">
                          {c.evidenceIds.length} 条证据
                        </span>
                      </div>
                      {preview && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-space-muted">
                          {preview}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
