# 研究策略：上下文工程与记忆工程

> 最后更新：2026-07-08（Phase 1000 B114 — Profile 页治理段全线闭环 · 10 项全量消化）

本项目是一个 **AI 上下文工程与记忆工程的研究平台**。目标是让研究者和实践者通过可运行的代码、可对比的实验、可追溯的文档，深入理解四个核心命题：

1. **记忆设计** — 如何组织信息让系统在需要时找到对的东西
2. **上下文处理** — 有限上下文窗口中塞什么、怎么塞
3. **Token 效率** — 每一分钱花在哪、值不值
4. **任务规划** — 复杂任务如何拆解、执行、纠偏

## 横切关注点

三个维度贯穿四块研究的每个 Phase：

### 用户控制权

系统视角之外，用户必须能干预记忆系统：纠正错误记忆、显式标注重要信息、删除敏感或过时记忆。不是"先建好系统再加控制面板"，而是每一步存储都携带可被用户操作的元数据。

**关键设计原则**：
- **Provenance tracking** — 每条 fact/episode 记录来源（从哪次对话、哪次抽取、哪次摘要产生），支持溯源和级联操作
- **级联控制** — 用户删除源对话时，衍生 facts/摘要的删除策略（级联删除 vs. 保留但标记为无源）
- **重要性 ground truth** — 用户显式标注的重要性作为模型训练的 ground truth，不纯靠启发式

### 隐私与安全分层

不是所有记忆平等。不做重量级合规框架，但两条最小落地原则不可妥协：

- **敏感信息分级** — 抽取时识别并标注（无害/个人/敏感/越界四级），嵌入元数据
- **注入过滤** — high-sensitivity 不进共享 LLM prompt，只进本地索引；中等敏感进 prompt 前做匿名化

| 级别 | 示例 | 存储 | 召回注入 | LLM 传输 |
|------|------|------|----------|----------|
| 无害 | 用户喜欢深色模式 | 全文 | 允 | 允 |
| 个人 | 用户有只猫叫咪咪 | 全文 | 允 | 允 |
| 敏感 | 月薪、住址 | 加密 | 匿名化后注入 | 摘要表述 |
| 越界 | 健康、政治、金融 | 本地 only | 禁止注入 prompt | 禁止 |

### 可演进的研究基础设施

不做"等所有 Phase 做完再验证"的大跃进，每个 Sprint 产出都能独立对比和评估。

- **A/B 对比实验框架** — 同一输入跑两个配置，diff 输出，量化差异
- **研究日志** — "假设 → 实验设计 → 结果 → 下一步发现"的科研式记录，与工程需求日志互补
- **渐进可用** — 每个 Sprint 产出可通过 Web UI 直接体验，不攒到最后一刻

---

## 一、记忆设计

核心问题：**如何组织信息，让系统在需要的时候找到对的东西？**

### Phase 1.1 — 事实抽取质量升级 ✅ 已交付

**现状**：DeepSeek 自由抽取 + 余弦去重。同实体不同写法不合并，重复事实漏检，丢失信息无法感知。

**要做的事**：
- **实体感知抽取**：从自由文本升级为 `(主体, 关系, 客体)` 三元组
- **跨对话事实融合**：基于实体消歧的去重（"老王" vs "王老师" → 同一实体），不单靠向量相似度
- **冲突检测**：同一主体同一关系不同客体 → 置信度双向降低，标记待澄清
- **信息丢失检测**：把抽取的事实拼回原文，让 LLM 判断"是否遗漏了重要信息"

**评估**：
- Precision / Recall（vs. 人工标注的事实集合）
- 冲突检测准确率
- 遗漏检测覆盖率

### Phase 1.2 — 多层存储架构 ✅ 已完成 (Phase 54, 5 Batch)

**已交付**：TierClassifier（recency + access + importance 三权重分级）→ TierRebalancer（定时重均衡）→ RecallEngine 分层感知（热/温/冷三源合并查询）→ API 端点 + 前端可视化面板（`TierDistributionPanel` + `MemoryBrowser` 层级筛选）。热层存全文向量（活跃窗口）、温层存压缩摘要向量（长期）、冷层存三元组图结构（永久）。层间迁移条件由 `TierClassifier.classify()` 自动判定。

