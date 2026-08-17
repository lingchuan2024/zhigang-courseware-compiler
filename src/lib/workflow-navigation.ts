import type {
  ProductStage,
  ProductStepStatus,
  ProductStateSnapshot,
  StageNavigationResult,
} from '../types';

// ============== 六步流程常量 ==============

export const PRODUCT_STAGES: ProductStage[] = ['upload', 'document', 'mineru', 'structure', 'cards', 'notes'];

export const STAGE_LABELS: Record<ProductStage, string> = {
  'upload': '上传课件',
  'document': '课件预览',
  'mineru': 'MinerU 解析',
  'structure': '知识结构',
  'cards': '知识卡片',
  'notes': '完整笔记',
};

export const STAGE_NUMBERS: Record<ProductStage, number> = {
  'upload': 1,
  'document': 2,
  'mineru': 3,
  'structure': 4,
  'cards': 5,
  'notes': 6,
};

// ============== 状态派生 ==============

/**
 * 判断某个阶段是否已完成（基于真实数据，非数组下标）
 */
export function isStageCompleted(stage: ProductStage, state: ProductStateSnapshot): boolean {
  switch (stage) {
    case 'upload':
      return state.document !== null;
    case 'document':
      return state.document !== null;
    case 'mineru':
      return state.mineruParseResult?.status === 'completed' &&
             Boolean(state.mineruParseResult.markdown) &&
             Boolean(state.sourceDocuments?.length);
    case 'structure':
      return Boolean(state.knowledgeTopics?.length);
    case 'cards':
      return Boolean(state.knowledgeCards?.length);
    case 'notes': {
      const note = state.courseMasterNote;
      const structureVersion = state.knowledgeBaseVersions?.topicStructure ?? 0;
      return Boolean(
        note &&
        note.status === 'completed' &&
        note.markdown.trim().length > 0 &&
        note.generatedFromStructureVersion === structureVersion,
      );
    }
    default:
      return false;
  }
}

/**
 * 判断某个阶段是否有数据
 */
export function hasStageData(stage: ProductStage, state: ProductStateSnapshot): boolean {
  switch (stage) {
    case 'upload':
      return state.document !== null;
    case 'document':
      return state.document !== null;
    case 'mineru':
      return Boolean(state.mineruParseResult) || Boolean(state.sourceDocuments?.length);
    case 'structure':
      return Boolean(state.knowledgeTopics?.length);
    case 'cards':
      return Boolean(state.knowledgeCards?.length);
    case 'notes':
      return Boolean(
        state.courseMasterNote ||
        state.chapterNotes?.length ||
        state.topicSyntheses?.length,
      );
    default:
      return false;
  }
}

/**
 * 判断某个阶段是否被阻塞（失败/需要模型配置等）
 */
export function isStageBlocked(stage: ProductStage, state: ProductStateSnapshot): boolean {
  if (stage === 'structure') {
    return state.structureExtractionStatus === 'model-required' ||
           state.structureExtractionStatus === 'failed';
  }
  return false;
}

/**
 * 判断某个阶段是否失败
 */
export function isStageFailed(stage: ProductStage, state: ProductStateSnapshot): boolean {
  if (stage === 'structure') {
    return state.structureExtractionStatus === 'failed';
  }
  if (stage === 'notes') {
    return state.courseMasterNote?.status === 'failed';
  }
  return false;
}

// ============== 导航守卫 ==============

/**
 * 检查是否可以导航到目标阶段
 */
