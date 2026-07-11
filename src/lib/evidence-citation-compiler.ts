import { Citation } from '../types';

// ========== Evidence Citation Compiler ==========
// Parses [[evidence:ev-1,ev-2,...]] placeholders from AI-generated markdown,
// validates evidence IDs, and replaces them with [cite-N] markers.

export interface CitationCompilationResult {
  /** Markdown with placeholders replaced by [cite-N] markers */
  markdown: string;
  /** Citation entries for NaturalKnowledgeNote.citations */
  citations: Citation[];
  /** Warnings about unknown evidence IDs or issues */
  warnings: string[];
}

// ========== Placeholder Pattern ==========

const EVIDENCE_PLACEHOLDER_PATTERN = /\[\[evidence:([^\]]+)\]\]/g;

// ========== Main Function ==========

/**
 * Compile evidence placeholders in AI-generated markdown.
 *
 * Flow:
 * 1. Find all [[evidence:ev-1,ev-2,...]] placeholders
 * 2. Validate each evidence ID against the known set
 * 3. Remove unknown IDs (with warnings)
 * 4. Deduplicate IDs within each placeholder
 * 5. Assign deterministic citation markers based on evidence group
 * 6. Replace placeholders with [cite-N] markers
 * 7. Return citations array
 *
 * Rules:
 * - Same evidence group → same marker (reused)
 * - Marker numbering is sequential by first appearance
 * - Unknown evidence IDs produce warnings but don't break
 */
export function compileEvidenceCitations(
  markdown: string,
  knownEvidenceIds: Set<string>
): CitationCompilationResult {
  const warnings: string[] = [];
  const citations: Citation[] = [];

  // Map from evidence group key → marker
  const groupToMarker = new Map<string, string>();
  let nextMarkerNum = 1;

  // Find all placeholders and collect unique groups
  const matches: Array<{
    fullMatch: string;
    rawIds: string[];
    validIds: string[];
    index: number;
  }> = [];

  let match: RegExpExecArray | null;
  EVIDENCE_PLACEHOLDER_PATTERN.lastIndex = 0;
  while ((match = EVIDENCE_PLACEHOLDER_PATTERN.exec(markdown)) !== null) {
    const fullMatch = match[0];
    const idsStr = match[1];
    const rawIds = idsStr
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    // Validate and deduplicate
    const seen = new Set<string>();
    const validIds: string[] = [];
    for (const rawId of rawIds) {
      if (!knownEvidenceIds.has(rawId)) {
        warnings.push(`未知的 Evidence ID: ${rawId}`);
        continue;
      }
      if (seen.has(rawId)) continue;
      seen.add(rawId);
      validIds.push(rawId);
    }

    if (validIds.length === 0) {
      warnings.push(`占位符 ${fullMatch} 中没有有效的 Evidence ID`);
    }

    matches.push({
      fullMatch,
      rawIds,
      validIds,
      index: match.index,
    });
  }

  // Assign markers: same evidence group → same marker
  // Process in order of appearance for deterministic numbering
  for (const m of matches) {
    if (m.validIds.length === 0) {
      continue; // Will be replaced with empty string
    }

    const groupKey = m.validIds.sort().join(',');

    if (!groupToMarker.has(groupKey)) {
      const marker = `cite-${nextMarkerNum++}`;
      groupToMarker.set(groupKey, marker);
      citations.push({
        marker,
        evidenceIds: [...m.validIds],
      });
    }
  }

  // Replace placeholders in markdown
  let result = markdown;
  // Process from last to first to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    let replacement: string;

    if (m.validIds.length === 0) {
      replacement = '';
    } else {
      const groupKey = m.validIds.sort().join(',');
      const marker = groupToMarker.get(groupKey);
      replacement = marker ? `[${marker}]` : '';
    }

    result =
      result.substring(0, m.index) +
      replacement +
      result.substring(m.index + m.fullMatch.length);
  }

  return {
    markdown: result,
    citations,
    warnings,
  };
}

// ========== Legacy Citation Support ==========

/**
 * Check if markdown contains legacy [cite-N] markers.
 * Used for backward compatibility with existing notes.
 */
export function hasLegacyCitations(markdown: string): boolean {
  return /\[cite-\d+\]/.test(markdown);
}

/**
 * Extract all citation markers from markdown (both [[evidence:...]] and [cite-N]).
 * Used for validation.
 */
export function extractAllCitationMarkers(markdown: string): string[] {
  const markers: string[] = [];

  // Legacy [cite-N]
  const legacyMatches = markdown.matchAll(/\[cite-(\d+)\]/g);
  for (const m of legacyMatches) {
    markers.push(`cite-${m[1]}`);
  }

  return markers;
}
