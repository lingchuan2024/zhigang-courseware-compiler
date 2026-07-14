import type { PipelineProgressStep } from '../../types';

interface JobStepListProps {
  steps: PipelineProgressStep[];
  className?: string;
}

/**
 * 内部步骤列表 — 显示后台任务的子步骤进度
 */
export function JobStepList({ steps, className }: JobStepListProps) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      {steps.map(step => (
        <ProgressStepItem key={step.id} step={step} />
      ))}
    </div>
  );
}

function ProgressStepItem({ step }: { step: PipelineProgressStep }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" aria-hidden="true">
        {step.status === 'completed' && (
          <svg className="w-4 h-4 text-celadon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {step.status === 'running' && (
          <span className="w-2 h-2 bg-celadon rounded-full animate-pulse-soft motion-reduce:animate-none" />
        )}
        {step.status === 'skipped' && (
          <svg className="w-4 h-4 text-charcoal/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {step.status === 'failed' && (
          <svg className="w-4 h-4 text-cinnabar" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {step.status === 'pending' && (
          <span className="w-2 h-2 bg-paper-dark rounded-full" />
        )}
        {step.status === 'blocked' && (
          <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        )}
      </span>
      <span
        className={`text-sm font-ui ${
          step.status === 'completed'
            ? 'text-charcoal/50'
            : step.status === 'running'
            ? 'text-ink font-medium'
            : step.status === 'skipped'
            ? 'text-charcoal/30'
            : step.status === 'failed'
            ? 'text-cinnabar'
            : step.status === 'blocked'
            ? 'text-amber-600'
            : 'text-charcoal/35'
        }`}
      >
        {step.label}
      </span>
      {step.detail && (
        <span className="text-xs text-charcoal/40 font-mono truncate">{step.detail}</span>
      )}
    </div>
  );
}
