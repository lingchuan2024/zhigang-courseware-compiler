import {
  CourseTopic,
  EvidenceAtom,
  EvidenceType,
  UnitContentItem,
  UnitContentType,
  MicroKnowledgeRelation,
  MicroRelationType,
  InternalStructure,
  InternalStructureSource,
  InternalStructureStatus,
} from '../types';
import { generateId } from './utils';

// ========== Type Mappings ==========

/**
 * EvidenceType -> UnitContentType mapping.
 * - 'title' is NOT mapped (acts as paragraph boundary, not a content item).
 * - 'text' is NOT mapped here; determined by context (intuition or conclusion).
 */
const EVIDENCE_TYPE_MAP: Partial<Record<EvidenceType, UnitContentType>> = {
  definition: 'definition',
  formula: 'formula',
  derivation: 'derivation',
  example: 'example',
  procedure: 'procedure',
  comparison: 'comparison',
  chart: 'chart',
  assumption: 'assumption',
  condition: 'condition',
  conclusion: 'conclusion',
};

/** Types whose consecutive evidences can be aggregated into a single content item. */
const AGGREGATABLE_TYPES: Set<EvidenceType> = new Set(['definition', 'formula']);

/** Narrative order for type-based fallback ordering. */
const NARRATIVE_ORDER: UnitContentType[] = [
  'motivation', 'problem', 'prerequisite', 'assumption', 'intuition',
  'definition', 'formula', 'derivation', 'procedure', 'example',
  'chart', 'comparison', 'condition', 'limitation', 'misconception', 'conclusion',
];

/** Micro-relation types that participate in topological ordering. */
const ORDERING_MICRO_RELATION_TYPES: Set<MicroRelationType> = new Set([
  'step_before',
  'derived_from',
]);

// ========== Helpers ==========

function sortByPosition(evidences: EvidenceAtom[]): EvidenceAtom[] {
  return [...evidences].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.blockIndex - b.blockIndex;
  });
}

/**
 * Determine the content type for a 'text' evidence based on its position.
 * Last ~30% of evidences -> 'conclusion', otherwise -> 'intuition'.
 */
function determineTextType(
  index: number,
  total: number
): UnitContentType {
  const position = total > 1 ? index / (total - 1) : 0;
  if (position > 0.7) return 'conclusion';
  return 'intuition';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ========== Main Functions ==========

/**
 * Generate local content items from topic evidences.
 * NOT a 1:1 mapping with evidence - consecutive definition/formula evidences
 * are aggregated, title evidences act as paragraph boundaries, and
 * conservative micro-relations are generated.
 */
export function generateLocalContentItems(
  topic: CourseTopic,
  evidences: EvidenceAtom[]
): { items: UnitContentItem[]; relations: MicroKnowledgeRelation[]; warnings: string[] } {
  const warnings: string[] = [];

  // Filter evidences belonging to this topic
  const topicEvidenceIds = new Set(topic.evidenceIds);
  const topicEvidences = evidences.filter(e => topicEvidenceIds.has(e.id));

  if (topicEvidences.length === 0) {
    return { items: [], relations: [], warnings: ['知识点无关联证据'] };
  }

  // Sort by (pageNumber, blockIndex) for stable ordering
  const sorted = sortByPosition(topicEvidences);
  const total = sorted.length;

  const items: UnitContentItem[] = [];
  let order = 0;

  // Aggregation buffer
  let buffer: EvidenceAtom[] = [];
  let bufferType: EvidenceType | null = null;

  const flushBuffer = () => {
    if (buffer.length === 0 || bufferType === null) return;

    const contentType = EVIDENCE_TYPE_MAP[bufferType] || 'intuition';
    const combinedContent = buffer.map(e => e.content).join('\n\n');
    const evidenceIds = buffer.map(e => e.id);
    const pages = Array.from(new Set(buffer.map(e => e.pageNumber))).sort((a, b) => a - b);
    const minConfidence = Math.min(...buffer.map(e => e.confidence));

    items.push({
      id: generateId('item'),
      topicId: topic.id,
      type: contentType,
      content: combinedContent,
      evidenceIds,
      originalPageNumbers: pages,
      originalOrder: order,
      recommendedOrder: order,
      confidence: clamp(minConfidence, 0.5, 0.8),
      itemKey: `local_${order}`,
    });
    order++;

    buffer = [];
    bufferType = null;
  };

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];

    if (ev.type === 'title') {
      // Title evidence -> paragraph boundary, NOT a content item
      flushBuffer();
      continue;
    }

    if (ev.type === 'text') {
      // 'text' type: determine intuition or conclusion by context
      flushBuffer();
      const contentType = determineTextType(i, total);
      items.push({
        id: generateId('item'),
        topicId: topic.id,
        type: contentType,
        content: ev.content,
        evidenceIds: [ev.id],
        originalPageNumbers: [ev.pageNumber],
        originalOrder: order,
        recommendedOrder: order,
        confidence: ev.confidence,
        itemKey: `local_${order}`,
      });
      order++;
      continue;
    }

    if (AGGREGATABLE_TYPES.has(ev.type)) {
      if (bufferType === ev.type) {
        // Same aggregatable type, add to buffer
        buffer.push(ev);
      } else {
        // Different type, flush and start new buffer
        flushBuffer();
        buffer = [ev];
        bufferType = ev.type;
      }
    } else {
      // Non-aggregatable type, flush buffer and create individual item
      flushBuffer();
      const contentType = EVIDENCE_TYPE_MAP[ev.type] || 'intuition';
      items.push({
        id: generateId('item'),
        topicId: topic.id,
        type: contentType,
        content: ev.content,
        evidenceIds: [ev.id],
        originalPageNumbers: [ev.pageNumber],
        originalOrder: order,
        recommendedOrder: order,
        confidence: ev.confidence,
        itemKey: `local_${order}`,
      });
      order++;
    }
  }
  flushBuffer();

  // Generate conservative micro-relations
  const relations = generateMicroRelations(items, topic.id);

  if (items.length === 0) {
    warnings.push('未能从证据中生成任何内容项');
  }

  return { items, relations, warnings };
}

