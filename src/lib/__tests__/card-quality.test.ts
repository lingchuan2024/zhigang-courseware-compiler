import { describe, expect, it } from 'vitest';
import { evaluateKnowledgeCardDraft } from '../card-quality';

describe('knowledge card quality gate', () => {
  it('rejects generic placeholder copy', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'comparison',
      detailedNote: '表格可能包含各方法的特点、适用场景等对比信息。',
      sourceRangeCount: 1,
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('正文包含空泛占位表达');
  });

  it('requires explicit intermediate steps for derivations', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'derivation',
      detailedNote: '## 推导\n\n由课件给出的起始公式，可以直接得到最终结论。该结论只在课件所列假设成立时使用。',
      sourceRangeCount: 2,
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('推导缺少可检查的连续步骤');
  });

  it('requires real objects and dimensions for comparisons', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'comparison',
      detailedNote: '## 方法比较\n\nPCA 和 NMF 都可以用于降维，但它们各有特点，应当结合实际情况进行选择。这里给出两种方法的总体说明。',
      sourceRangeCount: 2,
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('对比缺少明确对象和比较维度');
  });

  it('accepts a concrete comparison card', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'comparison',
      detailedNote: [
        '## 比较目标',
        '',
        'PCA 与 NMF 都将高维数据压缩到低维表示，但优化约束和结果解释不同。',
        '',
        '| 比较维度 | PCA | NMF |',
        '|---|---|---|',
        '| 核心约束 | 主方向彼此正交 | 因子矩阵保持非负 |',
        '| 表示含义 | 方差最大的线性方向 | 可加的部件组合 |',
        '| 适用数据 | 中心化连续变量 | 天然非负的计数或强度 |',
        '',
        '因此，目标是保留最大方差时优先考虑 PCA；强调非负部件解释时优先考虑 NMF。',
      ].join('\n'),
      sourceRangeCount: 2,
    });

    expect(result).toEqual({ accepted: true, reasons: [] });
  });

  it('requires an evidence warning when no source range is available', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'concept',
      detailedNote: '## 定义与直觉\n\n这一概念用于统一描述模型中的输入、输出与参数关系，并给出后续分析需要的基本语言。',
      sourceRangeCount: 0,
    });

    expect(result.reasons).toContain('缺少课件证据说明');
  });

  it('rejects a card whose body merely repeats its title', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'formula',
      title: '复合函数 Jacobian 链式法则',
      detailedNote: '复合函数 Jacobian 链式法则',
      sourceRangeCount: 1,
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('正文只是重复卡片标题');
  });
});
