// 工具函数
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeText(text: string): string {
  // 防止提示注入：移除可能的指令性内容
  return text
    .replace(/ignore\s+(previous|above|all)\s+instructions/gi, '[REDACTED_INSTRUCTION]')
    .replace(/you\s+are\s+now/gi, '[REDACTED_INSTRUCTION]')
    .replace(/system\s*prompt/gi, '[REDACTED_INSTRUCTION]')
    .trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
