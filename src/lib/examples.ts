import {
  ChapterNote,
  CourseDocument,
  CourseLearningPath,
  CourseMasterNote,
  FormulaCard,
  GlossaryItem,
  KnowledgeCard,
  KnowledgeTopic,
  MarkdownBlock,
  SourceDocument,
  SourceRange,
  TeachingBlock,
  TeachingRelation,
  TopicNarrativePath,
  TopicRelation,
} from '../types';
import { generateId } from './utils';
import { createSourceDocument } from './markdown-parser';
import { assembleCourseMasterNote, planFallbackChapters } from './course-master-note';
import { validateKnowledgeStructure } from './knowledge-validation';
import type { StructureQuality } from '../types';

// 示例课件：与真实流程一致，先有 Markdown 源文档，再挂知识结构与卡片。
// 数据为手工固化的 v6 结构（无 AI 也能完整演示知识网、卡片、母笔记）。
const EXAMPLE_MARKDOWN = `# 概率模型基础

从最大似然到线性回归。

## 1. 引言

本讲介绍概率模型、最大似然估计、线性回归、过拟合与正则化。

## 2. 概率模型基本概念

概率模型是描述随机现象的数学框架。

给定观测数据 D = {(x₁,y₁),...,(xₙ,yₙ)}，我们假设数据由含参数 θ 的概率分布生成：p(y|x;θ)。

学习的目标是估计参数 θ。

## 3. 最大似然估计（MLE）

似然函数 L(θ) = p(D|θ) = ∏ᵢ p(yᵢ|xᵢ;θ)

最大似然估计：θ̂_MLE = argmax_θ L(θ)

对数似然：l(θ) = log L(θ) = Σᵢ log p(yᵢ|xᵢ;θ)

## 4. 线性回归模型

y = wᵀx + b + ε，其中 ε ~ N(0, σ²)

p(y|x;w,b) = N(y; wᵀx + b, σ²)

## 5. 线性回归的MLE推导

对数似然：l(w,b) = -n/2 log(2πσ²) - 1/(2σ²) Σᵢ (yᵢ - wᵀxᵢ - b)²

最大化 l(w,b) 等价于最小化 J(w,b) = Σᵢ (yᵢ - wᵀxᵢ - b)²

结论：高斯噪声假设下，MLE等价于最小二乘。

## 6. 偏差-方差平衡

期望预测误差分解为：

E[(y - f̂(x))²] = Bias²[f̂(x)] + Var[f̂(x)] + σ²

简单模型偏差大方差小；复杂模型偏差小方差大。

## 7. 过拟合

当模型过于复杂时，会"记住"训练数据中的噪声。

表现：训练误差很小，测试误差很大。

## 8. 正则化

J_reg(w) = J(w) + λΩ(w)

λ > 0 是正则化强度。正则化等价于最大后验估计（MAP）。

## 9. Ridge回归（L2正则化）

Ω(w) = ||w||₂² = Σⱼ wⱼ²

J_Ridge(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼwⱼ²

闭式解：ŵ_Ridge = (XᵀX + λI)⁻¹Xᵀy

## 10. Lasso回归（L1正则化）

Ω(w) = ||w||₁ = Σⱼ |wⱼ|

J_Lasso(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼ|wⱼ|

产生稀疏解，自动特征选择。

## 11. 总结

- MLE是学习参数的基本方法
- 高斯噪声下MLE等价于最小二乘
- 偏差-方差权衡是模型选择核心
- Ridge和Lasso是常用正则化方法
`;

function blocksUnderHeading(doc: SourceDocument, heading: string): MarkdownBlock[] {
  return doc.blocks.filter(block =>
    block.headingPath.some(segment => segment.includes(heading)),
  );
}

function rangeOf(blocks: MarkdownBlock[]): SourceRange {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return {
    documentId: first.documentId,
    startBlockId: first.id,
    endBlockId: last.id,
  };
}

