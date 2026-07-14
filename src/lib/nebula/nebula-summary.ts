import type {
  CourseNebulaSummary,
  KnowledgeStarSummary,
  LibraryCourse,
  LibraryDocument,
  NebulaCardStatus,
} from '../../types';

export interface NebulaSnapshotInput {
  documentId: string;
  topics: Array<{
    id: string;
    name: string;
    aliases: string[];
    importance: KnowledgeStarSummary['importance'];
    sourceRangeCount: number;
  }>;
  cards: Array<{ topicId: string; status: NebulaCardStatus }>;
}

interface MutableKnowledgeStar {
  key: string;
  name: string;
  documentIds: Set<string>;
  evidenceCount: number;
  importance: KnowledgeStarSummary['importance'];
  cardStatus: NebulaCardStatus;
  aliases: Set<string>;
}

const PALETTE_IDS = ['crimson-cyan', 'carina-amber', 'cobalt-violet', 'oxygen-red'] as const;
const IMPORTANCE_RANK: Record<KnowledgeStarSummary['importance'], number> = {
  supplementary: 0,
  important: 1,
  core: 2,
};
const CARD_STATUS_RANK: Record<NebulaCardStatus, number> = {
  none: 0,
  failed: 1,
  partial: 2,
  complete: 3,
};

export function normalizeKnowledgeKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/** FNV-1a provides a small deterministic seed without persisting layout coordinates. */
export function hashNebulaSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function strongerImportance(
  left: KnowledgeStarSummary['importance'],
  right: KnowledgeStarSummary['importance'],
): KnowledgeStarSummary['importance'] {
  return IMPORTANCE_RANK[right] > IMPORTANCE_RANK[left] ? right : left;
}

function strongerCardStatus(left: NebulaCardStatus, right: NebulaCardStatus): NebulaCardStatus {
  return CARD_STATUS_RANK[right] > CARD_STATUS_RANK[left] ? right : left;
}

function mergeAggregate(target: MutableKnowledgeStar, source: MutableKnowledgeStar): void {
  source.documentIds.forEach(documentId => target.documentIds.add(documentId));
  source.aliases.forEach(alias => target.aliases.add(alias));
  target.evidenceCount += source.evidenceCount;
  target.importance = strongerImportance(target.importance, source.importance);
  target.cardStatus = strongerCardStatus(target.cardStatus, source.cardStatus);
}

export function buildCourseNebulaSummary(input: {
  course: LibraryCourse;
  documents: LibraryDocument[];
  snapshots: NebulaSnapshotInput[];
}): CourseNebulaSummary {
  const aggregates = new Set<MutableKnowledgeStar>();
  const byAlias = new Map<string, MutableKnowledgeStar>();

  input.snapshots.forEach(snapshot => {
    const statusByTopic = new Map<string, NebulaCardStatus>();
    snapshot.cards.forEach(card => {
      statusByTopic.set(
        card.topicId,
        strongerCardStatus(statusByTopic.get(card.topicId) ?? 'none', card.status),
      );
    });

    snapshot.topics.forEach(topic => {
      const normalizedKeys = [topic.name, ...topic.aliases]
        .map(normalizeKnowledgeKey)
        .filter((key, index, keys) => Boolean(key) && keys.indexOf(key) === index);
      if (normalizedKeys.length === 0) return;

      const matches = Array.from(new Set(
        normalizedKeys.map(key => byAlias.get(key)).filter((item): item is MutableKnowledgeStar => Boolean(item)),
      ));
      const target = matches[0] ?? {
        key: normalizedKeys[0],
        name: topic.name.trim() || topic.aliases.find(Boolean)?.trim() || normalizedKeys[0],
        documentIds: new Set<string>(),
        evidenceCount: 0,
        importance: topic.importance,
        cardStatus: 'none' as const,
        aliases: new Set<string>(),
      };

      if (matches.length === 0) aggregates.add(target);
      matches.slice(1).forEach(match => {
        mergeAggregate(target, match);
        aggregates.delete(match);
        match.aliases.forEach(alias => byAlias.set(alias, target));
      });

      target.documentIds.add(snapshot.documentId);
      target.evidenceCount += Math.max(0, topic.sourceRangeCount);
      target.importance = strongerImportance(target.importance, topic.importance);
      target.cardStatus = strongerCardStatus(target.cardStatus, statusByTopic.get(topic.id) ?? 'none');
      normalizedKeys.forEach(key => {
        target.aliases.add(key);
        byAlias.set(key, target);
      });
    });
  });

  const stars: KnowledgeStarSummary[] = Array.from(aggregates)
    .map(star => ({
      key: star.key,
      name: star.name,
      sourceDocumentCount: star.documentIds.size,
      evidenceCount: star.evidenceCount,
      importance: star.importance,
      cardStatus: star.cardStatus,
    }))
    .sort((left, right) =>
      IMPORTANCE_RANK[right.importance] - IMPORTANCE_RANK[left.importance]
      || right.evidenceCount - left.evidenceCount
      || left.name.localeCompare(right.name, 'zh-CN'));

  const seed = hashNebulaSeed(`${input.course.id}:${input.course.name}`);
  return {
    version: 1,
    courseId: input.course.id,
    courseName: input.course.name,
    documentCount: input.documents.length,
    knowledgeCount: stars.length,
    completedCardCount: stars.filter(star => star.cardStatus === 'complete').length,
    updatedAt: Math.max(input.course.updatedAt, ...input.documents.map(document => document.updatedAt), 0),
    paletteId: PALETTE_IDS[seed % PALETTE_IDS.length],
    seed,
    stars,
  };
}
