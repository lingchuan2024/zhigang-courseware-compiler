# 课程学习结构编译器设计

## 目标

把现有“多轮模型生成知识网络”的管线重构为“统一语义抽取 + 确定性课程编译”。系统的基础产物不是通用知识图谱，而是一份稳定、可追溯、可增量更新的两层课程学习结构：

1. 第一层 `LearningTopic` 表示课程中值得形成独立学习目标的核心知识。
2. 第二层 `TeachingUnit` 表示每个核心知识内部用于讲清它的定义、直觉、公式、推导、示例、条件和应用等讲解单元。
3. 课程学习顺序和知识内部讲解顺序由显式顺序约束、受控教学角色和确定性调度器编译，不从通用知识关系图中推导。

重构必须保留现有产品的证据回溯、卡片、母笔记、课程库和问答能力，同时显著减少结构阶段的模型调用次数。

## 已确认的产品决策

- 产品定位是“课程学习结构编译器”，不是知识图谱产品。
- 两层结构是正式课程结构，不增加第三层知识节点。
- 第一层保持扁平；原有 `parentTopicId` 不再表达知识层级。更细的子概念进入第二层。
- 第二层使用受控教学角色，学科化名称保留在标题和摘要中，不允许无限扩张机器类型。
- 语义关系与学习顺序约束分开存储。只有方向明确的顺序约束参与课程排序。
- 一个原文块可以同时支撑多个知识点和讲解单元；证据绑定必须精确到块内片段。
- 模型负责识别语义候选，程序负责身份归一、合并、校验、排序、状态和版本。
- 卡片、母笔记和问答是课程结构的下游消费者，不阻塞基础结构进入可用状态。
- 用户修正过的主题身份、合并决策和顺序约束在增量重跑时默认保留。

## 当前问题

现有结构阶段包含窗口候选提取、局部与全局合并、一级关系遍历、逐主题二层提取、逐主题二层关系遍历。模型调用数量近似为：

```text
窗口数 W + 合并调用 + 一级关系调用 + 2 × 一级知识点数 T
```

主要问题如下：

- 同一内容被模型在候选、关系、二层结构和二层关系阶段反复理解。
- 按主题进行两次串行调用，使成本和耗时随主题数线性增长。
- 一级语义关系方向不够明确，却直接用于拓扑排序。
- 第一层父子主题和第二层讲解块同时存在，结构边界模糊。
- 多轮局部合并会把连续来源范围压缩成起止端点，存在证据丢失风险。
- 同名候选在语义消歧前被直接合并，无法可靠处理同名不同义。
- 原文引用只到块级，无法区分一个块内支撑不同知识点的片段。
- 校验错误仍可能返回 `ready`，结构质量没有形成发布门。
- 主题和文档使用随机 ID，重跑后的身份和顺序难以保持稳定。

## 范围

### 本次重构

- 新的两层课程结构中间表示。
- 块内证据片段和多对多证据绑定。
- 按章节批次进行一次统一语义抽取。
- 确定性的候选归一、证据无损合并和模糊项批量裁决。
- 独立的课程顺序约束与课程调度器。
- 基于受控教学角色的二层讲解顺序编译器。
- 稳定身份、结构版本和章节级增量更新基础。
- 结构质量门和 `ready/degraded/failed` 状态语义。
- 兼容现有知识网、卡片、母笔记、持久化和问答的数据适配层。
- 结构阶段模型调用、耗时和 token 的可测量性能验收。

### 不在本次重构

- 用通用实体关系图替换课程学习结构。
- 新增第三层课程知识节点。
- 改造 MinerU 服务协议。
- 重写卡片深化、母笔记内容生成或全库问答逻辑。
- 引入服务端数据库、向量数据库或新的后端服务。
- 自动跨课程合并为一门新课程。
- 为所有学科设计专用教学模板；第一版只提供六类通用模板。

## 核心中间表示

### EvidenceSpan

`EvidenceSpan` 是知识结构引用原文的最小单位。它不复制整份原文，只保存稳定块引用、字符区间和用于审核的短引用。

```typescript
type EvidenceRole =
  | 'statement'
  | 'definition'
  | 'formula'
  | 'condition'
  | 'derivation'
  | 'example'
  | 'comparison'
  | 'application';

interface EvidenceSpan {
  id: string;
  documentId: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  role: EvidenceRole;
  contentHash: string;
}
```

约束：

