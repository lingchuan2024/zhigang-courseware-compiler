# API 平台预设与快捷获取入口设计

## 目标

只优化设置弹窗中的“02 · 知识生成”区域。用户可以先选择常用 API 平台，由界面自动填入该平台的 OpenAI-compatible API 地址和推荐模型；用户仍可手动修改地址与模型，并可直接跳转到对应平台的官方 API Key 页面。

## 已确认的产品决策

- 采用单个“API 平台”下拉框，不使用会显著拉长弹窗的平台卡片网格。
- 选择平台后自动填写 API 地址和推荐模型。
- 自动填写的地址和模型始终可手动修改。
- 切换平台时保留用户当前输入的 API Key，不主动清空密钥。
- 平台范围包括 OpenAI、DeepSeek、阿里云百炼、智谱 BigModel、Kimi、火山方舟、硅基流动、OpenRouter、模力方舟，并保留“自定义”。
- 只修改知识生成设置，不改 MinerU 设置、首页、课件处理流程或其他页面。

## 范围

### 本次实现

- 在知识生成区域增加 API 平台选择器。
- 为每个平台维护显示名称、兼容地址、推荐模型、API Key 官方入口和简短提示。
- 选择平台时自动更新 API 地址和模型名称。
- 根据已保存的 API 地址识别当前平台。
- 无法识别的地址归入“自定义”。
- 在 API Key 字段附近增加平台对应的官方获取入口。
- 更新已经停用的 DeepSeek 默认模型。
- 补充相关组件测试。

### 不在本次范围

- 不在线请求平台的实时模型列表。
- 不验证 API Key 是否有效，也不代表用户发起模型调用。
- 不增加服务端密钥代理、账号系统或云端存储。
- 不改变当前 `ModelConfig` 数据结构和 localStorage 存储格式。
- 不替用户创建平台账号、充值或生成 API Key。
- 不改动课件生成、知识卡片生成和模型调用流程。

## 界面设计

### 平台选择器

- 放在“OpenAI-compatible 模型”说明下方、API 地址和模型名称输入框上方。
- 标签为“API 平台”。
- 使用与现有输入框一致的深色边框、圆角、字体和焦点样式。
- 选项顺序优先照顾国内用户：DeepSeek、阿里云百炼、模力方舟、智谱 BigModel、Kimi、火山方舟、硅基流动、OpenAI、OpenRouter、自定义。
- 模力方舟使用完整名称“模力方舟（Gitee AI）”，避免与火山方舟混淆。

### API Key 获取入口

- 在 API Key 标签同一行右侧显示“前往 {平台名} 获取 API Key ↗”。
- 链接使用当前平台的强调色，但不抢过主操作按钮。
- 新窗口打开，并设置 `target="_blank"` 与 `rel="noreferrer noopener"`。
- “自定义”模式不展示不可靠的通用跳转，改为显示“请前往服务商控制台获取 API Key”。

### 平台提示

- 在平台选择器下方显示一行简短提示，例如模型标识可能随平台更新、可以手动修改。
- 不增加长篇接入文档，避免设置弹窗变成帮助页面。
- 现有“API Key 仅保存在当前浏览器本机存储”说明继续保留。

### 响应式行为

- 桌面端继续保持 API 地址和模型名称双列布局。
- 窄屏沿用现有断点改为单列，平台选择器和快捷链接不产生横向滚动。
- API Key 标签行空间不足时允许说明和链接换行。

## 平台预设

预设以 2026-08-25 的官方资料为基线。模型更新速度快，因此所有模型名称保持可编辑；实现中应把预设集中在单一常量中，后续更新不需要修改组件结构。

| 平台 | OpenAI-compatible API 地址 | 推荐模型 | API Key / 官方入口 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | `https://platform.deepseek.com/api_keys` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `https://bailian.console.aliyun.com/?apiKey=1#/api-key` |
| 模力方舟（Gitee AI） | `https://ai.gitee.com/v1` | `GLM-5` | `https://ai.gitee.com/products/apis` |
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2` | `https://open.bigmodel.cn/usercenter/apikeys` |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-k2.6` | `https://platform.kimi.com/console/api-keys` |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-lite-260215` | `https://console.volcengine.com/ark/region:ark+cn-beijing/apikey` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4-Flash` | `https://cloud.siliconflow.cn/account/ak` |
| OpenAI | `https://api.openai.com/v1` | `gpt-5-mini` | `https://platform.openai.com/api-keys` |
| OpenRouter | `https://openrouter.ai/api/v1` | `~openai/gpt-latest` | `https://openrouter.ai/settings/keys` |

模力方舟的官方入口当前可能要求先登录，再进入 Serverless API 控制台。页面只承诺快速跳转到官方入口，不假设登录后的内部路由长期稳定。

