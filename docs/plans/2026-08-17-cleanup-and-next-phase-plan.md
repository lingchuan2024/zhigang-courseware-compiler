# 知纲收敛与下阶段计划

日期：2026-08-17
状态：Phase 0 已完成（PR #2 已合并）；Phase 1 进行中（分支 `feat/persistence-and-incremental`：T1 持久化单一真相源、T2 重解析增量标记已完成，T3 模型健壮性待做）

> **Phase 1 / T2 执行结果（2026-08-17）**：重跑 MinerU 不再清空知识产物——按纯内容哈希对齐新旧文档块，
> 未受影响的主题/讲解块/卡片仅重映射引用（含 documentId 变化），引用内容变化的主题标 stale
> （卡片 status='stale'、覆盖章节降级、母笔记重组为 partial，可按章重试）；新增未被覆盖的内容块计入
> 提示。Sidebar 横幅与知识网节点"需更新"徽章接入真实 staleMarker。设计结论：主题级局部重提取在
> 内容变化语义下不成立（主题划分来自全局合并），结构重提取保持全量，由 store 集成测试
> （mock MinerU）与视图测试覆盖。

> **Phase 1 / T1 执行结果（2026-08-17）**：localStorage 只保留约 100 字节的工作区指针（schema v10），
> 项目数据唯一真相源为 IndexedDB 课程库快照；全量快照镜像改为 500ms 防抖合并写（flush 于
> beforeunload/visibilitychange），启动不再有同步恢复路径，模型配置仍在独立 key。删除了
> loadState/initializeFromStorage/migrateLegacyProjectToLibrary 等旧恢复链路。
> 验收：单元测试断言 localStorage 无项目数据；浏览器实测两份课件并存、刷新存活、
> 从课件库恢复工作区。决策点落地：维持"刷新回首页"，"原地停留"作为独立小改进留待后续。

> **Phase 0 执行结果（2026-08-17）**：仓库 −38,304 行 / +1,227 行（含 5 个遗留目录约 5MB）；
> src 非测试代码 35,849 → 21,440 行（−40%）；测试 81 文件 999 用例 → 56 文件 451 用例
> （删除的均为保护死代码的用例）；`pnpm check / test / build / lint` 全绿。
> 决策点落地：deployment-guide 随其余 4 个遗留目录一并删除（git 历史可恢复）；
> v1 存量数据经 schema v9 直接丢弃；示例课程改为 v6 数据直构，走与真实流程一致的渲染路径。

## 一句话结论

功能闭环已经完整，当前最大的问题不是缺功能，而是**仓库里压着三代架构和约 6,000 行死代码**。下阶段先做纯减法的 Phase 0（收干净），然后把精力集中在两个核心痛点上：**数据存得长**（持久化）和**重生成不心疼**（增量更新）。不再新增视图、视觉主题或任何横向功能。

## 1. 现状盘点

### 1.1 项目构成

- 主链路（live）：上传/示例 → 文档审阅（PDF/PPTX 高清预览）→ MinerU 解析为 Markdown → 8 阶段知识管线 → 卡片深化 → 逐章母笔记 → 多会话全库问答
- 代码量：src 非测试代码约 35,800 行（lib 22,081 / components 9,446 / store 2,466 / types 1,597），测试 81 个文件、999 个用例，2026-08-17 实测全绿
- 节奏：2026-07-12 至 07-15 四天冲刺 79 个提交（比赛交付），此后停更一个月
- 部署：阿里云 + rsync + Nginx 静态托管（`deploy.sh`），纯前端、数据全在浏览器本地

### 1.2 三代架构并存（本项目最大的结构事实）

| 代际 | 核心类型 | 状态 |
|---|---|---|
| v1 证据体系 | EvidenceAtom / LearningUnit / MasterNoteUnit | 半死：仅 `NotesView` 的 LegacyNotesView 兜底分支和示例课程在用 |
| v2–5 知识包体系 | CourseTopic / KnowledgePackage / InternalStructure | 大半死：`README` 还在主要讲这一代，代码里只有 v1 管线引用 |
| v6+ Markdown 体系 | SourceDocument / KnowledgeTopic / TeachingBlock / KnowledgeCard / ChapterNote | **live 主链路**，SCHEMA_VERSION=8 |

