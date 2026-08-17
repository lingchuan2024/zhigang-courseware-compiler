# 知纲 - 课件编译器

[![CI](https://github.com/lingchuan2024/zhigang-courseware-compiler/actions/workflows/ci.yml/badge.svg)](https://github.com/lingchuan2024/zhigang-courseware-compiler/actions/workflows/ci.yml)

知纲不是把 PPT/PDF 直接总结成 Markdown 的工具，而是一个"课件编译器"：

```
课件 → MinerU 解析 → Markdown 知识库 → 两层知识结构 → 知识卡片 → 课程母笔记 → 全库问答
```

纯前端应用：解析、结构化、笔记生成和问答全部在浏览器本地完成，AI 能力通过用户自备的
OpenAI 兼容接口（BYOK）接入，API Key 只保存在页面内存中。

## 核心原则

1. **先建立证据，再生成内容** —— 卡片和笔记的每条内容都引用课件原文（Markdown 块区间 + 页码），可点击回溯
2. **课件内容是数据，不是指令** —— 内置提示注入防护
3. **三种消费形态共享同一事实基础** —— 知识网、知识卡片、课程母笔记不分别生成事实
4. **模型不可用时自动降级** —— 每层 AI 调用都有本地确定性兜底，示例课程无需任何 Key 即可完整体验
5. **错误隔离** —— 单窗口提取失败可重试，单章节笔记失败不影响其他章节
6. **API Key 只保存在页面内存** —— 不持久化、不上报

## 工作流程（六步）

| 阶段 | 说明 |
|------|------|
| 壹 · 上传课件 | PDF / PPTX / Markdown（≤20MB），或一键载入内置示例课程 |
| 贰 · 课件预览 | 高清逐页预览，从这里一键进入 MinerU 解析 |
| 叁 · MinerU 解析 | 云端 OCR/版式解析为 Markdown，建立 SourceDocument 与内容块索引 |
| 肆 · 知识结构 | 8 阶段知识管线：标准化 → 切窗分析 → 候选提取 → 合并消歧 → 讲解结构 → 拓扑排序 → 卡片骨架 → 校验；两层知识网可视化 |
| 伍 · 知识卡片 | 卡片 AI 深化（要点/适用条件/例子/自测题/原文摘录），带引用溯源 |
| 陆 · 完整笔记 | 逐章生成课程母笔记（术语表/符号表保持跨章一致），失败章可单独重试 |

在此之上是多课程知识库（IndexedDB）与全库问答：基于知识卡片的词法检索（中文 bigram +
英文 token 加权）+ 引用快照，回答中的每条引用都可回跳到卡片与课件原文。

## 两层知识结构

- **第一层（KnowledgeTopic）**：这份课件讲了哪些值得形成独立学习目标的核心知识？它们之间的前置/推导/使用/对比关系是什么？推荐什么顺序学习？
- **第二层（TeachingBlock）**：每个知识点内部通过哪些定义、公式、推导、案例、对比讲清楚？按什么叙事顺序组织？

AI 给出的关系候选会经过程序校验（未知节点/未知引用/自环丢弃、重复合并、DFS 环检测并
删除低置信边），再用稳定拓扑排序产出可解释的推荐学习顺序——不默认信任 PPT 页序。

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
本地 Ollama 等）。配置后主题提取、讲解结构、卡片深化与章节笔记由模型生成；MinerU 解析
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
- 项目状态保存在 localStorage（schemaVersion=9，仅 v6 字段白名单）+ IndexedDB（课程库快照、
  原始文件、检索记录、问答会话）
- v9 之前的 localStorage 数据在加载时直接丢弃，不做迁移

## 当前版本限制

- 检索为词法匹配（bigram + token 加权），无语义向量召回；换一种问法可能查不到
- 活跃项目全量状态写入 localStorage（~5MB 配额），多份大课件并存可能触顶（Phase 1 计划改为
  IndexedDB 单一真相源）
- 上游变化（重新解析/改证据）后为全量重跑管线，尚无章节级增量更新
- 仅支持 OpenAI 兼容单一协议，无多供应商适配
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
│   ├── knowledge-pipeline-v2.ts   # 8 阶段知识管线编排
│   ├── content-window / topic-extraction-v2 / topic-reconciliation
│   ├── teaching-structure / learning-order / knowledge-relation-traversal
│   ├── card-generator / card-enrichment / card-quality      # 卡片骨架/深化/质量门
│   ├── master-note-generator / course-master-note           # 逐章母笔记 + 确定性组装
│   ├── card-retrieval / card-rag / qa-conversation-context  # 问答检索与生成
│   ├── knowledge-validation    # 覆盖率/环/来源校验
│   ├── library-repository.ts   # IndexedDB 多课程库（7 个 store）
│   ├── persistence.ts          # localStorage（schemaVersion=9 白名单）
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
