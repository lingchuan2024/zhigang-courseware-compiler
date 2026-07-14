import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredModelConfig,
  clearStoredMinerUConfig,
  loadStoredModelConfig,
  loadStoredMinerUConfig,
  saveStoredModelConfig,
  saveStoredMinerUConfig,
} from '../model-config-storage';

const values = new Map<string, string>();
const storageMock: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: key => values.get(key) ?? null,
  key: index => [...values.keys()][index] ?? null,
  removeItem: key => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  configurable: true,
});

describe('local model configuration storage', () => {
  beforeEach(() => localStorage.clear());

  it('restores a saved compatible model configuration after reload', () => {
    saveStoredModelConfig({
      endpoint: 'https://api.example.com',
      model: 'example-chat',
      apiKey: 'test-secret',
    });

    expect(loadStoredModelConfig()).toEqual({
      endpoint: 'https://api.example.com',
      model: 'example-chat',
      apiKey: 'test-secret',
    });
  });

  it('removes the saved configuration only when explicitly cleared', () => {
    saveStoredModelConfig({ endpoint: 'https://api.example.com', model: 'm', apiKey: 'k' });
    clearStoredModelConfig();
    expect(loadStoredModelConfig()).toBeNull();
  });

  it('rejects malformed stored data', () => {
    localStorage.setItem('zhigang_model_config', '{bad json');
    expect(loadStoredModelConfig()).toBeNull();
  });

  it('stores MinerU credentials independently from the knowledge model', () => {
    saveStoredMinerUConfig({
      endpoint: 'https://mineru.net/api/v4',
      apiKey: 'mineru-token',
      modelVersion: 'vlm',
      language: 'ch',
      enableFormula: true,
      enableTable: true,
    });
    saveStoredModelConfig({ endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'deepseek-key' });

    expect(loadStoredMinerUConfig()?.apiKey).toBe('mineru-token');
    expect(loadStoredModelConfig()?.apiKey).toBe('deepseek-key');

    clearStoredMinerUConfig();
    expect(loadStoredMinerUConfig()).toBeNull();
    expect(loadStoredModelConfig()?.apiKey).toBe('deepseek-key');
  });
});
