import { EvidenceType } from '../../types';

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, { label: string; color: string; bgColor: string }> = {
  title: { label: '标题', color: 'text-cinnabar', bgColor: 'bg-cinnabar/10' },
  definition: { label: '定义', color: 'text-celadon', bgColor: 'bg-celadon/10' },
  formula: { label: '公式', color: 'text-ink', bgColor: 'bg-ink/10' },
  derivation: { label: '推导', color: 'text-indigo-300', bgColor: 'bg-indigo-400/10' },
  conclusion: { label: '结论', color: 'text-teal-300', bgColor: 'bg-teal-400/10' },
  example: { label: '示例', color: 'text-amber-300', bgColor: 'bg-amber-400/10' },
  procedure: { label: '步骤', color: 'text-purple-300', bgColor: 'bg-purple-400/10' },
  comparison: { label: '比较', color: 'text-blue-300', bgColor: 'bg-blue-400/10' },
  chart: { label: '图表', color: 'text-pink-300', bgColor: 'bg-pink-400/10' },
  assumption: { label: '假设', color: 'text-orange-300', bgColor: 'bg-orange-400/10' },
  condition: { label: '条件', color: 'text-lime-300', bgColor: 'bg-lime-400/10' },
  text: { label: '文本', color: 'text-space-muted', bgColor: 'bg-space-750' },
};

export const EVIDENCE_TYPE_LIST: EvidenceType[] = [
  'title', 'definition', 'formula', 'derivation', 'conclusion',
  'example', 'procedure', 'comparison', 'chart', 'assumption', 'condition', 'text',
];
