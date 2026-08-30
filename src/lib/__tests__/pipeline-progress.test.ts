import { describe, it, expect } from 'vitest';
import {
  STRUCTURE_EXTRACTION_STEPS,
  NOTE_GENERATION_STEPS,
  createStructureExtractionProgress,
  createNoteGenerationProgress,
  updateProgressStep,
  skipProgressStep,
  blockProgress,
  completeProgress,
  failProgress,
  updateCurrentItem,
  updateCompilerProgress,
  deriveStructureProgress,
  deriveSidebarStepStates,
  computeProgressPercent,
} from '../pipeline-progress';
import type { PipelineProgress, WorkflowStage } from '../../types';

// Helper: create an idle pipeline progress for sidebar tests
function idleProgress(): PipelineProgress {
  return { operation: null, status: 'idle', steps: [] };
}

describe('pipeline-progress', () => {
  describe('course compiler progress', () => {
    it('uses the six compiler phases as the structure extraction steps', () => {
      expect(STRUCTURE_EXTRACTION_STEPS.map(step => step.id)).toEqual([
        'prepare-evidence',
        'compile-sections',
        'normalize-topics',
        'review-curriculum',
        'schedule-course',
        'validate-structure',
      ]);
    });

    it('advances compiler phases while preserving an explicitly skipped prior phase', () => {
      let progress = createStructureExtractionProgress();
      progress = skipProgressStep(progress, 'review-curriculum');
      progress = updateCompilerProgress(progress, 'scheduling');

      expect(progress.steps.find(step => step.id === 'compile-sections')?.status).toBe('completed');
      expect(progress.steps.find(step => step.id === 'review-curriculum')?.status).toBe('skipped');
      expect(progress.steps.find(step => step.id === 'schedule-course')?.status).toBe('running');
      expect(progress.steps.find(step => step.id === 'validate-structure')?.status).toBe('pending');
    });
  });

  // ========== Case 1: Main workflow 6 stages order ==========
  describe('STAGE_ORDER (via deriveSidebarStepStates)', () => {
    const expectedOrder: WorkflowStage[] = [
      'upload',
      'parse-review',
      'extracting-structure',
      'structure-review',
      'generating-notes',
      'notes',
    ];

    it('should have exactly 6 stages', () => {
      const result = deriveSidebarStepStates('upload', idleProgress(), true, false, false);
      expect(result).toHaveLength(6);
    });

    it('should have stages in order: upload → parse-review → extracting-structure → structure-review → generating-notes → notes', () => {
      expectedOrder.forEach((stage, expectedIndex) => {
        const result = deriveSidebarStepStates(stage, idleProgress(), true, false, false);
        const activeIndex = result.findIndex(s => s.status === 'active');
        expect(activeIndex).toBe(expectedIndex);
      });
    });
  });

  // ========== Case 2: extracting-structure is not generating-notes ==========
  describe('extracting-structure vs generating-notes distinction', () => {
    it('when stage is extracting-structure, step index 2 should be active (not step 4)', () => {
      const result = deriveSidebarStepStates(
        'extracting-structure',
        idleProgress(),
        true,
        false,
        false
      );
      expect(result[2].status).toBe('active');
      expect(result[4].status).toBe('pending');
    });

    it('when stage is generating-notes, step index 4 should be active (not step 2)', () => {
      const result = deriveSidebarStepStates(
        'generating-notes',
        idleProgress(),
        true,
        false,
        false
      );
      expect(result[4].status).toBe('active');
      expect(result[2].status).toBe('completed');
    });
  });

  // ========== Case 3: generating-notes doesn't show "extracting topics" ==========
  describe('createNoteGenerationProgress steps', () => {
    it('should use NOTE_GENERATION_STEPS, not STRUCTURE_EXTRACTION_STEPS', () => {
      const progress = createNoteGenerationProgress(5);
      const stepIds = progress.steps.map(s => s.id);
      expect(stepIds).toEqual(NOTE_GENERATION_STEPS.map(s => s.id));
    });

    it('should not contain extract-topics step', () => {
      const progress = createNoteGenerationProgress(5);
      const stepIds = progress.steps.map(s => s.id);
      expect(stepIds).not.toContain('extract-topics');
    });

    it('should contain generate-notes and assemble-master steps', () => {
      const progress = createNoteGenerationProgress(5);
      const stepIds = progress.steps.map(s => s.id);
      expect(stepIds).toContain('generate-notes');
      expect(stepIds).toContain('assemble-master');
    });
  });

  // ========== Case 4: completed/active/blocked/failed/pending derive correctly ==========
  describe('deriveSidebarStepStates - completed/active/pending', () => {
    it('when stage is upload, step 0 is active, rest are pending', () => {
      const result = deriveSidebarStepStates('upload', idleProgress(), true, false, false);
      expect(result[0].status).toBe('active');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].status).toBe('pending');
      }
    });

    it('when stage is parse-review, step 0 is completed, step 1 is active, rest are pending', () => {
      const result = deriveSidebarStepStates('parse-review', idleProgress(), true, false, false);
      expect(result[0].status).toBe('completed');
      expect(result[1].status).toBe('active');
      for (let i = 2; i < result.length; i++) {
        expect(result[i].status).toBe('pending');
      }
    });

    it('when stage is notes, steps 0-4 are completed, step 5 is active', () => {
      const result = deriveSidebarStepStates('notes', idleProgress(), true, false, false);
      for (let i = 0; i < 5; i++) {
        expect(result[i].status).toBe('completed');
      }
      expect(result[5].status).toBe('active');
    });
  });

  // ========== Case 5: model-required corresponds to blocked ==========
  describe('model-required / blocked status', () => {
    it('when pipelineProgress.status is blocked and stage is extracting-structure, sidebar shows blocked', () => {
      const blockedProgress: PipelineProgress = {
        operation: 'extract-structure',
        status: 'blocked',
        steps: STRUCTURE_EXTRACTION_STEPS.map(s => ({ ...s })),
      };
      const result = deriveSidebarStepStates(
        'extracting-structure',
        blockedProgress,
        true,
        false,
        false
      );
      expect(result[2].status).toBe('blocked');
    });

    it('when pipelineProgress.status is blocked and stage is extracting-structure without model config, sidebar shows blocked', () => {
      const blockedProgress: PipelineProgress = {
        operation: 'extract-structure',
        status: 'blocked',
        steps: STRUCTURE_EXTRACTION_STEPS.map(s => ({ ...s })),
      };
      const result = deriveSidebarStepStates(
        'extracting-structure',
        blockedProgress,
        false,
        false,
        false
      );
      expect(result[2].status).toBe('blocked');
    });

    it('deriveStructureProgress with model-required returns blocked status with message', () => {
      const progress = deriveStructureProgress('model-required', null);
      expect(progress.status).toBe('blocked');
      expect(progress.message).toBe('需要配置 AI 模型');
    });
  });

  // ========== Case 6: StructureExtractionStatus progression ==========
  describe('deriveStructureProgress - status progression', () => {
    it('maps the legacy extracting-topics status onto section compilation', () => {
      const progress = deriveStructureProgress('extracting-topics', null);
      expect(progress.steps.find(s => s.id === 'prepare-evidence')?.status).toBe('completed');
      expect(progress.steps.find(s => s.id === 'compile-sections')?.status).toBe('running');
      expect(progress.steps.find(s => s.id === 'normalize-topics')?.status).toBe('pending');
      expect(progress.steps.find(s => s.id === 'schedule-course')?.status).toBe('pending');
      expect(progress.steps.find(s => s.id === 'validate-structure')?.status).toBe('pending');
      expect(progress.status).toBe('running');
    });

    it('preserves a skipped normalization phase while advancing to scheduling', () => {
      let prev = createStructureExtractionProgress();
      prev = skipProgressStep(prev, 'normalize-topics');
      const progress = deriveStructureProgress('extracting-relations', prev);

      const mergeStep = progress.steps.find(s => s.id === 'normalize-topics');
      expect(mergeStep?.status).toBe('skipped');

      const extractTopicsStep = progress.steps.find(s => s.id === 'compile-sections');
      expect(extractTopicsStep?.status).toBe('completed');

      const extractRelationsStep = progress.steps.find(s => s.id === 'schedule-course');
      expect(extractRelationsStep?.status).toBe('running');

      const extractInternalStep = progress.steps.find(s => s.id === 'validate-structure');
      expect(extractInternalStep?.status).toBe('pending');
    });

    it('when status is ready (with progressed prevProgress), all steps should be completed', () => {
      // Simulate full progression up to the last running step
      const prev = deriveStructureProgress('extracting-internal-structures', null);
      // prev should be: [completed, completed, completed, running]
      const progress = deriveStructureProgress('ready', prev);
      expect(progress.status).toBe('completed');
      for (const step of progress.steps) {
        expect(step.status).toBe('completed');
      }
    });

    it('when status is idle, progress status should be idle', () => {
      const progress = deriveStructureProgress('idle', null);
      expect(progress.status).toBe('idle');
    });

    it('when status is failed, progress status should be failed with message', () => {
      const progress = deriveStructureProgress('failed', null);
      expect(progress.status).toBe('failed');
      expect(progress.message).toBe('AI 知识点提取失败');
    });
  });

  // ========== Case 7: Unexecuted merge step shows skipped ==========
  describe('unexecuted merge step shows skipped', () => {
    it('preserves skipped normalization when legacy status moves to relations', () => {
      let prev = createStructureExtractionProgress();
      prev = skipProgressStep(prev, 'normalize-topics');
      const progress = deriveStructureProgress('extracting-relations', prev);
      const mergeStep = progress.steps.find(s => s.id === 'normalize-topics');
      expect(mergeStep?.status).toBe('skipped');
    });

    it('preserves skipped normalization when legacy status moves to validation', () => {
      let prev = createStructureExtractionProgress();
      prev = skipProgressStep(prev, 'normalize-topics');
      const progress = deriveStructureProgress('extracting-internal-structures', prev);
      const mergeStep = progress.steps.find(s => s.id === 'normalize-topics');
      expect(mergeStep?.status).toBe('skipped');
    });
  });

  // ========== Case 8: Note generation currentItem/totalItems ==========
  describe('createNoteGenerationProgress and updateCurrentItem', () => {
    it('should initialize with currentItem=0 and totalItems=totalTopics', () => {
      const progress = createNoteGenerationProgress(10);
      expect(progress.currentItem).toBe(0);
      expect(progress.totalItems).toBe(10);
      expect(progress.currentItemTitle).toBeUndefined();
    });

    it('should initialize with operation generate-notes and status running', () => {
      const progress = createNoteGenerationProgress(5);
      expect(progress.operation).toBe('generate-notes');
      expect(progress.status).toBe('running');
    });

    it('updateCurrentItem should update currentItem, totalItems, and currentItemTitle', () => {
      const progress = createNoteGenerationProgress(10);
      const updated = updateCurrentItem(progress, 5, 10, '知识点A');
      expect(updated.currentItem).toBe(5);
      expect(updated.totalItems).toBe(10);
      expect(updated.currentItemTitle).toBe('知识点A');
    });

    it('updateCurrentItem should not mutate the original progress', () => {
      const progress = createNoteGenerationProgress(10);
      const updated = updateCurrentItem(progress, 3, 10, '知识点B');
      expect(progress.currentItem).toBe(0);
      expect(updated.currentItem).toBe(3);
    });

    it('updateCurrentItem should advance note generation total progress', () => {
      const progress = createNoteGenerationProgress(10);
      const updated = updateCurrentItem(progress, 5, 10, '知识点A');
      expect(updated.estimatedProgress).toBe(50);
      expect(updated.isEstimated).toBe(false);
    });
  });

  // ========== Case 9: Progress percent calculation ==========
  describe('computeProgressPercent', () => {
    // --- estimatedProgress priority ---

    it('should use estimatedProgress when set (running status)', () => {
      const progress = createStructureExtractionProgress();
      // createStructureExtractionProgress sets estimatedProgress: 2
      expect(computeProgressPercent(progress)).toBe(2);
    });

    it('should cap estimatedProgress at 99 for running status', () => {
      const progress: PipelineProgress = {
        ...createStructureExtractionProgress(),
        estimatedProgress: 150,
      };
      expect(computeProgressPercent(progress)).toBe(99);
    });

    it('should return 100 for completed status', () => {
      const progress = completeProgress(createStructureExtractionProgress());
      expect(computeProgressPercent(progress)).toBe(100);
    });

    it('should return estimatedProgress for failed status (not capped at 99)', () => {
      const progress: PipelineProgress = {
        ...createStructureExtractionProgress(),
        status: 'failed',
        estimatedProgress: 50,
      };
      expect(computeProgressPercent(progress)).toBe(50);
    });

    // --- step-based fallback (when estimatedProgress is undefined) ---

    it('should return 0 for all-pending steps via fallback', () => {
      const progress = {
        ...createStructureExtractionProgress(),
        estimatedProgress: undefined,
      };
      expect(computeProgressPercent(progress)).toBe(0);
    });

    it('should return 0 for empty steps', () => {
      const progress: PipelineProgress = { operation: null, status: 'idle', steps: [] };
      expect(computeProgressPercent(progress)).toBe(0);
    });

    it('should calculate partial progress via step-based fallback', () => {
      const progress: PipelineProgress = {
        ...createStructureExtractionProgress(),
        estimatedProgress: undefined,
        steps: STRUCTURE_EXTRACTION_STEPS.map((s, i) => ({
          ...s,
          status: i < 2 ? ('completed' as const) : ('pending' as const),
        })),
      };
      // 2 out of 6 steps completed
      expect(computeProgressPercent(progress)).toBe(Math.min(99, (2 / 6) * 100));
    });

    it('should cap at 99 for all-completed steps with running status via fallback', () => {
      const progress: PipelineProgress = {
        ...createStructureExtractionProgress(),
        estimatedProgress: undefined,
        steps: STRUCTURE_EXTRACTION_STEPS.map(s => ({ ...s, status: 'completed' as const })),
      };
      expect(computeProgressPercent(progress)).toBe(99);
    });

    it('should add sub-progress when currentItem/totalItems are set and a step is running (fallback)', () => {
      const progress = createNoteGenerationProgress(10);
      // Mark first step completed, second step running with currentItem=5
      const p: PipelineProgress = {
        ...progress,
        estimatedProgress: undefined,
        steps: progress.steps.map((s, i) => ({
          ...s,
          status:
            i === 0
              ? ('completed' as const)
              : i === 1
                ? ('running' as const)
                : ('pending' as const),
        })),
        currentItem: 5,
        totalItems: 10,
      };
      const percent = computeProgressPercent(p);
      // basePercent = 1/4 * 100 = 25
      // stepWeight = 1/4 = 0.25
      // subProgress = (5/10) * 0.25 = 0.125
      // result = 25 + 0.125 * 100 = 37.5
      expect(percent).toBe(37.5);
    });

    it('should not add sub-progress when no step is running (fallback)', () => {
      const progress = createNoteGenerationProgress(10);
      const p: PipelineProgress = {
        ...progress,
        estimatedProgress: undefined,
        steps: progress.steps.map((s, i) => ({
          ...s,
          status: i < 2 ? ('completed' as const) : ('pending' as const),
        })),
        currentItem: 5,
        totalItems: 10,
      };
      // No running step, so just base percent = 50
      expect(computeProgressPercent(p)).toBe(50);
    });

    it('should cap at 99 when sub-progress would exceed (fallback)', () => {
      const progress = createNoteGenerationProgress(10);
      const p: PipelineProgress = {
        ...progress,
        estimatedProgress: undefined,
        steps: progress.steps.map((s, i) => ({
          ...s,
          status:
            i < 3
              ? ('completed' as const)
              : i === 3
                ? ('running' as const)
                : ('pending' as const),
        })),
        currentItem: 10,
        totalItems: 10,
      };
      // basePercent = 3/4 * 100 = 75
      // stepWeight = 0.25
      // subProgress = (10/10) * 0.25 = 0.25
      // result = 75 + 25 = 100, but capped at 99 for running
      expect(computeProgressPercent(p)).toBe(99);
    });
  });

  // ========== Case 10: blockProgress ==========
  describe('blockProgress', () => {
    it('should set status to blocked and set the message', () => {
      const progress = createStructureExtractionProgress();
      const blocked = blockProgress(progress, '需要配置 AI 模型');
      expect(blocked.status).toBe('blocked');
      expect(blocked.message).toBe('需要配置 AI 模型');
    });

    it('should preserve existing steps', () => {
      const progress = createStructureExtractionProgress();
      const blocked = blockProgress(progress, 'some message');
      expect(blocked.steps).toHaveLength(progress.steps.length);
      expect(blocked.operation).toBe(progress.operation);
    });

    it('should not mutate the original progress', () => {
      const progress = createStructureExtractionProgress();
      blockProgress(progress, 'blocked!');
      expect(progress.status).toBe('running');
      expect(progress.message).toBeUndefined();
    });
  });

  // ========== Case 11: failProgress ==========
  describe('failProgress', () => {
    it('should set status to failed and set the message', () => {
      const progress = createStructureExtractionProgress();
      const failed = failProgress(progress, '提取失败');
      expect(failed.status).toBe('failed');
      expect(failed.message).toBe('提取失败');
    });

    it('should preserve existing steps', () => {
      const progress = createStructureExtractionProgress();
      const failed = failProgress(progress, 'some message');
      expect(failed.steps).toHaveLength(progress.steps.length);
      expect(failed.operation).toBe(progress.operation);
    });

    it('should not mutate the original progress', () => {
      const progress = createStructureExtractionProgress();
      failProgress(progress, 'failed!');
      expect(progress.status).toBe('running');
      expect(progress.message).toBeUndefined();
    });
  });

  // ========== Case 12: completeProgress ==========
  describe('completeProgress', () => {
    it('should set status to completed', () => {
      const progress = createStructureExtractionProgress();
      const completed = completeProgress(progress);
      expect(completed.status).toBe('completed');
    });

    it('should mark running steps as completed', () => {
      let progress = createStructureExtractionProgress();
      progress = updateProgressStep(progress, 'compile-sections', 'running');
      const completed = completeProgress(progress);
      const extractTopicsStep = completed.steps.find(s => s.id === 'compile-sections');
      expect(extractTopicsStep?.status).toBe('completed');
    });

    it('should leave non-running steps unchanged', () => {
      let progress = createStructureExtractionProgress();
      progress = updateProgressStep(progress, 'compile-sections', 'completed');
      progress = updateProgressStep(progress, 'normalize-topics', 'pending');
      const completed = completeProgress(progress);
      const extractTopicsStep = completed.steps.find(s => s.id === 'compile-sections');
      const mergeTopicsStep = completed.steps.find(s => s.id === 'normalize-topics');
      expect(extractTopicsStep?.status).toBe('completed');
      expect(mergeTopicsStep?.status).toBe('pending');
    });

    it('should mark multiple running steps as completed', () => {
      let progress = createStructureExtractionProgress();
      // Set all steps to running so completeProgress marks them all as completed
      for (const step of progress.steps) {
        progress = updateProgressStep(progress, step.id, 'running');
      }
      const completed = completeProgress(progress);
      expect(completed.steps.every(s => s.status === 'completed')).toBe(true);
    });

    it('should not mutate the original progress', () => {
      let progress = createStructureExtractionProgress();
      progress = updateProgressStep(progress, 'compile-sections', 'running');
      completeProgress(progress);
      const extractTopicsStep = progress.steps.find(s => s.id === 'compile-sections');
      expect(extractTopicsStep?.status).toBe('running');
      expect(progress.status).toBe('running');
    });
  });
});
