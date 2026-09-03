import type { LearningGenre, TeachingRole, TeachingUnit } from './types';

export const TEACHING_ROLE_TEMPLATES: Readonly<Record<LearningGenre, readonly TeachingRole[]>> = {
  concept: ['problem', 'motivation', 'intuition', 'definition', 'condition', 'property', 'example', 'application', 'misconception', 'summary'],
  derivation: ['problem', 'condition', 'definition', 'formula', 'derivation_step', 'summary', 'example', 'application'],
  algorithm: ['problem', 'intuition', 'condition', 'procedure_step', 'property', 'example', 'application', 'summary'],
  mechanism: ['problem', 'motivation', 'definition', 'procedure_step', 'condition', 'property', 'application', 'summary'],
  comparison: ['problem', 'definition', 'comparison', 'condition', 'example', 'application', 'summary'],
  case: ['problem', 'condition', 'procedure_step', 'example', 'comparison', 'summary'],
};

export function compileTeachingPath(
  genre: LearningGenre,
  units: TeachingUnit[],
  sourceOrderByEvidenceId: ReadonlyMap<string, number>,
): string[] {
  const rank = new Map(TEACHING_ROLE_TEMPLATES[genre].map((role, index) => [role, index]));
  const sourceOrder = (unit: TeachingUnit): number => Math.min(
    ...unit.evidenceIds.map(id => sourceOrderByEvidenceId.get(id) ?? Number.POSITIVE_INFINITY),
  );
  return [...units]
    .sort((left, right) => (rank.get(left.role) ?? 999) - (rank.get(right.role) ?? 999)
      || sourceOrder(left) - sourceOrder(right)
      || left.stableKey.localeCompare(right.stableKey))
    .map(unit => unit.id);
}
