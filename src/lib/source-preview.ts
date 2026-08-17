import type { MarkdownBlock } from '../types';
import { normalizeMinerUMarkdown } from './source-markdown-normalizer';

/**
 * Repair only the rendered preview of already-persisted MinerU blocks.
 * The stored block content and the "raw Markdown" view remain untouched.
 */
export function prepareSourceBlockPreview(block: MarkdownBlock): string {
  const hasLatexEnvironment = /\\begin\{[^}]+\}/.test(block.content);
  const hasDisplayDelimiter = /(^|\n)\s*(?:\$|\$\$|\\\[|\\\])\s*(?=\n|$)/.test(block.content);

  if (block.type !== 'formula' && !(hasLatexEnvironment && hasDisplayDelimiter)) {
    return block.content;
  }

  // Older persisted documents were affected by a JS replacement-string bug:
  // standalone `\[` and `\]` became one `$`. Upgrade only standalone delimiter
  // lines; genuine inline math is never touched.
  const repairedLegacyDelimiters = block.content
    .split('\n')
    .map(line => line.trim() === '$' ? '$$' : line)
    .join('\n');

  return normalizeMinerUMarkdown(repairedLegacyDelimiters).trim();
}
