import {
  MasterNoteUnit,
  LearningUnit,
  EvidenceAtom,
  Claim,
  ViewType,
  ViewConfig,
} from '../types';
import { generateId } from './utils';

// 视图配置
export const VIEW_CONFIGS: Record<ViewType, ViewConfig> = {
  'first-study': {
    showSummary: true,
    showKeyClaims: true,
    showFormulas: true,
    showExamples: true,
    showProcedures: true,
    showEvidenceRefs: true,
    compressionLevel: 'full',
  },
  'review': {
    showSummary: true,
    showKeyClaims: true,
    showFormulas: true,
    showExamples: false,
    showProcedures: true,
    showEvidenceRefs: true,
    compressionLevel: 'condensed',
  },
  'exam': {
    showSummary: false,
    showKeyClaims: true,
    showFormulas: true,
    showExamples: false,
    showProcedures: false,
    showEvidenceRefs: false,
    compressionLevel: 'keywords',
  },
};

// 从证据创建声明
function evidenceToClaim(
  evidence: EvidenceAtom,
  importance: Claim['importance'] = 'supporting'
): Claim {
  return {
    id: generateId('claim'),
    content: evidence.content,
    evidenceIds: [evidence.id],
    importance,
  };
}

// 生成本地母笔记（确定性方法，无需模型）
export function generateMasterNotesLocal(
  units: LearningUnit[],
  evidences: EvidenceAtom[]
): MasterNoteUnit[] {
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));

  return units.map(unit => {
    const unitEvidences = unit.evidenceIds
      .map(id => evidenceMap.get(id))
      .filter((e): e is EvidenceAtom => e !== undefined);

    // 按类型分组证据
    const definitions = unitEvidences.filter(e => e.type === 'definition');
    const formulas = unitEvidences.filter(e => e.type === 'formula');
    const examples = unitEvidences.filter(e => e.type === 'example');
    const procedures = unitEvidences.filter(e => e.type === 'procedure');
    const comparisons = unitEvidences.filter(e => e.type === 'comparison');
    const titles = unitEvidences.filter(e => e.type === 'title');
    const texts = unitEvidences.filter(e => e.type === 'text');

    // 生成摘要
    const summaryParts: string[] = [];
    if (titles.length > 0) {
      summaryParts.push(titles.map(t => t.content).join('；'));
    }
    if (definitions.length > 0) {
      summaryParts.push(`包含${definitions.length}个核心定义`);
    }
    if (formulas.length > 0) {
      summaryParts.push(`${formulas.length}个重要公式`);
    }
    const summary = summaryParts.join('，') || '本单元涵盖相关主题内容';

    // 关键声明：定义和比较作为核心
    const keyClaims: Claim[] = [
      ...definitions.map((e, i) => evidenceToClaim(e, i === 0 ? 'core' : 'supporting')),
      ...comparisons.map(e => evidenceToClaim(e, 'core')),
      ...texts.slice(0, 2).map(e => evidenceToClaim(e, 'supporting')),
    ];

    // 公式
    const formulaClaims: Claim[] = formulas.map(e => evidenceToClaim(e, 'core'));

    // 示例
    const exampleClaims: Claim[] = examples.map(e => evidenceToClaim(e, 'detail'));

    // 步骤
    const procedureClaims: Claim[] = procedures.map(e => evidenceToClaim(e, 'supporting'));

    return {
      unitId: unit.id,
      title: unit.title,
      objective: unit.objective,
      summary,
      keyClaims,
      formulas: formulaClaims,
      examples: exampleClaims,
      procedures: procedureClaims,
    };
  });
}

// 从模型响应解析母笔记（带验证和降级）
export function parseMasterNotesFromModel(
  modelOutput: unknown,
  units: LearningUnit[],
  evidences: EvidenceAtom[]
): MasterNoteUnit[] {
  // 模型输出格式验证失败时回退到本地生成
  try {
    if (!modelOutput || typeof modelOutput !== 'object') {
      return generateMasterNotesLocal(units, evidences);
    }

    const output = modelOutput as { units?: Array<{
      unitId: string;
      title?: string;
      objective?: string;
      summary?: string;
      keyClaims?: Array<{ content: string; evidenceIds?: string[]; importance?: Claim['importance'] }>;
      formulas?: Array<{ content: string; evidenceIds?: string[] }>;
      examples?: Array<{ content: string; evidenceIds?: string[] }>;
      procedures?: Array<{ content: string; evidenceIds?: string[] }>;
    }> };

    if (!output.units || !Array.isArray(output.units)) {
      return generateMasterNotesLocal(units, evidences);
    }

    const validEvidenceIds = new Set(evidences.map(e => e.id));
    const unitMap = new Map(units.map(u => [u.id, u]));

    const result: MasterNoteUnit[] = [];

    for (const modelUnit of output.units) {
      if (!modelUnit.unitId || !unitMap.has(modelUnit.unitId)) {
        continue; // 丢弃无效单元ID
      }

      const originalUnit = unitMap.get(modelUnit.unitId)!;

      const validateClaimEvidences = (claim: { evidenceIds?: string[] }): string[] => {
        if (!claim.evidenceIds) return [];
        return claim.evidenceIds.filter(id => validEvidenceIds.has(id));
      };

      const parseClaims = (
        claims: Array<{ content: string; evidenceIds?: string[]; importance?: Claim['importance'] }> | undefined,
        defaultImportance: Claim['importance']
      ): Claim[] => {
        if (!claims || !Array.isArray(claims)) return [];
        return claims
          .filter(c => c.content && typeof c.content === 'string')
          .map(c => {
            const validIds = validateClaimEvidences(c);
            // 如果没有有效证据ID，使用单元的第一个证据或丢弃
            if (validIds.length === 0 && originalUnit.evidenceIds.length > 0) {
              validIds.push(originalUnit.evidenceIds[0]);
            }
            return {
              id: generateId('claim'),
              content: c.content,
              evidenceIds: validIds.length > 0 ? validIds : originalUnit.evidenceIds.slice(0, 1),
              importance: c.importance || defaultImportance,
            };
          })
          .filter(c => c.evidenceIds.length > 0);
      };

      result.push({
        unitId: modelUnit.unitId,
        title: modelUnit.title || originalUnit.title,
        objective: modelUnit.objective || originalUnit.objective,
        summary: modelUnit.summary || originalUnit.objective,
        keyClaims: parseClaims(modelUnit.keyClaims, 'core'),
        formulas: parseClaims(modelUnit.formulas, 'core'),
        examples: parseClaims(modelUnit.examples, 'detail'),
        procedures: parseClaims(modelUnit.procedures, 'supporting'),
      });
    }

    // 如果没有有效单元，回退到本地生成
    if (result.length === 0) {
      return generateMasterNotesLocal(units, evidences);
    }

    return result;
  } catch {
    return generateMasterNotesLocal(units, evidences);
  }
}

