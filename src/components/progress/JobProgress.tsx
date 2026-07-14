import { useMemo } from 'react';
import type { PipelineProgress } from '../../types';
import { computeProgressPercent } from '../../lib/pipeline-progress';
import { JobStepList } from './JobStepList';

interface JobProgressProps {
  progress: PipelineProgress;
  title?: string;
  warnings?: string[];
}

export function JobProgress({ progress, title, warnings }: JobProgressProps) {
  const percent = computeProgressPercent(progress);

  const steps = useMemo(
    () => progress.steps.map(s => ({
      id: s.id,
      label: s.label,
      status: s.status,
      detail: s.detail,
    })),
    [progress.steps]
  );

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">
          {title || '正在处理'}
        </h2>
        {progress.message && (
          <p className="text-sm text-paper/60">{progress.message}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="mb-1 flex items-center justify-between text-xs text-paper/60">
          <span>
            {progress.isEstimated ? '估算进度' : '进度'}
          </span>
          <span className="tabular-nums">
            {Math.round(percent)}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-paper/10">
          <div
            className="h-full rounded-full bg-celadon transition-all duration-500 ease-out"
            style={{ width: `${Math.min(percent, 99)}%` }}
          />
        </div>

        {/* Window progress */}
        {progress.windowProgress && (
          <div className="mt-2 text-center text-xs text-paper/50">
            窗口 {progress.windowProgress.current} / {progress.windowProgress.total}
          </div>
        )}
      </div>

      {/* Current item */}
      {progress.currentItem !== undefined &&
        progress.totalItems !== undefined &&
        progress.totalItems > 0 && (
          <div className="text-center">
            <p className="text-sm text-paper/70">
              {progress.currentItem} / {progress.totalItems}
              {progress.currentItemTitle && (
                <span className="ml-2 text-celadon">
                  当前：{progress.currentItemTitle}
                </span>
              )}
            </p>
          </div>
        )}

      {/* Step list */}
      <JobStepList steps={steps} className="w-full max-w-md" />

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="w-full max-w-md rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="mb-1 text-xs font-medium text-amber-600">提示</p>
          <ul className="space-y-0.5">
            {warnings.slice(0, 3).map((w, i) => (
              <li key={i} className="text-xs text-paper/50">{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
