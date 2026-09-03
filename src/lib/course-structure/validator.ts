import type {
  CourseStructureIssue,
  CourseStructureStatus,
  CourseStructureValidation,
  EvidenceSpan,
  LearningTopic,
  OrderConstraint,
  TeachingUnit,
} from './types';

export interface CourseStructureValidationInput {
  topics: LearningTopic[];
  teachingUnits: TeachingUnit[];
  evidenceSpans: EvidenceSpan[];
  orderedTopicIds: string[];
  orderConstraints: OrderConstraint[];
  schedulerIssues: CourseStructureIssue[];
  failedBatchIds: string[];
  meaningfulBlockIds: string[];
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateCourseStructure(
  input: CourseStructureValidationInput,
): { status: CourseStructureStatus; validation: CourseStructureValidation } {
  const issues = [...input.schedulerIssues];
  const evidenceIds = new Set(input.evidenceSpans.map(evidence => evidence.id));
  const topicIds = new Set(input.topics.map(topic => topic.id));
  let corrupt = hasDuplicates(input.topics.map(topic => topic.id))
    || hasDuplicates(input.topics.map(topic => topic.stableKey))
    || hasDuplicates(input.evidenceSpans.map(evidence => evidence.id));

  input.topics.forEach(topic => {
    const validEvidence = topic.evidenceIds.filter(id => evidenceIds.has(id));
    if (validEvidence.length === 0) {
      issues.push({
        code: 'TOPIC_WITHOUT_EVIDENCE',
        severity: 'error',
        message: `主题“${topic.name}”没有有效原文证据`,
        topicId: topic.id,
      });
    }
    if (/^(概述|其他|知识点|内容|总结)$/u.test(topic.name.trim())) {
      issues.push({
        code: 'GENERIC_TOPIC',
        severity: 'warning',
        message: `主题“${topic.name}”过于笼统`,
        topicId: topic.id,
      });
    }
    topic.evidenceIds.filter(id => !evidenceIds.has(id)).forEach(() => {
      issues.push({
        code: 'INVALID_EVIDENCE',
        severity: 'error',
        message: `主题“${topic.name}”引用了不存在的证据`,
        topicId: topic.id,
      });
    });
  });

  input.teachingUnits.forEach(unit => {
    if (!topicIds.has(unit.topicId)) {
      corrupt = true;
      issues.push({
        code: 'UNKNOWN_TOPIC',
        severity: 'error',
        message: `讲解单元“${unit.title}”引用了不存在的主题`,
        teachingUnitId: unit.id,
      });
    }
    const validEvidence = unit.evidenceIds.filter(id => evidenceIds.has(id));
    if (validEvidence.length === 0) {
      issues.push({
        code: unit.required ? 'REQUIRED_UNIT_WITHOUT_EVIDENCE' : 'TEACHING_UNIT_WITHOUT_EVIDENCE',
        severity: 'error',
        message: `${unit.required ? '必要' : '讲解'}单元“${unit.title}”没有有效原文证据`,
        teachingUnitId: unit.id,
      });
    }
  });

  const orderPosition = new Map(input.orderedTopicIds.map((topicId, index) => [topicId, index]));
  input.orderConstraints.forEach(constraint => {
    if (!topicIds.has(constraint.beforeTopicId) || !topicIds.has(constraint.afterTopicId)) {
      corrupt = true;
      issues.push({
        code: 'UNKNOWN_TOPIC',
        severity: 'error',
        message: `顺序约束 ${constraint.id} 引用了不存在的主题`,
      });
    } else if (
      constraint.strength === 'hard' &&
      (orderPosition.get(constraint.beforeTopicId) ?? Number.POSITIVE_INFINITY) >=
        (orderPosition.get(constraint.afterTopicId) ?? Number.NEGATIVE_INFINITY)
    ) {
      issues.push({
        code: 'ORDER_CONSTRAINT_VIOLATION',
        severity: 'error',
        message: `课程顺序违反前置约束：${constraint.beforeTopicId} 必须先于 ${constraint.afterTopicId}`,
      });
    }
  });

  const orderedSet = new Set(input.orderedTopicIds);
  if (
    hasDuplicates(input.orderedTopicIds)
    || orderedSet.size !== topicIds.size
    || [...topicIds].some(id => !orderedSet.has(id))
  ) {
    corrupt = true;
    issues.push({
      code: 'UNKNOWN_TOPIC',
      severity: 'error',
      message: '课程学习顺序与主题目录不一致',
    });
  }

  input.failedBatchIds.forEach(batchId => issues.push({
    code: 'FAILED_SECTION_BATCH',
    severity: 'error',
    message: `章节批次 ${batchId} 编译失败`,
    batchId,
  }));

  const meaningfulBlockIds = new Set(input.meaningfulBlockIds);
  const coveredBlocks = new Set(input.evidenceSpans
    .map(evidence => evidence.blockId)
    .filter(blockId => meaningfulBlockIds.has(blockId)));
  const meaningfulBlockCount = meaningfulBlockIds.size;
  const coverageRate = meaningfulBlockCount === 0 ? 1 : coveredBlocks.size / meaningfulBlockCount;
  if (coverageRate < 0.5) {
    issues.push({
      code: 'LOW_COVERAGE',
      severity: 'warning',
      message: `有效内容覆盖率仅为 ${Math.round(coverageRate * 100)}%`,
    });
  }

  const validTopicCount = input.topics.filter(topic => topic.evidenceIds.some(id => evidenceIds.has(id))).length;
  const status: CourseStructureStatus = corrupt || validTopicCount === 0
    ? 'failed'
    : issues.some(issue => issue.severity === 'error')
      ? 'degraded'
      : 'ready';

  return {
    status,
    validation: {
      issues,
      meaningfulBlockCount,
      coveredMeaningfulBlockCount: coveredBlocks.size,
      coverageRate,
    },
  };
}
