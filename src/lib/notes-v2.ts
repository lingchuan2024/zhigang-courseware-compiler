import {
  KnowledgePackage,
  CourseTopic,
  ViewType,
  EvidenceAtom,
  OrderMode,
  MacroKnowledgeRelation,
  MasterNoteUnit,
  LearningUnit,
} from '../types';
import { getOrderedTopics, generateTopicId } from './knowledge-graph';
import { VIEW_CONFIGS } from './notes';
import { createKnowledgePackage, generateLocalNoteForPackage } from './knowledge-package';
import { generateId } from './utils';

// 组装完整母笔记（按推荐顺序）
export interface AssembledMasterNote {
  title: string;
  topicNotes: Array<{
    topicId: string;
    title: string;
    contentMarkdown: string;
    shortSummary: string;
    warnings: string[];
    pageRange: string;
  }>;
  transitions: string[];
  allCitations: Map<string, string[]>; // marker -> evidenceIds
}

export function assembleMasterNote(
  packages: KnowledgePackage[],
  topics: CourseTopic[],
  orderMode: OrderMode,
  documentTitle: string
): AssembledMasterNote {
  const orderedTopics = getOrderedTopics(topics, orderMode);
  const kpMap = new Map(packages.map(kp => [kp.topic.id, kp]));

  const topicNotes: AssembledMasterNote['topicNotes'] = [];
  const transitions: string[] = [];
  const allCitations = new Map<string, string[]>();

  let prevSummary: string | undefined;

  for (const topic of orderedTopics) {
    const kp = kpMap.get(topic.id);
    if (!kp?.note) {
      // 无笔记时使用降级
      topicNotes.push({
        topicId: topic.id,
        title: topic.title,
        contentMarkdown: `> 本知识点笔记生成中或失败\n\n**原文内容：**\n\n${kp?.source.combinedOriginalText || '无内容'}`,
        shortSummary: topic.learningGoal,
        warnings: ['笔记未生成'],
        pageRange: topic.originalPageNumbers.length > 0
          ? `P${topic.originalPageNumbers[0]}${topic.originalPageNumbers.length > 1 ? '-' + topic.originalPageNumbers[topic.originalPageNumbers.length - 1] : ''}`
          : '',
      });
      continue;
    }

    const note = kp.note;
    const pageRange = topic.originalPageNumbers.length > 0
      ? `P${topic.originalPageNumbers[0]}${topic.originalPageNumbers.length > 1 ? '-' + topic.originalPageNumbers[topic.originalPageNumbers.length - 1] : ''}`
      : '';

    // 收集citations，加topic前缀避免marker冲突
    const markerPrefix = `t${topicNotes.length + 1}-`;
    let processedContent = note.contentMarkdown;
    for (const cite of note.citations) {
      const globalMarker = markerPrefix + cite.marker;
      processedContent = processedContent.replace(
        new RegExp(`\\[${cite.marker}\\]`, 'g'),
        `[${globalMarker}]`
      );
      allCitations.set(globalMarker, cite.evidenceIds);
    }

    // 过渡
    if (prevSummary && note.continuityMemory) {
      transitions.push(note.continuityMemory);
    }
    prevSummary = note.shortSummary;

    topicNotes.push({
      topicId: topic.id,
      title: note.title || topic.title,
      contentMarkdown: processedContent,
      shortSummary: note.shortSummary,
      warnings: note.warnings,
      pageRange,
    });
  }

  return {
    title: documentTitle,
    topicNotes,
    transitions,
    allCitations,
  };
}