**评估**：三权重分类准确率（41 tests 覆盖）· 压缩比 · 跨层召回覆盖率

### Phase 1.3 — 智能召回 (MMR) ✅ 已完成 (Phase 20 Batch 82)

**已交付**：语义去重（`deduplicate_candidates()` — FAISS ID + content 双键去重）+ MMR 召回重排（`mmr_rerank()` — 相关度×多样度 λ 权衡 + 偏好向量注入）+ 回溯链（`reconstruct()` 恢复原始文本）。RecallEngine 支持多源合并（episodes + facts 双通道），composite score 三维排序（语义相似度 × 衰减强度 × 重要性）。

**评估**：Recall@K · 多样性得分 · MMR λ 参数可调节（侧边栏 slider）

### Phase 1.4 — 记忆固化 ✅ 完成 (Phase 56)

**现状**：ConsolidationCore 两批交付——B1 日终慢降温（乘性衰减 ×0.98/次，grace_period 24h 豁免）+ B2 动态重要性（tanh 归一化访问频率 + 用进效应）+ `protect_hot()` 连续 N 次召回遗忘豁免。合并公式 `importance × cooldown × (1 + tanh(freq) × rate)` 单 pass 同时应用冷却与提升。机会主义触发模式（`consolidate_if_stale`），零侵入现有管线。零新 DB 表，复用已有 `episodes` + `recall_log`。

**已交付**：
- **批量后处理**：`consolidate_if_stale()` 日终触发（24h 间隔），全量扫描 episode 合并冷却+提升
- **重要性评估**：`recalc_importance()` 基于访问频率的 tanh 归一化动态权重（用进废退）；`protect_hot()` 基于连续召回的保护信号
- **记忆降级**：`TierClassifier` 三权重（recency + access + importance）分级 → `TierRebalancer` 定时重均衡 — Phase 54

**未交付（剥离至图谱扩展）**：
- **记忆链接**：跨对话隐含关联发现（entity 共现 + fact_links 表）→ 原 B3 剥离，属 1.3 知识图谱推理，不属 1.4 记忆固化

**评估**：
- 24h 后信息保留率
- 误删/误衰减率（被丢弃的记忆在后续对话中被需要的比例）

### Phase 1.5 — 用户记忆控制（横切）✅ 已完成 (Phase 30, 4 Batch)

- **纠正**：`POST /facts/{id}/confidence` — 用户标记错误事实 → 置信度设为 0，记录 confidence_log
- **删除**：`delete_episode` / `delete_fact` + 级联处理（衍生 facts/摘要标记为无源）
- **加星**：用户显式标注重要信息 → 冷冻结（不参与衰减），作为重要性 ground truth
- **溯源面板**：`TagDetailDrawer` 右侧滑入抽屉 + `GET /memory/tag-detail`（JOIN facts+episodes+confidence_log 三表联查）+ 来源链路完整可追溯

---

## 二、上下文处理

核心问题：**有限上下文窗口里塞什么、怎么塞？**

### Phase 2.1 — 上下文预算机制 ✅ 已完成 (Phase 63, 2 Batch)

**已交付**：上下文四色分区条（system/recalled/history/tools）展示各占 token 数 + Recall 截断阈值 slider + 容量感知（`compute_partitions()` 实时计算已用 vs 上限）+ QueryClassifier（轻/中/重三级查询分类）+ BudgetAllocator（按查询级别差异化预算分配：10%/40%/60%）+ AutoDegradationEngine（运行时 token 超标→按优先级砍：①事实抽取 ②温层摘要 ③召回数量）。**全量闭环**。

**要做的事**：
- **容量感知**：实时计算已用 tokens vs. 模型上限，剩余空间作为"预算"
- **查询分级**：轻量 20% 窗口给记忆，重量 60%+ 给记忆
- **预算分配策略**：system instruction / 召回记忆 / 当前对话 / 输出预留