interface TopicSpec {
  name: string;
  aliases: string[];
  /** 主题覆盖的章节标题（可跨多个相邻小节） */
  headings: string[];
  summary: string;
  learningObjective: string;
  importance: KnowledgeTopic['importance'];
  difficulty: KnowledgeTopic['difficulty'];
  genre: KnowledgeTopic['knowledgeGenre'];
  blocks: Array<{
    title: string;
    type: string;
    /** 该讲解块引用的章节，默认第一个 */
    heading?: string;
    summary: string;
    detailedNote: string;
    keyPoints: string[];
    excerptLines: number[];
  }>;
}

const TOPIC_SPECS: TopicSpec[] = [
  {
    name: '概率模型',
    aliases: ['概率建模'],
    headings: ['2. 概率模型基本概念'],
    summary: '用含参数的概率分布描述数据生成机制，学习即参数估计。',
    learningObjective: '理解概率模型如何把学习问题转化为参数估计问题',
    importance: 'core',
    difficulty: 2,
    genre: 'concept',
    blocks: [
      {
        title: '概率模型的定义',
        type: 'definition',
        summary: '概率模型是描述随机现象的数学框架。',
        detailedNote: '概率模型假设观测数据由含参数 θ 的概率分布生成：p(y|x;θ)。\n\n给定数据集 D，学习的目标就是估计参数 θ。这个视角把"学规律"变成"估参数"，后续最大似然、回归、正则化都建立在此之上。',
        keyPoints: ['数据由分布生成', '参数 θ 待估计'],
        excerptLines: [0, 1],
      },
    ],
  },
  {
    name: '最大似然估计',
    aliases: ['MLE'],
    headings: ['3. 最大似然估计'],
    summary: '选择让观测数据出现概率最大的参数值。',
    learningObjective: '掌握似然函数与最大似然估计的定义',
    importance: 'core',
    difficulty: 3,
    genre: 'mathematical_derivation',
    blocks: [
      {
        title: '似然函数与 MLE 定义',
        type: 'formula',
        summary: '似然函数 L(θ) = p(D|θ)，MLE 是它的最大值点。',
        detailedNote: '似然函数把"参数"当作变量、把数据当作已知：\n\nL(θ) = p(D|θ) = ∏ᵢ p(yᵢ|xᵢ;θ)\n\n最大似然估计定义为 θ̂_MLE = argmax_θ L(θ)。由于连乘难处理，实践中最大化对数似然 l(θ) = Σᵢ log p(yᵢ|xᵢ;θ)。',
        keyPoints: ['似然是参数的函数', '连乘转对数求和'],
        excerptLines: [0, 1, 2],
      },
    ],
  },
  {
    name: '线性回归模型',
    aliases: ['线性回归'],
    headings: ['4. 线性回归模型'],
    summary: '线性预测子加高斯噪声的经典概率模型。',
    learningObjective: '写出线性回归的概率形式并指出其分布假设',
    importance: 'core',
    difficulty: 2,
    genre: 'concept',
    blocks: [
      {
        title: '线性回归的概率形式',
        type: 'formula',
        summary: 'y = wᵀx + b + ε，ε ~ N(0, σ²)。',
        detailedNote: '线性回归假设输出由线性预测子加高斯噪声生成：\n\ny = wᵀx + b + ε，其中 ε ~ N(0, σ²)\n\n因此 p(y|x;w,b) = N(y; wᵀx + b, σ²)。注意这是一个分布假设，不只是拟合一条线。',
        keyPoints: ['线性预测子', '高斯噪声假设'],
        excerptLines: [0, 1],
      },
    ],
  },
  {
    name: '线性回归的MLE推导',
    aliases: ['MLE与最小二乘'],
    headings: ['5. 线性回归的MLE推导'],
    summary: '高斯噪声假设下，MLE 等价于最小二乘。',
    learningObjective: '完成从对数似然到最小二乘目标的推导',
    importance: 'core',
    difficulty: 4,
    genre: 'mathematical_derivation',
    blocks: [
      {
        title: '从对数似然到最小二乘',
        type: 'derivation',
        summary: '最大化高斯对数似然等价于最小化平方误差和。',
        detailedNote: '写出对数似然：\n\nl(w,b) = -n/2 log(2πσ²) - 1/(2σ²) Σᵢ (yᵢ - wᵀxᵢ - b)²\n\n前一项与参数无关，最大化 l(w,b) 等价于最小化\n\nJ(w,b) = Σᵢ (yᵢ - wᵀxᵢ - b)²\n\n结论：高斯噪声假设下，MLE 等价于最小二乘。',
        keyPoints: ['常数项与参数无关', 'MLE = 最小二乘'],
        excerptLines: [0, 1, 2],
      },
    ],
  },
  {
    name: '偏差-方差平衡',
    aliases: ['偏差方差权衡'],
    headings: ['6. 偏差-方差平衡'],
    summary: '期望预测误差可分解为偏差平方、方差与不可约噪声。',
    learningObjective: '解释误差分解各项含义及其随复杂度的变化',
    importance: 'important',
    difficulty: 3,
    genre: 'mathematical_derivation',
    blocks: [
      {
        title: '误差分解公式',
        type: 'formula',
        summary: 'E[(y - f̂(x))²] = Bias² + Var + σ²。',
        detailedNote: '期望预测误差可分解为：\n\nE[(y - f̂(x))²] = Bias²[f̂(x)] + Var[f̂(x)] + σ²\n\n简单模型偏差大方差小；复杂模型偏差小方差大。模型选择的本质是在两项之间权衡，σ² 是数据本身的噪声下界。',
        keyPoints: ['偏差来自错误假设', '方差来自对样本敏感'],
        excerptLines: [1, 2],
      },
    ],
  },
  {
    name: '过拟合',
    aliases: ['过学习'],
    headings: ['7. 过拟合'],
    summary: '模型记住训练噪声，训练误差小而测试误差大。',
    learningObjective: '识别过拟合的表现与其在偏差-方差分解中的位置',
    importance: 'important',
    difficulty: 2,
    genre: 'concept',
    blocks: [
      {
        title: '过拟合的现象',
        type: 'mechanism',
        summary: '模型过于复杂时记住训练数据中的噪声。',
        detailedNote: '当模型过于复杂时，会"记住"训练数据中的噪声。\n\n表现：训练误差很小，测试误差很大。在偏差-方差语言里，这就是方差项主导了误差。',
        keyPoints: ['训练/测试误差剪刀差', '本质是高方差'],
        excerptLines: [0, 1],
      },
    ],
  },
  {
    name: '正则化',
    aliases: ['MAP正则化'],
    headings: ['8. 正则化'],
    summary: '在目标函数上加惩罚项抑制复杂度，等价于 MAP。',
    learningObjective: '理解正则化项的作用及其贝叶斯解释',
    importance: 'core',
    difficulty: 3,
    genre: 'concept',
    blocks: [
      {
        title: '正则化目标函数',
        type: 'formula',
        summary: 'J_reg(w) = J(w) + λΩ(w)。',
        detailedNote: '正则化在原目标上加惩罚项：\n\nJ_reg(w) = J(w) + λΩ(w)\n\nλ > 0 控制正则化强度，Ω(w) 度量复杂度。正则化等价于最大后验估计（MAP）：惩罚项对应参数的先验分布。',
        keyPoints: ['λ 控制强度', '等价于 MAP'],
        excerptLines: [0, 1],
      },
    ],
  },
  {
    name: 'Ridge与Lasso回归',
    aliases: ['岭回归', 'L1正则化', 'L2正则化'],
    headings: ['9. Ridge回归（L2正则化）', '10. Lasso回归（L1正则化）'],
    summary: 'L2 惩罚收缩权重，L1 惩罚产生稀疏解。',
    learningObjective: '对比两种正则化的目标函数、求解与结果差异',
    importance: 'important',
    difficulty: 3,
    genre: 'comparison',
    blocks: [
      {
        title: 'Ridge（L2）回归',
        type: 'formula',
        summary: 'Ω(w) = ||w||₂²，有闭式解。',
        detailedNote: 'Ridge 使用 L2 惩罚 Ω(w) = ||w||₂² = Σⱼ wⱼ²：\n\nJ_Ridge(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼwⱼ²\n\n闭式解：ŵ_Ridge = (XᵀX + λI)⁻¹Xᵀy。λ 越大，权重整体收缩越明显。',
        keyPoints: ['权重整体收缩', '闭式解存在'],
        excerptLines: [0, 1, 2],
      },
      {
        title: 'Lasso（L1）回归',
        type: 'formula',
        heading: '10. Lasso回归（L1正则化）',
        summary: 'Ω(w) = ||w||₁，产生稀疏解。',
        detailedNote: 'Lasso 使用 L1 惩罚 Ω(w) = ||w||₁ = Σⱼ |wⱼ|：\n\nJ_Lasso(w) = Σᵢ(yᵢ - wᵀxᵢ)² + λΣⱼ|wⱼ|\n\nL1 惩罚会把部分权重压到恰好为零，产生稀疏解，实现自动特征选择。',
        keyPoints: ['稀疏解', '自动特征选择'],
        excerptLines: [0, 1],
      },
    ],
  },
];

