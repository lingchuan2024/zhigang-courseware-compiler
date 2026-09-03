function hash(input: string): string {
  let value = 5381;
  for (let index = 0; index < input.length; index += 1) {
    value = ((value << 5) + value + input.charCodeAt(index)) | 0;
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function normalizeStableText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function evidenceStableKey(
  documentId: string,
  blockContentHash: string,
  startOffset: number,
  endOffset: number,
  quote: string,
): string {
  return `ev_${hash([
    documentId,
    blockContentHash,
    startOffset,
    endOffset,
    normalizeStableText(quote),
  ].join('|'))}`;
}

export function topicStableKey(
  courseId: string,
  name: string,
  confirmedAliases: string[],
  coreEvidenceKey: string,
): string {
  const aliases = [...confirmedAliases].map(normalizeStableText).sort().join(',');
  return `topic_${hash([courseId, normalizeStableText(name), aliases, coreEvidenceKey].join('|'))}`;
}

export function teachingUnitStableKey(
  topicKey: string,
  role: string,
  coreEvidenceKey: string,
): string {
  return `unit_${hash([topicKey, role, coreEvidenceKey].join('|'))}`;
}

export function constraintStableKey(
  beforeTopicId: string,
  afterTopicId: string,
  strength: string,
): string {
  return `order_${hash([beforeTopicId, afterTopicId, strength].join('|'))}`;
}
