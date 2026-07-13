# 双层知识网、知识卡片与课程母笔记设计

## 1. 目标

本次改造同时解决三个问题：

1. 一级课程知识网和二级内部知识网在同一画布上缺少明确的视觉边界。
2. 当前逐知识点生成的内容被称为“笔记”，但它实际只是后续综合所需的原子材料。
3. 进入笔记页时只检查流程状态，可能出现状态完成但正文为空，且长课件缺少可靠的分章生成与失败恢复机制。

目标流程调整为：

```text
上传课件
→ 课件预览
→ MinerU 解析
→ 知识结构
→ 知识卡片
→ 完整笔记
```

知识生成主链路调整为：

```text
MinerU Markdown
→ 两层知识网
→ KnowledgeCard
→ TopicSynthesis
→ ChapterNote
→ CourseMasterNote
```

事实和公式始终以 MinerU Markdown 对应的 `SourceRange` 为来源。后续阶段只组织、解释和综合，不把 AI 派生内容伪装成课件原文。

## 2. 当前代码映射

当前 V2 管线已经具备以下基础：

- `knowledge-pipeline-v2.ts` 生成 `KnowledgeTopic`、`TeachingBlock`、两层关系和遍历顺序。
- `card-generator.ts` 已经能够按 `TeachingBlock` 生成 `KnowledgeCard[]`。
- `note-generator-v2.ts` 生成的 `TopicNote[]` 仍是逐一级知识点内容，不是真正的课程完整笔记。
- `MarkdownNotesView.tsx` 把 `TopicNote[]` 顺序拼接后展示和导出，因此页面名称和最终产物语义不一致。
- `master-note.ts` 和 `notes-v2.ts` 存在旧版母笔记能力，但没有成为当前 V2 管线的一等数据对象。

本设计保留现有证据、知识网和卡片数据，重新划分生成阶段和页面职责，不重复实现 MinerU 解析或知识提取。

## 3. 双层知识网视觉模型

### 3.1 一级网始终是主网

一级节点来源于 `KnowledgeTopic`，表示能够形成独立学习目标的课程核心知识。

- 使用较大的深色实心节点。
- 节点显示课程遍历序号，例如 `② 广义线性模型`。
- 一级关系使用较粗实线，并在可读缩放级别显示关系名称。
- 一级网始终保留在画布中，不再通过切换页面进入完全独立的第二层画布。
- 未展开二级网时，画布自动适应完整一级网。

一级编号来自课程网的稳定遍历结果，不再提供“推荐路径”按钮。编号只表达建议学习顺序，不替代网络中的其他关系。

### 3.2 二级网是当前一级节点的临时展开区域

点击一级节点时，系统在同一张画布中展开该节点的 `TeachingBlock` 和 `TeachingRelation`：

- 当前一级节点保持高亮。
- 其他一级节点降低透明度但仍可见。
- 画布移动并缩放，使二级子网成为视觉中心。
- 子网节点被包围在带浅色背景、边框和圆角的分组区域内。
- 分组标题为“{一级知识名称} · 内部知识网”。
- 二级节点使用较小、较浅的卡片，编号为 `一级序号.二级序号`，例如 `②.③ 链接函数`。

二级知识类型不再局限于固定枚举。模型可以根据课件生成公式、定义组成、知识分类、算法分支、推导环节、假设、条件、性质、结论、案例、限制或其他具有学习价值的内容。类型字段为开放字符串，只用于说明，不作为生成约束。

### 3.3 子网左上角关闭按钮

关闭入口必须属于子网区域，而不是页面工具栏：

```text
┌─ ×  广义线性模型 · 内部知识网 ───────────┐
│                                           │
│  ②.① GLM 组成 → ②.② 指数分布族           │
│                    ↓                      │
│                 ②.③ 链接函数              │
│                                           │
└───────────────────────────────────────────┘
```

`×` 位于子网边界左上角，悬浮提示为“收起内部知识网”。点击后：

