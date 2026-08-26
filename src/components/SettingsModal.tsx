import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { MinerUConfig, ModelConfig } from '../types';
import { validateModelConfig } from '../lib/model';
import { getUsageSummaryByTask, resetUsageStats, type TaskUsageSummary } from '../lib/model-usage';
import {
  CUSTOM_MODEL_PROVIDER_ID,
  findModelProviderByEndpoint,
  MODEL_PROVIDER_PRESETS,
  type ModelProviderSelection,
} from '../lib/model-providers';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'default' | 'resume-mineru';
  onSaved?: (result: { mineruConfigured: boolean }) => void;
}

const DEFAULT_MINERU: MinerUConfig = {
  endpoint: 'https://mineru.net/api/v4',
  apiKey: '',
  modelVersion: 'vlm',
  language: 'ch',
  enableFormula: true,
  enableTable: true,
};

const DEFAULT_PROVIDER = MODEL_PROVIDER_PRESETS[0];

const DEFAULT_MODEL: ModelConfig = {
  endpoint: DEFAULT_PROVIDER.endpoint,
  model: DEFAULT_PROVIDER.defaultModel,
  apiKey: '',
};

const CUSTOM_PROVIDER_HINT = '使用任意 OpenAI-compatible 服务，并手动填写地址与模型名称。';