三代字段全部叠在 `ProjectState`（types/index.ts:915 起的"上帝对象"）里、全部进 localStorage 持久化白名单。

### 1.3 各环节实现状态

| 环节 | 实现 | 状态 |
|---|---|---|
| 上传/解析 | pdf.ts / pptx.ts / document-source.ts | 完整（20MB 校验、原始文件存 IndexedDB） |
| MinerU | mineru-client.ts + vite/mineru-proxy.ts | 完整（轮询 10min 超时、结果转 SourceDocument） |
| 证据层 | evidence.ts（635 行） | 完整但半闲置——只服务 v1 路径，v2 管线不消费，但每次上传仍生成并持久化 |
| 知识管线 v2 | knowledge-pipeline-v2.ts 8 阶段 | 完整，逐层降级（AI 失败回退本地合并/原始顺序） |
| 卡片 | card-generator + card-enrichment + card-quality | 完整（质量门 + 并发深化） |
| 母笔记 | master-note-generator + course-master-note | 完整（逐章生成、失败章可重试、术语/符号表） |
| 问答 | useQaStore + card-retrieval + card-rag | 完整（词法 bigram 检索、引用快照、注入防御） |
| 库 | library-repository（IndexedDB 7 store） | 完整但与 localStorage 双写全量数据 |

## 2. 核心优势（要保持的）

1. **可追溯性是贯穿设计**：每条笔记内容、每张卡片、每个 QA 回答都引用 evidenceId + 课件页码。这是与"总结成 Markdown"类工具的本质差异，也是产品立身之本。
2. **降级链条完整**：模型不可用时每层都有本地确定性兜底（本地合并、原始顺序、fallback 章节），产品不会因 API 故障变成白屏。
3. **工程密度高**：999 个测试用例、纯前端零后端运维、API Key 仅内存不落盘、错误隔离（单知识点失败不拖垮整份课件）。
4. **闭环真实可用**：从一份 PPT 到知识网、卡片、完整笔记、全库问答，链路已端到端跑通并部署。

## 3. 技术债清单

### P0 结构债（Phase 0 处理）

| # | 债 | 证据 |
|---|---|---|
| 1 | 仓库混入 5 个零引用目录，约 5MB | cosmic-universe-test/（独立实验项目）、deep-space-cosmic/（AI 设计稿）、trae-demo-post/、project-evaluation/、deployment-guide/。全部来自最终 bulk 提交 4cde257，当时的开发计划文档（docs/superpowers/plans/2026-07-15-real-nebula-workspace-backgrounds.md L893）明确写了"不要 stage"这些目录 |
| 2 | 组件层死代码 2,616 行（7 个文件） | KnowledgeGraph.tsx(1043)、StructureReviewView.tsx(669)、GeneratingView.tsx(341)、EvidenceCard.tsx(226)、EvidenceInspector.tsx(200)、MarkdownNotesView.tsx(127)、ParseReviewView.tsx(10)。均无任何 live 引用 |
| 3 | lib 层死代码约 3,400 行 | master-note.ts(554)、note-generator-v2.ts(615)、ai-topic-extraction.ts(332) 三个零引用模块；v1 管线连带 knowledge-pipeline.ts(306)、internal-structure.ts(439)、learning-path.ts(352)、ai-extraction-batching.ts(846) |
| 4 | useStore.ts 1,521 行、45 字段、44 action | 双代字段并存；约 300 行 action 无存活调用方（证据编辑 6 件套、learningUnits CRUD 5 件套、confirmParse/confirmStructure 等） |
| 5 | types/index.ts 1,597 行、129 个 export | 三代类型混在一个文件 |
| 6 | localStorage 容量定时炸弹 | saveState 把 34 个字段全量 JSON 塞 ~5MB 的 localStorage（evidences 全文、章节笔记 markdown、MinerU markdown 全文……），满了只截断一处 v2 字符串、再失败静默丢；同时每次保存三重镜像 IndexedDB（双写两份全量） |