- 只清除展开状态，不删除任何节点、关系或生成结果。
- 画布恢复一级网视口。
- 原一级节点保持选中，右侧继续展示其信息。
- 不出现二次确认，因为该操作完全可逆且不改变数据。

实现上，图模型增加展开分组元数据；画布根据该分组包含的节点位置计算包围盒，在节点和边下方绘制分组背景，并在包围盒左上角绘制可点击的 `×`。

```ts
interface ExpandedNetworkGroup {
  topicId: string;
  label: string;
  nodeIds: string[];
}
```

### 3.4 两层分别建网和编号

两层关系不能从一个线性顺序反推，而要分别由 AI 遍历节点后建立：

```text
提取一级节点
→ 分批判断一级节点关系
→ 合并一级网
→ 环检测与稳定遍历
→ 为每个一级节点提取二级节点
→ 分批判断该一级节点内的二级关系
→ 合并二级网
→ 环检测与稳定遍历
```

稳定遍历优先级为：

```text
硬前置
> 推导
> 组成与定义
> 方法步骤
> 软前置
> 教学连贯性
> 原文顺序
```

关系网保存全部有效关系；编号仅显示从关系网派生的稳定遍历顺序。

### 3.5 右侧信息面板

点击一级节点时显示：

- 知识摘要和学习目标；
- 直接前置、后继及关系类型；
- 二级节点数量；
- 全部 `SourceRange` 对应原文。

点击二级节点时显示：

- 名称、开放类型和 AI 概括；
- 公式、定义或具体内容；
- 与其他二级节点的直接关系；
- MinerU Markdown 原文和来源范围；
- 对应知识卡片入口。

原文预览通过现有 Markdown 渲染器和 KaTeX 渲染公式。无法解析的 LaTeX 显示为局部错误块，不能把整段 Markdown 变成红色普通文本。

## 4. 知识卡片阶段

### 4.1 定位

现有逐知识点笔记改名为“知识卡片”。一张卡片对应一个二级知识节点，是事实受控、可复用、可独立重试的最小讲解单元，不是最终阅读产物。

```ts
interface KnowledgeCard {
  id: string;
  topicId: string;
  teachingBlockId: string;
  title: string;
  summary: string;
  details: string;
  formulas: FormulaItem[];
  keywords: string[];
  sourceRanges: SourceRange[];
  prerequisiteIds: string[];
  relatedIds: string[];
  status: GenerationStatus;
  sourceVersion: number;
  cardVersion: number;
}
```

卡片必须保留来源范围和版本信息。课件原文、二级结构或提示词版本变化时，卡片标记为过期，不能被静默当作最新内容用于母笔记。

### 4.2 页面

知识卡片页左侧按一级知识分组列出二级卡片；中间显示卡片正文；右侧显示对应 MinerU 原文。

卡片正文包含：

- 一句话直觉；
- 自然讲解；
- 公式、符号和适用条件；
- 与前后知识的直接关系；
- 来源引用和生成状态。

页面支持单张重新生成、编辑、标记需补充、标记错误、返回网络节点、查看原文和批量生成缺失卡片。

## 5. 一级知识综合

`TopicSynthesis` 汇总同一一级节点下的全部知识卡片，是卡片与章节之间的中间层：

```ts
interface TopicSynthesis {
  id: string;
  topicId: string;
  framework: string[];
  orderedCardIds: string[];
  parallelGroups: ParallelGroup[];
  comparisons: ComparisonItem[];
  formulaChains: FormulaChain[];
  markdown: string;
  cardVersions: Record<string, number>;
  status: GenerationStatus;
}
```

该阶段负责：

- 把零散卡片组织成一级知识的内部讲解框架；
- 识别并列分类、方法族和情况分支；
- 识别适合使用表格的比较关系；
- 把相关公式整理成“前提—符号—公式—推导—含义—条件”的公式链；
- 合并重复定义，但保留所有证据引用；
- 生成供章节阶段使用的短摘要，避免把全部卡片正文反复传入后续调用。

