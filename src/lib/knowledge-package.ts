import {
  CourseTopic,
  MacroKnowledgeRelation,
  KnowledgePackage,
  KnowledgePackageSourceEvidence,
  UnitContentItem,
  MicroKnowledgeRelation,
  UnitContentType,
  EvidenceAtom,
  NaturalKnowledgeNote,
  CourseGenerationMemory,
} from '../types';
import { generateId } from './utils';
import { getTopicRelations } from './knowledge-graph';

export const PROMPT_VERSION = 'v2-natural-notes-2026-07';

// 从Topic和Evidence创建KnowledgePackage
export function createKnowledgePackage(
  topic: CourseTopic,
  allRelations: MacroKnowledgeRelation[],
  evidences: EvidenceAtom[]
): KnowledgePackage {
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));
  const topicRelations = getTopicRelations(topic.id, allRelations);

  // 收集该topic的所有相关关系（前置、后继、相关）
  const relevantRelations = [
    ...topicRelations.prerequisites,
    ...topicRelations.dependents,
    ...topicRelations.related,
  ];

  // 构建原文证据
  const sourceEvidences: KnowledgePackageSourceEvidence[] = topic.evidenceIds
    .map(id => {
      const ev = evidenceMap.get(id);
      if (!ev) return null;
      return {
        evidenceId: id,
        pageNumber: ev.pageNumber,
        type: ev.type as string,
        originalText: ev.content,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // 按页码排序原文
  sourceEvidences.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return 0;
  });

  const combinedText = sourceEvidences
    .map(e => `[P${e.pageNumber}] ${e.originalText}`)
    .join('\n\n');

  // 从证据简单生成本地化的items（降级路径）
  const localItems = generateLocalContentItems(topic, sourceEvidences);

  const orderedItemIds = orderItemsNarratively(localItems);

  return {
    id: generateId('kp'),
    topic: { ...topic },
    source: {
      evidenceIds: topic.evidenceIds,
      combinedOriginalText: combinedText,
      evidence: sourceEvidences,
    },
    internalStructure: {
      items: localItems,
      relations: [],
      orderedItemIds,
      source: 'local',
      warnings: [],
      status: 'ready',
    },
    macroRelations: relevantRelations,
    note: undefined,
    versions: {
      sourceVersion: 1,
      structureVersion: 1,
      noteVersion: 0,
      promptVersion: PROMPT_VERSION,
    },
  };
}

// 本地降级：从证据生成内容项
function generateLocalContentItems(
  topic: CourseTopic,
  sourceEvidences: KnowledgePackageSourceEvidence[]
): UnitContentItem[] {
  const items: UnitContentItem[] = [];
  let order = 0;

  const typeMap: Record<string, UnitContentType> = {
    title: 'motivation',
    definition: 'definition',
    formula: 'formula',
    example: 'example',
    procedure: 'procedure',
    comparison: 'comparison',
    text: 'intuition',
  };

  for (const ev of sourceEvidences) {
    const contentType = typeMap[ev.type] || 'intuition';
    items.push({
      id: generateId('item'),
      topicId: topic.id,
      type: contentType,
      content: ev.originalText,
      evidenceIds: [ev.evidenceId],
      originalPageNumbers: [ev.pageNumber],
      originalOrder: order,
      recommendedOrder: order,
      confidence: 0.6,
    });
    order++;
  }

  return items;
}

// 教学叙事顺序模板
const NARRATIVE_ORDER: UnitContentType[] = [
  'motivation',
  'problem',
  'prerequisite',
  'assumption',
  'intuition',
  'definition',
  'formula',
  'derivation',
  'procedure',
  'example',
  'chart',
  'comparison',
  'condition',
  'limitation',
  'misconception',
  'conclusion',
];

function orderItemsNarratively(items: UnitContentItem[]): string[] {
  const typePriority = new Map(NARRATIVE_ORDER.map((t, i) => [t, i]));

  return [...items]
    .sort((a, b) => {
      const pa = typePriority.get(a.type) ?? 99;
      const pb = typePriority.get(b.type) ?? 99;
      if (pa !== pb) return pa - pb;
      const pageA = a.originalPageNumbers[0] || 0;
      const pageB = b.originalPageNumbers[0] || 0;
      if (pageA !== pageB) return pageA - pageB;
      return a.originalOrder - b.originalOrder;
    })
    .map(i => i.id);
}

