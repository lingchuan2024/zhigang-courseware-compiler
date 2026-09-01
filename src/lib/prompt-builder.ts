// ========== Compiled Prompt Structure ==========
// v6 管线各模块自带提示词文本；此文件只保留统一的编译产物契约。

export interface CompiledPrompt {
  system: string;
  stablePrefix: string;
  dynamicInput: string;
  promptVersion: string;
  /** 任务级输出上限；未指定时使用通用默认值。 */
  maxOutputTokens?: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}
