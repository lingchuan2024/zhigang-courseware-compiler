import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { ModelConfig } from '../types';
import { validateModelConfig } from '../lib/model';
import {
  getUsageSummaryByTask,
  getUsageRecords,
  clearUsageRecords,
  type TaskUsageSummary,
} from '../lib/model-usage';

const TASK_LABELS: Record<string, string> = {
  'topic-extraction': '主题提取',
  'topic-repair': '主题修复',
  'relation-extraction': '宏观关系',
  'internal-structure': '内部结构',
  'note-generation': '笔记生成',
  'note-repair': '笔记修复',
  'topic-merge': '主题合并',
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const modelConfig = useStore(s => s.modelConfig);
  const setModelConfig = useStore(s => s.setModelConfig);

  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [validation, setValidation] = useState<{ valid: boolean; message?: string }>({ valid: false });
  const [summaries, setSummaries] = useState<TaskUsageSummary[]>([]);
  const [recordCount, setRecordCount] = useState(0);

  useEffect(() => {
    if (modelConfig) {
      setEndpoint(modelConfig.endpoint);
      setModel(modelConfig.model);
      setApiKey(modelConfig.apiKey);
    }
  }, [modelConfig, isOpen]);

  useEffect(() => {
    const config: ModelConfig = { endpoint, model, apiKey };
    setValidation(validateModelConfig(apiKey ? config : null));
  }, [endpoint, model, apiKey]);

  const refreshStats = useCallback(() => {
    setSummaries(getUsageSummaryByTask());
    setRecordCount(getUsageRecords().length);
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshStats();
    }
  }, [isOpen, refreshStats]);

  const handleSave = () => {
    if (apiKey) {
      setModelConfig({ endpoint, model, apiKey });
    } else {
      setModelConfig(null);
    }
    onClose();
  };

  const handleClear = () => {
    setApiKey('');
    setModelConfig(null);
  };

  const handleClearStats = () => {
    clearUsageRecords();
    refreshStats();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-song text-xl font-bold text-ink">模型配置</h2>
            <button
              onClick={onClose}
              className="text-charcoal/40 hover:text-charcoal text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-charcoal/70 mb-4">
                配置 OpenAI 兼容的 API 端点。不配置模型时将使用本地规则生成笔记。
                <strong className="text-cinnabar"> API Key 仅保存在浏览器内存中，刷新页面后需要重新输入。</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-mono text-ink mb-1">API 端点</label>
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 border border-paper-dark rounded focus:outline-none focus:border-celadon"
              />
              <p className="text-xs text-charcoal/50 mt-1">
                支持 OpenAI、Azure OpenAI、本地 Ollama 等兼容接口
              </p>
            </div>

            <div>
              <label className="block text-sm font-mono text-ink mb-1">模型名称</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
                className="w-full px-3 py-2 border border-paper-dark rounded focus:outline-none focus:border-celadon"
              />
            </div>

            <div>
              <label className="block text-sm font-mono text-ink mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-paper-dark rounded focus:outline-none focus:border-celadon"
              />
              <p className="text-xs text-charcoal/50 mt-1">
                留空则使用本地确定性方法生成，无需联网
              </p>
            </div>

            {apiKey && !validation.valid && validation.message && (
              <div className="p-3 bg-cinnabar/10 border border-cinnabar/30 rounded text-cinnabar text-sm">
                {validation.message}
              </div>
            )}

            {!apiKey && (
              <div className="p-3 bg-celadon/10 border border-celadon/30 rounded text-celadon-dark text-sm">
                当前将使用本地规则生成笔记。所有内容基于课件证据，无需调用模型。
              </div>
            )}
          </div>

          {/* Cache Statistics */}
          {recordCount > 0 && (
            <div className="mt-6 pt-4 border-t border-stone-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-stone-700">
                  缓存统计
                  <span className="ml-2 text-xs font-normal text-stone-400">
                    （{recordCount} 次调用）
                  </span>
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={refreshStats}
                    className="text-xs px-2 py-1 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors"
                  >
                    刷新
                  </button>
                  <button
                    onClick={handleClearStats}
                    className="text-xs px-2 py-1 text-stone-400 hover:text-cinnabar hover:bg-cinnabar/5 rounded transition-colors"
                  >
                    清除
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {summaries.map(s => {
                  const rateStr = s.overallCacheHitRate !== undefined
                    ? `${(s.overallCacheHitRate * 100).toFixed(1)}%`
                    : 'N/A';
                  const hasCacheData = s.totalCacheHitTokens > 0 || s.totalCacheMissTokens > 0;
                  return (
                    <div
                      key={s.taskType}
                      className="flex items-center justify-between text-xs py-1.5 px-2 bg-stone-50 rounded"
                    >
                      <span className="font-medium text-stone-600">
                        {TASK_LABELS[s.taskType] || s.taskType}
                      </span>
                      <div className="flex items-center gap-3 text-stone-500">
                        <span>{s.callCount}次</span>
                        {hasCacheData ? (
                          <>
                            <span className="text-green-600">
                              命中 {s.totalCacheHitTokens.toLocaleString()}
                            </span>
                            <span className="text-amber-600">
                              未命中 {s.totalCacheMissTokens.toLocaleString()}
                            </span>
                            <span className={`font-medium ${
                              s.overallCacheHitRate !== undefined && s.overallCacheHitRate > 0.3
                                ? 'text-green-600'
                                : 'text-stone-500'
                            }`}>
                              {rateStr}
                            </span>
                          </>
                        ) : (
                          <span className="text-stone-400">无缓存数据</span>
                        )}
                        <span className="text-stone-400">
                          {(s.totalDurationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-stone-400 mt-2">
                缓存为 best-effort。主题提取和宏观关系通常只有一次调用，低命中属正常。
                优化重点是逐知识点内部结构提取和笔记生成。
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-6 justify-end">
            {modelConfig?.apiKey && (
              <button
                onClick={handleClear}
                className="btn-outline text-cinnabar border-cinnabar/50 hover:bg-cinnabar/10"
              >
                清除配置
              </button>
            )}
            <button
              onClick={onClose}
              className="btn-outline"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="btn-primary"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
