import { normalizeGeneratedMarkdown } from './markdown-normalization';
import { validateGeneratedMarkdown } from './markdown-validation';

/**
 * Remove a response wrapper such as ```markdown ... ``` while preserving
 * genuine code blocks inside the generated document.
 */
function unwrapMarkdownResponseFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/i);
  return match ? match[2].trim() : trimmed;
}

/**
 * Prepare model-generated Markdown for persistence and display.
 * The transformation is deterministic and idempotent.
 */
export function prepareGeneratedMarkdown(content: string): string {
  const unwrapped = unwrapMarkdownResponseFence(content);
  const normalized = normalizeGeneratedMarkdown(unwrapped);
  return validateGeneratedMarkdown(normalized.content, []).fixedContent.trim();
}