- 字符区间必须落在对应 `MarkdownBlock.content` 内。
- `quote` 必须和区间文本归一化后一致。
- 一个 `EvidenceSpan` 可以被多个主题或讲解单元引用。
- 同一个块可以包含多个不重叠或重叠的 `EvidenceSpan`。
- 模型给出无效偏移时，程序尝试以 `quote` 在原文中唯一定位；无法唯一定位则丢弃该片段并记录问题。

### LearningTopic

第一层只保留具有独立学习目标的课程知识。

```typescript
type LearningGenre =
  | 'concept'
  | 'derivation'
  | 'algorithm'
  | 'mechanism'
  | 'comparison'
  | 'case';

interface LearningTopic {
  id: string;
  stableKey: string;
  courseId: string;
  name: string;
  aliases: string[];
  learningObjective: string;
  scope: string;
  genre: LearningGenre;
  difficulty: 1 | 2 | 3 | 4 | 5;
  importance: 'core' | 'important' | 'supplementary';
  evidenceIds: string[];
  sourceSectionIds: string[];
  confidence: number;
  status: 'draft' | 'verified' | 'corrected';
}
```

主题准入条件：

- 名称必须具体，不能是“课程内容”“概述”“其他内容”等容器词。
- `learningObjective` 必须表达学完后能理解、解释、推导、比较或应用什么。
- 至少包含一条有效证据。
- 只被提及、没有解释或教学内容的术语不能自动成为一级主题。
- 定义、公式、步骤或例子如果不能形成独立学习目标，应进入某个主题的第二层。

### TeachingUnit

第二层表达一级知识内部的讲解组成。

```typescript
type TeachingRole =
  | 'motivation'
  | 'problem'
  | 'intuition'
  | 'definition'
  | 'formula'
  | 'condition'
  | 'derivation_step'
  | 'procedure_step'
  | 'property'
  | 'example'
  | 'comparison'
  | 'misconception'
  | 'application'
  | 'summary';

interface TeachingUnit {
  id: string;
  stableKey: string;
  topicId: string;
  role: TeachingRole;
  title: string;
  summary: string;
  evidenceIds: string[];
  required: boolean;
  confidence: number;
  status: 'draft' | 'verified' | 'corrected';
}
```

`role` 是可执行的教学功能，`title` 是面向具体学科的人类可读名称。第一版不接受模型生成新的机器角色；无法归类的候选回退到最接近的角色并产生警告。

### OrderConstraint

学习顺序使用独立、方向统一的约束结构。

```typescript
interface OrderConstraint {
  id: string;
  beforeTopicId: string;
  afterTopicId: string;
  strength: 'hard' | 'soft';
  reason: string;
  evidenceIds: string[];
  source: 'explicit' | 'inferred' | 'corrected';
  confidence: number;
}
```

统一语义是：`beforeTopicId` 必须或最好在 `afterTopicId` 之前学习。

- `hard` 只用于明确依赖：后者的定义、符号、推导或操作必须使用前者。
- `soft` 用于更自然但非必要的先后关系。
- `explicit` 必须带课件证据。
- `inferred` 可以没有直接陈述证据，但必须有可解释理由，只作为软约束。
- `corrected` 来自用户修改，优先级最高，不在自动重跑中删除。

### CourseLearningStructure

```typescript
interface CourseLearningStructure {
  courseId: string;
  sourceVersion: number;
  structureVersion: number;
  compilerVersion: string;
  topics: LearningTopic[];
  teachingUnits: TeachingUnit[];
  evidenceSpans: EvidenceSpan[];
  orderConstraints: OrderConstraint[];
  orderedTopicIds: string[];
  teachingPaths: Record<string, string[]>;
  status: 'ready' | 'degraded' | 'failed';
  validation: CourseStructureValidation;
}
```

## 统一章节编译

### 输入批次

不再把所有文档块拼接后做固定重叠窗口。程序先按文档和 Markdown 章节切分，再把连续小章节装入不超过模型上下文预算的 `SectionBatch`。

每个批次包含：

- 文档 ID、文档标题和章节路径。
- 带稳定块 ID 的原文内容。
- 前一批次的术语摘要，不复制前一窗口原文。
- 已确认课程术语表中的相关别名。

批次绝不跨文档边界。超长章节在安全块边界切分，但共享同一个章节 ID。

### 单次结构化输出

一个批次只调用一次抽取模型，同时返回主题提及、讲解单元草稿和顺序声明：

```typescript
interface SectionCompilation {
  sectionIds: string[];
  topicMentions: TopicMentionDraft[];
  teachingUnits: TeachingUnitDraft[];
  orderClaims: OrderClaimDraft[];
  unresolvedReferences: UnresolvedReference[];
  confidence: number;
}
```

