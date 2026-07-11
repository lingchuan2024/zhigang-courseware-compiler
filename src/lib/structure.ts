import { LearningUnit, EvidenceAtom, EvidenceType } from '../types';
import { generateId } from './utils';
import { validateEvidenceIds } from './evidence';

// 基于标题证据自动分组生成学习单元（本地确定性方法）
export function generateLearningUnitsLocal(evidences: EvidenceAtom[]): LearningUnit[] {
  // 按页码排序
  const sorted = [...evidences].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return 0;
  });

  const units: LearningUnit[] = [];
  let currentUnit: LearningUnit | null = null;
  let unitCounter = 1;

  // 首先找到所有标题
  const titleEvidences = sorted.filter(e => e.type === 'title');

  if (titleEvidences.length === 0) {
    // 如果没有标题，创建一个默认单元
    return [{
      id: generateId('unit'),
      title: '第一部分',
      objective: '学习本课件的核心内容',
      evidenceIds: sorted.map(e => e.id),
      order: 0,
    }];
  }

  // 基于标题分割内容
  for (let i = 0; i < sorted.length; i++) {
    const evidence = sorted[i];

    if (evidence.type === 'title') {
      // 保存之前的单元
      if (currentUnit && currentUnit.evidenceIds.length > 0) {
        units.push(currentUnit);
      }
      // 创建新单元
      currentUnit = {
        id: generateId('unit'),
        title: evidence.content.replace(/^[#第章节课\d.、)）\s]+/, '').trim() || `第${unitCounter}部分`,
        objective: `掌握${evidence.content.replace(/^[#第章节课\d.、)）\s]+/, '').trim() || '本章节'}的核心概念`,
        evidenceIds: [evidence.id],
        order: units.length,
      };
      unitCounter++;
    } else if (currentUnit) {
      currentUnit.evidenceIds.push(evidence.id);
    } else {
      // 标题前的内容放入第一个单元
      if (units.length === 0) {
        currentUnit = {
          id: generateId('unit'),
          title: '开篇引言',
          objective: '了解课程背景和引入内容',
          evidenceIds: [evidence.id],
          order: 0,
        };
      } else {
        units[0].evidenceIds.push(evidence.id);
      }
    }
  }

  // 添加最后一个单元
  if (currentUnit && currentUnit.evidenceIds.length > 0) {
    units.push(currentUnit);
  }

  // 更新order
  return units.map((unit, idx) => ({ ...unit, order: idx }));
}

// 重命名学习单元
export function renameLearningUnit(
  units: LearningUnit[],
  unitId: string,
  newTitle: string
): LearningUnit[] {
  return units.map(unit =>
    unit.id === unitId ? { ...unit, title: newTitle } : unit
  );
}

// 修改学习单元目标
export function updateUnitObjective(
  units: LearningUnit[],
  unitId: string,
  objective: string
): LearningUnit[] {
  return units.map(unit =>
    unit.id === unitId ? { ...unit, objective } : unit
  );
}

// 移动学习单元
export function moveLearningUnit(
  units: LearningUnit[],
  fromIndex: number,
  toIndex: number
): LearningUnit[] {
  const result = [...units];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result.map((unit, idx) => ({ ...unit, order: idx }));
}

// 删除学习单元（将其证据移到前一个单元）
export function deleteLearningUnit(
  units: LearningUnit[],
  unitId: string
): LearningUnit[] {
  const unitIndex = units.findIndex(u => u.id === unitId);
  if (unitIndex === -1) return units;

  const deletedUnit = units[unitIndex];
  const result = units.filter(u => u.id !== unitId);

  // 将证据移到前一个单元
  if (result.length > 0) {
    const targetIndex = Math.max(0, unitIndex - 1);
    result[targetIndex] = {
      ...result[targetIndex],
      evidenceIds: [...result[targetIndex].evidenceIds, ...deletedUnit.evidenceIds],
    };
  }

  return result.map((unit, idx) => ({ ...unit, order: idx }));
}

// 向学习单元添加证据
export function addEvidenceToUnit(
  units: LearningUnit[],
  unitId: string,
  evidenceId: string
): LearningUnit[] {
  return units.map(unit => {
    if (unit.id === unitId && !unit.evidenceIds.includes(evidenceId)) {
      return { ...unit, evidenceIds: [...unit.evidenceIds, evidenceId] };
    }
    return unit;
  });
}

// 从学习单元移除证据
export function removeEvidenceFromUnit(
  units: LearningUnit[],
  unitId: string,
  evidenceId: string
): LearningUnit[] {
  return units.map(unit => {
    if (unit.id === unitId) {
      return { ...unit, evidenceIds: unit.evidenceIds.filter(id => id !== evidenceId) };
    }
    return unit;
  });
}

// 验证学习单元的证据ID有效性
export function validateLearningUnits(
  units: LearningUnit[],
  evidences: EvidenceAtom[]
): LearningUnit[] {
  return units.map(unit => ({
    ...unit,
    evidenceIds: validateEvidenceIds(evidences, unit.evidenceIds),
  }));
}

// 获取单元内特定类型的证据
export function getUnitEvidencesByType(
  unit: LearningUnit,
  evidences: EvidenceAtom[],
  type: EvidenceType
): EvidenceAtom[] {
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));
  return unit.evidenceIds
    .map(id => evidenceMap.get(id))
    .filter((e): e is EvidenceAtom => e !== undefined && e.type === type);
}
