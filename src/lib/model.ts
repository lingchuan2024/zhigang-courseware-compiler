import { ModelConfig } from '../types';

// 验证模型配置是否可用
export function validateModelConfig(config: ModelConfig | null): { valid: boolean; message?: string } {
  if (!config) {
    return { valid: false, message: '未配置模型' };
  }
  if (!config.endpoint) {
    return { valid: false, message: '请输入API端点' };
  }
  if (!config.model) {
    return { valid: false, message: '请输入模型名称' };
  }
  if (!config.apiKey) {
    return { valid: false, message: '请输入API Key' };
  }
  try {
    if (config.endpoint.startsWith('/')) {
      if (!config.endpoint.startsWith('/api/')) throw new Error('Unsupported relative endpoint');
    } else {
      new URL(config.endpoint);
    }
  } catch {
    return { valid: false, message: 'API端点格式无效' };
  }
  return { valid: true };
}