所有草稿使用批次内唯一 ID。程序收到响应后立即加上 `documentId/sectionId/batchId` 命名空间，禁止跨批次临时 ID 冲突。

模型抽取要求：

- 一次完成证据定位、主题候选、第二层讲解角色和明确顺序声明。
- 不输出最终课程 ID，不负责跨章节合并。
- 不输出通用知识补充，只能基于输入课件。
- 不为保证结构完整而虚构关系。
- 一个证据片段可以绑定多个候选。

### 调用策略

- 批次并发上限沿用模型配置和限流能力，默认 2。
- 缓存键由 `section content hash + prompt version + model identity` 组成。
- 结构化 JSON 失败只重试该批次。
- 批次失败后保留章节和块，结构状态进入 `degraded`，其余批次继续。
- 卡片和笔记生成不属于该阶段。

## 候选归一与课程级审查

### 确定性快路径

候选合并按以下顺序执行：

1. 规范化大小写、空白、全半角、常见公式表示和课程术语别名。
2. 同一重叠批次内，规范名称相同且证据集合重叠的候选直接合并。
3. 跨章节候选只有在名称/别名相似、学习目标相似和证据语义相容同时成立时才自动合并。
4. 名称相同但章节语境和学习目标明显不同的候选保持分离。
5. 合并使用证据并集，禁止只保存范围端点。

第一版允许使用已有模型 embedding 端点做候选相似度；未配置 embedding 时退化为名称、别名、关键词和证据词面的确定性相似度。不得为此引入向量数据库。

### 模糊候选批量裁决

只有落在相似度模糊区间的候选对进入一次批量模型裁决。输出只允许：

- `merge`
- `keep_separate`
- `promote_first`
- `promote_second`
- `drop_both`

每项必须引用输入候选 ID和理由。程序验证操作后执行，模型不能重写全部主题。

### 一次课程级审查

确定性归一后进行一次紧凑课程级审查。模型只看到主题目录、学习目标、短证据和候选顺序声明，用于：

- 发现明显遗漏的合并或拆分。
- 判断候选是否达到一级学习目标粒度。
- 将过细候选降为现有主题的 TeachingUnit。
- 提议方向明确的 hard/soft 顺序约束。

审查输出为受限操作列表；任何新增主题都必须复用已有证据，不能生成无证据知识。

## 课程顺序编译器

课程顺序不是通用关系图的拓扑结果，而是带硬约束和教学目标的调度结果。

### 硬约束阶段

1. 验证所有主题 ID 和方向。
2. 去除自环和完全重复约束。
3. 构建只包含 `hard` 约束的有向无环偏序。
4. 若出现环，按以下顺序处理：
   - `corrected` 约束不可自动删除。
   - 保留有直接证据的 `explicit` 约束。
   - 删除环内最低置信度的 `inferred` 约束。
   - 仍无法解除时进入 `degraded`，报告冲突，不静默伪造顺序。

### 教学调度阶段

在所有当前入度为零的可学习主题中，使用稳定优先级选择下一个主题：

1. 满足更多 soft 前置关系。
2. 基础性和核心重要性更高。
3. 与上一个主题的术语和章节连续性更强。
4. 难度跳跃更小。
5. 原始课件顺序更靠前。
6. `stableKey` 字典序作为最终稳定兜底。

所有分数和权重是版本化配置，排序结果必须在相同输入和配置下完全确定。第一版使用稳定 Kahn 调度，不引入通用图数据库或复杂优化求解器。

### 顺序解释

每个学习步骤保存：

- 已满足的 hard 前置主题。
- 影响排序的主要 soft 约束。
- 难度、重要性或内容连续性理由。

界面继续显示“为什么现在学习这个知识”，但理由由调度输入生成，不由模型重新编写。

## 二层讲解顺序编译器

第二层不再单独调用模型建关系。统一抽取阶段已经给出教学角色和局部明确顺序声明，程序按照主题 `genre` 编译路径。

默认模板：

```text
concept:
  problem → motivation → intuition → definition → condition → property
  → example → application → misconception → summary

derivation:
  problem → condition → definition → formula → derivation_step
  → summary → example → application

algorithm:
  problem → intuition → condition → procedure_step → property
  → example → application → summary

mechanism:
  problem → motivation → definition → procedure_step → condition
  → property → application → summary

comparison:
  problem → definition → comparison → condition → example
  → application → summary

case:
  problem → condition → procedure_step → example → comparison
  → summary
```