## 6. 章节规划与章节笔记

### 6.1 章节规划

系统根据一级知识网的关系、稳定遍历顺序、主题聚类和课件章节信息生成课程框架。框架生成后先展示给用户，再开始正文生成。

章节规划输入只包含：

- 一级节点名称、摘要和关系；
- 一级稳定遍历顺序；
- 课件原有标题路径；
- 每个一级节点的 `TopicSynthesis` 短摘要。

不把整份 MinerU Markdown 或全部卡片正文一次性交给模型。

### 6.2 章节笔记

```ts
interface ChapterNote {
  id: string;
  title: string;
  objective: string;
  framework: ChapterFramework;
  topicIds: string[];
  markdown: string;
  sourceCardIds: string[];
  status: GenerationStatus;
  error?: string;
  retryCount: number;
}
```

每章单独调用、持久化和重试。生成当前章节时只输入：

- 当前章节框架；
- 当前章节的 `TopicSynthesis`；
- 直接前置章节的短摘要；
- 全局术语表和符号表；
- 笔记风格与证据约束。

章节内容自然组织，但至少要完成以下理解优化：

1. 知识较多时先给出具体框架和本章要解决的问题。
2. 并列知识先概括共同框架，再分别解释，最后总结差异。
3. 适合比较时使用对照表，不适合时使用连贯文字。
4. 复杂概念先给直觉，再给正式定义和公式。
5. 公式按前提、符号、推导、含义和适用条件组织。
6. 示例必须说明它验证或解释了哪个知识。
7. 只在必要处回顾前置知识，避免重复整段内容。
8. 标明易错点、适用边界、证据冲突和 AI 补全推导。
9. 在章节结束说明本章知识之间的关系以及为什么进入下一章。

## 7. 课程母笔记

```ts
interface CourseMasterNote {
  id: string;
  title: string;
  outline: OutlineItem[];
  chapters: ChapterNote[];
  glossary: GlossaryItem[];
  formulaIndex: FormulaIndexItem[];
  markdown: string;
  coverage: CoverageReport;
  status: GenerationStatus;
  generatedFromStructureVersion: number;
}
```

课程母笔记不通过一次大模型调用重写整门课程，而是按章节顺序确定性组装。组装阶段只允许：

- 添加课程目录和章节导读；
- 统一标题层级、术语和符号；
- 删除重复回顾；
- 添加轻量章节过渡；
- 聚合公式索引和术语索引；
- 检查每张有效知识卡片是否被章节覆盖。

它不能修改公式、知识事实和证据引用。若全局检查发现冲突，记录为可见警告，而不是静默覆盖。

## 8. 完整笔记页面

完整笔记生成前先展示课程框架；生成时显示可恢复的真实阶段：

```text
正在规划课程框架
正在生成第 2/6 章
正在整理并列知识
正在统一公式和符号
正在检查知识覆盖率
正在组装完整笔记
```

阅读页采用：

```text
课程目录 | 完整笔记正文 | 本段来源/知识卡片
```

正文默认突出课程框架、章节框架和自然讲解；证据与卡片入口默认收起。支持目录跳转、搜索、公式索引、术语索引、来源查看、返回卡片、单章重试、Markdown 导出，以及从同一结构化结果派生“快速复习版”。

## 9. 状态、持久化与失败恢复

统一生成状态：

```ts
type GenerationStatus =
  | "pending"
  | "generating"
  | "partial"
  | "completed"
  | "stale"
  | "failed";
```

流程栏依次显示未开始、处理中、部分完成、完成、过期或失败。页面进入条件不能只依赖流程步骤，完整笔记只有同时满足以下条件才可显示为成功：

```ts
masterNote.status === "completed"
&& masterNote.markdown.trim().length > 0
&& masterNote.generatedFromStructureVersion === currentStructureVersion
```

章节也必须满足正文非空才能标记完成。若一章失败：

