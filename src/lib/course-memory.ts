import {
  CourseGenerationMemory,
  NaturalKnowledgeNote,
  SymbolConflict,
  TerminologyEntry,
  SymbolEntry,
} from '../types';

// ========== Main Functions ==========

/**
 * Update course generation memory with a newly generated note.
 *
 * Rules:
 * - Same symbol + same meaning -> reuse (merge evidence IDs)
 * - Same symbol + different meaning -> record conflict, do NOT overwrite
 * - Terminology aliases are checked to avoid duplicate entries
 */
export function updateMemoryWithNote(
  memory: CourseGenerationMemory,
  topicId: string,
  note: NaturalKnowledgeNote,
  evidenceIds: string[]
): CourseGenerationMemory {
  // Deep copy to avoid mutating the original memory
  const newMemory: CourseGenerationMemory = {
    terminology: Object.fromEntries(
      Object.entries(memory.terminology).map(([k, v]) => [
        k,
        { ...v, aliases: [...v.aliases] } as TerminologyEntry,
      ])
    ),
    symbols: Object.fromEntries(
      Object.entries(memory.symbols).map(([k, v]) => [
        k,
        {
          ...v,
          sourceEvidenceIds: [...v.sourceEvidenceIds],
          conflicts: v.conflicts ? v.conflicts.map(c => ({ ...c })) : undefined,
        } as SymbolEntry,
      ])
    ),
    generatedTopicSummaries: { ...memory.generatedTopicSummaries },
    previousTransition: note.continuityMemory,
  };

  // Update generated topic summary
  newMemory.generatedTopicSummaries[topicId] = note.shortSummary;

  // Process terminology updates
  for (const [term] of Object.entries(note.terminologyUpdates)) {
    const normalizedTerm = term.trim().toLowerCase();

    // Skip if this exact term already exists
    if (newMemory.terminology[term]) {
      continue;
    }

    // Check if this term is an alias of an existing terminology entry
    let foundAlias = false;
    for (const [, entry] of Object.entries(newMemory.terminology)) {
      const allNames = [entry.preferredName, ...entry.aliases].map(n =>
        n.trim().toLowerCase()
      );
      if (allNames.includes(normalizedTerm)) {
        // This term is an alias of an existing entry - add it as an alias
        if (!entry.aliases.includes(term)) {
          entry.aliases.push(term);
        }
        foundAlias = true;
        break;
      }
    }

    if (!foundAlias) {
      // New terminology entry
      newMemory.terminology[term] = {
        preferredName: term,
        aliases: [],
        introducedByTopicId: topicId,
      };
    }
  }

  // Process symbol updates
  for (const [symbol, meaning] of Object.entries(note.symbolUpdates)) {
    const existing = newMemory.symbols[symbol];

    if (!existing) {
      // New symbol - add it
      newMemory.symbols[symbol] = {
        meaning,
        introducedByTopicId: topicId,
        sourceEvidenceIds: [...evidenceIds],
      };
    } else if (existing.meaning === meaning) {
      // Same symbol + same meaning -> reuse
      // Merge evidence IDs (deduplicate)
      const mergedEvIds = new Set([...existing.sourceEvidenceIds, ...evidenceIds]);
      existing.sourceEvidenceIds = Array.from(mergedEvIds);
    } else {
      // Same symbol + different meaning -> record conflict, do NOT overwrite
      const conflict: SymbolConflict = {
        meaning,
        topicId,
        evidenceIds: [...evidenceIds],
      };

      if (!existing.conflicts) {
        existing.conflicts = [];
      }

      // Check if this exact conflict already exists (avoid duplicates)
      const conflictExists = existing.conflicts.some(
        c => c.meaning === meaning && c.topicId === topicId
      );

      if (!conflictExists) {
        existing.conflicts.push(conflict);
      }
    }
  }

  return newMemory;
}

/**
 * Detect all symbol conflicts in the course generation memory.
 * Returns a flat list of all conflicts across all symbols.
 */
export function detectSymbolConflicts(memory: CourseGenerationMemory): SymbolConflict[] {
  const conflicts: SymbolConflict[] = [];

  for (const [, entry] of Object.entries(memory.symbols)) {
    if (entry.conflicts && entry.conflicts.length > 0) {
      conflicts.push(...entry.conflicts);
    }
  }

  return conflicts;
}
