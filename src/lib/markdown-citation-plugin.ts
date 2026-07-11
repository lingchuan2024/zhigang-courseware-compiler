/**
 * Remark plugin: remarkCitation
 *
 * Transforms `[cite-N]` markers found inside `text` nodes into custom
 * `citation` mdast nodes. The resulting nodes carry `data.hName` /
 * `data.hProperties` / `data.hChildren` so that `mdast-util-to-hast` (used
 * internally by `react-markdown`) emits a custom `<citation marker="cite-N">`
 * hast element, which a custom React component can render.
 *
 * Constraints:
 *  - Must NOT process `code` or `inlineCode` nodes (their content is plain
 *    text and `[cite-N]` inside them must stay literal).
 *  - Works in paragraphs, headings, list items, table cells, blockquotes,
 *    and any other parent that contains `text` children.
 *
 * Note on `visit`:
 *  The `unist-util-visit` package is only a transitive dependency of
 *  `react-markdown` and, under pnpm's strict node_modules layout, is not
 *  directly resolvable from project source. We therefore ship a small,
 *  self-contained depth-first walker that mirrors the relevant subset of the
 *  `unist-util-visit` API.
 */

/** Minimal mdast node shape we operate on. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: Array<{ type: string; value?: string }>;
  };
  [key: string]: unknown;
}

/** Matches a citation marker like `[cite-1]`, `[cite-42]`. */
const CITE_PATTERN = /\[cite-(\d+)\]/g;

/**
 * Split a text value into a sequence of `text` and `citation` nodes.
 * Returns `null` when the value contains no citation marker (so the caller
 * can leave the original node untouched).
 */
function splitCitations(value: string): MdastNode[] | null {
  CITE_PATTERN.lastIndex = 0;
  if (!CITE_PATTERN.test(value)) return null;
  CITE_PATTERN.lastIndex = 0;

  const nodes: MdastNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CITE_PATTERN.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }
    const marker = `cite-${match[1]}`;
    nodes.push({
      type: 'citation',
      marker,
      data: {
        hName: 'citation',
        hProperties: { marker },
        hChildren: [{ type: 'text', value: `[${marker}]` }],
      },
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes;
}

/**
 * Depth-first traversal mirroring `unist-util-visit`. The visitor may return
 * the string `'skip'` to avoid descending into a node's children.
 */
function visit(
  tree: MdastNode,
  visitor: (node: MdastNode, index: number | null, parent: MdastNode | null) => void | 'skip'
): void {
  function walk(node: MdastNode, index: number | null, parent: MdastNode | null): void {
    const result = visitor(node, index, parent);
    if (result === 'skip') return;
    if (node.children) {
      let i = 0;
      for (const child of node.children) {
        walk(child, i, node);
        i++;
      }
    }
  }
  walk(tree, null, null);
}

/**
 * Walk the tree and, for every `text` node whose parent is not a code-like
 * node, replace it in place with the split sequence of text/citation nodes.
 */
function transformTree(tree: MdastNode): void {
  visit(tree, (node, _index, parent) => {
    // Never descend into code (block) or inlineCode nodes.
    if (node.type === 'code' || node.type === 'inlineCode') {
      return 'skip';
    }

    if (node.type === 'text' && parent && parent.children) {
      const replaced = splitCitations(node.value ?? '');
      if (replaced) {
        const idx = parent.children.indexOf(node);
        if (idx >= 0) {
          parent.children.splice(idx, 1, ...replaced);
        }
      }
    }
  });
}

/**
 * The remark plugin. Returns a transformer that mutates the mdast tree.
 */
export function remarkCitation() {
  return function transformer(tree: MdastNode) {
    transformTree(tree);
  };
}

export type { MdastNode };