**评估**：
- 上下文利用率（回复引用记忆 tokens / 注入记忆 tokens）
- 溢出率（目标：零）

### Phase 2.2 — 按需展开 ✅ 已完成 (Phase 58, 2 Batch)

**已交付**：B1 条目概要化（每条召回生成 20-30 token 摘要，`RecallItem.summary` 字段）+ B2 两阶段注入（`ChatEngine.generate(two_stage=True)` — 先概要入 prompt → LLM 引用后再展开原文注入二轮调用）。`ChatEngine.generate_and_store()` 签名新增 `two_stage` 参数，管线透明可追踪。

**评估**：展开率 · 窗口节省率 · 两阶段 vs 全量注入对比（A/B 实验框架可跑）

### Phase 2.3 — 上下文压缩管道 ✅ 已完成 (Phase 64, 2 Batch)

**已交付**：单消息 LLM 摘要压缩 + 压缩日志 + 分区条优化前后对比 + 对话结构识别（话题切换点检测 + 对话行为分类）+ 增量摘要（最近 3 轮原文 → 前 10 轮一句 → 再往前按主题合并）+ CriticalInfoProtector（五类不可概括信息保护：专名/数字/日期/决策/承诺，压缩前后 verify 保留率）+ TemporalFidelityEvaluator（LCS 比对+逆序检测，压缩后事件时序保真度评估）。**全量闭环**。

**要做的事**：
- **对话结构识别**：话题切换点检测 → 对话行为分类 → 段落标注（核心信息/情感/决策）
- **增量摘要**：最近 3 轮原文 → 前 10 轮一句 → 再往前按主题合并
- **关键信息保护**：压缩中保护专名、数字、日期、决策、承诺——这些不可被概括替代

**评估**：
- 事实保留率（压缩后能回答原对话事实问题的比例）
- 时序保真度（压缩后事件先后顺序保持率）
- 压缩比

### Phase 2.4 — 跨会话连续性 ✅ 已完成 (Phase 59, 2 Batch)

**已交付**：B1 会话边界检测（`SessionBoundaryDetector` — 三级回退：时间间隔 + 话题漂移 + 非终态 intent 检测）+ B2 回归摘要（`generate_regression_summary()` — 新会话自动注入上次关键回顾）+ 待办跟踪（`track_open_items()` — 未完成任务在新会话开始时提醒）。`session_summaries` 表持久化，`MemoryStore.get_recent_session_summaries()` 查询接口。

**评估**：连续性感知评分 · 用户重复交代率 · 边界检测准确率

---

## 三、Token 效率

核心问题：**每一分钱花在哪、值不值？**

### Phase 3.1 — 全链路 Token 计量 ✅ 已交付

**现状**：完全不可见。哪步花了多少毫无感知。

**要做的事**：
- **Token 会计**：每个 LLM 调用点自动记录 token 消耗
- **成本归因**：一次完整对话的总 token + 各环节占比，可视化到 pipeline chain
- **质量-成本比**：回复质量代理指标 / token 成本

**评估**：整套计量基础设施 + dashboard，后续每个优化都有 before/after。

### Phase 3.2 — 分级响应 ✅ 已完成 (Phase 63 B2 + Phase 65, 2 Batch)

**已交付**：意图分类器（提问/指令/探索/闲聊/澄清，置信度 0-1）+ 管线差异化路由（`ModelRouter.decide(intent)` — 简单意图→轻量管线，复杂意图→全管线）+ AutoDegradationEngine（token 预算不足时按优先级砍管线步骤：①事实抽取 ②温层摘要 ③召回数量）+ SensitiveInfoDetector（七类 PII 检测：身份证/手机/银行卡/地址/密码/邮箱/API密钥，命中→skip 外部 API→本地合成回复）。**全量闭环**。

**要做的事**：
- **查询分类器**：轻（聊聊，skip 召回）/ 中（一般问答，标准管线）/ 重（复杂任务，全管线）
- **自动降级**：token 预算不足时——先砍事实抽取，再砍温层摘要，最后砍召回数量
- 敏感信息查询走本地管线，不上传 API