## 状态与交互

组件内部增加仅用于界面展示的 `selectedProviderId`，不写入 `ModelConfig`：

1. 弹窗打开或 `initialValue` 更新时，对 API 地址做规范化比较，忽略末尾 `/`。
2. 地址与某个预设匹配时选择该平台，否则选择“自定义”。
3. 用户切换到预设平台时，以该平台的 `endpoint` 和 `defaultModel` 更新表单。
4. 切换平台不修改 `apiKey`。
5. 用户随后手动修改地址或模型时不阻止编辑；地址离开当前预设后，平台状态切换为“自定义”，避免错误显示平台身份。
6. 用户切回某个平台时再次应用该平台预设。
7. 保存仍调用现有 `onSave(ModelConfig)`，不增加字段，也不迁移历史数据。

## 代码组织

- 平台预设定义为只读常量和明确的 `ProviderPreset` 类型。
- 如平台匹配和 URL 规范化逻辑超过简单表达式，提取为无副作用辅助函数，便于单元测试。
- `SettingsModal` 继续负责表单状态和保存；不新增全局状态。
- 不引入新的 UI 组件库或运行时依赖。

## 兼容性与安全

- 已有用户保存的 API 地址、模型和 API Key 原样读取。
- 自定义 OpenAI-compatible 服务仍可正常配置。
- API Key 不出现在平台跳转 URL、日志或测试快照中。
- 外链只指向 HTTPS 官方域名。
- 外链使用安全的新窗口属性，防止新页面访问原页面的 `window.opener`。
- 本功能不声称纯前端 localStorage 等同于服务端密钥保险库；保留现有本机存储风险提示。

## 错误与边界处理

- 地址为空时平台显示“自定义”，继续由现有保存校验提示必填。
- 平台官网无法访问或要求登录时不影响表单填写和保存。
- 推荐模型在平台下线后，用户仍能手动填写其他模型；后续只需更新预设常量。
- 阿里云、火山方舟等存在地域或工作空间专属地址时，默认提供最通用的中国大陆入口，用户可以按控制台信息手动覆盖。
- 不通过前端探测链接可用性，避免跨域请求和额外隐私暴露。

## 测试策略

### 组件测试

- 渲染全部平台选项，且包含“模力方舟（Gitee AI）”和“自定义”。
- 选择平台会填写对应 API 地址和推荐模型。
- 切换平台保留 API Key。
- 自动填写后地址和模型仍可编辑。
- 手动修改为未知地址后切换为“自定义”。
- 已保存地址能在弹窗打开时识别对应平台，包括末尾斜杠差异。
- 模力方舟显示正确的官方入口。
- 自定义模式不显示错误的平台链接。
- 外链带有 `_blank`、`noopener` 和 `noreferrer`。
- 保存结果仍只有现有的 `endpoint`、`model` 和 `apiKey`。

### 回归测试

- 原有 MinerU Token 获取、校验和保存测试继续通过。
- 未配置模型时的现有状态和提示不受影响。
- 完整前端测试与生产构建通过。

## 验收标准

1. 用户能在知识生成区域选择全部 9 个平台或“自定义”。
2. 每个预设平台都能自动填入 API 地址和推荐模型。
3. 平台切换不会清空已输入的 API Key。
4. 用户可以手动覆盖自动填写的地址和模型。
5. 每个平台都提供可点击的官方 API Key 获取入口，模力方舟不能遗漏。
6. 保存和刷新后，现有模型配置继续正常恢复，不需要数据迁移。
7. 自定义 OpenAI-compatible 地址仍可使用。
8. 不改动设置弹窗之外的页面和功能。
9. 相关测试与生产构建通过。

## 官方资料基线

- OpenAI Quickstart：`https://platform.openai.com/docs/quickstart/make-your-first-api-request`
- DeepSeek API 文档与更新日志：`https://api-docs.deepseek.com/`、`https://api-docs.deepseek.com/updates/`
- 阿里云百炼 OpenAI 兼容调用：`https://help.aliyun.com/zh/model-studio/model-calling-in-sub-workspace`
- 模力方舟 Serverless API：`https://ai.gitee.com/products/apis`
- 智谱 HTTP API：`https://docs.bigmodel.cn/cn/guide/develop/http/introduction`
- Kimi API 概述与模型列表：`https://platform.kimi.com/docs/api/overview`、`https://platform.kimi.com/docs/models`
- 火山方舟快速调用：`https://www.volcengine.com/docs/82379/1795150`
- 硅基流动快速上手：`https://api-docs.siliconflow.cn/docs/userguide/quickstart`
- OpenRouter Quickstart：`https://openrouter.ai/docs/quickstart`