const TOPIC_RELATIONS: Array<{
  from: string;
  to: string;
  type: TopicRelation['type'];
  reason: string;
}> = [
  { from: '概率模型', to: '最大似然估计', type: 'hard_prerequisite', reason: 'MLE 是在概率模型框架下定义参数估计方法' },
  { from: '概率模型', to: '线性回归模型', type: 'hard_prerequisite', reason: '线性回归是高斯概率模型的具体实例' },
  { from: '最大似然估计', to: '线性回归的MLE推导', type: 'derived_from', reason: '推导直接套用 MLE 的对数似然最大化' },
  { from: '线性回归模型', to: '线性回归的MLE推导', type: 'hard_prerequisite', reason: '推导依赖线性回归的高斯噪声假设' },
  { from: '偏差-方差平衡', to: '过拟合', type: 'application_of', reason: '过拟合是方差项主导误差的具体表现' },
  { from: '过拟合', to: '正则化', type: 'extension_of', reason: '正则化是应对过拟合的标准手段' },
  { from: '正则化', to: 'Ridge与Lasso回归', type: 'hard_prerequisite', reason: '两种回归是正则化目标的具体化' },
];

const GLOSSARY: GlossaryItem[] = [
  { term: '似然函数', aliases: ['likelihood'], definition: '参数取值下观测数据出现的概率 L(θ) = p(D|θ)。', topicId: 'topic-mle' },
  { term: '偏差-方差分解', aliases: [], definition: '期望误差 = 偏差² + 方差 + 不可约噪声。', topicId: 'topic-bias-variance' },
  { term: '正则化', aliases: ['regularization'], definition: '在目标函数上加复杂度惩罚项 J_reg(w) = J(w) + λΩ(w)。', topicId: 'topic-regularization' },
];

