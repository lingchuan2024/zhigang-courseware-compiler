import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_PROVIDER_ID,
  MODEL_PROVIDER_PRESETS,
  findModelProviderByEndpoint,
} from '../model-providers';

describe('model provider presets', () => {
  it('keeps providers in the stable settings order', () => {
    expect(MODEL_PROVIDER_PRESETS.map(provider => provider.id)).toEqual([
      'deepseek',
      'aliyun-bailian',
      'modelark',
      'zhipu',
      'kimi',
      'volcengine-ark',
      'siliconflow',
      'openai',
      'openrouter',
    ]);
  });

  it('reserves custom for a user-defined provider', () => {
    expect(CUSTOM_MODEL_PROVIDER_ID).toBe('custom');
  });

  it('uses the current DeepSeek and ModelArk defaults', () => {
    expect(MODEL_PROVIDER_PRESETS.find(provider => provider.id === 'modelark')).toMatchObject({
      label: '模力方舟（Gitee AI）',
      endpoint: 'https://ai.gitee.com/v1',
      defaultModel: 'GLM-5',
      apiKeyUrl: 'https://ai.gitee.com/products/apis',
    });

    expect(MODEL_PROVIDER_PRESETS.find(provider => provider.id === 'deepseek')).toMatchObject({
      endpoint: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
    });
    expect(MODEL_PROVIDER_PRESETS.find(provider => provider.id === 'deepseek')?.defaultModel).not.toBe('deepseek-chat');
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
