export interface KnowledgeCardDraftQualityInput {
  teachingType: string;
  title?: string;
  detailedNote: string;
  sourceRangeCount: number;
}

export interface KnowledgeCardQualityResult {
  accepted: boolean;
  reasons: string[];
}

const PLACEHOLDER_PATTERNS = [
  /可能包含/,
  /可能包括/,
  /可从以下方面/,
  /可以介绍/,
  /等对比信息/,
];

function isDerivation(type: string): boolean {
  return /derivation|推导|formula-system/i.test(type);
}

function isComparison(type: string): boolean {
  return /comparison|对比|分类/i.test(type);
}

export function evaluateKnowledgeCardDraft(
  input: KnowledgeCardDraftQualityInput,
): KnowledgeCardQualityResult {
  const text = input.detailedNote.trim();
  const reasons: string[] = [];
  const normalizedText = text.replace(/[-#>*_`\s：:。！？!?，,；;（）()]/g, '').toLowerCase();
  const normalizedTitle = (input.title ?? '')
    .replace(/[-#>*_`\s：:。！？!?，,；;（）()]/g, '')
    .toLowerCase();

  if (text.length < 120) reasons.push('正文过短，尚未形成可独立学习的讲解');
  if (normalizedTitle && normalizedText === normalizedTitle) reasons.push('正文只是重复卡片标题');
  if (PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text))) {
    reasons.push('正文包含空泛占位表达');
  }
  if (input.sourceRangeCount === 0 && !text.includes('证据不足')) {
    reasons.push('缺少课件证据说明');
  }

  if (isDerivation(input.teachingType)) {
    const stepSignals = text.match(/(?:步骤\s*\d+|第[一二三四五六七八九十]+步|\n\s*\d+[.、)])/g) ?? [];
    if (stepSignals.length < 2) reasons.push('推导缺少可检查的连续步骤');
  }

  if (isComparison(input.teachingType)) {
    const tableRows = text.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    if (tableRows.length < 4) reasons.push('对比缺少明确对象和比较维度');
  }

  return { accepted: reasons.length === 0, reasons };
}