export interface ExampleCourse {
  document: CourseDocument;
  sourceDocuments: SourceDocument[];
  knowledgeTopics: KnowledgeTopic[];
  topicRelations: TopicRelation[];
  teachingBlocks: TeachingBlock[];
  teachingRelations: TeachingRelation[];
  courseLearningPath: CourseLearningPath;
  narrativePaths: Record<string, TopicNarrativePath>;
  knowledgeCards: KnowledgeCard[];
  glossary: GlossaryItem[];
  formulaCards: FormulaCard[];
  courseMasterNote: CourseMasterNote;
  structureVersion: number;
  structureQuality: StructureQuality;
}

/** courseId 传入时（工作区内加载示例）文档与知识产物挂到该课程空间，刷新后可从课件库恢复。 */
export function createExampleCourse(courseId?: string): ExampleCourse {
  const resolvedCourseId = courseId ?? generateId('course');
  const sourceDocument = createSourceDocument(EXAMPLE_MARKDOWN, resolvedCourseId, '概率模型基础');
  const doc = sourceDocument;

  const topics: KnowledgeTopic[] = [];
  const teachingBlocks: TeachingBlock[] = [];
  const teachingRelations: TeachingRelation[] = [];
  const narrativePaths: Record<string, TopicNarrativePath> = {};
  const knowledgeCards: KnowledgeCard[] = [];
  const formulaCards: FormulaCard[] = [];
  const topicIdByName = new Map<string, string>();

  TOPIC_SPECS.forEach((spec, topicIndex) => {
    const topicId = `topic-${spec.name === '最大似然估计' ? 'mle' : `t${topicIndex + 1}`}`;
    topicIdByName.set(spec.name, topicId);
    const sectionBlocks = spec.headings.flatMap(heading => blocksUnderHeading(doc, heading));
    const sourceRanges = sectionBlocks.length > 0 ? [rangeOf(sectionBlocks)] : [];

    topics.push({
      id: topicId,
      courseId: resolvedCourseId,
      name: spec.name,
      aliases: spec.aliases,
      summary: spec.summary,
      learningObjective: spec.learningObjective,
      sourceRanges,
      childTopicIds: [],
      importance: spec.importance,
      difficulty: spec.difficulty,
      knowledgeGenre: spec.genre,
      confidence: 0.95,
      status: 'generated',
    });

    const topicBlockIds: string[] = [];
    spec.blocks.forEach((blockSpec) => {
      const blockId = generateId('tb');
      const citeBlocks = blocksUnderHeading(doc, blockSpec.heading ?? spec.headings[0]);
      const citedBlocks = blockSpec.excerptLines
        .map(line => citeBlocks[line])
        .filter(Boolean);
      const blockRanges = citedBlocks.length > 0 ? [rangeOf(citedBlocks)] : sourceRanges;

      teachingBlocks.push({
        id: blockId,
        topicId,
        type: blockSpec.type,
        title: blockSpec.title,
        sourceRanges: blockRanges,
        summary: blockSpec.summary,
        importance: 'required',
        confidence: 0.9,
      });
      topicBlockIds.push(blockId);

      const cardId = generateId('card');
      knowledgeCards.push({
        id: cardId,
        courseId: resolvedCourseId,
        topicId,
        topicName: spec.name,
        teachingBlockId: blockId,
        teachingType: blockSpec.type,
        title: blockSpec.title,
        conciseSummary: blockSpec.summary,
        detailedNote: blockSpec.detailedNote,
        keyPoints: blockSpec.keyPoints,
        sourceExcerpt: citedBlocks.map(block => block.content).join('\n\n') || undefined,
        sourceRanges: blockRanges,
        keywords: [spec.name, ...spec.aliases],
        aliases: spec.aliases,
        prerequisiteTopicIds: [],
        relatedTopicIds: [],
        confidence: 0.9,
        reviewStatus: 'generated',
        narrativeIndex: topicBlockIds.length - 1,
        status: 'completed',
        sourceVersion: 1,
        cardVersion: 1,
      });

      if (blockSpec.type === 'formula' || blockSpec.type === 'derivation') {
        const formulaMatch = blockSpec.detailedNote.match(/[A-Za-zΩθλŷᵀ₀-₉()|²,.;:+=\- ]{6,}/);
        if (formulaMatch) {
          formulaCards.push({
            id: generateId('formula'),
            topicId,
            formula: formulaMatch[0].trim(),
            description: blockSpec.title,
            sourceRanges: blockRanges,
          });
        }
      }
    });

    narrativePaths[topicId] = {
      topicId,
      orderedTeachingBlockIds: topicBlockIds,
      rationale: `按“${spec.blocks.map(block => block.title).join(' → ')}”的顺序讲解`,
    };

    // 讲解块之间的先后关系
    for (let i = 1; i < topicBlockIds.length; i++) {
      teachingRelations.push({
        id: generateId('tr'),
        topicId,
        sourceBlockId: topicBlockIds[i - 1],
        targetBlockId: topicBlockIds[i],
        type: 'narrative_order',
        reason: '讲解顺序上的承接',
        confidence: 0.8,
      });
    }
  });

  const topicRelations: TopicRelation[] = TOPIC_RELATIONS
    .map(({ from, to, type, reason }) => {
      const sourceTopicId = topicIdByName.get(from);
      const targetTopicId = topicIdByName.get(to);
      if (!sourceTopicId || !targetTopicId) return null;
      return {
        id: generateId('rel'),
        sourceTopicId,
        targetTopicId,
        type,
        reason,
        confidence: 0.85,
      };
    })
    .filter((relation): relation is TopicRelation => relation !== null);

  // 学习顺序：先基础概念与方法，再推导与权衡，最后正则化
  const orderPreference = [
    '概率模型',
    '最大似然估计',
    '线性回归模型',
    '线性回归的MLE推导',
    '偏差-方差平衡',
    '过拟合',
    '正则化',
    'Ridge与Lasso回归',
  ];
  const orderedTopicIds = orderPreference
    .map(name => topicIdByName.get(name))
    .filter((id): id is string => Boolean(id));

  const courseLearningPath: CourseLearningPath = {
    orderedTopicIds,
    steps: orderedTopicIds.map(topicId => {
      const prerequisites = topicRelations
        .filter(relation => relation.targetTopicId === topicId && relation.type === 'hard_prerequisite')
        .map(relation => relation.sourceTopicId);
      const topic = topics.find(item => item.id === topicId);
      return {
        topicId,
        reason: `${topic?.learningObjective ?? ''}` || '按课程叙事顺序推进',
        prerequisiteTopicIds: prerequisites,
      };
    }),
  };

  // 母笔记：用与线上降级一致的本地组装路径
  const structureVersion = topics.length;
  const outline = planFallbackChapters(topics, orderedTopicIds, 3);
  const cardsByTopic = new Map(topics.map(topic => [
    topic.id,
    knowledgeCards.filter(card => card.topicId === topic.id),
  ]));
  const chapterNotes: ChapterNote[] = outline.map(plan => ({
    ...plan,
    markdown: [
      `## ${plan.title}`,
      '',
      ...plan.topicIds.map(topicId => {
        const topic = topics.find(item => item.id === topicId);
        const cards = cardsByTopic.get(topicId) ?? [];
        return [
          `### ${topic?.name ?? topicId}`,
          '',
          topic?.summary ?? '',
          '',
          ...cards.flatMap(card => [card.detailedNote, '']),
        ].join('\n');
      }),
    ].join('\n'),
    sourceCardIds: plan.topicIds.flatMap(topicId =>
      (cardsByTopic.get(topicId) ?? []).map(card => card.id),
    ),
    status: 'completed',
    retryCount: 0,
  }));
  const courseMasterNote = assembleCourseMasterNote({
    courseId: resolvedCourseId,
    title: '概率模型基础',
    outline,
    chapterNotes,
    knowledgeCards,
    glossary: GLOSSARY,
    formulaIndex: formulaCards,
    structureVersion,
  });

  // 文档对象：给文档审阅阶段提供页级预览
  const pageTexts = EXAMPLE_MARKDOWN.split(/\n(?=## )/);
  const document: CourseDocument = {
    id: doc.id,
    courseId: resolvedCourseId,
    title: '概率模型基础',
    fileName: 'example-概率模型基础.md',
    fileType: 'markdown',
    pages: pageTexts.map((text, index) => ({
      pageNumber: index + 1,
      text: text.trim(),
      warning: undefined,
    })),
    uploadedAt: Date.now(),
  };

  const validation = validateKnowledgeStructure(doc.blocks, topics, teachingBlocks, topicRelations, []);
  const structureQuality: StructureQuality = {
    coverageRate: validation.coverage.coverageRate,
    totalBlocks: validation.coverage.totalBlocks,
    assignedBlocks: validation.coverage.assignedBlocks,
    topicCount: validation.topicStats.totalTopics,
    topicsWithTeachingBlocks: validation.topicStats.topicsWithTeachingBlocks,
  };

  return {
    document,
    sourceDocuments: [doc],
    knowledgeTopics: topics,
    topicRelations,
    teachingBlocks,
    teachingRelations,
    courseLearningPath,
    narrativePaths,
    knowledgeCards,
    glossary: GLOSSARY,
    formulaCards,
    courseMasterNote,
    structureVersion,
    structureQuality,
  };
}
