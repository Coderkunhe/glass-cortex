# GlassCortex

See How AI Remembers, Thinks, and Plans
逐层解剖 AI Robot 工作原理

**核心体验**：基模是大脑，GlassCortex 是包裹大脑的皮层。打开 AI Robot，逐层解剖它的认知过程——记忆如何形成与遗忘、上下文如何组装、Token 如何消耗、意图如何识别。不是黑盒 API 调用，是透明的认知层探索工具。

## 30 秒快速体验

```bash
# Gitee（国内用户推荐）
git clone git@gitee.com:Coderkunhe/agent-instances.git && cd agent-instances/glasscortex
# GitHub
git clone git@github.com:Coderkunhe/glass-cortex.git && cd glass-cortex/glasscortex
make setup                               # 创建环境 → 安装依赖
export DEEPSEEK_API_KEY=sk-...           # DeepSeek API key（注册即送额度）
make dev                                 # 浏览器打开 → 开始对话
```

也可以用终端：

```bash
./venv/bin/python -m src.chat.cli         # CLI 聊天，Rich 彩色终端面板
./venv/bin/python -m src.chat.cli --profile bob  # 指定 Profile
```

没有 API key？没关系——记忆系统的召回、遗忘、可视化全部照常运转，只是 AI 回复和知识抽取会静默跳过。

## 四大认知支柱

每个支柱回答一个核心问题，映射到 AI Robot 认知层的具体能力：

| 支柱 | 回答的问题 | 已有能力 | 远期 |
|------|-----------|---------|------|
| **记忆与遗忘** | "它怎么记住我、又为什么会忘？" | 双层记忆（Episode+Fact）、艾宾浩斯衰减曲线、语义向量召回、知识三元组抽取、冲突检测、用户画像 | — |
| **上下文工程** | "它能同时看到多少信息？" | 上下文窗口可视化、3 种溢出策略（截断/排序/摘要）、系统提示词查看、会话记忆边界 | — |
| **Token 监控与节省** | "每一分钱花在哪了？" | 全链路 Token 计量、成本瀑布图（DeepSeek 定价换算）、数据主权面板（存储位置/文件大小） | — |
| **Planner 意图识别** | "它怎么理解我的意图并规划行动？" | L1 意图分类（5 类）、L2 子任务 DAG 分解、L2.5 重规划检测、L3 反思引擎、历史计划检索 | 执行引擎对接 |

**横切能力**：消息旅程四阶段卡片（遗忘→召回→回复→存储）、模型参数实时调节（model/temperature/max_tokens）、A/B 实验框架、可观测性仪表盘（健康检查 + 结构化日志 + Trace 浏览器）。

**三页导航**：
- **聊天** — 对话交互 + 认知层面板
- **用户画像** — 知识标签 + 记忆统计 + Profile 切换
- **记忆实验室** — 时间轴 / 分布 / 浏览器 / 知识库 / 向量空间 / A/B 实验

## 配置 API Key

```bash
export DEEPSEEK_API_KEY=sk-your-key-here
```

在 [DeepSeek 开放平台](https://platform.deepseek.com) 注册即送免费额度。

## 为什么暂未做 RAG 和 MCP

RAG（检索增强生成）和 MCP（Model Context Protocol）在路线图上标记为「远期」，暂未实现的原因：

**领域聚焦优先**。GlassCortex 的定位是 AI Robot **认知层透明化**——记忆如何形成与遗忘、上下文如何组装与溢出、Token 如何计量与节省、意图如何识别与任务如何规划。这四大支柱已经构成完整的认知闭环，每个支柱都有独立的可视化面板、状态机、边界测试。RAG 和 MCP 属于 Agent **框架层**能力，解决的是「怎么调用外部工具/检索外部知识」——这与认知层透明化的分层边界不同。

**认知层先行，框架层后至**。在四大支柱完全落地、透明化体验打磨到位之前，不扩展到新的技术领域。RAG 和 MCP 作为认知层的自然延伸，会在核心支柱成熟后加入——届时外部知识检索（RAG）和外部工具调用（MCP）将成为第五、第六支柱，同样带有完整的透明化面板。

详见 [docs/architecture.md](docs/architecture.md) 项目边界定义。

<!-- GITEE-ONLY-START -->
## 文档导航

| 你想了解 | 看这里 |
|---------|--------|
| 项目协作规范和工程铁律 | [CLAUDE.md](CLAUDE.md) |
| 架构决策记录 (ADR) + 技术选型 | [docs/architecture.md](docs/architecture.md) |
| 开发进度、任务明细、验证标准 | [docs/roadmap.md](docs/roadmap.md) |
| 需求变更日志 | [docs/requirements-log.md](docs/requirements-log.md) |
| AI 辅助开发工作流方法论 | [docs/methodology.md](docs/methodology.md) |
| 踩坑记录 | [docs/pitfalls.md](docs/pitfalls.md) |
| 可迁移经验沉淀 | [docs/lessons-learned.md](docs/lessons-learned.md) |

## 常用命令

| 命令 | 用途 |
|------|------|
| `make check` | lint + type + test 全量门禁 |
| `make dev` | 启动 FastAPI + Next.js 前端 |
| `make check-all` | Python + 前端全栈门禁 |
| `make lint-fix` | ruff 自动修复格式问题 |
| `make ship` | 全栈门禁 → 推送 Gitee → 自动镜像 GitHub |

运行 `make help` 查看全部可用命令。
<!-- GITEE-ONLY-END -->
