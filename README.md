# 知纲 - 课件编译器

[![CI](https://github.com/lingchuan2024/zhigang-courseware-compiler/actions/workflows/ci.yml/badge.svg)](https://github.com/lingchuan2024/zhigang-courseware-compiler/actions/workflows/ci.yml)

知纲不是把 PPT/PDF 直接总结成 Markdown 的工具，而是一个"课件编译器"：

```
MinerU Markdown → 稳定证据片段 → 章节统一编译 → 课程知识归一
→ 学习顺序编译 → 两层课程结构 → 知识卡片/母笔记/问答
```

纯前端应用：解析、结构化、笔记生成和问答全部在浏览器本地完成，AI 能力通过用户自备的
OpenAI 兼容接口（BYOK）接入，API Key 只保存在页面内存中。

## 核心原则

1. **先建立证据，再生成内容** —— 卡片和笔记的每条内容都引用课件原文（Markdown 块区间 + 页码），可点击回溯
2. **课件内容是数据，不是指令** —— 内置提示注入防护
3. **三种消费形态共享同一事实基础** —— 知识网、知识卡片、课程母笔记不分别生成事实
4. **结构编译与内容生成分离** —— 结构就绪不等待卡片深化或笔记生成，示例课程无需任何 Key 即可完整体验
5. **错误隔离** —— 单章节批次失败会保留其余可用结构，单章节笔记失败不影响其他章节
6. **API Key 只保存在页面内存** —— 不持久化、不上报

## 工作流程（六步）

| 阶段 | 说明 |
|------|------|
| 壹 · 上传课件 | PDF / PPTX / Markdown（≤20MB），或一键载入内置示例课程 |
| 贰 · 课件预览 | 高清逐页预览，从这里一键进入 MinerU 解析 |
| 叁 · MinerU 解析 | 云端 OCR/版式解析为 Markdown，建立 SourceDocument 与内容块索引 |
| 肆 · 知识结构 | 六阶段课程编译：准备证据 → 章节统一编译 → 知识点归一 → 课程审查 → 学习顺序编排 → 结构校验；两层结构可视化 |
| 伍 · 知识卡片 | 卡片 AI 深化（要点/适用条件/例子/自测题/原文摘录），带引用溯源 |
| 陆 · 完整笔记 | 逐章生成课程母笔记（术语表/符号表保持跨章一致），失败章可单独重试 |

在此之上是多课程知识库（IndexedDB）与全库问答：基于知识卡片的词法检索（中文 bigram +
英文 token 加权）+ 引用快照，回答中的每条引用都可回跳到卡片与课件原文。

## 两层课程结构

- **第一层（LearningTopic）**：每个节点都是独立、可学习、可验证的课程目标；不建立父子主题树。
- **第二层（TeachingUnit）**：用受控角色表达定义、条件、公式、推导步骤、案例、对比和应用，负责把一个知识点讲清楚。

这不是通用知识图谱。原文证据可以同时支撑多个知识点；显式的 `before → after` 约束决定
硬前置顺序，程序通过环检测、确定性拓扑排序和原文顺序兜底得到稳定学习路径。模型只负责
按章节提取候选结构和至多一次课程级审查，不在每个知识点上重复调用。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发模式（内置 /api/mineru 本地代理，解决开发期 CORS）
pnpm test       # 测试
pnpm check      # TypeScript 类型检查
pnpm lint       # ESLint
pnpm build      # 生产构建（tsc -b && vite build）
```

### 无模型体验

点击"载入示例课程"（概率模型基础，9 个知识点/12 张卡片/3 章母笔记），无需任何 API Key
即可走完知识网 → 卡片 → 完整笔记 → 问答全流程。

### 配置 AI（可选）

侧栏"模型设置"填入 OpenAI 兼容接口（endpoint + model + apiKey，支持 OpenAI、DeepSeek、
本地 Ollama 等）。配置后章节结构编译、课程级审查、卡片深化与章节笔记由模型生成；MinerU 解析
需要在设置中单独配置 MinerU API（mineru.net）。

## 部署

静态站点，`pnpm build` 后将 `dist/` 部署到任意静态服务器。生产环境需要反向代理两条路径
（等价于 `vite/mineru-proxy.ts` 在开发期提供的能力）：

- `/api/mineru/v4/*` → `https://mineru.net`
- `/api/mineru/resource/*` → MinerU 结果文件所在的白名单域

参考 `deploy.sh`（rsync 到 Nginx 静态目录）。

## 技术栈

- React 18 + TypeScript + Vite + Tailwind CSS
- Zustand（状态管理，三个 store：工作区 / 课程库 / 问答会话）
- PDF.js（PDF 解析）、JSZip（PPTX 解析）
- react-markdown + remark-math + rehype-katex（笔记渲染）
- 纯 SVG/Canvas 知识网（不引入 Cytoscape 等重依赖）
- Vitest + jsdom + fake-indexeddb（测试）

## 隐私边界

- 课件解析、结构组织、笔记渲染全部在浏览器本地完成
- 只有用户主动配置模型/MinerU 后，相关内容才会发送到对应 API
- API Key 仅保存在页面内存，刷新后需重新输入
- **持久化（v10）**：项目数据唯一真相源是 IndexedDB 课程库（快照、原始文件、检索记录、问答会话）；localStorage 只存一个约 100 字节的工作区指针和模型/MinerU 配置，项目数据不再进入 localStorage，多课件并存不再受 5MB 配额限制
- 刷新后回到首页，从课件库打开课件即可恢复到离开时的阶段

## 当前版本限制

- 检索为词法匹配（bigram + token 加权）+ 提问前的一次查询改写（把问题转写为卡片术语词表内的检索词，失败自动回退原问题）；无语义向量召回
- 重跑 MinerU 采用内容级增量：未变化章节复用编译 checkpoint，不发生结构提取调用；人工修正且证据仍有效的主题与顺序约束会被保留
- 仅支持 OpenAI 兼容单一协议，无多供应商适配（限流/5xx 已有指数退避与 Retry-After 支持，用量统计在本机累计并在服务配置中查看）
- 知识网只读浏览（不支持拖节点/手动加删边）
- 跨课件统一笔记未实现（数据基础已预留，见下阶段计划）

## 项目结构

```
src/
├── components/
│   ├── home/               # 首页落地页（休眠知识宇宙）
│   ├── document-review/    # 课件预览工作区（PDF/PPTX 高清预览）
│   ├── knowledge-network/  # 两层知识网画布 + 原文面板
│   ├── progress/           # 任务进度/失败/阻塞状态
│   ├── nebula/             # 星云视觉背景（Canvas）
│   ├── backgrounds/        # 天文图像背景
│   ├── UploadView / MinerUParseView / KnowledgeStructureView
│   ├── KnowledgeCardsView / MasterNoteView
│   ├── KnowledgeQaView / LibraryView / SettingsModal / Sidebar
│   └── MarkdownRenderer    # KaTeX + 引用按钮渲染
├── lib/
│   ├── markdown-parser.ts / source-markdown-normalizer.ts   # MinerU Markdown → SourceDocument
│   ├── mineru-client.ts    # MinerU API（上传/轮询/结果抽取）
│   ├── knowledge-pipeline-v2.ts   # 课程结构编译、兼容投影与基础卡片编排
│   ├── course-structure/          # 两层 IR、章节编译、课程调度、校验与增量复用
│   ├── content-window / learning-order   # 旧快照兼容与共享工具
│   ├── card-generator / card-enrichment / card-quality      # 卡片骨架/深化/质量门
│   ├── master-note-generator / course-master-note           # 逐章母笔记 + 确定性组装
│   ├── card-retrieval / card-rag / qa-conversation-context  # 问答检索与生成
│   ├── knowledge-validation    # 覆盖率/环/来源校验
│   ├── library-repository.ts   # IndexedDB 多课程库（7 个 store）
│   ├── persistence.ts          # IndexedDB 快照 + localStorage v10 工作区指针
│   ├── model-v2.ts             # callChatCompletion（OpenAI 兼容、结构化重试）
│   └── examples.ts             # 内置示例课程（v6 数据直构）
├── store/
│   ├── useStore.ts         # 工作区状态（单课件编译流程）
│   ├── useLibraryStore.ts  # 多课程库导航
│   └── useQaStore.ts       # 问答会话
└── types/index.ts          # v6 类型体系（Markdown 知识库架构）
```

## 开发验证

```bash
pnpm test && pnpm check && pnpm lint && pnpm build
```

## License

MIT