同一角色内按显式局部顺序、原文顺序和 `stableKey` 排序。课件明确说明的局部顺序覆盖模板，但不能形成环。缺少某个模板角色是正常情况，不生成空节点。

## 稳定身份与增量更新

### 稳定键

- `EvidenceSpan.stableKey`：文档稳定身份、块内容哈希、规范化引用文本和区间共同计算。
- `LearningTopic.stableKey`：课程命名空间、规范名称、核心证据指纹和已确认别名共同计算。
- `TeachingUnit.stableKey`：主题稳定键、教学角色和核心证据指纹共同计算。

数据库主键可继续使用普通 ID，但所有增量对齐必须使用 `stableKey`，不得使用时间戳随机 ID 判断实体身份。

### 增量流程

1. 比较新旧章节内容哈希。
2. 未变化章节直接复用 `SectionCompilation`。
3. 只重新抽取新增或变化章节。
4. 找出引用变化证据的候选簇，只重新归一这些簇。
5. 未变化且用户修正过的主题和讲解单元保持 ID、名称和状态。
6. 重新运行确定性课程调度和受影响主题的二层顺序编译。
7. 卡片和笔记根据稳定主题/讲解单元 ID 标记 stale，按现有下游流程单独更新。

## 状态和错误处理

### ready

- 所有主题和必要讲解单元都有有效证据。
- hard 顺序约束无环。
- 没有无效 ID、越界证据或损坏引用。
- 批次失败没有造成核心内容缺口。

### degraded

- 存在失败章节批次、无法自动解除的顺序冲突、重要未分配内容或低置信候选。
- 已验证部分仍可浏览和生成基础卡片。
- UI 必须显示具体问题，不能显示为完整成功。

### failed

- 没有形成任何有效一级主题。
- 核心数据模型损坏。
- 证据解析或持久化失败使结构不可安全使用。

失败批次、模糊候选和顺序冲突使用结构化 issue 保存，不仅保留人类可读字符串。

## 兼容迁移

采用并行新 IR + 适配器迁移，不直接一次删除现有 V2 类型。

### 第一阶段：新编译核心

- 新增课程结构类型、章节编译器、归一器、顺序调度器和验证器。
- 不接入主 UI，以单元测试和固定课件 fixture 验证。

### 第二阶段：只读适配

- 将 `CourseLearningStructure` 适配为现有 `KnowledgeTopic`、`TeachingBlock`、`CourseLearningPath` 和 `TopicNarrativePath`。
- 知识网、证据面板、卡片和母笔记继续消费现有接口。
- 适配后的 `KnowledgeTopic.parentTopicId` 始终为空。
- `TopicRelation` 只保留展示需要的顺序边，不再作为真实主数据。

### 第三阶段：主链切换

- `runKnowledgePipeline` 改为调用新编译器并返回适配结果。
- 新旧管线通过本地开发开关短期并存，用同一 fixture 做输出对比。
- 新管线达到验收标准后删除旧的 topic reconciliation、关系遍历和逐主题二次调用路径。

### 第四阶段：持久化升级

- IndexedDB 快照保存新 `CourseLearningStructure`。
- 打开旧快照时继续读取现有 V2 结构；只有用户主动重新提取时才生成新结构。
- 不尝试把旧的随机主题 ID 自动提升为稳定主题身份，避免错误合并。

## 模块边界

建议新增以下聚焦模块：

```text
src/lib/course-structure/
├── types.ts
├── section-batching.ts
├── section-compiler.ts
├── evidence-span.ts
├── candidate-normalizer.ts
├── curriculum-review.ts
├── course-scheduler.ts
├── teaching-path-compiler.ts
├── validator.ts
├── stable-identity.ts
├── incremental-reconcile.ts
└── legacy-adapter.ts
```

模块职责：

- `section-batching` 只负责文档与章节边界和 token 预算。
- `section-compiler` 只负责单批次模型调用与响应解析。
- `evidence-span` 只负责块内证据解析、定位和校验。
- `candidate-normalizer` 只负责候选身份归一和证据无损合并。
- `curriculum-review` 只负责一次紧凑全局审查和受限操作解析。
- `course-scheduler` 只消费主题与顺序约束，不依赖模型。
- `teaching-path-compiler` 只消费主题 genre、教学角色和局部约束。
- `validator` 只报告结构问题，不静默修改正式结构。
- `stable-identity` 统一稳定键生成规则。
- `incremental-reconcile` 计算新旧结构的复用、stale 和受影响范围。
- `legacy-adapter` 是迁移期间唯一的新旧模型转换边界。