- 已完成章节保持不变；
- 母笔记状态变为 `partial`；
- 用户只重试失败章节；
- 刷新页面后从持久化状态恢复；
- 所有章节有效后才重新组装母笔记。

卡片或知识结构发生修改时，只使受影响的综合、章节和母笔记进入 `stale`，不删除旧内容，用户仍可查看旧版本并选择重新生成。

## 10. 模型调用与缓存

为了降低 DeepSeek 缓存未命中和长上下文失败：

- 系统提示、JSON Schema 和稳定规则保持固定前缀。
- 动态课件内容统一放在提示词末尾。
- 一级关系、二级关系、卡片、一级综合和章节分别调用，不发送整份课件。
- 批次大小按 token 估算，不按页数硬切。
- 相同 `sourceVersion + promptVersion + modelConfig` 生成稳定缓存键。
- 失败重试复用完全相同的固定前缀和结构，只替换错误反馈部分。
- JSON 阶段要求结构化输出并进行本地校验；Markdown 阶段不再强制 JSON。

## 11. 组件与模块边界

- `KnowledgeStructureView`：管理一级选中、展开的一级节点、选中二级节点和右侧面板状态。
- `KnowledgeNetworkCanvas`：渲染两层节点、关系、分组背景、编号和子网左上角关闭按钮。
- `knowledge-network-adapter`：构造包含主网与单个展开子网的统一模型。
- `KnowledgeCardsView`：知识卡片分组、阅读、编辑和重试。
- `topic-synthesis-generator`：生成一级知识综合。
- `chapter-planner`：生成章节框架。
- `chapter-note-generator`：逐章生成并持久化。
- `course-master-note`：确定性组装、索引聚合和覆盖检查。
- `MasterNoteView`：框架确认、生成状态和完整笔记阅读。

生成模块不读取 React 状态；界面组件不直接构造模型提示词。所有模型产物通过类型校验后才写入 store。

## 12. 数据迁移

- 保留现有 `knowledgeCards`，补齐缺少的状态和版本字段时提供默认值。
- 现有 `topicNotes` 不自动当作完整笔记，可迁移为旧版知识内容或标记为需要重新生成的 `TopicSynthesis` 草稿。
- 新增 `topicSyntheses`、`chapterPlan`、`chapterNotes` 和 `courseMasterNote`。
- 持久化 schema 提升版本，并为旧项目提供显式迁移函数。
- 迁移不能删除 MinerU Markdown、知识网、来源范围或旧笔记正文。

## 13. 验收标准

1. 一级网始终可见，一级节点和二级节点在尺寸、颜色、编号和区域边界上可立即区分。
2. 点击一级节点时只展开一个二级子网，画布聚焦子网且保留一级主网上下文。
3. 子网左上角存在独立 `×`；点击后只收起子网，不删除数据。
4. 一级和二级关系分别来自各自的 AI 遍历结果，编号来自各自稳定遍历顺序。
5. 点击任意层节点都能在右侧看到对应 MinerU 原文，公式正常渲染。
6. 现有逐知识点内容以“知识卡片”呈现，不再称为完整笔记。
7. 完整笔记生成前显示课程与章节框架。
8. 并列知识能够生成共同概括、分别讲解和差异总结。
9. 每章独立生成、保存和重试，一章失败不会丢失其他章节。
10. 空 Markdown 不能被标记为完成，页面不会再次出现“可查看但正文为空”。
11. 母笔记由章节确定性组装，不把全部 MinerU Markdown 一次性交给模型。
12. 覆盖检查能列出未被章节使用的知识卡片和缺失引用。
13. 旧项目迁移后保留原始数据，并能明确提示需要重新生成的阶段。

## 14. 非本次范围

- 同时展开多个一级节点的二级子网。
- 用户手工新增关系或保存拖拽布局。
- 跨课件全局知识锚点网络。
- 多人协作编辑和评论。
- 对整份课程母笔记执行不受约束的全量 AI 重写。

这些能力在单子网交互、知识卡片和分章母笔记稳定后再单独设计。
