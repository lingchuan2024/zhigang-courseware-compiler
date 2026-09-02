// ========== Compiled Prompt Structure ==========
// v6 管线各模块自带提示词文本；此文件只保留统一的编译产物契约。

export interface CompiledPrompt {
  system: string;
  stablePrefix: string;
  dynamicInput: string;
  promptVersion: string;
  /** 任务级输出上限；未指定时使用通用默认值。 */
  maxOutputTokens?: number;
  /** Responses API 的思考强度；结构化抽取使用 minimal 直接生成答案。 */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** 结构化输出尝试次数；前台轻量提取使用 1，避免重放长请求。 */
  maxStructuredAttempts?: number;
  /** 传输请求总尝试次数；前台轻量提取使用 1，避免 429/5xx 后重复等待。 */
  maxTransportAttempts?: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}
