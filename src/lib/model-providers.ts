import type { ModelApiMode } from '../types';

export type ModelProviderId =
  | 'deepseek'
  | 'aliyun-bailian'
  | 'modelark'
  | 'zhipu'
  | 'kimi'
  | 'volcengine-ark'
  | 'volcengine-agent-plan'
  | 'siliconflow'
  | 'openai'
  | 'openrouter';

export const CUSTOM_MODEL_PROVIDER_ID = 'custom' as const;

export type ModelProviderSelection = ModelProviderId | typeof CUSTOM_MODEL_PROVIDER_ID;

export interface ModelProviderPreset {
  readonly id: ModelProviderId;
  readonly label: string;
  readonly endpoint: string;
  readonly defaultModel: string;
  readonly apiMode: ModelApiMode;
  readonly apiKeyUrl: string;
  readonly hint: string;
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '默认使用 DeepSeek V4 Flash；模型名称仍可手动修改。',
  },
  {
    id: 'aliyun-bailian',
    label: '阿里云百炼',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    hint: '默认使用中国大陆兼容地址；工作空间专属地址可手动覆盖。',
  },
  {
    id: 'modelark',
    label: '模力方舟（Gitee AI）',
    endpoint: 'https://ai.gitee.com/v1',
    defaultModel: 'GLM-5',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://ai.gitee.com/products/apis',
    hint: '登录模力方舟后可进入 Serverless API 控制台获取密钥。',
  },
  {
    id: 'zhipu',
    label: '智谱 BigModel',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.2',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    hint: '默认使用智谱通用 OpenAI-compatible API。',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    hint: '默认使用 Kimi 当前通用模型；可按控制台模型列表修改。',
  },
  {
    id: 'volcengine-ark',
    label: '火山方舟',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    hint: '默认使用北京地域 API；其他地域或接入点可手动覆盖。',
  },
  {
    id: 'volcengine-agent-plan',
    label: '火山方舟 Agent Plan',
    endpoint: '/api/ark-agent-plan/v3',
    defaultModel: 'glm-5-3-flash-260901',
    apiMode: 'responses',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    hint: '使用 Agent Plan 专属 Token 与 Responses API；请保留同源代理地址。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '模型标识以硅基流动模型广场为准，可随时手动修改。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    hint: '默认使用成本较低的 GPT-5 mini，模型名称可手动修改。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    defaultModel: '~openai/gpt-latest',
    apiMode: 'chat-completions',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    hint: 'OpenRouter 支持多家模型；可把模型名称改为任意有效 slug。',
  },
];

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

export function findModelProviderByEndpoint(endpoint: string): ModelProviderPreset | undefined {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return undefined;
  return MODEL_PROVIDER_PRESETS.find(provider => normalizeEndpoint(provider.endpoint) === normalized);
}