### P1 维护债（Phase 0 顺手处理）

7. README 脱节两代：主讲的还是 v2 知识包体系；"当前版本限制"里写的短板（不支持 PPTX、无跨课件问答等）实际全已实现；项目结构一节列的是旧组件。
8. 测试在保护死代码：master-note.test(352 行)、ai-topic-extraction.test(477 行)、notes.test 的 v1 导出分支等，跑得慢且给删除制造阻力。
9. 命名陷阱：markdown-normalization.ts（清洗 AI 输出）与 markdown-normalizer-v2.ts（清洗 MinerU 源文本）名字相近语义无关；assembleMasterNote 在 notes-v2/master-note/course-master-note 三处有同名实现；notes.ts 与 notes-v2.ts 互相纠缠。
10. 编译产物入库：vite.config.js、vite.config.d.ts、vite/mineru-proxy.js。
11. 示例课程（examples.ts loadExampleCourse）构造的还是 v1 数据，走 legacy 渲染路径——首次体验用户看到的恰是旧架构。
12. 部署文档自相矛盾：docs/plans/2026-07-15-rapid-deployment-design.md 写的是 Cloudflare Pages 方案，实际落地是阿里云 + rsync。

### P2 功能短板（不是债，是 Phase 1/2 的素材）

13. 检索是纯词法（中文 bigram + 英文 token），无语义召回，换一种问法就查不到；knowledgeBaseVersions.embeddings 字段预留未实现。
14. stale 增量更新有数据结构（V2Checkpoint/staleMarker）但流程未激活：任何上游变化都意味着全量重跑管线与逐章重生成，慢且费 token。
15. generationMemory（课程级术语/符号表）在 v2 母笔记路径只读不写，不再随生成增长。
16. 模型调用无指数退避（固定 2 次结构化重试），用量统计（model-usage）不持久化。
17. 每次上传仍无条件生成 v1 evidences（冗余计算 + 冗余持久化）。

## 4. 下阶段原则

1. **先减后加**：Phase 0 只删不加、行为对用户不变，测试全绿是硬门槛。
2. **聚焦两个核心痛点**：数据留存（存不长就撑不起"多课件知识库"卖点）和增量重生成（重跑不心疼，产品才敢让用户反复迭代课件）。
3. **明确不膨胀**（见第 8 节清单），每个新提议先问"它是否强化 可信笔记 + 可追溯问答"。

## 5. Phase 0：收干净（纯减法，可直接执行）

按顺序执行，每步一个提交，任何一步 `check/test/build` 变红即回退。

| 步骤 | 内容 | 预期削减 |
|---|---|---|
| 0.1 | 删除遗留目录：cosmic-universe-test、deep-space-cosmic、trae-demo-post、project-evaluation 直接删；deployment-guide 归档或删（见决策点 1）；.gitignore 补充对应模式 | 仓库 −5MB |
| 0.2 | 删除 7 个死组件及其测试 | −2,616 行 |
| 0.3 | 删除 3 个零引用 lib 模块（master-note、note-generator-v2、ai-topic-extraction）及测试 | −1,500 行 |
| 0.4 | 切断 v1 链：删 LegacyNotesView 分支与 convertV1ToV2 迁移；示例课程改为 v6 数据直构（一次性离线跑 v2 管线固化产物，或手写 v6 fixture）；随后删 v1 管线及其连带模块（knowledge-pipeline/internal-structure/learning-path/ai-extraction-batching） | −1,900 行 |
| 0.5 | persistence schema 升 v9：丢弃全部 v1/v2–5 字段（evidences、learningUnits、knowledgePackages、masterNotes、globalAnchors 等）；上传不再自动生成 v1 evidences | 持久化瘦身 + evidence 冗余消除 |
| 0.6 | useStore 瘦身：删无调用方 action（证据编辑 6 件套、learningUnits CRUD、confirmParse/confirmStructure/setStage 等）与 legacy 字段 | store 预计 1,521 → 约 1,000 行 |
| 0.7 | types 收敛：删 v1/v2–5 类型；如顺手可按域拆分（workflow / knowledge / library / qa），但不强制 | 预计 −600 行 |
| 0.8 | 删编译产物（vite.config.js、vite.config.d.ts、vite/mineru-proxy.js）；统一 notes/markdown 命名（assembleMasterNote 只留一处） | 小 |
| 0.9 | 重写 README：按 v6 主链路描述架构与流程，"当前版本限制"改为真实限制（词法检索、localStorage、单模型协议），部署一节统一为阿里云实际方案 | 文档 |

