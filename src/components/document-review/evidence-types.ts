import { EvidenceType } from '../../types';

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, { label: string; color: string; bgColor: string }> = {
  title: { label: '标题', color: 'text-cinnabar', bgColor: 'bg-cinnabar/10' },
  definition: { label: '定义', color: 'text-celadon', bgColor: 'bg-celadon/10' },
  formula: { label: '公式', color: 'text-ink', bgColor: 'bg-ink/10' },
  derivation: { label: '推导', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  conclusion: { label: '结论', color: 'text-teal-600', bgColor: 'bg-teal-50' },
  example: { label: '示例', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  procedure: { label: '步骤', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  comparison: { label: '比较', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  chart: { label: '图表', color: 'text-pink-600', bgColor: 'bg-pink-50' },
  assumption: { label: '假设', color: 'text-orange-600', bgColor: 'bg-orange-50' },
  condition: { label: '条件', color: 'text-lime-600', bgColor: 'bg-lime-50' },
  text: { label: '文本', color: 'text-stone-500', bgColor: 'bg-stone-100' },
};

export const EVIDENCE_TYPE_LIST: EvidenceType[] = [
  'title', 'definition', 'formula', 'derivation', 'conclusion',
  'example', 'procedure', 'comparison', 'chart', 'assumption', 'condition', 'text',
];
