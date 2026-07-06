# GlassCortex

See How AI Remembers, Thinks, and Plans
逐层解剖 AI Robot 工作原理

**核心体验**：基模是大脑，GlassCortex 是包裹大脑的皮层。打开 AI Robot，逐层解剖它的认知过程——记忆如何形成与遗忘、上下文如何组装、Token 如何消耗、意图如何识别。不是黑盒 API 调用，是透明的认知层探索工具。

## 30 秒快速体验

```bash
git clone <repo-url> && cd glassmind
make setup                               # 创建环境 → 安装依赖
export DEEPSEEK_API_KEY=sk-...           # DeepSeek API key（注册即送额度）
make web                                 # 浏览器打开 → 开始对话
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
| **Planner 意图识别** | "它怎么理解我的意图并规划行动？" | — | 意图分类、任务拆解、执行规划 |

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
| `make web` | 启动 Streamlit Web UI |
| `make smoke` | Streamlit 冒烟测试（启动 → curl 200 → 退出） |
| `make lint-fix` | ruff 自动修复格式问题 |

运行 `make help` 查看全部可用命令。