export function SettingsModal({ isOpen, onClose, mode = 'default', onSaved }: SettingsModalProps) {
  const storedMinerU = useStore(state => state.mineruConfig);
  const storedModel = useStore(state => state.modelConfig);
  const setMinerUConfig = useStore(state => state.setMinerUConfig);
  const setModelConfig = useStore(state => state.setModelConfig);
  const [mineru, setMineru] = useState<MinerUConfig>(DEFAULT_MINERU);
  const [model, setModel] = useState<ModelConfig>(DEFAULT_MODEL);
  const [selectedProviderId, setSelectedProviderId] = useState<ModelProviderSelection>(DEFAULT_PROVIDER.id);
  const [mineruError, setMineruError] = useState('');
  const [usage, setUsage] = useState<TaskUsageSummary[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setMineru(storedMinerU ?? DEFAULT_MINERU);
    const nextModel = storedModel ?? DEFAULT_MODEL;
    setModel(nextModel);
    setSelectedProviderId(findModelProviderByEndpoint(nextModel.endpoint)?.id ?? CUSTOM_MODEL_PROVIDER_ID);
    setMineruError('');
    setUsage(getUsageSummaryByTask());
  }, [isOpen, storedMinerU, storedModel]);

  if (!isOpen) return null;

  const modelValidation = validateModelConfig(model.apiKey ? model : null);
  const mineruValid = Boolean(mineru.endpoint.trim() && mineru.apiKey.trim());
  const selectedProvider = MODEL_PROVIDER_PRESETS.find(provider => provider.id === selectedProviderId);

  const selectProvider = (providerId: ModelProviderSelection) => {
    setSelectedProviderId(providerId);
    if (providerId === CUSTOM_MODEL_PROVIDER_ID) return;
    const provider = MODEL_PROVIDER_PRESETS.find(item => item.id === providerId);
    if (!provider) return;
    setModel(current => ({ ...current, endpoint: provider.endpoint, model: provider.defaultModel }));
  };

  const save = () => {
    const endpoint = mineru.endpoint.trim();
    const apiKey = mineru.apiKey.trim();
    const nextMinerU = endpoint && apiKey ? { ...mineru, endpoint, apiKey } : null;
    if (mode === 'resume-mineru' && !nextMinerU) {
      setMineruError('请填写 MinerU API 地址和 Token');
      return;
    }
    setMinerUConfig(nextMinerU);
    setModelConfig(model.apiKey.trim() ? { ...model, endpoint: model.endpoint.trim(), model: model.model.trim(), apiKey: model.apiKey.trim() } : null);
    onSaved?.({ mineruConfigured: Boolean(nextMinerU) });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-space-border-strong bg-space-850 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-space-border bg-space-850/95 px-6 py-4 backdrop-blur-xl">
          <div>
            <h2 className="font-song text-xl font-bold text-ink">服务配置</h2>
            <p className="mt-1 text-xs text-space-muted">文档解析与知识生成使用两套独立服务</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full text-xl text-space-muted hover:bg-space-750 hover:text-white" aria-label="关闭">×</button>
        </header>

        <div className="p-6 space-y-6">
          <section className="rounded-xl border border-space-border bg-space-900/70 p-5">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-celadon">01 · 文档解析</p>
                <h3 className="font-song text-lg font-bold text-ink mt-1">MinerU 精准解析 API</h3>
                <p className="mt-1 text-xs text-space-muted">上传 PDF/PPTX，异步生成 Markdown、公式和表格。</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-xs ${mineruValid ? 'border-celadon/25 bg-celadon/10 text-celadon-light' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}`}>
                {mineruValid ? '已配置' : '未配置'}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="API 地址">
                <input className="config-input" value={mineru.endpoint} onChange={event => { setMineru({ ...mineru, endpoint: event.target.value }); setMineruError(''); }} placeholder="https://mineru.net/api/v4" />
              </Field>
              <Field label="API Token">
                <input className="config-input" type="password" value={mineru.apiKey} onChange={event => { setMineru({ ...mineru, apiKey: event.target.value }); setMineruError(''); }} placeholder="MinerU Token" autoComplete="off" />
              </Field>
              <Field label="解析模型">
                <select className="config-input" value={mineru.modelVersion} onChange={event => setMineru({ ...mineru, modelVersion: event.target.value as MinerUConfig['modelVersion'] })}>
                  <option value="vlm">vlm（推荐）</option>
                  <option value="pipeline">pipeline</option>
                </select>
              </Field>
              <Field label="文档语言">
                <select className="config-input" value={mineru.language} onChange={event => setMineru({ ...mineru, language: event.target.value })}>
                  <option value="ch">中英文</option>
                  <option value="en">英文</option>
                  <option value="japan">日文</option>
                  <option value="korean">韩文</option>
                </select>
              </Field>
            </div>
            <p className="mt-3 text-xs leading-5 text-space-muted">
              没有 Token？
              <a
                href="https://mineru.net/apiManage/token"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 font-medium text-celadon-light underline decoration-celadon/40 underline-offset-4 hover:text-celadon"
              >
                免费申请 MinerU Token ↗
              </a>
              <span className="ml-1">官方当前提供每日免费高优先级解析额度，具体以官网为准。</span>
            </p>
            <div className="mt-4 flex gap-5 text-sm text-ink-light">
              <label className="flex items-center gap-2"><input type="checkbox" checked={mineru.enableFormula} onChange={event => setMineru({ ...mineru, enableFormula: event.target.checked })} />识别公式</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={mineru.enableTable} onChange={event => setMineru({ ...mineru, enableTable: event.target.checked })} />识别表格</label>
            </div>
            {mineruError && (
              <p role="alert" className="mt-3 rounded-lg border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-light">{mineruError}</p>
            )}
          </section>

          <section className="rounded-xl border border-space-border bg-space-900/70 p-5">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-cinnabar font-semibold">02 · 知识生成</p>
                <h3 className="font-song text-lg font-bold text-ink mt-1">OpenAI-compatible 模型</h3>
                <p className="mt-1 text-xs text-space-muted">用于主题提取、结构合并、学习顺序与笔记生成。</p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-xs ${model.apiKey && modelValidation.valid ? 'border-celadon/25 bg-celadon/10 text-celadon-light' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}`}>
                {model.apiKey && modelValidation.valid ? '已配置' : '未配置'}
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="API 平台">
                  <select
                    className="config-input"
                    aria-label="API 平台"
                    aria-describedby="model-provider-hint"
                    value={selectedProviderId}
                    onChange={event => selectProvider(event.target.value as ModelProviderSelection)}
                  >
                    {MODEL_PROVIDER_PRESETS.map(provider => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                    <option value={CUSTOM_MODEL_PROVIDER_ID}>自定义</option>
                  </select>
                </Field>
                <p id="model-provider-hint" className="mt-1.5 text-xs text-space-muted">{selectedProvider?.hint ?? CUSTOM_PROVIDER_HINT}</p>
              </div>
              <Field label="API 地址">
                <input
                  className="config-input"
                  aria-label="知识生成 API 地址"
                  value={model.endpoint}
                  onChange={event => {
                    const endpoint = event.target.value;
                    setModel({ ...model, endpoint });
                    setSelectedProviderId(findModelProviderByEndpoint(endpoint)?.id ?? CUSTOM_MODEL_PROVIDER_ID);
                  }}
                  placeholder="https://api.deepseek.com"
                />
              </Field>
              <Field label="模型名称">
                <input className="config-input" aria-label="知识生成模型名称" value={model.model} onChange={event => setModel({ ...model, model: event.target.value })} placeholder="deepseek-v4-flash" />
              </Field>
              <div className="sm:col-span-2">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <label htmlFor="knowledge-model-api-key" className="text-xs font-medium text-ink-light">API Key</label>
                  {selectedProvider ? (
                    <a
                      href={selectedProvider.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="model-api-key-link"
                      className="text-xs font-medium text-celadon-light underline decoration-celadon/40 underline-offset-4 hover:text-celadon"
                    >
                      前往{selectedProvider.label}获取 API Key ↗
                    </a>
                  ) : (
                    <span className="text-xs text-space-muted">请前往服务商控制台获取 API Key</span>
                  )}
                </div>
                <input id="knowledge-model-api-key" className="config-input" type="password" value={model.apiKey} onChange={event => setModel({ ...model, apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
              </div>
            </div>
            {model.apiKey && !modelValidation.valid && modelValidation.message && (
              <p className="mt-3 rounded-lg border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-light">{modelValidation.message}</p>
            )}

            <div className="mt-5 rounded-lg border border-space-border bg-space-850/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-wide text-ink-light">模型用量（本机累计）</p>
                {usage.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-space-muted hover:text-cinnabar"
                    onClick={() => { resetUsageStats(); setUsage([]); }}
                    data-testid="reset-usage"
                  >
                    清空统计
                  </button>
                )}
              </div>
              {usage.length === 0 ? (
                <p className="mt-2 text-xs text-space-faint">尚无调用记录。生成知识结构与笔记后，这里会按任务统计 tokens 与耗时。</p>
              ) : (
                <ul className="mt-2 space-y-1.5" data-testid="usage-list">
                  {usage.map(item => (
                    <li key={`${item.taskType}-${item.callCount}`} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-space-muted">{TASK_LABELS[item.taskType] ?? item.taskType} · {item.callCount} 次</span>
                      <span className="font-mono text-space-faint">
                        {(item.totalPromptTokens + item.totalCompletionTokens).toLocaleString()} tokens · {(item.totalDurationMs / 1000).toFixed(1)}s
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <p className="text-xs leading-5 text-space-muted">
            API Key 仅保存在当前浏览器本机存储，不会写入项目导出内容或 Git。纯前端环境无法提供服务端级别的密钥保护，请仅在受信任设备上使用。
          </p>
        </div>

        <footer className="sticky bottom-0 flex justify-between gap-3 border-t border-space-border bg-space-850/95 px-6 py-4 backdrop-blur-xl">
          <button className="text-sm text-cinnabar hover:underline" onClick={() => { setMinerUConfig(null); setModelConfig(null); setMineru(DEFAULT_MINERU); setModel(DEFAULT_MODEL); setSelectedProviderId(DEFAULT_PROVIDER.id); }}>清除全部配置</button>
          <div className="flex gap-3">
            <button className="btn-outline" onClick={onClose}>取消</button>
            <button className="btn-primary" onClick={save}>{mode === 'resume-mineru' ? '保存并开始解析' : '保存配置'}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const TASK_LABELS: Record<string, string> = {
  'topic-extraction': '主题提取',
  'topic-repair': '主题修复',
  'relation-extraction': '关系提取',
  'internal-structure': '内部结构',
  'note-generation': '笔记生成',
  'note-repair': '笔记重试',
  'topic-merge': '主题合并',
  'topic-candidate-extraction': '候选提取',
  'topic-granularity-judgment': '粒度判定',
  'topic-quality-repair': '质量修复',
  'query-rewrite': '查询改写',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-light">{label}</span>
      {children}
    </label>
  );
}
