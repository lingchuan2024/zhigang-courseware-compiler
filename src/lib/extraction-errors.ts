/**
 * 结构化提取错误 — 替代原来 model-v2.ts 中吞掉异常后返回空结果的做法。
 *
 * 每种错误都有明确 code，UI 可以据此显示具体阶段、窗口编号和错误类型，
 * 而不是只看到"知识点为空"。
 */

export type ExtractionErrorCode =
  | 'api-timeout'          // 请求超时
  | 'api-rate-limit'       // 限流
  | 'api-network'          // 网络错误
  | 'api-http-error'       // HTTP 非 2xx
  | 'response-truncated'   // 输出被截断
  | 'json-parse-failed'    // 不是合法 JSON
  | 'json-schema-mismatch' // JSON 结构不符（缺少 topics 等字段）
  | 'evidence-filtered'    // Evidence ID 校验后全部被过滤
  | 'model-returned-empty' // 模型真的返回了空数组
  | 'unknown';             // 未知错误

export type ExtractionStage =
  | 'candidate-extraction'
  | 'local-merge'
  | 'global-merge'
  | 'quality-check'
  | 'targeted-repair'
  | 'relation-extraction'
  | 'internal-structure'
  | 'section-compile'
  | 'curriculum-review'
  | 'note-generation'
  | 'unknown';

/**
 * 结构化提取错误。
 * 携带阶段名、窗口编号（可选）和原始错误信息，
 * 让 UI 能精准展示失败位置。
 */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly stage: ExtractionStage;
  readonly windowIndex?: number;
  readonly rawResponse?: string;

  constructor(
    code: ExtractionErrorCode,
    stage: ExtractionStage,
    message: string,
    opts?: {
      windowIndex?: number;
      rawResponse?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    this.stage = stage;
    if (opts?.windowIndex !== undefined) this.windowIndex = opts.windowIndex;
    if (opts?.rawResponse !== undefined) this.rawResponse = opts.rawResponse;
    if (opts?.cause !== undefined) (this as any).cause = opts.cause;
  }

  /**
   * 用户可读的错误描述，包含阶段和窗口编号。
   */
  toUserMessage(): string {
    const stageLabels: Record<ExtractionStage, string> = {
      'candidate-extraction': '候选知识点提取',
      'local-merge': '局部合并',
      'global-merge': '全局合并',
      'quality-check': '质量检查',
      'targeted-repair': '定向修复',
      'relation-extraction': '关系提取',
      'internal-structure': '内部结构生成',
      'section-compile': '章节课程结构编译',
      'curriculum-review': '课程结构审查',
      'note-generation': '笔记生成',
      'unknown': '处理',
    };
    const codeLabels: Record<ExtractionErrorCode, string> = {
      'api-timeout': '请求超时',
      'api-rate-limit': 'API 限流',
      'api-network': '网络错误',
      'api-http-error': 'HTTP 错误',
      'response-truncated': '输出被截断',
      'json-parse-failed': 'JSON 解析失败',
      'json-schema-mismatch': '返回结构不符预期',
      'evidence-filtered': '证据 ID 校验后全部被过滤',
      'model-returned-empty': '模型返回空结果',
      'unknown': '未知错误',
    };
    const stage = stageLabels[this.stage] || this.stage;
    const code = codeLabels[this.code] || this.code;
    const window = this.windowIndex !== undefined ? `（窗口 ${this.windowIndex + 1}）` : '';
    return `${stage}${window}：${code} — ${this.message}`;
  }
}

/**
 * 从原始 fetch / JSON 错误推导结构化错误码。
 */
export function inferErrorCode(error: unknown): ExtractionErrorCode {
  if (error instanceof ExtractionError) return error.code;
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';

  if (
    name === 'TimeoutError'
    || name === 'AbortError'
    || msg.includes('timeout')
    || msg.includes('Timeout')
    || msg.includes('timed out')
    || msg.includes('AbortError')
  ) {
    return 'api-timeout';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
    return 'api-rate-limit';
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Network')) {
    return 'api-network';
  }
  if (msg.includes('JSON') || msg.includes('json') || msg.includes('parse')) {
    return 'json-parse-failed';
  }
  if (msg.includes('API ') && /\d{3}/.test(msg)) {
    return 'api-http-error';
  }
  return 'unknown';
}