**评估**：
- 分级准确率（重级召回率 / 轻级误报率）
- 平均 token 节省比例
- 追问率变化（代理质量指标）

### Phase 3.3 — 缓存策略 ✅ 已完成 (Phase 62, 1 Batch)

**已交付**：EmbeddingCache（FIFO max 1000）+ FactCache（SHA256 key max 64）+ 瀑布图缓存节省条 + LSH 近似匹配 + Prompt 前缀缓存（利用 DeepSeek API prompt caching）+ SemanticResponseCache（余弦相似度≥0.95 命中返回缓存响应，FIFO 64，feature flag 门控）。**全量闭环**。

**要做的事**：
- Embedding 缓存（LSH 近似匹配）
- Prompt 前缀缓存（利用 DeepSeek API prompt caching）
- Fact extraction 去重（新对话和最近某次高度重合 → skip）
- 响应缓存（>0.95 相似查询返回缓存，用户可强制刷新）
- 敏感缓存本地 only

**评估**：
- 各环节缓存命中率
- 延迟改善
- 直接成本节约

### Phase 3.4 — 模型路由 ✅ 已完成 (Phase 55)

**现状**：✅ 全链路交付——决策引擎 + 管线接入 + 失败回退 + 前端可见。4 Batch 闭环。

**已交付**：
- `ModelRouter.decide(intent)` — intent→complexity→model 规则链：简单意图（闲聊/澄清）→ `simple_model` (deepseek-chat)，复杂意图（提问/指令/探索）→ `complex_model` (deepseek-reasoner)
- `is_retryable_error()` — 超时/4xx/5xx（除 401）自动触发回退
- `execute_with_fallback()` — 主模型失败→回退模型，最多 1 次重试，不退化为无限循环
- `RoutingInfo` Pydantic 模型 + `ChatResponse.routing` 字段 — API 响应显式携带路由决策
- `ModelRoutingCard` — Sidebar 三态渲染（自动/手动/未初始化）+ 模型覆盖下拉
- Feature flag `routing_enabled` 默认关闭，零风险渐进上线

**评估**：
- 路由准确率：5 意图全分类正确（41 tests 覆盖）
- 成本-质量帕累托：简单任务用 deepseek-chat (¥1/¥2)，复杂任务用 deepseek-reasoner (¥4/¥16)
- 回退安全性：401 不回退 · 最多 1 次重试 · FallbackExhaustedError 含完整上下文

---

## 四、任务规划

核心问题：**复杂任务如何拆解、执行、纠偏？**

### Phase 4.1 — 规划能力基建 ✅ 已完成 (Phase 53, 2 Batch)

**已交付**：Plan Schema（`PlanResult` + `Subtask` + `TaskDependency` Pydantic 模型）+ PlanStore（`plans` 表 + `MemoryStore.insert_plan()` / `get_plan()` / `list_plans()`）+ API（`POST /planner/plan` + `GET /planner/plans`）+ 前端（`PlanProgressPanel` 展示当前执行计划 + 步骤状态）。L1 意图分类（Phase 17 Batch 70）作为前置基础已就绪。敏感任务标记通过 provenance tracking 元数据覆盖。

**评估**：意图分类准确率（5 类全分类，41 tests 覆盖）· 计划生成质量（人工评审）· Plan Store 查询性能

### Phase 4.2 — 记忆引导规划 ✅ 已完成 (Phase 60, 3 Batch)

**已交付**：B1 `PlanHistoryRetriever` — 新任务从 Plan Store 检索相似历史计划（语义向量 + 意图类别双通道）+ B2 成败模式学习 — 提取历史计划中常失败步骤/常遗漏依赖/成功路径特征 + B3 自适应生成 — `PlanGenerator.generate_plan()` 基于历史得失调整步骤（`plan_history` 参数），不照搬历史。`MemoryStore.update_subtask()` 追踪步骤执行结果反哺记忆。

**评估**：有记忆 vs. 无记忆下的 plan match 率差异 · 首次成功率

### Phase 4.3 — 动态重规划 ✅ 已完成 (Phase 57, 3 Batch)

