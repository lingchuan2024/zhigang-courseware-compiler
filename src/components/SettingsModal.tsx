import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { MinerUConfig, ModelConfig } from '../types';
import { validateModelConfig } from '../lib/model';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_MINERU: MinerUConfig = {
  endpoint: 'https://mineru.net/api/v4',
  apiKey: '',
  modelVersion: 'vlm',
  language: 'ch',
  enableFormula: true,
  enableTable: true,
};

const DEFAULT_MODEL: ModelConfig = {
  endpoint: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const storedMinerU = useStore(state => state.mineruConfig);
  const storedModel = useStore(state => state.modelConfig);
  const setMinerUConfig = useStore(state => state.setMinerUConfig);
  const setModelConfig = useStore(state => state.setModelConfig);
  const [mineru, setMineru] = useState<MinerUConfig>(DEFAULT_MINERU);
  const [model, setModel] = useState<ModelConfig>(DEFAULT_MODEL);

  useEffect(() => {
    if (!isOpen) return;
    setMineru(storedMinerU ?? DEFAULT_MINERU);
    setModel(storedModel ?? DEFAULT_MODEL);
  }, [isOpen, storedMinerU, storedModel]);

  if (!isOpen) return null;

  const modelValidation = validateModelConfig(model.apiKey ? model : null);
  const mineruValid = Boolean(mineru.endpoint.trim() && mineru.apiKey.trim());

  const save = () => {
    setMinerUConfig(mineru.apiKey.trim() ? { ...mineru, endpoint: mineru.endpoint.trim(), apiKey: mineru.apiKey.trim() } : null);
    setModelConfig(model.apiKey.trim() ? { ...model, endpoint: model.endpoint.trim(), model: model.model.trim(), apiKey: model.apiKey.trim() } : null);
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
                <input className="config-input" value={mineru.endpoint} onChange={event => setMineru({ ...mineru, endpoint: event.target.value })} placeholder="https://mineru.net/api/v4" />
              </Field>
              <Field label="API Token">
                <input className="config-input" type="password" value={mineru.apiKey} onChange={event => setMineru({ ...mineru, apiKey: event.target.value })} placeholder="MinerU Token" autoComplete="off" />
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
            <div className="mt-4 flex gap-5 text-sm text-ink-light">
              <label className="flex items-center gap-2"><input type="checkbox" checked={mineru.enableFormula} onChange={event => setMineru({ ...mineru, enableFormula: event.target.checked })} />识别公式</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={mineru.enableTable} onChange={event => setMineru({ ...mineru, enableTable: event.target.checked })} />识别表格</label>
            </div>
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
              <Field label="API 地址">
                <input className="config-input" value={model.endpoint} onChange={event => setModel({ ...model, endpoint: event.target.value })} placeholder="https://api.deepseek.com" />
              </Field>
              <Field label="模型名称">
                <input className="config-input" value={model.model} onChange={event => setModel({ ...model, model: event.target.value })} placeholder="deepseek-chat" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="API Key">
                  <input className="config-input" type="password" value={model.apiKey} onChange={event => setModel({ ...model, apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" />
                </Field>
              </div>
            </div>
            {model.apiKey && !modelValidation.valid && modelValidation.message && (
              <p className="mt-3 rounded-lg border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-light">{modelValidation.message}</p>
            )}
          </section>

          <p className="text-xs leading-5 text-space-muted">
            API Key 仅保存在当前浏览器本机存储，不会写入项目导出内容或 Git。纯前端环境无法提供服务端级别的密钥保护，请仅在受信任设备上使用。
          </p>
        </div>

        <footer className="sticky bottom-0 flex justify-between gap-3 border-t border-space-border bg-space-850/95 px-6 py-4 backdrop-blur-xl">
          <button className="text-sm text-cinnabar hover:underline" onClick={() => { setMinerUConfig(null); setModelConfig(null); setMineru(DEFAULT_MINERU); setModel(DEFAULT_MODEL); }}>清除全部配置</button>
          <div className="flex gap-3">
            <button className="btn-outline" onClick={onClose}>取消</button>
            <button className="btn-primary" onClick={save}>保存配置</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-light">{label}</span>
      {children}
    </label>
  );
}