## 安全与隐私

- 延续“课件内容是数据，不是指令”的提示隔离。
- 模型只能引用输入中的文档、章节、块和候选 ID。
- EvidenceSpan 偏移、引用文本和块 ID全部由程序复检。
- API Key 仍只保存在内存中。
- 缓存只保存结构化抽取结果和内容哈希，不额外上传或共享课程内容。
- 模型返回的标题、摘要和理由在渲染前继续执行文本清洗。

## 测试策略

### 证据层

- 一个块内提取两个知识点，分别绑定不同片段。
- 两个知识点共享同一片段不会被判为重复。
- 偏移错误但 quote 唯一时可修复。
- quote 重复导致定位歧义时拒绝绑定。
- 多轮合并后证据集合无损。

### 两层结构

- 只有独立学习目标才能进入第一层。
- 定义、公式和推导步骤优先进入对应主题第二层。
- `parentTopicId` 不再参与新结构。
- 未知 TeachingRole 被拒绝或映射并产生警告。
- 每个 TeachingUnit 只能属于一个 LearningTopic，但证据可以共享。

### 候选归一

- 相邻重叠批次中的同一主题自动合并。
- 同名不同义候选保持分离。
- 名称不同但别名、目标和证据一致的候选可以合并。
- 模糊裁决操作无法引用未知候选。
- 合并结果与候选输入顺序无关。

### 课程调度

- hard 约束全部满足。
- soft 约束只影响优先级，不造成死锁。
- inferred 环可以按置信度解除。
- corrected 环不会被静默删除，结构进入 degraded。
- 相同输入产生完全相同的主题顺序和解释。
- 没有关系时按重要性、难度、连续性和原文顺序稳定排序。

### 二层顺序

- 六类 genre 的模板顺序正确。
- 缺少模板角色时不生成空节点。
- 显式局部顺序可以覆盖模板。
- 局部顺序环会被报告，不能进入 ready。

### 增量更新

- 未变化章节不触发模型调用。
- 单章节变化只重编译该章节和受影响候选簇。
- 未变化主题和讲解单元保持 ID。
- corrected 主题名称和顺序约束在重跑后保留。
- 受影响卡片和章节被正确标 stale。

### 集成与兼容

- 新结构能适配到现有知识网。
- 原文点击可以精确定位 EvidenceSpan 所在块并高亮片段。
- 卡片、母笔记和问答继续获得正确 courseId、topicId 和引用。
- 旧快照可正常打开，新快照可刷新恢复。
- 模型批次失败显示 degraded，而不是完整 ready。

## 性能验收

以现有代表性课件 fixture 和至少一份 50 页以上真实课件进行对比：

- 结构阶段不再包含按一级主题执行的模型调用。
- 模型调用数等于章节批次数、至多一次模糊裁决和一次课程级审查。
- 相同课件第二次运行命中缓存时，未变化章节抽取调用数为零。
- 在相同模型和课件上，结构阶段调用数相比旧管线减少至少 60%。
- 结构阶段 token 消耗相比旧管线减少至少 50%。
- 调用次数、输入/输出 token、缓存命中率和各阶段耗时进入现有模型用量统计。
- 卡片和母笔记耗时不计入基础课程结构 ready 时间。

## 质量验收

1. 每个正式一级主题都有具体学习目标和有效证据。
2. 每个 required TeachingUnit 都有有效证据。
3. 一个原文块支撑多个主题时可以分别回溯到对应片段。
4. 同名不同义主题不因名称相同被自动合并。
5. 所有 hard 顺序约束方向统一、理由可见且无环。
6. 学习顺序满足全部 hard 约束，并对每一步提供确定性解释。
7. 相同输入、编译器版本和配置产生相同稳定键与学习顺序。
8. 单章节变更不会使未相关主题更换身份。
9. 任一关键校验错误都会使结构进入 degraded 或 failed，不能静默 ready。
10. 现有知识网、卡片、母笔记、持久化和问答通过兼容回归测试。

## 实施顺序

1. 建立新 IR、证据片段校验和稳定身份。
2. 实现纯函数课程调度器与二层讲解顺序编译器。
3. 实现章节批次和统一模型抽取。
4. 实现候选归一、模糊裁决和课程级审查。
5. 实现结构验证器与状态语义。
6. 实现旧视图适配器并接入主链开发开关。
7. 实现章节缓存和增量对齐。
8. 完成真实课件性能与质量对比后切换默认管线。
9. 删除旧的多轮合并、独立关系遍历和逐主题二次调用路径。

