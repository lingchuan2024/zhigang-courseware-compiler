/**
 * Custom React components for `react-markdown`.
 *
 * `createMarkdownComponents(onCitationClick, validMarkers)` returns a
 * `Components` map that:
 *  - renders `citation` hast elements (produced by `remarkCitation`) as a
 *    clickable superscript button using a **closure** handler (no module-level
 *    mutable ref),
 *  - sanitizes link `href`s (only http/https/mailto and safe relative URLs),
 *  - styles inline code, code blocks (with a language label), headings,
 *    tables, and blockquotes with Tailwind.
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { Components } from 'react-markdown';

export type CitationClickHandler = (marker: string) => void;

/** Allowed URL schemes for outgoing links. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Decide whether a URL is safe to render as an `href`.
 *  - Absolute URLs: only http/https/mailto are allowed.
 *  - Relative URLs, anchors (`#…`) and root-absolute paths (`/…`) are allowed.
 *  - Everything else (javascript:, data:, vbscript:, file:, etc.) is rejected.
 */
export function isSafeUrl(href?: string | null): boolean {
  if (href == null) return false;
  const value = String(href).trim();
  if (value === '') return false;
  // Scheme detection: `scheme:` at the start (RFC 3986 scheme = letter then
  // letters/digits/+/-/.).
  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) {
    // No scheme: relative URL, anchor, or protocol-relative `//host`. Allow.
    return true;
  }
  return SAFE_SCHEMES.has(schemeMatch[1].toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Citation                                                            */
/* ------------------------------------------------------------------ */

interface CitationProps {
  marker?: string;
  node?: { properties?: { marker?: string } };
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

interface AnchorProps {
  href?: string;
  children?: ReactNode;
  node?: unknown;
}

const AnchorComponent: ComponentType<AnchorProps> = ({ href, children }) => {
  if (!isSafeUrl(href)) {
    // Dangerous or missing URL: render the text without a clickable link.
    return <span className="text-space-muted">{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-celadon hover:underline break-words"
    >
      {children}
    </a>
  );
};

/* ------------------------------------------------------------------ */
/* Code (inline + block)                                               */
/* ------------------------------------------------------------------ */

interface CodeProps {
  className?: string;
  children?: ReactNode;
  node?: unknown;
}

const CodeComponent: ComponentType<CodeProps> = ({ className, children }) => {
  // Determine whether this <code> is a fenced code block (inside a <pre>) or
  // inline code. Fenced blocks either carry a `language-*` class or contain a
  // newline; inline code never contains a newline.
  const langMatch = /language-([\w-]+)/.exec(className || '');
  const text = nodeText(children);
  const isBlock = !!langMatch || text.includes('\n');

  if (isBlock) {
    return <code className={className}>{children}</code>;
  }

  return (
    <code className="rounded border border-space-border bg-space-750 px-1.5 py-0.5 font-mono text-[0.9em] text-space-text break-words">
      {children}
    </code>
  );
};

interface PreProps {
  children?: ReactNode;
  node?: {
    children?: Array<{ properties?: { className?: string | string[] } }>;
  };
}

const PreComponent: ComponentType<PreProps> = ({ children, node }) => {
  // Extract the language label from the nested <code> element's className.
  const codeNode = node?.children?.[0];
  const codeClassName = codeNode?.properties?.className;
  const classNameStr = Array.isArray(codeClassName)
    ? codeClassName.join(' ')
    : codeClassName || '';
  const langMatch = /language-([\w-]+)/.exec(classNameStr);
  const lang = langMatch ? langMatch[1] : '';

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-space-border">
      {lang && (
        <div className="border-b border-space-border bg-space-750 px-3 py-1 font-mono text-xs text-space-muted">
          {lang}
        </div>
      )}
      <pre className="m-0 overflow-x-auto bg-space-950 p-4 text-sm text-space-text">{children}</pre>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Headings                                                            */
/* ------------------------------------------------------------------ */

const HEADING_CLASSES: Record<string, string> = {
  h1: 'text-2xl font-bold text-space-text mt-8 mb-4 pb-2 border-b border-space-border',
  h2: 'text-xl font-bold text-space-text mt-7 mb-3',
  h3: 'text-lg font-semibold text-space-text mt-6 mb-2',
  h4: 'text-base font-semibold text-space-text mt-5 mb-2',
  h5: 'text-sm font-semibold text-space-muted mt-4 mb-1',
  h6: 'text-xs font-semibold text-space-faint mt-3 mb-1 uppercase tracking-wider',
};

function makeHeading(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  const Component: ComponentType<{ children?: ReactNode }> = ({ children }) => {
    const Tag = tag;
    return <Tag className={HEADING_CLASSES[tag]}>{children}</Tag>;
  };
  return Component;
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

interface TableProps {
  children?: ReactNode;
}

const TableComponent: ComponentType<TableProps> = ({ children }) => (
  <div className="my-4 overflow-x-auto">
    <table className="min-w-full border-collapse border border-space-border text-sm">
      {children}
    </table>
  </div>
);

const ThComponent: ComponentType<{ children?: ReactNode; style?: CSSProperties }> = ({
  children,
  style,
}) => (
  <th
    className="border border-space-border bg-space-750 px-3 py-2 text-left font-semibold text-space-text"
    style={style}
  >
    {children}
  </th>
);

const TdComponent: ComponentType<{ children?: ReactNode; style?: CSSProperties }> = ({
  children,
  style,
}) => (
  <td className="border border-space-border px-3 py-2 text-space-muted" style={style}>
    {children}
  </td>
);

/* ------------------------------------------------------------------ */
/* Blockquote                                                          */
/* ------------------------------------------------------------------ */

interface BlockquoteProps {
  children?: ReactNode;
}

const BlockquoteComponent: ComponentType<BlockquoteProps> = ({ children }) => (
  <blockquote className="my-4 rounded-r border-l-4 border-celadon/45 bg-celadon/5 py-1 pl-4 text-space-muted">
    {children}
  </blockquote>
);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function nodeText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(nodeText).join('');
  return '';
}

/**
 * Build the `Components` map for `react-markdown`.
 *
 * The citation component is created **inside** this function so it closes
 * over the specific `onCitationClick` handler and `validMarkers` set.
 * This eliminates the need for a module-level mutable ref — each
 * MarkdownRenderer instance gets its own isolated handler.
 */
export function createMarkdownComponents(
  onCitationClick?: CitationClickHandler,
  validMarkers?: Set<string>
): Components {
  const CitationComponent: ComponentType<CitationProps> = ({ marker, node }) => {
    const m = marker ?? node?.properties?.marker ?? '';
    // Display only the numeric part: "cite-2" → "2"
    const displayNum = m.replace(/^cite-/, '');
    // Check validity: valid if no validMarkers set provided (backward compat),
    // or if the marker is in the set
    const isValid = !validMarkers || validMarkers.size === 0 || validMarkers.has(m);

    return (
      <sup>
        <button
          type="button"
          onClick={() => onCitationClick?.(m)}
          className={`font-mono text-xs cursor-pointer px-0.5 rounded mx-px align-super transition-colors ${
            isValid
              ? 'text-cinnabar hover:underline bg-cinnabar/5'
              : 'text-space-faint bg-space-750 cursor-default'
          }`}
          title={isValid ? `点击跳转到引用 ${displayNum}` : `引用 ${displayNum} 无对应证据`}
          data-marker={m}
          aria-label={isValid ? `引用 ${displayNum}` : `无效引用 ${displayNum}`}
        >
          [{displayNum}]
        </button>
      </sup>
    );
  };

  return {
    citation: CitationComponent,
    a: AnchorComponent,
    code: CodeComponent,
    pre: PreComponent,
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
    table: TableComponent,
    th: ThComponent,
    td: TdComponent,
    blockquote: BlockquoteComponent,
  } as Components;
}
