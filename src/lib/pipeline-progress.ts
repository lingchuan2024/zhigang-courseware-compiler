import {
  PipelineProgress,
  PipelineProgressStep,
  ProgressStepStatus,
  StructureExtractionStatus,
  WorkflowStage,
} from '../types';
import type { CourseExtractionProgress } from './course-structure/types';

// ========== 常量 ==========

export const STRUCTURE_EXTRACTION_STEPS: PipelineProgressStep[] = [
  { id: 'prepare-evidence', label: '准备证据', status: 'pending' },
  { id: 'extract-two-layer', label: '识别两层知识', status: 'pending' },
  { id: 'compile-course', label: '合并知识点与学习顺序', status: 'pending' },
  { id: 'validate-structure', label: '校验课程结构', status: 'pending' },
];

export const NOTE_GENERATION_STEPS: PipelineProgressStep[] = [
  { id: 'prepare-packages', label: '准备知识包', status: 'pending' },
  { id: 'extract-internal', label: '生成知识点内部结构', status: 'pending' },
  { id: 'generate-notes', label: '逐知识点生成笔记', status: 'pending' },
  { id: 'assemble-master', label: '组装课程母笔记', status: 'pending' },
];

export const IDLE_PROGRESS: PipelineProgress = {
  operation: null,
  status: 'idle',
  steps: [],
};

// ========== 阶段进度范围映射 ==========

/**
 * 每个阶段对应的进度范围 [下限, 上限]。
 * 估算进度只会在当前阶段范围内缓慢上涨，
 * 进入下一阶段时纠正到真实下限。
 */
export const STAGE_PROGRESS_RANGES: Record<string, [number, number]> = {
  'prepare-evidence': [1, 5],
  'extract-two-layer': [5, 75],
  'compile-course': [75, 90],
  'validate-structure': [90, 99],
  // 笔记生成
  'prepare-packages': [1, 5],
  'generate-notes': [5, 95],
  'assemble-master': [95, 99],
};

// ========== 工厂函数 ==========

export function createStructureExtractionProgress(): PipelineProgress {
  return {
    operation: 'extract-structure',
    status: 'running',
    steps: STRUCTURE_EXTRACTION_STEPS.map(s => ({ ...s })),
    estimatedProgress: 2,
    isEstimated: true,
  };
}

export function createNoteGenerationProgress(totalTopics: number): PipelineProgress {
  return {
    operation: 'generate-notes',
    status: 'running',
    steps: NOTE_GENERATION_STEPS.map(s => ({ ...s })),
    currentItem: 0,
    totalItems: totalTopics,
    currentItemTitle: undefined,
    estimatedProgress: 2,
    isEstimated: true,
  };
}

// ========== 更新辅助 ==========

export function updateProgressStep(
  progress: PipelineProgress,
  stepId: string,
  status: ProgressStepStatus,
  detail?: string
): PipelineProgress {
  const range = STAGE_PROGRESS_RANGES[stepId];
  const newProgress = {
    ...progress,
    steps: progress.steps.map(s =>
      s.id === stepId ? { ...s, status, detail } : s
    ),
  };

  // 进入新阶段时，把估算进度纠正到该阶段下限
  if (status === 'running' && range) {
    newProgress.estimatedProgress = range[0];
    newProgress.isEstimated = true;
  }

  // 完成阶段时，把估算进度设到该阶段上限
  if (status === 'completed' && range) {
    newProgress.estimatedProgress = range[1];
  }

  return newProgress;
}

export function completeProgressStep(
  progress: PipelineProgress,
  stepId: string
): PipelineProgress {
  return updateProgressStep(progress, stepId, 'completed');
}

export function failProgressStep(
  progress: PipelineProgress,
  stepId: string,
  detail?: string
): PipelineProgress {
  return {
    ...progress,
    status: 'failed',
    steps: progress.steps.map(s =>
      s.id === stepId ? { ...s, status: 'failed', detail } : s
    ),
  };
}

export function skipProgressStep(
  progress: PipelineProgress,
  stepId: string
): PipelineProgress {
  return updateProgressStep(progress, stepId, 'skipped');
}

export function blockProgress(
  progress: PipelineProgress,
  message: string
): PipelineProgress {
  return {
    ...progress,
    status: 'blocked',
    message,
  };
}

export function completeProgress(progress: PipelineProgress): PipelineProgress {
  return {
    ...progress,
    status: 'completed',
    steps: progress.steps.map(s =>
      s.status === 'running' ? { ...s, status: 'completed' } : s
    ),
    estimatedProgress: 100,
    isEstimated: false,
  };
}

export function failProgress(progress: PipelineProgress, message: string): PipelineProgress {
  return {
    ...progress,
    status: 'failed',
    message,
    // 失败时保留当前估算进度，不归零
  };
}

/**
 * 带失败阶段信息的 failProgress。
 */