/**
 * Generate conservative micro-relations between content items.
 * - definition -> defines -> formula
 * - derivation step -> step_before -> next derivation step
 * - example -> example_of -> nearest preceding definition
 * - condition/assumption -> qualifies -> nearest preceding definition/formula
 */
function generateMicroRelations(
  items: UnitContentItem[],
  topicId: string
): MicroKnowledgeRelation[] {
  const relations: MicroKnowledgeRelation[] = [];

  const definitions = items.filter(i => i.type === 'definition');
  const formulas = items.filter(i => i.type === 'formula');
  const derivations = items.filter(i => i.type === 'derivation');
  const examples = items.filter(i => i.type === 'example');
  const conditions = items.filter(i => i.type === 'condition' || i.type === 'assumption');

  // definition -> defines -> formula (first formula after this definition)
  for (const def of definitions) {
    for (const formula of formulas) {
      if (formula.originalOrder > def.originalOrder) {
        relations.push({
          id: generateId('mrel'),
          sourceItemId: def.id,
          targetItemId: formula.id,
          topicId,
          type: 'defines',
          evidenceIds: [],
          reason: '定义解释了公式中的概念',
          confidence: 0.6,
        });
        break;
      }
    }
  }

  // derivation step -> step_before -> next derivation step
  const sortedDerivations = [...derivations].sort((a, b) => a.originalOrder - b.originalOrder);
  for (let i = 0; i < sortedDerivations.length - 1; i++) {
    relations.push({
      id: generateId('mrel'),
      sourceItemId: sortedDerivations[i].id,
      targetItemId: sortedDerivations[i + 1].id,
      topicId,
      type: 'step_before',
      evidenceIds: [],
      reason: '连续推导步骤',
      confidence: 0.7,
    });
  }

  // example -> example_of -> nearest preceding definition
  for (const ex of examples) {
    const nearestDef = definitions
      .filter(d => d.originalOrder < ex.originalOrder)
      .sort((a, b) => b.originalOrder - a.originalOrder)[0];
    if (nearestDef) {
      relations.push({
        id: generateId('mrel'),
        sourceItemId: ex.id,
        targetItemId: nearestDef.id,
        topicId,
        type: 'example_of',
        evidenceIds: [],
        reason: '例子展示了定义的应用',
        confidence: 0.6,
      });
    }
  }

  // condition/assumption -> qualifies -> nearest preceding definition/formula
  for (const cond of conditions) {
    const nearestTarget = [...definitions, ...formulas]
      .filter(t => t.originalOrder < cond.originalOrder)
      .sort((a, b) => b.originalOrder - a.originalOrder)[0];
    if (nearestTarget) {
      relations.push({
        id: generateId('mrel'),
        sourceItemId: cond.id,
        targetItemId: nearestTarget.id,
        topicId,
        type: 'qualifies',
        evidenceIds: [],
        reason: '条件限定了适用范围',
        confidence: 0.5,
      });
    }
  }

  return relations;
}

