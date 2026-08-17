// ========== Compiled Prompt Structure ==========
// v6 管线各模块自带提示词文本；此文件只保留统一的编译产物契约。

export interface CompiledPrompt {
  system: string;
  stablePrefix: string;
  dynamicInput: string;
  promptVersion: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}