**验收**：`pnpm check` / `pnpm test` / `pnpm build` 全绿；src 非测试代码减少 ≥ 6,000 行；仓库体积 −5MB；`grep` 扫描无零引用模块/组件；示例课程走 v6 渲染路径。

**基线（2026-08-17 实测）**：81 个测试文件、999 个用例全部通过——这是整个 Phase 0 的安全网。

## 6. Phase 1：留存与增量（建议下一步主线）

目标：让"多课件知识库"这个核心卖点在数据层面真正成立。

### 6.1 持久化单一真相源

- IndexedDB 为唯一数据源（library-repository 已有 7 个 store 和快照机制，基础是好的）；localStorage 只保留 `{ schemaVersion, activeCourseId, activeDocumentId, UI 偏好 }` 级别的轻量指针。
- 启动时按需加载当前课程快照，保存时不再全量序列化到 localStorage，消除双写。
- 验收：3 份 100 页级课件并存，刷新/重开浏览器数据不丢；localStorage 占用 < 50KB。

### 6.2 激活 stale 增量更新

- 利用已有 V2Checkpoint / staleMarker：重跑 MinerU 或源文档变化后，只把受影响 topic 标记 stale，只重生成对应 synthesis、卡片与章节笔记，其余章节直接复用。
- 配合逐章重试（已有 retryChapterNote）形成"章节级"操作粒度。
- 验收：单页级变更的重生成 token 消耗 < 全量重跑的 20%。

### 6.3 模型调用健壮性（小项，顺手做）

- 429/5xx 指数退避；model-usage 持久化并在设置面板展示；超时和失败在 UI 上有一致的呈现。

## 7. Phase 2：检索与答案质量（Phase 1 之后评估）

1. **查询改写先行**：问答前用一次轻量模型调用把用户问题改写成 2–3 个检索查询，复用现有词法检索。成本一次调用，解决大半"换问法查不到"，且不引入任何新依赖。
2. **质量可见化**：把 knowledge-validation 已有的覆盖率/引用率数据在 UI 上呈现（每章"证据引用率"角标），强化"可信"心智。
3. embedding 仅在改写后召回仍不足时评估：优先用模型 API 的 embedding 端点 + IndexedDB 存向量，坚持不引入向量库和重依赖。

## 8. 明确不做（防膨胀清单）

- 不新增视图、视觉主题、背景素材（视觉层现状 9.6% 占比已够）。
- 不做用户系统、账号、云同步、任何后端服务。
- 不做移动端适配。
- 不做多模型供应商 SDK 适配（继续单 OpenAI 兼容协议 + 用户自填 endpoint）。
- 不引入 Cytoscape/向量库等重依赖。
- 不做跨课件统一笔记（README 已声明，GlobalKnowledgeAnchor 数据基础已预留，等产品验证后再说）。

## 9. 待拍板的决策点

1. **deployment-guide/ 去留**：若仓库兼作比赛提交/运维记录则归档保留，否则删除。其余 4 个遗留目录建议直接删。
2. **v1 存量数据**：Phase 0 的 schema v9 会直接丢弃旧版 localStorage 数据。项目当前无真实存量用户，建议接受；若有需要保留的演示数据，先导出为 v6 示例课程。
3. **Phase 1 主线确认**：本计划建议"留存 + 增量"优先于"检索质量"；若更在意问答体验可对调 Phase 1/2。