/**
 * Order items by relations and evidence continuity.
 * Priority: step_before/derived_from relations > derivation continuity >
 * definition dependency > page+blockIndex > type narrative.
 * Uses stable topological sort.
 */
export function orderInternalItems(
  items: UnitContentItem[],
  relations: MicroKnowledgeRelation[]
): string[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [items[0].id];

  const itemMap = new Map(items.map(i => [i.id, i]));
  const itemIdSet = new Set(items.map(i => i.id));

  // Build adjacency for topological sort
  // step_before: source -> target (source first)
  // derived_from: source is derived from target -> target first (target -> source)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const item of items) {
    inDegree.set(item.id, 0);
    adj.set(item.id, []);
  }

  const seenEdges = new Set<string>();
  for (const r of relations) {
    if (!ORDERING_MICRO_RELATION_TYPES.has(r.type)) continue;
    if (!itemIdSet.has(r.sourceItemId) || !itemIdSet.has(r.targetItemId)) continue;
    if (r.sourceItemId === r.targetItemId) continue;

    let from: string;
    let to: string;
    if (r.type === 'step_before') {
      from = r.sourceItemId;
      to = r.targetItemId;
    } else {
      // derived_from: source is derived from target, so target comes first
      from = r.targetItemId;
      to = r.sourceItemId;
    }

    const edgeKey = `${from}->${to}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);

    adj.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  }

  // Stable queue sort: page+blockIndex (originalOrder) > type narrative > ID
  const typePriority = new Map(NARRATIVE_ORDER.map((t, i) => [t, i]));

  const sortQueue = (queue: string[]) => {
    queue.sort((a, b) => {
      const itemA = itemMap.get(a)!;
      const itemB = itemMap.get(b)!;

      // 1. Page number
      const pageA = itemA.originalPageNumbers[0] || 0;
      const pageB = itemB.originalPageNumbers[0] || 0;
      if (pageA !== pageB) return pageA - pageB;

      // 2. Original order (proxy for blockIndex continuity)
      if (itemA.originalOrder !== itemB.originalOrder) {
        return itemA.originalOrder - itemB.originalOrder;
      }

      // 3. Type narrative order
      const typeA = typePriority.get(itemA.type) ?? 99;
      const typeB = typePriority.get(itemB.type) ?? 99;
      if (typeA !== typeB) return typeA - typeB;

      // 4. Stable ID
      return a.localeCompare(b);
    });
  };

  const result: string[] = [];
  const queue: string[] = [];

  for (const item of items) {
    if ((inDegree.get(item.id) || 0) === 0) queue.push(item.id);
  }

  while (queue.length > 0) {
    sortQueue(queue);
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Remaining items (cycle residual) - append by original order
  if (result.length < items.length) {
    const remaining = items
      .filter(i => !result.includes(i.id))
      .sort((a, b) => a.originalOrder - b.originalOrder);
    result.push(...remaining.map(i => i.id));
  }

  return result;
}

/**
 * Create an InternalStructure with proper status.
 * Builds local content items, generates micro-relations, and orders items.
 */
export function createInternalStructure(
  topic: CourseTopic,
  evidences: EvidenceAtom[],
  source: InternalStructureSource
): InternalStructure {
  const { items, relations, warnings } = generateLocalContentItems(topic, evidences);
  const orderedItemIds = orderInternalItems(items, relations);

  // Update recommendedOrder based on ordering
  items.forEach((item, i) => {
    const orderIdx = orderedItemIds.indexOf(item.id);
    item.recommendedOrder = orderIdx !== -1 ? orderIdx : i;
  });

  const status: InternalStructureStatus = items.length > 0 ? 'ready' : 'failed';

  return {
    items,
    relations,
    orderedItemIds,
    source,
    warnings,
    status,
  };
}