export function failProgressWithStage(
  progress: PipelineProgress,
  message: string,
  failedStage: string,
  failedWindowIndex?: number,
): PipelineProgress {
  return {
    ...progress,
    status: 'failed',
    message,
    failedStage,
    failedWindowIndex,
  };
}

export function updateCurrentItem(
  progress: PipelineProgress,
  currentItem: number,
  totalItems: number,
  currentItemTitle: string
): PipelineProgress {
  const noteRange = STAGE_PROGRESS_RANGES['generate-notes'];
  const ratio = totalItems > 0 ? Math.max(0, Math.min(1, currentItem / totalItems)) : 0;
  const estimatedProgress = progress.operation === 'generate-notes' && noteRange
    ? Math.round((noteRange[0] + (noteRange[1] - noteRange[0]) * ratio) * 10) / 10
    : progress.estimatedProgress;

  return {
    ...progress,
    currentItem,
    totalItems,
    currentItemTitle,
    estimatedProgress,
    isEstimated: progress.operation === 'generate-notes' ? false : progress.isEstimated,
  };
}

/**
 * 更新窗口进度（分窗口提取时使用）。
 * 语义提取单元完成数量驱动 5%~75% 的真实进度。
 */
export function updateWindowProgress(
  progress: PipelineProgress,
  current: number,
  total: number,
): PipelineProgress {
  const range = STAGE_PROGRESS_RANGES['extract-two-layer'];
  if (!range) return progress;

  const ratio = total > 0 ? current / total : 0;
  const realProgress = range[0] + (range[1] - range[0]) * ratio;

  return {
    ...progress,
    windowProgress: { current, total },
    estimatedProgress: Math.round(realProgress * 10) / 10,
    isEstimated: false,
    message: `已完成 ${current}/${total} 个证据单元`,
  };
}

/** 使用编译器真实事件刷新计数与进度，不按时间伪造百分比。 */
export function updateExtractionProgress(
  progress: PipelineProgress,
  event: CourseExtractionProgress,
): PipelineProgress {
  const updated = updateWindowProgress(progress, event.completedUnits, event.totalUnits);
  const elapsedSeconds = Math.max(0, Math.round(event.elapsedMs / 1000));
  return {
    ...updated,
    successfulItems: event.successfulUnits,
    failedItems: event.failedUnits,
    discoveredItems: event.discoveredTopicMentions,
    elapsedMs: event.elapsedMs,
    message: `已完成 ${event.completedUnits}/${event.totalUnits} · 成功 ${event.successfulUnits} · 失败 ${event.failedUnits} · 发现 ${event.discoveredTopicMentions} 个知识点 · ${elapsedSeconds} 秒`,
    isEstimated: false,
  };
}

/**
 * 平滑递增估算进度（由计时器每 800ms 调用）。
 * 只在当前阶段的上限减 1 的范围内缓慢增加。
 */
export function tickEstimatedProgress(progress: PipelineProgress): PipelineProgress {
  if (progress.status !== 'running') return progress;
  if (progress.isEstimated === false && progress.windowProgress !== undefined) {
    // 有真实窗口进度时不做估算递增
    return progress;
  }

  const runningStep = progress.steps.find(s => s.status === 'running');
  if (!runningStep) return progress;

  const range = STAGE_PROGRESS_RANGES[runningStep.id];
  if (!range) return progress;

  const ceiling = range[1] - 1; // 不超过阶段上限减 1
  const current = progress.estimatedProgress ?? range[0];

  if (current >= ceiling) return progress;

  // 每 tick 增加 0.3~0.8
  const increment = 0.3 + Math.random() * 0.5;
  const next = Math.min(ceiling, current + increment);

  return {
    ...progress,
    estimatedProgress: Math.round(next * 10) / 10,
    isEstimated: true,
  };
}

// ========== 从 StructureExtractionStatus 推导进度 ==========

const STATUS_TO_STEP: Record<string, string> = {
  'extracting-topics': 'extract-two-layer',
  'repairing-topics': 'compile-course',
  'extracting-relations': 'compile-course',
  'extracting-internal-structures': 'validate-structure',
  'quality-checking': 'compile-course',
  'quality-repairing': 'validate-structure',
};

const COMPILER_STAGE_TO_STEP: Record<string, string> = {
  batching: 'prepare-evidence',
  compiling: 'extract-two-layer',
  normalizing: 'compile-course',
  reviewing: 'compile-course',
  scheduling: 'compile-course',
  validating: 'validate-structure',
};

/** 根据课程结构编译器的真实阶段推进进度。 */
export function updateCompilerProgress(
  progress: PipelineProgress,
  stage: 'batching' | 'compiling' | 'normalizing' | 'reviewing' | 'scheduling' | 'validating',
): PipelineProgress {
  const currentStepId = COMPILER_STAGE_TO_STEP[stage];
  const stepIndex = progress.steps.findIndex(step => step.id === currentStepId);
  if (stepIndex < 0) return progress;

  const steps = progress.steps.map((step, index) => {
    if (index < stepIndex) {
      return step.status === 'skipped' ? step : { ...step, status: 'completed' as const };
    }
    if (index === stepIndex) return { ...step, status: 'running' as const };
    return { ...step, status: 'pending' as const };
  });
  const range = STAGE_PROGRESS_RANGES[currentStepId];
  return {
    ...progress,
    status: 'running',
    steps,
    estimatedProgress: range?.[0] ?? progress.estimatedProgress,
    isEstimated: false,
  };
}

