import { describe, expect, it } from 'vitest';
import { createSourceDocument } from '../markdown-parser';
import { diffReparse, remapSourceRange, remapSourceRanges } from '../reparse-diff';
import type { KnowledgeTopic, SourceDocument } from '../../types';

const BASE_MARKDOWN = `# 概率模型基础

## 1. 概率模型

概率模型是描述随机现象的数学框架。

给定数据 D，假设数据由含参数 θ 的分布生成。

## 2. 最大似然估计

似然函数 L(θ) = p(D|θ)

对数似然 l(θ) = Σᵢ log p(yᵢ|xᵢ;θ)

## 3. 正则化

J_reg(w) = J(w) + λΩ(w)
`;

function makeDoc(markdown: string): SourceDocument {
  return createSourceDocument(markdown, 'course-1', '概率模型基础');
}

/** 段落块可能由多个相邻段落合并而成，按包含关系定位。 */
function blockIdsByContent(doc: SourceDocument, snippet: string): string {
  const block = doc.blocks.find(item => item.content.includes(snippet));
  if (!block) throw new Error(`block not found: ${snippet}`);
  return block.id;
}

function makeTopic(id: string, doc: SourceDocument, contents: string[]): KnowledgeTopic {
  const ordered = [...doc.blocks].sort((a, b) => a.orderIndex - b.orderIndex);
  const ids = contents.map(content => blockIdsByContent(doc, content));
  const start = ordered.findIndex(block => block.id === ids[0]);
  const end = ordered.findIndex(block => block.id === ids[ids.length - 1]);
  return {
    id,
    courseId: doc.courseId,
    name: id,
    aliases: [],
    summary: '',
    learningObjective: '',
    sourceRanges: [{
      documentId: doc.id,
      startBlockId: ordered[start].id,
      endBlockId: ordered[end].id,
    }],
    childTopicIds: [],
    importance: 'core',
    difficulty: 2,
    knowledgeGenre: 'concept',
    confidence: 0.9,
    status: 'generated',
  };
}

describe('diffReparse', () => {
  it('内容完全一致时：全部主题完好，引用重映射到新文档', () => {
    const oldDoc = makeDoc(BASE_MARKDOWN);
    const newDoc = makeDoc(BASE_MARKDOWN);
    const topics = [
      makeTopic('topic-prob', oldDoc, ['概率模型是描述随机现象的数学框架。']),
      makeTopic('topic-mle', oldDoc, ['似然函数 L(θ) = p(D|θ)']),
    ];

    const diff = diffReparse([oldDoc], [newDoc], topics);

    expect(diff.staleTopicIds).toEqual([]);
    expect(diff.intactTopicIds.map((id: string) => id).sort()).toEqual(['topic-mle', 'topic-prob']);
    expect(diff.newUncoveredBlockCount).toBe(0);
    // 文档 id 与块 id 都变了，但映射完整
    expect(oldDoc.id).not.toBe(newDoc.id);
    expect(diff.alignment.documentRemap.get(oldDoc.id)).toBe(newDoc.id);
    const remapped = remapSourceRanges(topics[0].sourceRanges, diff.alignment);
    expect(remapped[0].documentId).toBe(newDoc.id);
    expect(newDoc.blocks.some(block => block.id === remapped[0].startBlockId)).toBe(true);
  });

  it('被引用内容变化时：对应主题 stale，其余完好', () => {
    const changedMarkdown = BASE_MARKDOWN.replace(
      '似然函数 L(θ) = p(D|θ)',
      '似然函数 L(θ) = p(D|θ)（已修订定义）',
    );
    const oldDoc = makeDoc(BASE_MARKDOWN);
    const newDoc = makeDoc(changedMarkdown);
    const topics = [
      makeTopic('topic-prob', oldDoc, ['概率模型是描述随机现象的数学框架。']),
      makeTopic('topic-mle', oldDoc, ['似然函数 L(θ) = p(D|θ)']),
    ];

    const diff = diffReparse([oldDoc], [newDoc], topics);

    expect(diff.staleTopicIds).toEqual(['topic-mle']);
    expect(diff.intactTopicIds).toEqual(['topic-prob']);
    expect(diff.changedCitedBlockCount).toBeGreaterThan(0);
    expect(diff.summary).toContain('1 个知识点的原文有变化');
  });

  it('新增未被覆盖的内容块时计入 newUncoveredBlockCount，不产生 stale', () => {
    const extended = BASE_MARKDOWN + '\n## 4. 全新章节\n\n这一节是重解析后新增的内容。\n';
    const oldDoc = makeDoc(BASE_MARKDOWN);
    const newDoc = makeDoc(extended);
    const topics = [makeTopic('topic-prob', oldDoc, ['概率模型是描述随机现象的数学框架。'])];

    const diff = diffReparse([oldDoc], [newDoc], topics);

    expect(diff.staleTopicIds).toEqual([]);
    expect(diff.newUncoveredBlockCount).toBeGreaterThan(0);
    expect(diff.summary).toContain('未被现有结构覆盖');
  });

  it('首次解析（无旧结构）不产生任何 stale 判定', () => {
    const newDoc = makeDoc(BASE_MARKDOWN);
    const diff = diffReparse([], [newDoc], []);
    expect(diff.staleTopicIds).toEqual([]);
    expect(diff.intactTopicIds).toEqual([]);
    expect(diff.newUncoveredBlockCount).toBeGreaterThan(0);
  });

  it('未映射的引用范围保持原样（resolver 会给出缺失说明）', () => {
    const oldDoc = makeDoc(BASE_MARKDOWN);
    const newDoc = makeDoc(BASE_MARKDOWN.replace('J_reg(w) = J(w) + λΩ(w)', '已删除的公式'));
    const range = {
      documentId: oldDoc.id,
      startBlockId: blockIdsByContent(oldDoc, 'J_reg(w) = J(w) + λΩ(w)'),
      endBlockId: blockIdsByContent(oldDoc, 'J_reg(w) = J(w) + λΩ(w)'),
    };
    const remapped = remapSourceRange(range, diffReparse([oldDoc], [newDoc], []).alignment);
    expect(remapped.startBlockId).toBe(range.startBlockId);
  });
});
