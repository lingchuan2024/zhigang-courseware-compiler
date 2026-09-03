import { normalizeStableText, topicStableKey } from './stable-identity';
import type { LearningGenre, LearningTopic } from './types';

export interface ResolvedTopicDraft {
  localId: string;
  name: string;
  aliases: string[];
  learningObjective: string;
  scope: string;
  genre: LearningGenre;
  difficulty: number;
  importance: LearningTopic['importance'];
  evidenceIds: string[];
  sectionIds: string[];
  confidence: number;
}

export interface CandidateNormalizationResult {
  topics: LearningTopic[];
  localTopicToCanonicalId: Map<string, string>;
  ambiguousPairs: Array<[string, string]>;
}

function intersects(left: string[], right: string[]): boolean {
  const rightValues = new Set(right);
  return left.some(value => rightValues.has(value));
}

function labels(candidate: ResolvedTopicDraft): string[] {
  return [candidate.name, ...candidate.aliases]
    .map(normalizeStableText)
    .filter(Boolean);
}

function canMerge(left: ResolvedTopicDraft, right: ResolvedTopicDraft): boolean {
  return intersects(labels(left), labels(right))
    && (intersects(left.evidenceIds, right.evidenceIds)
      || intersects(left.sectionIds, right.sectionIds));
}

function objectiveOverlap(left: string, right: string): boolean {
  const leftTokens = new Set(Array.from(normalizeStableText(left)).filter(char => !/\s/.test(char)));
  return Array.from(normalizeStableText(right)).some(char => leftTokens.has(char) && !/\s/.test(char));
}

function unionInOrder(values: string[][]): string[] {
  const seen = new Set<string>();
  return values.flatMap(items => items.filter(item => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  }));
}

function clampedDifficulty(value: number): LearningTopic['difficulty'] {
  return Math.min(5, Math.max(1, Math.round(value))) as LearningTopic['difficulty'];
}

export function normalizeCandidates(
  courseId: string,
  candidates: ResolvedTopicDraft[],
): CandidateNormalizationResult {
  const parents = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parents[current] !== current) current = parents[current];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = current;
      index = next;
    }
    return current;
  };
  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const ambiguousPairs: Array<[string, string]> = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (canMerge(candidates[left], candidates[right])) {
        unite(left, right);
      } else if (
        intersects(labels(candidates[left]), labels(candidates[right]))
        && objectiveOverlap(candidates[left].learningObjective, candidates[right].learningObjective)
      ) {
        ambiguousPairs.push([candidates[left].localId, candidates[right].localId]);
      }
    }
  }

  const groups = new Map<number, ResolvedTopicDraft[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate]);
  });

  const topics: LearningTopic[] = [];
  const localTopicToCanonicalId = new Map<string, string>();
  groups.forEach(group => {
    const ordered = [...group].sort((left, right) => right.confidence - left.confidence
      || left.localId.localeCompare(right.localId));
    const representative = ordered[0];
    const evidenceIds = unionInOrder(group.map(candidate => candidate.evidenceIds));
    const sourceSectionIds = [...new Set(group.flatMap(candidate => candidate.sectionIds))].sort();
    const alternateNames = group.map(candidate => candidate.name)
      .filter(name => normalizeStableText(name) !== normalizeStableText(representative.name));
    const aliases = [...new Set([...group.flatMap(candidate => candidate.aliases), ...alternateNames])]
      .sort((left, right) => normalizeStableText(left).localeCompare(normalizeStableText(right)));
    const stableKey = topicStableKey(courseId, representative.name, [], evidenceIds[0] ?? 'no-evidence');
    const topic: LearningTopic = {
      id: stableKey,
      stableKey,
      courseId,
      name: representative.name,
      aliases,
      learningObjective: representative.learningObjective,
      scope: representative.scope,
      genre: representative.genre,
      difficulty: clampedDifficulty(representative.difficulty),
      importance: representative.importance,
      evidenceIds,
      sourceSectionIds,
      confidence: Math.min(1, Math.max(0, Math.max(...group.map(candidate => candidate.confidence)))),
      status: evidenceIds.length > 0 ? 'verified' : 'draft',
    };
    topics.push(topic);
    group.forEach(candidate => localTopicToCanonicalId.set(candidate.localId, topic.id));
  });

  topics.sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  return { topics, localTopicToCanonicalId, ambiguousPairs };
}
