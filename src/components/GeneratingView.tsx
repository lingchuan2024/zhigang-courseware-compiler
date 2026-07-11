import { useStore } from '../store/useStore';
import type { StructureExtractionStatus } from '../types';

const STATUS_MESSAGES: Record<StructureExtractionStatus, { title: string; desc: string }> = {
  'idle': { title: '准备中', desc: '正在初始化...' },
  'extracting-topics': { title: '正在提取知识点', desc: 'AI 正在分析课件证据，识别粗粒度知识主题...' },
  'repairing-topics': { title: '正在修复提取结果', desc: '校验发现问题，AI 正在根据反馈修复主题划分...' },
  'extracting-relations': { title: '正在分析知识点关系', desc: 'AI 正在判断知识点之间的学习依赖关系...' },
  'extracting-internal-structures': { title: '正在生成内部结构', desc: 'AI 正在逐个分析知识点的内部内容结构...' },
  'ready': { title: '即将完成', desc: '结构生成完毕，正在跳转...' },
  'failed': { title: '提取失败', desc: 'AI 知识点提取失败，请检查模型配置后重试' },
  'model-required': { title: '需要配置 AI 模型', desc: '知识点提取需要 AI 模型支持，请先配置模型' },
};

export function GeneratingView() {
  const status = useStore(s => s.structureExtractionStatus);
  const errors = useStore(s => s.extractionErrors);
  const warnings = useStore(s => s.structureWarnings);
  const regenerate = useStore(s => s.regenerateKnowledgeStructure);
  const setStage = useStore(s => s.setStage);

  const msg = STATUS_MESSAGES[status] || STATUS_MESSAGES['idle'];
  const isFailed = status === 'failed';
  const isModelRequired = status === 'model-required';
  const isLoading = !isFailed && !isModelRequired;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        {isLoading && (
          <div className="w-20 h-20 mx-auto mb-6 relative">
            <div className="absolute inset-0 border-4 border-paper-dark rounded-full"></div>
            <div className="absolute inset-0 border-4 border-cinnabar border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {isFailed && (
          <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center bg-red-50 rounded-full">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}

        {isModelRequired && (
          <div className="w-20 h-20 mx-auto mb-6 flex items-center justify-center bg-amber-50 rounded-full">
            <svg className="w-10 h-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        )}

        <h2 className="font-song text-2xl font-bold text-ink mb-2">{msg.title}</h2>
        <p className="text-charcoal/60 font-mono text-sm mb-4">{msg.desc}</p>

        {/* 进度指示器 */}
        {isLoading && (
          <div className="mt-6 flex justify-center gap-1">
            <div className="w-2 h-2 bg-cinnabar rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 bg-cinnabar rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 bg-cinnabar rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        )}

        {/* 阶段步骤指示 */}
        {isLoading && (
          <div className="mt-8 flex justify-center gap-2 text-xs font-mono">
            {(['extracting-topics', 'repairing-topics', 'extracting-relations', 'extracting-internal-structures'] as StructureExtractionStatus[]).map((s, i) => {
              const isActive = status === s;
              const isPast = isLoading && false; // 简化：只高亮当前阶段
              return (
                <div
                  key={s}
                  className={`px-2 py-1 rounded ${isActive ? 'bg-cinnabar text-white' : isPast ? 'bg-celadon/20 text-celadon' : 'bg-paper-dark/30 text-charcoal/40'}`}
                >
                  {i + 1}. {STATUS_MESSAGES[s].title}
                </div>
              );
            })}
          </div>
        )}

        {/* 错误信息 */}
        {isFailed && errors.length > 0 && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded text-left">
            <h4 className="font-song text-sm font-bold text-red-800 mb-2">错误详情：</h4>
            <ul className="space-y-1">
              {errors.map((err, i) => (
                <li key={i} className="text-xs text-red-700 font-mono">• {err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 警告信息 */}
        {isLoading && warnings.length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-left max-h-32 overflow-y-auto">
            <ul className="space-y-1">
              {warnings.slice(-3).map((w, i) => (
                <li key={i} className="text-xs text-amber-700">{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 操作按钮 */}
        {(isFailed || isModelRequired) && (
          <div className="mt-6 flex justify-center gap-3">
            {isModelRequired && (
              <button
                onClick={() => setStage('parse-review')}
                className="btn-primary"
              >
                返回配置模型
              </button>
            )}
            {isFailed && (
              <>
                <button
                  onClick={() => setStage('parse-review')}
                  className="btn-outline"
                >
                  返回检查
                </button>
                <button
                  onClick={regenerate}
                  className="btn-primary"
                >
                  重新提取
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