export function deriveStructureProgress(
  status: StructureExtractionStatus,
  prevProgress: PipelineProgress | null
): PipelineProgress {
  // 从已有进度开始，或创建新的
  let progress = prevProgress && prevProgress.operation === 'extract-structure'
    ? { ...prevProgress, steps: prevProgress.steps.map(s => ({ ...s })) }
    : createStructureExtractionProgress();

  if (status === 'idle') {
    return { ...progress, status: 'idle' };
  }

  if (status === 'model-required') {
    return blockProgress(progress, '需要配置 AI 模型');
  }

  if (status === 'failed') {
    return failProgress(progress, 'AI 知识点提取失败');
  }

  if (status === 'ready') {
    return completeProgress(progress);
  }

  // 正在执行的状态
  const currentStepId = STATUS_TO_STEP[status];
  if (!currentStepId) return progress;

  progress = { ...progress, status: 'running' };
  const stepIndex = progress.steps.findIndex(s => s.id === currentStepId);

  for (let i = 0; i < progress.steps.length; i++) {
    const step = progress.steps[i];
    if (i < stepIndex) {
      if (step.status !== 'skipped') {
        progress.steps[i] = { ...step, status: 'completed' };
      }
    } else if (i === stepIndex) {
      progress.steps[i] = { ...step, status: 'running' };
    } else {
      progress.steps[i] = { ...step, status: 'pending' };
    }
  }

  // 进入新阶段时纠正估算进度
  const range = STAGE_PROGRESS_RANGES[currentStepId];
  if (range) {
    progress.estimatedProgress = range[0];
    progress.isEstimated = true;
  }

  return progress;
}

// ========== 从 WorkflowStage 推导侧栏步骤状态（旧接口兼容） ==========

export interface SidebarStepState {
  status: 'completed' | 'active' | 'blocked' | 'failed' | 'pending';
}

const STAGE_ORDER: WorkflowStage[] = [
  'upload',
  'parse-review',
  'extracting-structure',
  'structure-review',
  'generating-notes',
  'notes',
];

export function deriveSidebarStepStates(
  stage: WorkflowStage,
  pipelineProgress: PipelineProgress,
  hasModelConfig: boolean,
  _hasTopics: boolean,
  _hasNotes: boolean
): SidebarStepState[] {
  const currentIdx = STAGE_ORDER.indexOf(stage);
  const result: SidebarStepState[] = [];

  for (let i = 0; i < STAGE_ORDER.length; i++) {
    if (i < currentIdx) {
      result.push({ status: 'completed' });
    } else if (i === currentIdx) {
      if (stage === 'extracting-structure') {
        if (pipelineProgress.status === 'blocked') {
          result.push({ status: 'blocked' });
        } else if (pipelineProgress.status === 'failed') {
          result.push({ status: 'failed' });
        } else {
          result.push({ status: 'active' });
        }
      } else if (stage === 'generating-notes') {
        if (pipelineProgress.status === 'failed') {
          result.push({ status: 'failed' });
        } else {
          result.push({ status: 'active' });
        }
      } else {
        result.push({ status: 'active' });
      }
    } else {
      result.push({ status: 'pending' });
    }
  }

  if (stage === 'extracting-structure' && pipelineProgress.status === 'blocked' && !hasModelConfig) {
    result[2] = { status: 'blocked' };
  }

  return result;
}

// ========== 计算进度百分比 ==========

export function computeProgressPercent(progress: PipelineProgress): number {
  // 失败时保留失败时的进度
  if (progress.status === 'failed') {
    return progress.estimatedProgress ?? 0;
  }

  // 完成时显示 100%
  if (progress.status === 'completed') {
    return 100;
  }

  // 有估算进度时使用估算进度（但永远不超过 99）
  if (progress.estimatedProgress !== undefined) {
    return Math.min(99, progress.estimatedProgress);
  }

  // 回退到旧的步骤计算
  if (progress.steps.length === 0) return 0;
  const completed = progress.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const basePercent = (completed / progress.steps.length) * 100;

  if (progress.currentItem !== undefined && progress.totalItems !== undefined && progress.totalItems > 0) {
    const runningStep = progress.steps.findIndex(s => s.status === 'running');
    if (runningStep >= 0) {
      const stepWeight = 1 / progress.steps.length;
      const subProgress = (progress.currentItem / progress.totalItems) * stepWeight;
      return Math.min(99, basePercent + subProgress * 100);
    }
  }

  return Math.min(99, basePercent);
}