// 更新KnowledgePackage的内部结构（AI返回细粒度内容后）
export function updatePackageInternalStructure(
  kp: KnowledgePackage,
  items: Partial<UnitContentItem>[],
  relations: MicroKnowledgeRelation[]
): KnowledgePackage {
  const validEvIds = new Set(kp.source.evidenceIds);
  const topicId = kp.topic.id;

  // 验证items的evidenceIds和topicId
  const validItems: UnitContentItem[] = items
    .map((item, idx) => ({
      id: item.id || generateId('item'),
      topicId,
      type: item.type || 'text' as UnitContentItem['type'],
      title: item.title,
      content: item.content || '',
      evidenceIds: (item.evidenceIds || []).filter(id => validEvIds.has(id)),
      originalPageNumbers: item.originalPageNumbers && item.originalPageNumbers.length > 0
        ? item.originalPageNumbers
        : getPagesFromEvidenceIds(item.evidenceIds || [], kp),
      originalOrder: item.originalOrder ?? idx,
      recommendedOrder: item.recommendedOrder ?? idx,
      confidence: Math.max(0, Math.min(1, item.confidence || 0.5)),
    }))
    .filter(item => item.evidenceIds.length > 0 || item.content);

  // 验证relations
  const validItemIds = new Set(validItems.map(i => i.id));
  const validRelations = relations
    .filter(r =>
      r.sourceItemId && r.targetItemId &&
      validItemIds.has(r.sourceItemId) && validItemIds.has(r.targetItemId) &&
      r.sourceItemId !== r.targetItemId
    )
    .map(r => ({
      ...r,
      id: r.id || generateId('mrel'),
      topicId,
      evidenceIds: (r.evidenceIds || []).filter(id => validEvIds.has(id)),
      confidence: Math.max(0, Math.min(1, r.confidence || 0.5)),
    }));

  const orderedIds = orderItemsNarratively(validItems);
  // 更新recommendedOrder
  validItems.forEach((item, i) => {
    const orderIdx = orderedIds.indexOf(item.id);
    item.recommendedOrder = orderIdx !== -1 ? orderIdx : i;
  });

  return {
    ...kp,
    internalStructure: {
      items: validItems,
      relations: validRelations,
      orderedItemIds: orderedIds,
      source: 'ai',
      warnings: [],
      status: 'ready',
    },
    versions: {
      ...kp.versions,
      structureVersion: kp.versions.structureVersion + 1,
    },
  };
}

