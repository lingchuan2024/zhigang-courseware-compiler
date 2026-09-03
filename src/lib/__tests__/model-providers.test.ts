import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_PROVIDER_ID,
  MODEL_PROVIDER_PRESETS,
  findModelProviderByEndpoint,
} from '../model-providers';

const assertProviderPresetsAreImmutable = (): void => {
  // @ts-expect-error provider presets are immutable
  MODEL_PROVIDER_PRESETS[0].endpoint = 'https://mutated.example.com';
};
void assertProviderPresetsAreImmutable;

const approvedPresets = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'aliyun-bailian',
    label: '阿里云百炼',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
  },
  {
    id: 'modelark',
    label: '模力方舟（Gitee AI）',
    endpoint: 'https://ai.gitee.com/v1',
    defaultModel: 'GLM-5',
    apiKeyUrl: 'https://ai.gitee.com/products/apis',
  },
  {
    id: 'zhipu',
    label: '智谱 BigModel',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.2',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
  },
  {
    id: 'volcengine-ark',
    label: '火山方舟',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
  },
  {
    id: 'volcengine-agent-plan',
    label: '火山方舟 Agent Plan',
    endpoint: '/api/ark-agent-plan/v3',
    defaultModel: 'glm-5-3-flash-260901',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    defaultModel: '~openai/gpt-latest',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
  },
] as const;

describe('model provider presets', () => {
  it('keeps providers in the stable settings order', () => {
    expect(MODEL_PROVIDER_PRESETS.map(provider => provider.id)).toEqual([
      'deepseek',
      'aliyun-bailian',
      'modelark',
      'zhipu',
      'kimi',
      'volcengine-ark',
      'volcengine-agent-plan',
      'siliconflow',
      'openai',
      'openrouter',
    ]);
  });

  it('reserves custom for a user-defined provider', () => {
    expect(CUSTOM_MODEL_PROVIDER_ID).toBe('custom');
  });

  it.each(approvedPresets)('keeps approved data for $id', expected => {
    const preset = MODEL_PROVIDER_PRESETS.find(provider => provider.id === expected.id);
    expect(preset).toBeDefined();
    if (!preset) return;

    expect(preset).toMatchObject(expected);
    expect(Object.values(preset).every(value => value.trim().length > 0)).toBe(true);
    if (preset.id === 'volcengine-agent-plan') {
      expect(preset.endpoint).toBe('/api/ark-agent-plan/v3');
      expect(preset.apiMode).toBe('responses');
    } else {
      expect(preset.endpoint).toMatch(/^https:\/\//);
      expect(preset.apiMode).toBe('chat-completions');
    }
    expect(preset.apiKeyUrl).toMatch(/^https:\/\//);
  });

  it('matches endpoints after trimming, slash removal, and case folding', () => {
    expect(findModelProviderByEndpoint('  https://api.deepseek.com///  ')?.id).toBe('deepseek');
    expect(findModelProviderByEndpoint('HTTPS://AI.GITEE.COM/v1/')?.id).toBe('modelark');
  });

  it('returns undefined for unknown and empty endpoints', () => {
    expect(findModelProviderByEndpoint('https://models.example.com/v1')).toBeUndefined();
    expect(findModelProviderByEndpoint('')).toBeUndefined();
  });
});