// 导出为Markdown
export function exportToMarkdown(
  notes: MasterNoteUnit[],
  evidences: EvidenceAtom[],
  viewType: ViewType = 'first-study',
  documentTitle: string = '课件笔记'
): string {
  const config = VIEW_CONFIGS[viewType];
  const evidenceMap = new Map(evidences.map(e => [e.id, e]));

  const lines: string[] = [];
  lines.push(`# ${documentTitle}`);
  lines.push('');
  lines.push(`> 视图模式：${viewType === 'first-study' ? '首次学习' : viewType === 'review' ? '课后复习' : '考前速查'}`);
  lines.push('');

  for (const note of notes) {
    lines.push(`## ${note.title}`);
    lines.push('');

    if (config.showSummary && config.compressionLevel !== 'keywords') {
      lines.push(`**学习目标：** ${note.objective}`);
      lines.push('');
      if (config.compressionLevel === 'full') {
        lines.push(`**摘要：** ${note.summary}`);
        lines.push('');
      }
    }

    if (config.showKeyClaims && note.keyClaims.length > 0) {
      if (config.compressionLevel !== 'keywords') {
        lines.push('### 核心要点');
      }
      for (const claim of note.keyClaims) {
        if (config.compressionLevel === 'keywords') {
          lines.push(`- ${claim.content.split(/[，。；]/)[0]}`);
        } else {
          const refs = config.showEvidenceRefs
            ? ` [${claim.evidenceIds.map(id => {
                const ev = evidenceMap.get(id);
                return ev ? `P${ev.pageNumber}` : '';
              }).filter(Boolean).join(', ')}]`
            : '';
          lines.push(`- ${claim.content}${refs}`);
        }
      }
      lines.push('');
    }

    if (config.showFormulas && note.formulas.length > 0) {
      if (config.compressionLevel !== 'keywords') {
        lines.push('### 重要公式');
      }
      for (const formula of note.formulas) {
        if (config.compressionLevel === 'keywords') {
          lines.push(`- ${formula.content.substring(0, 50)}`);
        } else {
          const refs = config.showEvidenceRefs
            ? ` [${formula.evidenceIds.map(id => {
                const ev = evidenceMap.get(id);
                return ev ? `P${ev.pageNumber}` : '';
              }).filter(Boolean).join(', ')}]`
            : '';
          lines.push(`- ${formula.content}${refs}`);
        }
      }
      lines.push('');
    }

    if (config.showProcedures && note.procedures.length > 0) {
      lines.push('### 步骤/流程');
      for (const proc of note.procedures) {
        const refs = config.showEvidenceRefs
          ? ` [${proc.evidenceIds.map(id => {
              const ev = evidenceMap.get(id);
              return ev ? `P${ev.pageNumber}` : '';
            }).filter(Boolean).join(', ')}]`
          : '';
        lines.push(`- ${proc.content}${refs}`);
      }
      lines.push('');
    }

    if (config.showExamples && note.examples.length > 0) {
      lines.push('### 示例');
      for (const example of note.examples) {
        const refs = config.showEvidenceRefs
          ? ` [${example.evidenceIds.map(id => {
              const ev = evidenceMap.get(id);
              return ev ? `P${ev.pageNumber}` : '';
            }).filter(Boolean).join(', ')}]`
          : '';
        lines.push(`- ${example.content}${refs}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// 获取证据引用页码文本
export function getEvidencePageRef(evidences: EvidenceAtom[], evidenceIds: string[]): string {
  const pages = new Set(
    evidenceIds
      .map(id => evidences.find(e => e.id === id))
      .filter((e): e is EvidenceAtom => e !== undefined)
      .map(e => e.pageNumber)
  );
  return Array.from(pages).sort((a, b) => a - b).map(p => `P${p}`).join(', ');
}