function getPagesFromEvidenceIds(
  evidenceIds: string[],
  kp: KnowledgePackage
): number[] {
  const pages = new Set<number>();
  for (const id of evidenceIds) {
    const ev = kp.source.evidence.find(e => e.evidenceId === id);
    if (ev) pages.add(ev.pageNumber);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

// 设置笔记并更新版本
export function setPackageNote(
  kp: KnowledgePackage,
  note: NaturalKnowledgeNote,
  model?: string
): KnowledgePackage {
  // 验证citations中的evidenceIds
  const validEvIds = new Set(kp.source.evidenceIds);
  const validCitations = note.citations
    .map(c => ({
      ...c,
      evidenceIds: c.evidenceIds.filter(id => validEvIds.has(id)),
    }))
    .filter(c => c.evidenceIds.length > 0);

  const validatedNote: NaturalKnowledgeNote = {
    ...note,
    citations: validCitations,
  };

  return {
    ...kp,
    note: validatedNote,
    topic: {
      ...kp.topic,
      noteStatus: 'completed',
    },
    versions: {
      ...kp.versions,
      noteVersion: kp.versions.noteVersion + 1,
      model,
      generatedAt: Date.now(),
    },
  };
}

// 标记单个package失败
export function markPackageFailed(kp: KnowledgePackage, reason: string): KnowledgePackage {
  return {
    ...kp,
    topic: {
      ...kp.topic,
      noteStatus: 'failed',
    },
    note: {
      id: generateId('note'),
      topicId: kp.topic.id,
      title: kp.topic.title,
      contentMarkdown: `> 笔记生成失败：${reason}\n\n请查看下方原始内容。\n\n${kp.source.combinedOriginalText}`,
      shortSummary: kp.topic.learningGoal,
      citations: kp.source.evidenceIds.slice(0, 3).map((id, i) => ({
        marker: `cite-${i + 1}`,
        evidenceIds: [id],
      })),
      terminologyUpdates: {},
      symbolUpdates: {},
      continuityMemory: '',
      warnings: [reason],
    },
    versions: {
      ...kp.versions,
    },
  };
}

// 检测证据变化，标记stale
export function markStalePackages(
  packages: KnowledgePackage[],
  newEvidences: EvidenceAtom[]
): KnowledgePackage[] {
  const newEvMap = new Map(newEvidences.map(e => [e.id, e.content]));

  return packages.map(kp => {
    let changed = false;
    for (const ev of kp.source.evidence) {
      const newContent = newEvMap.get(ev.evidenceId);
      if (newContent !== undefined && newContent !== ev.originalText) {
        changed = true;
        break;
      }
      if (newContent === undefined && kp.versions.sourceVersion > 0) {
        // 证据被删除
        changed = true;
        break;
      }
    }

    if (changed) {
      return {
        ...kp,
        topic: {
          ...kp.topic,
          noteStatus: 'stale',
        },
      };
    }
    return kp;
  });
}

// 将本地items组装为简单自然笔记（降级路径）
export function generateLocalNoteForPackage(kp: KnowledgePackage): NaturalKnowledgeNote {
  const itemsById = new Map(kp.internalStructure.items.map(i => [i.id, i]));
  const orderedItems = kp.internalStructure.orderedItemIds
    .map(id => itemsById.get(id))
    .filter((i): i is UnitContentItem => i !== undefined);

  const sections: string[] = [];
  const citations: Array<{ marker: string; evidenceIds: string[] }> = [];
  let citeIdx = 1;

  // 按类型分组组织
  const groups: Record<string, UnitContentItem[]> = {};
  for (const item of orderedItems) {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push(item);
  }

  const sectionTitles: Record<string, string> = {
    motivation: '引入',
    problem: '问题',
    intuition: '直观理解',
    definition: '定义',
    formula: '公式',
    derivation: '推导',
    procedure: '步骤',
    example: '例子',
    comparison: '对比',
    condition: '适用条件',
    limitation: '局限',
    misconception: '注意',
    conclusion: '总结',
  };

  for (const [type, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    const title = sectionTitles[type] || type;
    if (sections.length > 0) sections.push('');
    if (items.length > 1 || type !== 'intuition') {
      sections.push(`### ${title}`);
    }
    for (const item of items) {
      const marker = `cite-${citeIdx}`;
      citations.push({ marker, evidenceIds: item.evidenceIds });
      const pages = item.originalPageNumbers.length > 0 ? `P${item.originalPageNumbers.join(',')}` : '';
      sections.push(`${item.content} {--${marker}--}${pages ? ` [${pages}]` : ''}`);
      citeIdx++;
    }
  }

  let contentMarkdown = sections.join('\n\n');
  // 将citation标记转换为标准[cite-N]格式
  for (const c of citations) {
    contentMarkdown = contentMarkdown.replace(`{--${c.marker}--}`, `[${c.marker}]`);
  }

  return {
    id: generateId('note'),
    topicId: kp.topic.id,
    title: kp.topic.title,
    contentMarkdown,
    shortSummary: kp.topic.learningGoal,
    citations,
    terminologyUpdates: {},
    symbolUpdates: {},
    continuityMemory: kp.topic.title,
    warnings: kp.source.evidence.length < 3 ? ['本知识点证据较少'] : [],
  };
}

// 更新课程记忆
export function updateMemoryWithNote(
  memory: CourseGenerationMemory,
  kp: KnowledgePackage,
  note: NaturalKnowledgeNote
): CourseGenerationMemory {
  const newMemory: CourseGenerationMemory = {
    terminology: { ...memory.terminology },
    symbols: { ...memory.symbols },
    generatedTopicSummaries: {
      ...memory.generatedTopicSummaries,
      [kp.topic.id]: note.shortSummary,
    },
    previousTransition: note.continuityMemory,
  };

  // 添加新术语
  for (const [term] of Object.entries(note.terminologyUpdates)) {
    if (!newMemory.terminology[term]) {
      newMemory.terminology[term] = {
        preferredName: term,
        aliases: [],
        introducedByTopicId: kp.topic.id,
      };
    }
  }

  // 添加新符号
  for (const [symbol, meaning] of Object.entries(note.symbolUpdates)) {
    newMemory.symbols[symbol] = {
      meaning,
      introducedByTopicId: kp.topic.id,
      sourceEvidenceIds: note.citations
        .filter(c => c.evidenceIds.length > 0)
        .flatMap(c => c.evidenceIds)
        .slice(0, 3),
    };
  }

  return newMemory;
}