// 导出Markdown（v2版本，自然笔记）
export function exportToMarkdownV2(
  packages: KnowledgePackage[],
  topics: CourseTopic[],
  evidences: EvidenceAtom[],
  viewType: ViewType,
  orderMode: OrderMode,
  documentTitle: string
): string {
  const config = VIEW_CONFIGS[viewType];
  const assembled = assembleMasterNote(packages, topics, orderMode, documentTitle);
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));

  const lines: string[] = [];
  lines.push(`# ${assembled.title}`);
  lines.push('');

  const viewLabel = viewType === 'first-study' ? '首次学习' : viewType === 'review' ? '课后复习' : '考前速查';
  const orderLabel = orderMode === 'ai-recommended' ? 'AI推荐顺序' : '原始顺序';
  lines.push(`> 视图：${viewLabel} · 顺序：${orderLabel}`);
  lines.push('');

  for (let i = 0; i < assembled.topicNotes.length; i++) {
    const tn = assembled.topicNotes[i];
    lines.push(`## ${i + 1}. ${tn.title}`);
    if (config.showEvidenceRefs && tn.pageRange) {
      lines.push('');
      lines.push(`<sub>原文页码：${tn.pageRange}</sub>`);
    }
    lines.push('');

    if (viewType === 'exam') {
      // 考前速查：只保留标题、公式块、核心句子，大幅压缩
      const compressed = compressForExam(tn.contentMarkdown);
      lines.push(compressed);
    } else if (viewType === 'review') {
      // 复习视图：保留主要内容，但省略示例和长段落
      lines.push(tn.contentMarkdown);
    } else {
      // 首次学习：完整内容
      lines.push(tn.contentMarkdown);
    }

    // 引用解析为页码
    if (config.showEvidenceRefs) {
      lines.push('');
      const refLines: string[] = [];
      const markerRegex = /\[(t\d+-cite-\d+)\]/g;
      const markers = new Set<string>();
      let match;
      const contentToScan = viewType === 'exam' ? compressForExam(tn.contentMarkdown) : tn.contentMarkdown;
      while ((match = markerRegex.exec(contentToScan)) !== null) {
        markers.add(match[1]);
      }
      for (const marker of markers) {
        const evIds = assembled.allCitations.get(marker);
        if (evIds) {
          const pages = new Set(
            evIds.map(id => evidenceMap.get(id)?.pageNumber).filter((p): p is number => p !== undefined)
          );
          const pageStr = Array.from(pages).sort((a, b) => a - b).map(p => `P${p}`).join(',');
          refLines.push(`- [${marker}] → ${pageStr}`);
        }
      }
      if (refLines.length > 0 && viewType === 'first-study') {
        lines.push('<small>**引用：**</small>');
        lines.push('');
        lines.push(refLines.join('\n'));
      }
    }

    lines.push('');

    if (i < assembled.topicNotes.length - 1 && config.compressionLevel === 'full') {
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function compressForExam(markdown: string): string {
  // 移除长段落，保留标题、列表项、公式、加粗句子
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      result.push(line);
    } else if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s/.test(line)) {
      result.push(line);
    } else if (line.startsWith('$$') || line.startsWith('$')) {
      result.push(line);
    } else if (line.startsWith('>')) {
      result.push(line);
    } else if (line.startsWith('|')) {
      result.push(line);
    } else if (line.trim() === '' || line.startsWith('---')) {
      result.push(line);
    } else if (line.includes('**') && line.length < 200) {
      result.push(line);
    }
  }

  return result.join('\n');
}

// 从v1 MasterNoteUnit转换到v2 KnowledgePackage（迁移兼容）
export function convertV1ToV2(
  units: LearningUnit[],
  notes: MasterNoteUnit[],
  evidences: EvidenceAtom[]
): {
  topics: CourseTopic[];
  relations: MacroKnowledgeRelation[];
  packages: KnowledgePackage[];
} {

  const topics: CourseTopic[] = units.map((unit, i) => {
    const pages = [...new Set(
      unit.evidenceIds
        .map(id => evidences.find(e => e.id === id)?.pageNumber)
        .filter((p): p is number => p !== undefined)
    )].sort((a, b) => a - b);

    return {
      id: generateTopicId(unit.title),
      title: unit.title,
      aliases: [],
      type: 'composite' as const,
      learningGoal: unit.objective,
      evidenceIds: unit.evidenceIds,
      originalPageNumbers: pages,
      importance: i < 3 ? 'core' as const : 'secondary' as const,
      confidence: 0.6,
      originalOrder: unit.order,
      recommendedOrder: unit.order,
      noteStatus: 'pending' as const,
    };
  });

  // 连续关系
  const relations: import('../types').MacroKnowledgeRelation[] = [];
  for (let i = 0; i < topics.length - 1; i++) {
    relations.push({
      id: generateId('rel'),
      sourceTopicId: topics[i].id,
      targetTopicId: topics[i + 1].id,
      type: 'recommended_before',
      evidenceIds: [],
      reason: '原顺序',
      confidence: 0.4,
      origin: 'courseware-explicit',
    });
  }

  // 创建packages和本地笔记
  const packages: KnowledgePackage[] = [];
  for (const topic of topics) {
    const kp = createKnowledgePackage(topic, relations, evidences);
    // 尝试使用v1笔记
    const v1Note = notes.find(n => n.title === topic.title);
    if (v1Note) {
      kp.note = {
        id: generateId('note'),
        topicId: topic.id,
        title: v1Note.title,
        contentMarkdown: v1Note.keyClaims.map(c => `- ${c.content}`).join('\n') +
          (v1Note.formulas.length > 0 ? '\n\n**公式：**\n' + v1Note.formulas.map(f => `- ${f.content}`).join('\n') : '') +
          (v1Note.procedures.length > 0 ? '\n\n**步骤：**\n' + v1Note.procedures.map(p => `- ${p.content}`).join('\n') : '') +
          (v1Note.examples.length > 0 ? '\n\n**例子：**\n' + v1Note.examples.map(e => `- ${e.content}`).join('\n') : ''),
        shortSummary: v1Note.summary,
        citations: v1Note.keyClaims.flatMap(c => c.evidenceIds.map(id => ({
          marker: 'cite-1',
          evidenceIds: [id],
        }))),
        terminologyUpdates: {},
        symbolUpdates: {},
        continuityMemory: '',
        warnings: [],
      };
      kp.topic.noteStatus = 'completed';
    } else {
      kp.note = generateLocalNoteForPackage(kp);
      kp.topic.noteStatus = 'completed';
    }
    packages.push(kp);
  }

  return { topics, relations, packages };
}