export function canNavigateToStage(
  targetStage: ProductStage,
  currentStage: ProductStage,
  state: ProductStateSnapshot,
): StageNavigationResult {
  const targetIndex = PRODUCT_STAGES.indexOf(targetStage);
  const currentIndex = PRODUCT_STAGES.indexOf(currentStage);

  // 允许进入紧邻的下一步，只要当前步骤已经完成；更远的未来步骤不可点击。
  if (targetIndex > currentIndex && !isStageCompleted(targetStage, state) && !hasStageData(targetStage, state)) {
    if (targetIndex === currentIndex + 1 && isStageCompleted(currentStage, state)) {
      return {
        allowed: true,
        targetStage,
        mode: 'edit',
        invalidatedResources: [],
        requiresConfirmation: false,
      };
    }
    return {
      allowed: false,
      targetStage,
      mode: 'view',
      invalidatedResources: [],
      requiresConfirmation: false,
      reason: '未来步骤不可点击',
    };
  }

  // 检查目标阶段是否有数据
  if (!hasStageData(targetStage, state) && !isStageCompleted(targetStage, state)) {
    return {
      allowed: false,
      targetStage,
      mode: 'view',
      invalidatedResources: [],
      requiresConfirmation: false,
      reason: '该阶段尚无数据',
    };
  }

  // 返回已完成步骤 → 只读模式
  if (targetIndex < currentIndex) {
    return {
      allowed: true,
      targetStage,
      mode: 'view',
      invalidatedResources: [],
      requiresConfirmation: false,
      reason: '返回查看（只读模式）',
    };
  }

  // 当前阶段
  if (targetStage === currentStage) {
    return {
      allowed: true,
      targetStage,
      mode: 'view',
      invalidatedResources: [],
      requiresConfirmation: false,
    };
  }

  // 前进到下一步
  return {
    allowed: true,
    targetStage,
    mode: 'edit',
    invalidatedResources: [],
    requiresConfirmation: false,
  };
}

// ============== 侧栏步骤派生 ==============

export interface ProductStepInfo {
  stage: ProductStage;
  label: string;
  number: number;
  status: ProductStepStatus;
  canClick: boolean;
  statusLabel?: string;
}

/**
 * 从真实数据派生侧栏四个步骤的状态
 */
export function deriveProductSteps(
  currentStage: ProductStage,
  state: ProductStateSnapshot,
): ProductStepInfo[] {
  const currentIndex = PRODUCT_STAGES.indexOf(currentStage);

  return PRODUCT_STAGES.map((stage, i) => {
    const completed = isStageCompleted(stage, state);
    const hasData = hasStageData(stage, state);
    const blocked = isStageBlocked(stage, state);
    const failed = isStageFailed(stage, state);
    const isCurrent = stage === currentStage;
    const isFuture = i > currentIndex;

    let status: ProductStepStatus;
    let canClick: boolean;
    let statusLabel: string | undefined;

    if (failed) {
      status = 'failed';
      canClick = true;
      statusLabel = '提取失败';
    } else if (blocked) {
      status = 'blocked';
      canClick = true;
      statusLabel = '需要配置';
    } else if (isCurrent) {
      status = 'active';
      canClick = false;
      // 当前阶段的补充状态
      if (state.jobStatus === 'running') {
        statusLabel = '正在处理';
      }
    } else if (isFuture && hasData) {
      canClick = true;
      if (state.staleMarker) {
        status = 'stale';
        statusLabel = '需要更新';
      } else {
        status = 'completed';
        if (stage === 'notes' && !completed) statusLabel = '部分完成';
      }
    } else if (isFuture && !completed) {
      status = 'pending';
      canClick = false;
    } else if (completed || hasData) {
      // 有 staleMarker 时，下游阶段标记为 stale
      if (state.staleMarker && i > currentIndex) {
        status = 'stale';
        statusLabel = '需要更新';
      } else {
        status = 'completed';
      }
      canClick = true;
    } else {
      status = 'pending';
      canClick = false;
    }

    return {
      stage,
      label: STAGE_LABELS[stage],
      number: STAGE_NUMBERS[stage],
      status,
      canClick,
      statusLabel,
    };
  });
}

// ============== 返回最新阶段 ==============

/**
 * 找到用户应该返回的最新阶段
 */
export function getLatestStage(state: ProductStateSnapshot): ProductStage {
  if (hasStageData('notes', state)) return 'notes';
  if (isStageCompleted('cards', state)) return 'cards';
  if (isStageCompleted('structure', state)) return 'structure';
  if (isStageCompleted('mineru', state)) return 'mineru';
  if (isStageCompleted('document', state)) return 'document';
  return 'upload';
}