**已交付**：B1 步骤监控（`ReplanDetector` — 每步完成自动评估产出质量，异常检测：超时/偏离/依赖变更）+ B2 局部重规划（`replan()` — 从失败步骤重规划，保留已完成产出，DAG 依赖自动重算）+ B3 用户干预接口（计划可视化后用户可跳过/修改/补充步骤，`PATCH /planner/plan/{id}` + `POST /planner/plan/{id}/override`）。`ReplanComparePanel` 前端对比原计划 vs 重规划差异。

**评估**：异常检测准确率 · 重规划额外步骤数 · 用户干预频率

### Phase 4.4 — 反思闭环 ✅ 已完成 (Phase 61, 2 Batch)

**已交付**：B1 事后总结（`post_mortem()` — 实际 vs. 计划 diff + 偏差提取 + 关键决策点回溯 + LLM 改进合成）+ B2 知识沉淀（`upsert_reflection_insight()` — 反思中的通用规律写入 `reflection_insights` 表，标记为元知识）+ 计划蒸馏（同类任务多次执行后蒸馏最佳实践模板，`ReflectionEngine.distill()`）。`MemoryStore.get_reflection_insight()` / `list_reflection_insights()` 查询接口 + `POST /planner/reflect` API。

**评估**：反思质量（人工评分）· 跨任务知识迁移率 · 计划蒸馏覆盖率

---

## 执行路径

每个 Sprint 产出：代码 + 测试 + 评估数据 + 研究笔记（`docs/research-notes/`）。

> **2026-07-01 里程碑**：95 问内容答案全部交付（Phase 42-52，Ch1-Ch8 全覆盖）。四支柱 15/15 子阶段全量闭环 🎉🎉🎉。Phase 53-65 全部完成。无遗留项。

```
四支柱交付总览:
  记忆设计:   1.1 ✅ · 1.2 ✅ (Phase 54) · 1.3 ✅ (Phase 20) · 1.4 ✅ (Phase 56) · 1.5 ✅ (Phase 30)
  上下文处理: 2.1 ✅ (Phase 63) · 2.2 ✅ (Phase 58) · 2.3 ✅ (Phase 64) · 2.4 ✅ (Phase 59)
  Token 效率: 3.1 ✅ · 3.2 ✅ (Phase 63+65) · 3.3 ✅ (Phase 62) · 3.4 ✅ (Phase 55)
  任务规划:   4.1 ✅ (Phase 53) · 4.2 ✅ (Phase 60) · 4.3 ✅ (Phase 57) · 4.4 ✅ (Phase 61)
```

### 横切能力交付现状

| 横切维度 | 已交付 | 未交付 |
|---------|--------|--------|
| 用户控制权 | provenance tracking · 级联删除 · 加星冻结 · 溯源面板 (TagDetailDrawer) | 固化结果用户可审核 |
| 隐私安全 | 四级敏感分级标注 · 本地索引存储 | 注入过滤规则 · 敏感任务审批流 |
| 实验基础设施 | A/B 对比实验框架 (ExperimentRunner) · 实验日志模板 | 自动化 benchmark · CI 集成 |

---

## 文档体系

| 文档 | 定位 |
|------|------|
| `docs/architecture.md` | 组件中枢索引 + ADR + 实现现状表 |
| `docs/roadmap.md` | 分批次任务明细 + 验证标准 + 执行状态 |
| `docs/methodology.md` | AI 辅助开发端到端工作流方法论（可迁移） |
| `docs/research-strategy.md` | 本文件 — 研究策略全景 |
| `docs/requirements-log.md` | 工程需求变更日志 |
| `docs/pitfalls.md` | 踩坑记录 |
| `docs/lessons-learned.md` | 可迁移的通用经验 |
| `docs/ui-ux-patterns.md` | UI/UX 通用模式手册（跨框架可迁移） |
| `docs/model-comparison.md` | 模型能力对比追踪（候选编程 agent 评估唯一真相源） |
| `docs/research-notes/` | 研究笔记（按 Sprint 组织） |
