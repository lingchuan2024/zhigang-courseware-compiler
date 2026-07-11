import {
  CourseTopic,
  GlobalKnowledgeAnchor,
  CourseKnowledgeOccurrence,
  KnowledgePackage,
} from '../types';
import { generateId } from './utils';

// ========== Known Alias Groups ==========

/**
 * Known cross-language alias groups for common technical terms.
 * Topics whose names match any alias in a group should link to the same anchor.
 */
const KNOWN_ALIAS_GROUPS: string[][] = [
  ['mle', '最大似然估计', 'maximum likelihood estimation'],
  ['map', '最大后验估计', 'maximum a posteriori'],
  ['em算法', 'expectation maximization', 'em algorithm'],
  ['pca', '主成分分析', 'principal component analysis'],
  ['svm', '支持向量机', 'support vector machine'],
  ['cnn', '卷积神经网络', 'convolutional neural network'],
  ['rnn', '循环神经网络', 'recurrent neural network'],
  ['gan', '生成对抗网络', 'generative adversarial network'],
  ['kl散度', 'kl divergence', 'kullback-leibler divergence'],
  ['bgd', '批量梯度下降', 'batch gradient descent'],
  ['sgd', '随机梯度下降', 'stochastic gradient descent'],
];

// ========== Main Functions ==========

/**
 * Normalize an anchor name for comparison.
 * Trims, collapses whitespace, and lowercases.
 */
export function normalizeAnchorName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Find an anchor candidate for a topic.
 *
 * - Exact name match or explicit alias -> auto-link (return the anchor).
 * - Fuzzy match -> candidate only, NOT auto-merge (return null).
 * - Same name but different evidence semantics -> different anchors
 *   (if multiple anchors match, return null to avoid ambiguous linking).
 */
export function findAnchorCandidates(
  topic: CourseTopic,
  existingAnchors: GlobalKnowledgeAnchor[]
): GlobalKnowledgeAnchor | null {
  const topicNames = [topic.title, ...topic.aliases].map(normalizeAnchorName);

  const matches: GlobalKnowledgeAnchor[] = [];

  for (const anchor of existingAnchors) {
    const anchorNames = [anchor.canonicalName, ...anchor.aliases].map(normalizeAnchorName);

    let isMatch = false;

    // Check for exact name match
    for (const topicName of topicNames) {
      if (anchorNames.includes(topicName)) {
        isMatch = true;
        break;
      }
    }

    // Check known alias groups
    if (!isMatch) {
      for (const topicName of topicNames) {
        for (const group of KNOWN_ALIAS_GROUPS) {
          const normalizedGroup = group.map(normalizeAnchorName);
          if (
            normalizedGroup.includes(topicName) &&
            anchorNames.some(an => normalizedGroup.includes(an))
          ) {
            isMatch = true;
            break;
          }
        }
        if (isMatch) break;
      }
    }

    if (isMatch) {
      matches.push(anchor);
    }
  }

  // If exactly one match -> auto-link
  // If multiple matches -> ambiguous (possibly different evidence semantics),
  // do NOT auto-merge
  if (matches.length === 1) {
    return matches[0];
  }

  // No match or ambiguous -> no auto-link
  return null;
}

/**
 * Link a package occurrence to an anchor.
 * Returns a new anchor with the occurrence added (immutable).
 */
export function linkPackageToAnchor(
  anchor: GlobalKnowledgeAnchor,
  occurrence: CourseKnowledgeOccurrence
): GlobalKnowledgeAnchor {
  if (anchor.occurrenceIds.includes(occurrence.id)) {
    return anchor;
  }
  return {
    ...anchor,
    occurrenceIds: [...anchor.occurrenceIds, occurrence.id],
  };
}

/**
 * Unlink an occurrence from all anchors.
 * Preserves anchors that may be used by other courses (anchors with
 * remaining occurrences or no occurrences are both kept).
 */
export function unlinkOccurrence(
  anchors: GlobalKnowledgeAnchor[],
  occurrenceId: string
): GlobalKnowledgeAnchor[] {
  return anchors.map(anchor => ({
    ...anchor,
    occurrenceIds: anchor.occurrenceIds.filter(id => id !== occurrenceId),
  }));
}

/**
 * Rebuild all anchors and occurrences from packages.
 * For each package, create or find an anchor and create an occurrence.
 */
export function rebuildAnchors(
  packages: KnowledgePackage[],
  documentId: string
): { anchors: GlobalKnowledgeAnchor[]; occurrences: CourseKnowledgeOccurrence[] } {
  const anchors: GlobalKnowledgeAnchor[] = [];
  const occurrences: CourseKnowledgeOccurrence[] = [];

  for (const kp of packages) {
    const occurrence: CourseKnowledgeOccurrence = {
      id: generateId('occ'),
      documentId,
      knowledgePackageId: kp.id,
      topicTitle: kp.topic.title,
    };

    // Try to find existing anchor for auto-linking
    const existingAnchor = findAnchorCandidates(kp.topic, anchors);

    if (existingAnchor) {
      // Auto-link to existing anchor
      const linkedAnchor = linkPackageToAnchor(existingAnchor, occurrence);
      const idx = anchors.findIndex(a => a.id === linkedAnchor.id);
      if (idx !== -1) {
        // Merge any new aliases from the topic
        const topicAliases = kp.topic.aliases.filter(
          a => !linkedAnchor.aliases.includes(a) && a !== linkedAnchor.canonicalName
        );
        anchors[idx] = {
          ...linkedAnchor,
          aliases: topicAliases.length > 0
            ? [...linkedAnchor.aliases, ...topicAliases]
            : linkedAnchor.aliases,
        };
      }
      occurrence.globalAnchorId = linkedAnchor.id;
    } else {
      // Create new anchor
      const anchor: GlobalKnowledgeAnchor = {
        id: generateId('anchor'),
        canonicalName: kp.topic.title,
        aliases: [...kp.topic.aliases],
        type: kp.topic.type,
        occurrenceIds: [occurrence.id],
      };
      anchors.push(anchor);
      occurrence.globalAnchorId = anchor.id;
    }

    occurrences.push(occurrence);
  }

  return { anchors, occurrences };
}
