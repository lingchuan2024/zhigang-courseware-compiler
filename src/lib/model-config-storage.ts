import type { MinerUConfig, ModelConfig } from '../types';

const MODEL_CONFIG_STORAGE_KEY = 'zhigang_model_config';
const MINERU_CONFIG_STORAGE_KEY = 'zhigang_mineru_config';

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelConfig>;
  return typeof candidate.endpoint === 'string'
    && candidate.endpoint.length > 0
    && typeof candidate.model === 'string'
    && candidate.model.length > 0
    && typeof candidate.apiKey === 'string'
    && candidate.apiKey.length > 0
    && (candidate.apiMode === undefined
      || candidate.apiMode === 'chat-completions'
      || candidate.apiMode === 'responses');
}

export function saveStoredModelConfig(config: ModelConfig): void {
  localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function loadStoredModelConfig(): ModelConfig | null {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isModelConfig(parsed)
      ? { ...parsed, apiMode: parsed.apiMode ?? 'chat-completions' }
      : null;
  } catch {
    return null;
  }
}

export function clearStoredModelConfig(): void {
  localStorage.removeItem(MODEL_CONFIG_STORAGE_KEY);
}

function isMinerUConfig(value: unknown): value is MinerUConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MinerUConfig>;
  return typeof candidate.endpoint === 'string'
    && candidate.endpoint.length > 0
    && typeof candidate.apiKey === 'string'
    && candidate.apiKey.length > 0
    && (candidate.modelVersion === 'pipeline' || candidate.modelVersion === 'vlm')
    && typeof candidate.language === 'string'
    && typeof candidate.enableFormula === 'boolean'
    && typeof candidate.enableTable === 'boolean';
}

export function saveStoredMinerUConfig(config: MinerUConfig): void {
  localStorage.setItem(MINERU_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function loadStoredMinerUConfig(): MinerUConfig | null {
  try {
    const raw = localStorage.getItem(MINERU_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isMinerUConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStoredMinerUConfig(): void {
  localStorage.removeItem(MINERU_CONFIG_STORAGE_KEY);
}
