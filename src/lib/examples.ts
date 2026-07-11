import {
  CourseDocument,
  EvidenceAtom,
  KnowledgePackage,
  CourseGenerationMemory,
  CoursePage,
} from '../types';
import { generateId } from './utils';
import { generateEvidences } from './evidence';
import { createKnowledgePackage, setPackageNote, generateLocalNoteForPackage } from './knowledge-package';
import { generateLearningUnitsLocal } from './structure';
import { generateMasterNotesLocal } from './notes';
import { applyRecommendedOrder, topologicalSort, generateLocalTopicsFromEvidences } from './knowledge-graph';

// 示例课件页面（与真实PDF解析出的CoursePage格式一致）
const PAGES: CoursePage[] = [
  { pageNumber: 1, text: '概率模型基础\n从最大似然到线性回归', warning: undefined },
  { pageNumber: 2, text: '1. 引言\n本讲介绍概率模型、最大似然估计、线性回归、过拟合与正则化。', warning: undefined },
  { pageNumber: 3, text: '2. 概率模型基本概念\n概率模型是描述随机现象的数学框架。\n给定观测数据 D = {(x₁,y₁),...,(xₙ,yₙ)}，我们假设数据由含参数 θ 的概率分布生成：p(y|x;θ)。\n学习的目标是估计参数 θ。', warning: undefined },
  { pageNumber: 4, text: '3. 最大似然估计（MLE）\n似然函数 L(θ) = p(D|θ) = ∏ᵢ p(yᵢ|xᵢ;θ)\n最大似然估计：θ̂_MLE = argmax_θ L(θ)\n对数似然：l(θ) = log L(θ) = Σᵢ log p(yᵢ|xᵢ;θ)', warning: undefined },
  { pageNumber: 5, text: '4. 线性回归模型\ny = wᵀx + b + ε，其中 ε ~ N(0, σ²)\np(y|x;w,b) = N(y; wᵀx + b, σ²)', warning: undefined },
  { pageNumber: 6, text: '5. 线性回归的MLE推导\n对数似然：l(w,b) = -n/(2) log(2πσ²) - 1/(2σ²) Σᵢ (yᵢ - wᵀxᵢ - b)²\n最大化 l(w,b) 等价于最小化 J(w,b) = Σᵢ (yᵢ - wᵀxᵢ - b)²\n结论：高斯噪声假设下，MLE等价于最小二乘。', warning: undefined },
  { pageNumber: 7, text: '6. 偏差-方差平衡\n期望预测误差分解为：\nE[(y - f̂(x))²] = Bias²[f̂(x)] + Var[f̂(x)] + σ²\n简单模型偏差大方差小；复杂模型偏差小方差大。', warning: undefined },
  { pageNumber: 8, text: '7. 过拟合\n当模型过于复杂时，会"记住"训练数据中的噪声。\n表现：训练误差很小，测试误差很大。', warning: undefined },
  { pageNumber: 9, text: '8. 正则化\nJ_reg(w) = J(w) + λΩ(w)\nλ > 0 是正则化强度。正则化等价于最大后验估计（MAP）。', warning: undefined },
  { pageNumber: 10, text: '9. Ridge回归（L2正则化）\nΩ(w) = ||w||₂² = Σⱼ wⱼ²\nJ_Ridge(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼwⱼ²\n闭式解：ŵ_Ridge = (XᵀX + λI)⁻¹Xᵀy', warning: undefined },
  { pageNumber: 11, text: '10. Lasso回归（L1正则化）\nΩ(w) = ||w||₁ = Σⱼ |wⱼ|\nJ_Lasso(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼ|wⱼ|\n产生稀疏解，自动特征选择。', warning: undefined },
  { pageNumber: 12, text: '11. 总结\n- MLE是学习参数的基本方法\n- 高斯噪声下MLE等价于最小二乘\n- 偏差-方差权衡是模型选择核心\n- Ridge和Lasso是常用正则化方法', warning: undefined },
];

export function createExampleCourse(): { document: CourseDocument; evidences: EvidenceAtom[] } {
  const document: CourseDocument = {
    id: generateId('doc'),
    title: '概率模型基础',
    fileName: 'example.pdf',
    pages: PAGES,
    uploadedAt: Date.now(),
  };
  // 使用与真实PDF完全相同的证据生成管线
  const evidences = generateEvidences(PAGES, document.id);
  return { document, evidences };
}

export function createExampleCourseV2() {
  const { document, evidences } = createExampleCourse();

  // 使用通用算法生成知识结构（与真实上传流程一致）
  const buildResult = generateLocalTopicsFromEvidences(evidences);
  const { topics: rawTopics, relations } = buildResult;
  const topoResult = topologicalSort(rawTopics, relations);
  const topics = applyRecommendedOrder(rawTopics, topoResult);

  // 为每个知识点创建KnowledgePackage并生成本地笔记
  const knowledgePackages: KnowledgePackage[] = topics.map(t => {
    const kp = createKnowledgePackage(t, relations, evidences);
    const note = generateLocalNoteForPackage(kp);
    return setPackageNote(kp, note);
  });

  const learningUnits = generateLearningUnitsLocal(evidences);
  const masterNotes = generateMasterNotesLocal(learningUnits, evidences);
  const generationMemory: CourseGenerationMemory = {
    terminology: {},
    symbols: {},
    generatedTopicSummaries: {},
  };

  for (const kp of knowledgePackages) {
    if (kp.note) {
      generationMemory.generatedTopicSummaries[kp.topic.id] = kp.note.shortSummary;
    }
  }

  return {
    document,
    evidences,
    topics,
    macroRelations: relations,
    knowledgePackages,
    learningUnits,
    masterNotes,
    generationMemory,
    globalAnchors: [],
    occurrences: [],
    structureWarnings: topoResult.warnings,
  };
}
