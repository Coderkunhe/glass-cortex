# 架构文档

> 最后更新: 2026-07-16 (三张架构图完稿: System Architecture + Runtime Pipeline + Memory Timeline)

## 系统架构图

### System Architecture ### 

```
┌──────────────────────────────────────────────────────────────────┐
│                          🖥  浏览器                               │
│   / 聊天    /learn 知识库    /lab 实验台    /profile    /obs      │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼───────────────────────────────────────┐
│                    Next.js 16 App Router                         │
│                                                                  │
│  AppShell 布局层    │ 共享组件层                                  │
│                     │ ChatMessage · AnswerCard · Drawer          │
│  Hooks 层           │ OnionPanel · ProcessDrawer                 │
│  useChat            │ ErrorBoundary · TabBar · CollapsibleSection│
│  useFetchData       │                                            │
│  useCodeHighlight   │ Lib 层                                     │
│  useLocalStorage    │ API Client · renderMarkdown · formatNum    │
│                     │ formatTime · confidence · constants        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ fetch / JSON
┌──────────────────────────▼───────────────────────────────────────┐
│                     FastAPI REST API                             │
│  /chat  /memory  /profiles  /metrics  /traces  /context  /planner│
│  /health                                                         │
└───┬────────┬─────────┬──────────┬──────────┬────────────────────┘
    │        │         │          │          │
┌───▼────────▼─────────▼──────────▼──────────▼────────────────────┐
│                       Python 引擎层                               │
│                                                                  │
│  ChatEngine          记忆系统(7)       Planner(7)    上下文工程   │
│  聊天管线            triple·fact      intent·plan    overflow_sim│
│  model_router        store·index      plan_history   partition   │
│  local_router        recall·forget    reflection     budget      │
│  CLI                 consolidate      replan         session_bnd │
│                                                                  │
│  TokenLedger — 全链路计量与归因                                  │
│                                                                  │
└───┬─────────┬────────────┬──────────────────────────────────────┘
    │         │            │              ┌──────────────────┐
┌───▼─────────▼────────────▼──┐           │   DeepSeek API   │
│        数据层                │           │   LLM 推理       │
│  ┌───────────┐ ┌──────────┐ │           └──────────────────┘
│  │  SQLite   │ │  FAISS   │ │
│  │  episodes │ │ 语义索引 │ │
│  │  facts    │ │ 向量检索 │ │
│  │  traces   │ │          │ │
│  │  sessions │ │          │ │
│  └───────────┘ └──────────┘ │
└─────────────────────────────┘
```

> 前端 5 页面 → 8 个 API 路由 → 5 个引擎模块 → SQLite + FAISS 双存储。DeepSeek API 为唯一外部依赖。

## Runtime Pipeline — 一次请求的完整流转

```
用户输入: "Token 是什么？"
│
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │                    POST /api/chat                                   │
│  │  {message, profile_id, model?, temperature?, max_tokens?}          │
│  └──────────────┬──────────────────────────────────────────────────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 1. Planner 意图分类   │  LLM 调用 → 五类意图: 提问/指令/分析/闲聊/规划
│     │    IntentResult       │  含 confidence + rationale + complexity
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 2. Embedding 嵌入     │  MiniLM 本地模型 → message → [0.12, -0.34, ...]
│     │    embed(message)     │  向量维度 384
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 3. FAISS 语义检索     │  FAISS.search(vector, k=20)
│     │    粗筛 top-20        │  IndexFlatL2 → 欧氏距离排序
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐         ┌────────────────────┐
│     │ 4. 并行取回           │────────►│ SQLite: episodes   │
│     │    fork-join          │         │ (id, content, ...  │
│     │    by episode_id      │────────►│  strength, tier)   │
│     └───────────┬──────────┘         └────────────────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 5. 语义去重 + MMR    │  Dedup: FAISS ID + content 双键去重
│     │    dedup → mmr_rerank│  MMR: 相关度×多样度 λ 权衡 → top_k=5
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 6. 艾宾浩斯强度计算   │  strength = e^(-λ × Δt)
│     │    + 置信度评分       │  + recall_count 用进效应
│     │    + 截断过滤         │  + composite score 阈值截断
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 7. System Prompt 组装 │  基础指令 + 召回记忆 + 事实
│     │    _build_system_     │  → OverflowSim 溢出模拟
│     │    prompt()           │  → 策略: truncate/prioritize/summarize
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 8. LLM 推理           │  POST DeepSeek API /chat/completions
│     │    ChatEngine.generate│  {system, user, temperature, max_tokens}
│     │                       │  ← response + usage (prompt/compl tokens)
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 9. Token 计量         │  token_ledger.record("chat",
│     │    TokenLedger        │    prompt_tokens, completion_tokens)
│     │                       │  → 计入 session + 全量统计
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 10. 事实抽取          │  FactExtractor (LLM 二次调用)
│     │     extract_facts()   │  三元组 (s, r, o) + 实体归一化
│     │                       │  + 冲突检测 + 去重
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 11. 双写存储           │  ┌─ SQLite: INSERT episode (user+assistant)
│     │     store_response()  │  │  + INSERT facts (triples)
│     │     + insert_facts()  │  └─ FAISS: add(embedding, metadata)
│     └───────────┬──────────┘
│                 │
│     ┌───────────▼──────────┐
│     │ 12. 管线 Trace 持久化  │  trace 表: step_name + elapsed_ms +
│     │     insert_trace()    │  status + metrics
│     └───────────┬──────────┘
│                 │
│  ┌──────────────▼──────────────────────────────────────────────────────┐
│  │                    JSON Response → Next.js                          │
│  │  {reply, episode_id, intent, context_meta, api_trace, trace_id}    │
│  └──────────────┬──────────────────────────────────────────────────────┘
│                 │
│  ┌──────────────▼──────────────────────────────────────────────────────┐
│  │  前端渲染: ChatMessage · OnionPanel 四层渐进披露                     │
│  │  L1 意图 → L2 召回 → L3 上下文窗口 → L4/L5 模型推理                 │
│  └─────────────────────────────────────────────────────────────────────┘
```

> 一次 `/chat` 请求经过 12 步管线：Planner → Embed → FAISS → 并行取回 → 去重+MMR → 评分截断 → Prompt 组装 → LLM → Token 计量 → 事实抽取 → 双写存储 → Trace 持久化。每一步均可通过 OnionPanel 展开查看细节。

## Memory Timeline — 记忆生命周期

```
                        ┌──────────────────────────────────────────────┐
                        │              记忆生命周期全景                  │
                        └──────────────────────────────────────────────┘

  ┌─────────┐    ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
  │  CREATION│───►│  STORAGE│───►│ RETRIEVAL │───►│ STRENGTH │───►│FORGETTING│
  │  创造     │    │  存储    │    │  检索      │    │  强化     │    │  遗忘     │
  └────┬─────┘    └────┬─────┘    └─────┬─────┘    └────┬─────┘    └────┬─────┘
       │               │               │               │               │
       ▼               ▼               ▼               ▼               ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │用户对话   │   │双写持久化 │   │语义召回   │   │艾宾浩斯   │   │慢降温     │
  │& LLM 回复 │   │SQLite    │   │FAISS 搜索 │   │衰减曲线   │   │cooldown   │
  │           │   │+ FAISS   │   │top_k=5   │   │strength   │   │importance │
  └──────────┘   └──────────┘   └──────────┘   └──────────┘   │衰减       │
                                                              └──────────┘
  ════════════════════════════════════════════════════════════════════════════
  详细时间线
  ════════════════════════════════════════════════════════════════════════════

  t=0  用户消息到达
  │    ├─ ChatEngine.generate_and_store() 入口
  │    │
  │    ├─ [EXTRACT] FactExtractor
  │    │   └─ LLM 调用 → (subject, relation, object) 三元组
  │    │   └─ 实体归一化: "GPT" / "ChatGPT" → "GPT"
  │    │   └─ 冲突检测: 同一 subject+relation 已有不同 object → 标记 conflict
  │    │
  │    ├─ [STORE] MemoryStore
  │    │   ├─ episode: INSERT INTO episodes (session_id, role, content,
  │    │   │           embedding, tier, strength=1.0, importance=1.0)
  │    │   ├─ facts:   INSERT INTO facts (episode_id, subject, relation,
  │    │   │           object, confidence, source_quote, ...)
  │    │   └─ index:   FAISS.add(embedding, external_id=episode_id)
  │    │
  ├──── 同一会话后续消息继续累积 ────┤
  │
  t=会话结束 (session boundary detected)
  │    │
  │    ├─ [CONSOLIDATE] ConsolidationCore.consolidate_if_stale()
  │    │   ├─ 扫描距上次召回超过 grace_period(24h) 的 episode
  │    │   ├─ importance *= (1 - cooldown_rate): 慢降温
  │    │   ├─ 下限保护: importance ≥ cooldown_min_importance(0.1)
  │    │   └─ 持久化 last_consolidated_at
  │    │
  ├──── 下一次聊天请求 ────┤
  │
  │    ├─ [RECALL] RecallEngine.recall()
  │    │   ├─ 1. embed(user_message) → query vector
  │    │   ├─ 2. FAISS.search(query, k=20) → 候选 episode IDs
  │    │   ├─ 3. SQLite: SELECT episodes + JOIN facts
  │    │   ├─ 4. deduplicate_candidates(): FAISS ID + content 双键去重
  │    │   ├─ 5. mmr_rerank(): 相关度 × 多样度 λ 权衡 → top_k
  │    │   │   └─ 偏好向量注入: 用户兴趣方向偏置
  │    │   ├─ 6. 艾宾浩斯 strength → composite score 整合
  │    │   │   └─ strength = e^(-λ × Δt) × recall_boost
  │    │   │   └─ recall_boost = 1.0 + recall_count × 0.05 (用进效应)
  │    │   └─ 7. apply_truncation(): composite score 阈值截断
  │    │       └─ 返回前 5 条最强记忆 + 截断分隔线可视化
  │    │
  │    ├─ [STRENGTHEN] 命中记忆自动强化
  │    │   ├─ SQLite: UPDATE episodes SET strength = new_strength
  │    │   ├─ SQLite: recall_count += 1, last_recalled_at = now
  │    │   └─ 用进效应: 频繁召回的 episode 衰减更慢
  │    │
  │    ├─ [REFLECTION] 反思引擎 (周期性触发)
  │    │   ├─ planner/reflection.py: 检测 plan 完成度
  │    │   ├─ planner/replan.py: 偏离检测 → 重规划建议
  │    │   └─ plan_history: 最近 N 次计划检索用于模式匹配
  │    │
  ├──── 日终 (24h 周期) ────┤
  │
  │    ├─ [FORGET] ForgettingEngine
  │    │   ├─ decay_all(lambda): 全量 episode strength × e^(-λ × Δt)
  │    │   │   └─ λ 可调 (默认 0.01, 通过 Settings.forgetting_lambda)
  │    │   ├─ forget_session(session_id): 主动遗忘整个会话
  │    │   │   └─ episodes 归档 + FAISS 索引联动清理
  │    │   └─ 遗忘豁免: tier="core" 或 importance > 0.8 的记忆衰减减半
  │    │
  │    └─ [CONSOLIDATE] 日终固化 (tier 重分级)
  │        ├─ TierClassifier: 基于 importance → 分入 hot/warm/cold/core 四层
  │        │   └─ hot: 最近 7 天 · warm: 7-30 天 · cold: 30+ 天 · core: 豁免
  │        └─ 存储策略差异: hot→全字段, cold→仅摘要, core→永久保留
  │
  ▼  时间 →
```

> **四阶段闭环**：创造（提取+双写）→ 检索（FAISS+MMR+评分）→ 强化（用进效应+反射）→ 遗忘（衰减+固化+tier 分级）。每一阶段均有可观测面板：MemoryBrowserPanel / DecayDistributionPanel / RecallRacePanel。

> **编号说明**：Phase 28+（2026-06-22+）条目使用 `Phase N Batch M` 标准两层编号。Phase 1-22 条目（2026-06-15~06-22，日期标注）因编写时编号标准尚未建立，表内保留原始 Batch 编号作为历史记录，与 git log 交叉索引一致。旧编号→新编号映射可查 `docs/archive/roadmap-phase-1-18.md`。

| 组件 | 状态 | 日期 | 说明 |
|------|------|----------|------|
| 项目骨架 | ✅ 完成 | 2026-06-20 | CLAUDE.md / pyproject.toml / Makefile (web + web-debug + api) / docs/ |
| FastAPI REST API | ✅ M1 完成 | 2026-06-22 | `api/main.py`（FastAPI + CORS + 3 层异常处理）+ `api/routers/`（8 路由）+ `api/schemas.py`（Pydantic v2，30+ 模型）— Phase 28 Batch 122-124 |
| Next.js 前端 | ✅ M2 + M3 完成 | 2026-06-23 | `frontend/` Next.js 16 App Router + Tailwind v4。M2: 聊天页 MVP + 洋葱交互 + 文档页 + ProcessDrawer。M3: Observability 3 Tab + API 契约层。M3.5: 6 批复补齐 Sidebar 六层参数面板 + Profile 卡片 + 四支柱全景 + 品牌恢复。— Phase 28 Batch 125-162 全部完成 ✅ |
| Lab 实验台页面 | ✅ 完成 | 2026-06-24 | `frontend/src/app/lab/` + `components/lab/` — 5 Tab 实验台。上下文 Tab (B169): OverflowSimPanel + StrategyComparePanel + IntentTestPanel。管线 Tab (B170): TokenDashboardPanel + StepLatencyPanel + PipelineTracePanel。数据 Tab (B171): MemoryBrowserPanel + EmbeddingSpacePanel + CacheStatsPanel。图谱 Tab (B172): KnowledgeGraphPanel + DecayDistributionPanel + Health/Log 复用。实验 Tab (B179): ExperimentComparePanel + CostWaterfallPanel。全部 11 面板 + 1 新 API 端点。 |
| Profile 标签溯源 | ✅ Phase 30 B1-B4 完成 | 2026-06-24 | TagDetailDrawer 右侧滑入抽屉 + `GET /memory/tag-detail` (JOIN facts+episodes+confidence_log 三表联查) + `POST /facts/{id}/confidence` (纠正+加星) + `MemoryStore.get_tag_detail()` / `get_fact_confidence_history_batch()` — Batch Phase30 B1-B4 |
| 新人上车路径 | ✅ 完成 | 2026-06-15 | requirements.in + lock / make setup + clean |
| 核心记忆引擎 | ✅ 完成 | 2026-06-15 | Store / usearch / Embed / Recall / Forgetting |
| CLI 聊天界面 | ✅ 完成 | 2026-06-15 | rich 终端面板 + 召回/记忆可视化 |
| 集成测试 | ✅ 完成 | 2026-06-22 | 12 tests — memory 全链路 + 多轮遗忘 + 索引持久化 + recall top_k + overflow 模拟 + 冲突检测 + 事实抽取 + 压缩 + 记忆增强 + 错误恢复 + 策略对比 — Batch 76-87, 138 |
| 测试体系（Python） | ✅ 完成 | 2026-06-30 | Python: 999 tests / 34 文件。test_web.py 5001→7 域文件（Phase 28 Batch 130）。fact.py 纯函数测试 +32（Phase 28 Batch 131），CLI 命令测试 +20（Phase 28 Batch 132），二次加固 +92（Phase 28 Batch 133-137），集成测试 5→12（Phase 28 Batch 138），E2E Playwright +6（Phase 28 Batch 139） |
| AI 对话引擎 | ✅ 完成 | 2026-06-15 | ChatEngine (DeepSeek API) — Batch 6 |
| 组件 — 数据常量拆分 | ✅ 完成 | 2026-06-21 | `_data.py`（19 术语字典）/ `_icons.py`（42 emoji→图标映射）— Phase 23 Batch 91 |
| 组件 — 聊天域拆分 | ✅ 完成 | 2026-06-21 | `_trace_engine.py`（7 种块渲染）/ `_recall_narrative.py`（召回叙事）/ `_inference_panels.py`（推理面板）— Phase 23 Batch 92 |
| 组件 — 页面入口点 | ✅ 完成 | 2026-06-21 | `lab.py` / `profile.py` → `render_lab_page()` / `render_profile_page()` — Phase 23 Batch 93 |
| 组件 — 侧边栏独立 | ✅ 完成 | 2026-06-21 | `sidebar.py`（Profile 卡片 + 参数面板 + 重置流程）— Phase 23 Batch 94 |
| CSS 设计令牌 | ✅ 完成 | 2026-06-20 | `inject_global_css()` — 60+ 个 --gm-* custom properties + 全局组件覆写 (v2 Batch 36 扩至 60+，Batch 85 补 `--gm-text-base` 定义 + px→token 迁移) — Batch 32 |
| CSS Token 补齐 (CROSS-7/8) | ✅ 完成 | 2026-06-24 | `globals.css` — 15 token (6 未定义 + 9 语义) + 3 @theme inline 映射 — Phase 31 Batch 1 |
| ErrorDisplay 统一报错组件 | ✅ 完成 | 2026-06-24 | `frontend/src/components/ui/ErrorDisplay.tsx` — 三 variant (card/inline/fullscreen) + categorizeError 分类 — Phase 31 Batch 1 |
| categorizeError 错误分类工具 | ✅ 完成 | 2026-06-24 | `frontend/src/lib/errorCategories.ts` — 5 分类 (network/server/llm/render/unknown) 全中文 + `CategorizedError` 接口导出 — Phase 31 Batch 1 |
| TabBar 统一 Tab 导航栏 | ✅ 完成 | 2026-07-08 | `frontend/src/components/ui/TabBar.tsx` — controlled component + brand/info activeColor + sm/xs size + icon 支持 + ARIA tablist/tab/aria-selected/aria-controls/tabPanelIdPrefix — Phase 31 Batch 11 + Phase 66 B110/B111 |
| UI 组件打磨 | ✅ 完成 | 2026-06-17 | 侧边栏卡片化 + 强度条渐变 + Token 条/Accent 色迁移 — Batch 33 |
| Fact 层 | ✅ 完成 | 2026-06-15 | FactExtractor + Store Fact 方法 + Recall 集成 — Batch 8 |
| Recall Log | ✅ 完成 | 2026-06-15 | recall_log 表 + 日志记录 — Batch 9 |
| 艾宾浩斯时间轴 | ✅ 完成 | 2026-06-15 | Plotly 衰减曲线 + recall 跳跃标记 — Batch 9。Next.js 前端：Ebbinghaus 曲线已迁移至 ParamSliders 的 ForgettingCurveSVG 内联 SVG 渲染 |
| 记忆浏览器 | ✅ 完成 | 2026-06-15 | 搜索 + 展开详情 + 单条衰减曲线 — Batch 9 |
| Pipeline Chain 可视化 | ✅ 完成 | 2026-06-15 | 存储/召回链路 v2：8 种 block 类型 + 并行拓扑 + fork-join — Batch 10 |
| Settings 配置模块 | ✅ 完成 | 2026-06-15 | `src/config.py` — frozen dataclass，30+ 参数集中管理，A/B 实验就绪 — Batch 11 |
| Settings 嵌套化重构 | ✅ B77-B81 完成 | 2026-07-04 | 16 域 100% 嵌套化 — 20 frozen dataclass（Paths/Embed/LLM/Pricing/Recall/Dedup/Context/Memory/Forgetting/FactExtraction/Planner/PlanHistory/Tier/Consolidation/Router/LocalRouter/ResponseCache/Budget/SessionBoundary/Observability）· 38 flat fields → 16 groups · 51 backward-compat property · 1328 tests 零回归 |
| 事实三元组抽取 | ✅ 完成 | 2026-06-15 | `src/memory/triple.py` + FactExtractor 升级 — 结构化 (s,r,o) 抽取 + 实体归一化 + 冲突检测 + 信息丢失自检 — Batch 12A |
| Token 全链路计量 | ✅ 完成 | 2026-06-15 | `src/token_ledger.py` — ChatEngine + FactExtractor 双插桩 + Web UI 归因面板 — Batch 12B |
| A/B 实验框架 | ✅ 完成 | 2026-06-15 | `src/experiment.py` — ExperimentRunner + 6 维对比 — Batch 13 |
| 消息旅程主视图 | ✅ 完成 | 2026-06-16 | `render_message_journey()` — 四阶段卡片（遗忘/召回/回复/存储），自然语言摘要 + 可展开技术细节 — Batch 14 |
| 当前会话层 | ✅ 完成 | 2026-06-16 | L1: `render_session_stats` + `render_session_memory_summary` + recall origin tags — 短期/长期记忆边界可视化 — Batch 15 |
| 记忆召回叙事 | ✅ 完成 | 2026-06-16 | L2: `render_recall_narrative` + top_k/recall_threshold 动态滑块 — "在哪层揭开就在哪层控制"首例 — Batch 16 |
| 上下文窗口层 | ✅ 完成 | 2026-06-16 | L3: `render_context_window` — token 填充条 + 3 种溢出策略 (truncate/prioritize/summarize) + ChatEngine 窗口管理升级 — Batch 17 |
| 系统提示词层 | ✅ 完成 | 2026-06-16 | L4: `render_system_prompt` — 只读查看完整 system prompt（基础指令 + 召回记忆 + 事实），st.code 展示 — Batch 18 |
| 模型与推理层 | ✅ 完成 | 2026-06-16 | L5: `render_model_inference` — model 下拉 + temperature/max_tokens 滑块 + ChatEngine 参数透传 + Settings.llm_temperature/available_models 新增 — Batch 19 |
| 遗忘曲线交互层 | ✅ 完成 | 2026-06-16 | L6: `render_forgetting_curve` — λ 滑块 + 实时 Ebbinghaus 预览曲线 + decay_all lambda_override + 衰减 delta 追踪 — Batch 20 |
| 知识提取层 | ✅ 完成 | 2026-06-16 | L7: `render_knowledge_graph()` — 三元组主体分组 + 冲突检测 — Batch 21 |
| 向量空间层 | ✅ 完成 | 2026-06-16 | L8: PCA 2D/3D 散点图 + numpy SVD 零依赖 — Batch 22 |
| 成本会计层 | ✅ 完成 | 2026-06-16 | L9: `render_cost_waterfall()` — Plotly 瀑布图 + DeepSeek 定价换算 — Batch 23 |
| 数据主权面板 | ✅ 完成 | 2026-06-16 | L10: `render_data_sovereignty()` — 存储位置/文件大小/所有权声明（只读） — Batch 24。Next.js 前端：数据主权信息已嵌入 SessionHarvest 组件（db_size_bytes/has_index/profile counts） |
| 多用户 Profile 隔离 | ✅ 完成 | 2026-06-16 | Profile 选择器 + 数据目录分离 + Settings profile 感知 — Batch 25 |
| 记忆手动管理 | ✅ 完成 | 2026-06-16 | delete_episode / update_episode_content / delete_fact + CLI 命令 + Web UI 控件 — Batch 26 |
| UI 信息架构重设计 | ✅ 完成 | 2026-06-17 | 三页导航+ 侧边栏精简（32→15 元素）+ 共享 init + 死代码清理 — Batch 29-30 |
| UI 视觉现代化 v1 | ✅ 完成 | 2026-06-17 | indigo 主题 + Inter 字体 + 16 CSS 令牌 + 侧边栏卡片化 + 强度条渐变 — Batch 31-33 |
| 设计系统 v2 + 暗色模式 | ✅ 完成 | 2026-06-17 | 60+ 令牌 + data-theme + localStorage 持久化 + 玻璃态卡片 + 10 组动画 keyframes — Batch 34-39 |
| 暗色模式全组件审计 | ✅ 完成 | 2026-06-17 | 20 项 P0-P2 覆盖（widget/Plotly/expander/button）+ L5 拉通 — Batch 40A-40D |
| 图标字体化 + 公共 Header/Footer | ✅ 完成 | 2026-06-18 | Remix Icon v4.6.0 CDN + _ICON_MAP 映射 + toolbar 隐藏 + render_app_header/footer — Batch 41A-41B |
| Header/Sidebar/Layout 精细化 | ✅ 完成 | 2026-06-18 | fixed header + scroll 双高度切换 + 侧边栏 JS 强制显隐 + 自定义展开按钮 + 浮动回聊天按钮 — Batch 42-43② |
| 图标体系统一 | ✅ 完成 | 2026-06-18 | _ICON_MAP 3 处映射修正 + 3 死映射清理 — Batch 44-45 |
| UI 深度优化 | ✅ 完成 | 2026-06-18 | 画像页 Hero/知识云 + 线条瘦身 + 透明度层次 + 操作语义颜色 + 警告按钮 JS 注入 — Batch 46-53 |
| 记忆实验室交互优化 | ✅ 完成 | 2026-06-18 | avg_strength 修正 + 交互控件 + fact↔episode 信息联动 + 记忆浏览器统一搜索 — Batch 54-56 |
| 图表与 Tab 视觉升级 | ✅ 完成 | 2026-06-18 | Tab 纯文字 pill 容器 + 时间轴 480px/nticks=6 + KDE 品牌色直方图 + expander 默认展开 — Batch 57 |
| 结构化日志 | ✅ 完成 | 2026-06-18 | `src/logging.py` — JSON Lines + RotatingFileHandler + 上下文注入 — Batch 58 |
| 健康检查 | ✅ 完成 | 2026-06-18 | `src/health.py` — database/FAISS/LLM/disk/embedding 五项 + 启动自动运行 — Batch 58 |
| 管道 Instrumentation | ✅ 完成 | 2026-06-18 | `trace_step` 装饰器 + `StepRecord` + `pipeline_trace` 表 + app.py 计时插桩 — Batch 59A+59B |
| Token 缓存层 | ✅ 完成 | 2026-06-19 | `src/cache.py` — EmbeddingCache (FIFO, max 1000) + FactCache (SHA256 key, max 64)，embed.py 集成 + FactExtractor 集成 — Batch 67 |
| 可观测性页面 | ✅ 完成 | 2026-06-19 | `src/web/pages/observability.py` → 已迁移至 Next.js frontend（HealthDashboard/LogViewer/JourneyHistoryBrowser）— 健康仪表盘 + 日志查看器 + Trace 历史浏览器，UI 美化 (Batch 62) + HTML 片段函数化 + BeautifulSoup 结构测试 (Batch 63) — Batch 60-63 |
| 健康仪表盘体验统一 | ✅ 完成 | 2026-06-19 | 卡片等高 + 检查时间 + 延迟着色 + detail tooltip + 刷新按钮 CSS pill + accent bar + hover — Batch 61A + 62 |
| 日志查看器交互升级 | ✅ 完成 | 2026-06-19 | 分页翻页 + 关键词清除 + 文件元信息 + 消息可展开 + segmented_control + bordered container + 每页条数 — Batch 61B + 62 |
| Trace 浏览器体验修复 | ✅ 完成 | 2026-06-19 | 指标口径统一 + 状态筛选 + 耗时排序 + 摘要指标容器分组 + 回归修复 — Batch 61C + 62 |
| Recall 截断 | ✅ 完成 | 2026-06-20 | `apply_truncation()` — composite score 阈值截断 + 截断分隔线可视化 + 可配置 slider — Batch 69A |
| 消息压缩 | ✅ 完成 | 2026-06-20 | `ChatEngine.compress_message()` — LLM 单句摘要 + 📦 badge + 上下文标记 + 可配置阈值 — Batch 69B |
| 上下文分区可视化 | ✅ 完成 | 2026-06-20 | `compute_partitions()` — 四色分区条 + 点击展开详情 + 暗色适配 — Batch 68 |
| Token 节省拆分 | ✅ 完成 | 2026-06-20 | 瀑布图"优化节省"合并缓存+压缩两项 + 压缩日志 tab + 分区条虚线标注优化前占比 — Batch 69C |
| Planner 意图分类 | ✅ 完成 | 2026-06-20 | `src/planner.py` → 已重构为 `src/planner/` 包（Phase 37 Batch 1）— IntentResult + PlannerEngine (LLM 五类意图分类) + TokenLedger 注入 — Batch 70 |
| 消息旅程 V2 | ✅ 完成 | 2026-06-20 | 六镜头卡片 3×2 网格（理解/召回/组装/花费/回复/记忆）+ CSS pulse animation + 意图 pill — Batch 70 |
| 意图历史面板 | ✅ 完成 | 2026-06-20 | 画像页 Plotly 饼图 + 最近 10 条意图 + store.get_traces_by_step() — Batch 70 |
| 项目地图 | ✅ 完成 | 2026-06-20 | 右滑入 Drawer — 项目介绍 / 六镜头旅程 / 页面导航 / 概念速查 15 术语 + 全屏模式 + TOC + `?` 键快捷键 — Batch 66 |
| Embedding/Fact 缓存 | ✅ 完成 | 2026-06-20 | `src/cache.py` — EmbeddingCache (FIFO 1000) + FactCache (SHA256 64) — Batch 67 |
| 上下文分区 | ✅ 完成 | 2026-06-20 | `src/context/partition.py` — 四区 token 统计 + 彩色分段条 + 点击展开详情 — Batch 68 |
| Recall 截断 + 消息压缩 | ✅ 完成 | 2026-06-20 | composite score 阈值截断 + LLM 单句摘要压缩 + 分区条虚线标注 — Batch 69A-69C |
| 六镜头旅程 V2 + Planner | ✅ 完成 | 2026-06-20 | 3×2 网格卡片 + 意图分类 (5 类) + TokenLedger 集成 — Batch 70 |
| 异常处理加固 | ✅ 完成 | 2026-06-20 | 13 处 `except Exception` 收窄 — Batch 71 (M4 已去 Streamlit) |
| L4 运行时治理 | ✅ 完成 | 2026-06-20 | 37 session_state key 显式初始化 + 读写路径审计 + switch_profile 清理覆盖 — Batch 72 |
| Components 拆分 | ✅ 完成 | 2026-06-20 | 5274 行单文件 → 7 模块 package：`_tokens` / `shared` / `chat` / `profile` / `analytics` / `chrome` / `memory_viz` — Batch 73-76 |
| CSS 孤儿清理 | ✅ 完成 | 2026-06-20 | 删除 7 个死选择器 + observability 内联 CSS 迁移至 `_tokens.py` (20A) + 3 孤儿类 + 4 死 @keyframes + 5 假类名补定义 + 4 px→token (Batch 85) — Batch 20A / 85 |
| 配置外化 | ✅ 完成 | 2026-06-20 | `config.py` 4 模块常量 (DB/INDEX/LOG 文件名 + CDN URL) + 17 处硬编码替换 — Phase 20B |
| 溢出模拟引擎 | ✅ 完成 | 2026-06-20 | `src/context/overflow_sim.py` — `OverflowSimResult` + `simulate_overflow()` + `compare_strategies()` + 策略人格 (守门员/策展人/口述史家) — Batch 79 |
| 会话边界检测 + 回归摘要 | ✅ 完成 | 2026-06-30 | `src/context/session_boundary.py` — `SessionBoundaryResult` + `SessionBoundaryDetector`（三级回退 + 非终态 intent 检测 + ?/? 启发式）+ `RegressionSummary` + `generate_regression_summary()` + `track_open_items()` — `session_summaries` 表 — Phase 59 Batch 1+2 |
| 营养标签 + 策略人格 UI | ✅ 完成 | 2026-06-20 | `_NUTRITION_LABEL_CSS` + `render_nutrition_label()` + `render_strategy_persona()` + `render_overflow_badge()` + `render_raw_prompt_view()` — Batch 79 |
| 溢出沙箱 Tab | ✅ 完成 | 2026-06-20 | `src/web/pages/lab.py` → 已迁移至 Next.js frontend（OverflowSandboxPanel）— 双列策略对比 + Delta 差异卡 + 上下文时间线 + Ghost Mode 合成 prompt 预览 — Batch 80 |
| 合成 Prompt 构建器 | ✅ 完成 | 2026-06-20 | `build_synthetic_system_prompt()` in `chat.py` — 从 OverflowSimResult 重建 system prompt 文本 — Batch 80 |
| 上下文引擎统一 | ✅ 完成 | 2026-06-20 | `ChatEngine._build_system_prompt()` 调用 `simulate_overflow()` 作为单一真相源，消除 ~130 行重复。`last_overflow` property 暴露 `OverflowSimResult` — Batch 81 |
| 溢出叙事卡片 | ✅ 完成 | 2026-06-20 | 旅程 Card 3 "组装" 接入策略人格 + Token 预算 + 记忆留存三步溢出叙事 — Batch 81 |
| 上下文健康 Badge | ✅ 完成 | 2026-06-20 | `render_context_health_badge()` 三态显示（充裕/接近上限/溢出）— Batch 81 |
| 溢出预检 | ✅ 完成 | 2026-06-20 | LLM 调用后溢出触发告警横幅 + 调整建议 — Batch 81 |
| 地图联动 | ✅ 完成 | 2026-06-20 | glossary 锚点 + `openMapToGlossary()` JS + 旅程卡片 "了解更多" 链接 — Batch 81 |
| 语义去重 | ✅ 完成 | 2026-06-20 | `deduplicate_candidates()` — FAISS ID + content 双键去重 + `DedupResult` dataclass — Batch 82 |
| MMR 召回重排 | ✅ 完成 | 2026-06-20 | `mmr_rerank()` — 相关度×多样度 λ 权衡 + 偏好向量注入 + `reconstruct()` — Batch 82 |
| 遗憾分析 | ✅ 完成 | 2026-06-20 | `analyze_regret()` — `RegretAnalysis` dataclass + 三栏 Web 面板 (被置换/低分/冗余) — Batch 82 |
| 四支柱全景卡片 | ✅ 完成 | 2026-06-20 | `render_four_pillar_panorama()` — 记忆设计/上下文工程/Token效率/任务规划 始终可见摘要条 — Batch 83 |
| 旅程历史浏览器 | ✅ 完成 | 2026-06-20 | `render_journey_history()` expando 反向排列迷你卡片 + `_take_journey_snapshot()` 管线末端快照 — Batch 83 |
| 行内术语 Tooltip | ✅ 完成 | 2026-06-20 | `render_glossary_tooltip()` + `_GLOSSARY_DATA` 19 条术语 + CSS-only `::after` hover 弹出定义 — Batch 83 |
| 知识桥 CSS | ✅ 完成 | 2026-06-20 | `_KNOWLEDGE_BRIDGE_CSS` — `.gm-glossary-tooltip` / `.gm-mini-journey`（`.gm-adr-badge` 已在 Batch 85 作为孤儿类移除）— Batch 83 |
| 地图 ADR 段 | ✅ 完成 | 2026-06-20 | 16 glossary anchor ID + Section 5 架构决策 (ADR-001~011 一行摘要) + TOC 第 5 项 — Batch 83 |
| 主题切换状态同步 | ✅ 完成 | 2026-06-21 | Header/Sidebar 双入口统一走 `?theme=` URL param → session_state 桥接 + Ctrl+J 快捷键 + toggle label 动态 🌙/☀️ — Phase 27 Batch 111 |
| CSS 暗色覆盖盲区 | ✅ 完成 | 2026-06-21 | `stForm`/`stFormSubmitButton`/`data-baseweb input` dark-mode catch-all — Phase 27 Batch 111 |
| 聊天页间距治理 | ✅ 完成 | 2026-06-21 | chat_input min-height 88→64px, margin-bottom 36→16px; footer fixed→relative; welcome hero padding/margin 收紧 — Phase 27 Batch 111 |
| Hover CSS 迁移 | ✅ 完成 | 2026-06-20 | `.gm-journey-card:hover` CSS 替代 inline `onmouseover`/`onmouseout` JS — Batch 89 |
| XSS 防护 | ✅ 完成 | 2026-06-20 | `html.escape()` 覆盖 sidebar profile / section header 等旧代码路径 — Batch 89 |
| 溢出沙箱错误边界 | ✅ 完成 | 2026-06-20 | lab.py 溢出沙箱 `try/except` 防止畸形数据崩溃 — Batch 89 |
| 主题双模式门禁 | ✅ 重建 | 2026-06-24 | `tools/check_theme.py` — Playwright 5 路由 console.error 扫描 + `make check-theme` 门禁 + pre-commit 集成 — Phase 29 Batch 182（Batch 96 Streamlit 版已随 M4 切除） |
| 解释引擎骨架 | ✅ 完成 | 2026-06-21 | `_archive.py`（LLMCallArchive 不可变 dataclass）+ `_explain.py`（ExplainTooltip + ExplainPopover + CSS）+ `_data.py` 术语模型扩展 L1/L2/L3 三层 — Batch 99 |
| ProcessDrawer L3 深度抽屉 | ✅ 完成 | 2026-06-21 | `_process_drawer.py` — 首个端到端 L3 组件，展示 LLM 调用档案四段（Request/Response/Parse/Token），iframe JS 注入 + data-* JSON 属性桥接 + 与 map drawer 同架构 — Phase 26 Batch 100 |
| 意图分类透明化 | ✅ 完成 | 2026-06-21 | app.py 数据断层修复（`_intent_trace` → `LLMCallArchive` → `intent_archives`）+ intent pill 可点击触发 ProcessDrawer — Phase 26 Batch 100 |
| 错误教学化 | ✅ 完成 | 2026-06-21 | `_error_narrative.py` — 三段叙事格式（发生了什么/为什么/我能做什么），全站 7 个错误提示点升级 — Phase 26 Batch 104 |
| 冲突故事化 | ✅ 完成 | 2026-06-21 | `profile.py:_render_conflict_story()` — 冲突检测叙事卡片 + 选择性遗忘按钮（两步确认 + FAISS 联动清理） — Phase 26 Batch 106 |
| Mermaid 流程图 | ✅ 完成 | 2026-06-21 | `_flowchart.py` — Mermaid 11 CDN 渲染器 + 三个图定义（消息旅程/召回管线/意图分类），`st.components.v1.html` srcdoc iframe，亮/暗双模式自适应 — Phase 26 Batch 107 |
| 语义搜索 | ✅ 完成 | 2026-06-21 | `_memory_search.py` — 自然语言语义搜索，复用 RecallEngine.recall() 完整链路（embed→FAISS→去重→评分→MMR），strengthen=False 避免搜索污染记忆强度 — Phase 26 Batch 107 |
| 知识图谱 | ✅ 完成 | 2026-06-21 | `_kg_viz.py` — vis.js 力导向图，从三元组构建实体-关系网络，16 种关系颜色映射，srcdoc iframe 渲染，亮/暗双模式自适应 — Phase 26 Batch 108 |
| 记忆里程碑 | ✅ 完成 | 2026-06-21 | `_milestones.py` — 累积事实折线图 + 关键事件卡片，纯 Python 计算（零新 SQL），Plotly 图表，首次/Nth/峰值/最高置信度里程碑 — Phase 26 Batch 108 |
| 欢迎卡片组件 | ✅ 完成 | 2026-06-21 | `_welcome.py` — hero banner + 功能卡片 + 快速引导 + 好奇心按钮，提取自 app.py（Rule 7 行数治理），通过 on_chat_input 回调解耦 — Phase 26 Batch 109 |
| 令牌反向依赖修复 | ✅ 完成 | 2026-06-21 | `_EXPLAIN_CSS` + `_PROCESS_DRAWER_CSS` 从 `_explain.py`/`_process_drawer.py` 迁入 `_tokens_features.py`，消除 `_tokens.py` 对组件模块的反向依赖 — Phase 26 Batch 109
| 前端 — OnionPanel 洋葱交互 | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/OnionPanel.tsx` — 四段纵向堆叠：L1 意图识别 + L2 记忆召回 + L3 上下文窗口（含 ContextBar/NutritionLabel/StrategyPersona/ContextWindowPanel/GhostPromptView/ContextHealthBadge）+ L4/L5 ModelInferencePanel（模型 + 参数 + Token + 成本），CSS 展开动画，零新依赖 — Phase 28 Batch 128/174/175 |
| 前端 — ContextBar 分区条 | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/ContextBar.tsx` — 增强版：溢出虚线切断 + 压缩节省气泡 + tools 段透传 + hover tooltip — Phase 29 Batch 174 |
| 前端 — ContextWindowPanel | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/ContextWindowPanel.tsx` — 折叠式 token 分区明细表 + 压缩/溢出信息区块 — Phase 29 Batch 174 |
| 前端 — NutritionLabel | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/NutritionLabel.tsx` — FDA 营养标签风格上下文指标卡片 — Phase 29 Batch 174 |
| 前端 — GhostPromptView | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/GhostPromptView.tsx` — system prompt 源码折叠视图 + 复制 — Phase 29 Batch 174 |
| 前端 — StrategyPersona | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/StrategyPersona.tsx` — 溢出策略人格卡片（三策略高亮当前） — Phase 29 Batch 174 |
| 前端 — ContextHealthBadge | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/ContextHealthBadge.tsx` — 上下文健康指示灯（绿/黄/红 + tooltip） — Phase 29 Batch 174 |
| 前端 — ModelInferencePanel | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/ModelInferencePanel.tsx` — L5 模型推理面板：模型 badge + Token 三卡片（prompt/completion/total）+ 成本估算 + 折叠式参数详情（temperature/max_tokens/caller）+ raw_response/parsed_result 代码块 — Phase 29 Batch 175 |
| 前端 — JourneyHistoryBrowser | ✅ 完成 | 2026-06-24 | `frontend/src/components/chat/JourneyHistoryBrowser.tsx` — 对话历史浏览器：自管理 fetch（GET /memory/episodes）+ 客户端搜索过滤 + 可展开元数据行 + 四态（loading/error/empty/success）— Phase 29 Batch 175 |
| 前端 — MermaidDiagram 流程图 | ✅ 完成 | 2026-06-24 | `frontend/src/components/ui/MermaidDiagram.tsx` — mermaid.js npm 懒加载渲染组件（next/dynamic, ssr: false），暗色主题自适应（MutationObserver），三态（loading/success/error + raw chart debug），零外部 CDN 依赖 — Phase 29 Batch 178 |
| 前端 — flowcharts 数据层 | ✅ 完成 | 2026-06-24 | `frontend/src/lib/flowcharts.ts` — 3 张 Mermaid 图定义（记忆管线/上下文分区/遗忘曲线）+ FlowchartDef 类型 + getFlowchart/getFlowchartsGrouped 查询函数 — Phase 29 Batch 178 |
| 前端 — ProjectMapDrawer 流程图集成 | ✅ 完成 | 2026-06-24 | `frontend/src/components/layout/ProjectMapDrawer.tsx` — 第 5 段"流程图"（accordion 模式，3 分类：记忆管线/上下文工程/记忆科学），懒加载 MermaidDiagram，对标概念速查交互 — Phase 29 Batch 178 |
| 前端 — CostWaterfallPanel 成本瀑布 | ✅ 完成 | 2026-06-24 | `frontend/src/components/lab/CostWaterfallPanel.tsx` — Lab 页 Token 消耗瀑布面板：LLM 调用总额 → 缓存节省 → 压缩节省 → 净消耗逐步拆解，纯 CSS 横向瀑布条渲染，FetchState 四态管理 + 底部摘要 — Phase 29 Batch 179 |
| 前端 — ExperimentComparePanel A/B 实验 | ✅ 完成 | 2026-06-24 | `frontend/src/components/lab/ExperimentComparePanel.tsx` — Lab 页 A/B 实验对比面板：4 预设卡片选择器 + 输入文本区 + 实验运行 + 双列结果卡片（召回/Token/事实/回复）+ 维度差异表（7 维度，A 更优/B 更优/中立方向指示）— Phase 29 Batch 179 |
| API — Lab: 成本瀑布端点 | ✅ 完成 | 2026-06-24 | `api/routers/lab.py` `GET /lab/cost-waterfall` — TokenLedger.summary() → 瀑布步骤重组，`CostWaterfallStep` + `CostWaterfallResponse` Pydantic 模型，零副作用只读端点 — Phase 29 Batch 179 |
| 前端 — Profile 画像页面 | ✅ 完成 | 2026-06-24 | `frontend/src/app/profile/page.tsx` + `components/profile/ProfileShell.tsx` — 用户画像页：ProfileCard 复用 + 标签详情抽屉 + TagDetailDrawer 溯源面板（事实/对话/置信度变更日志）+ 事实纠正/加星操作按钮 + `GET /memory/tag-detail` API 端点 — Phase 29 Batch 173 + Phase 30 B1-B4 |
| 前端 — ExplainTooltip/ExplainPopover | ✅ 完成 | 2026-06-24 | `frontend/src/components/ui/ExplainTooltip.tsx`（纯 CSS hover tooltip，零依赖）+ `frontend/src/components/ui/ExplainPopover.tsx`（Portal 居中弹窗，createPortal）+ `frontend/src/lib/glossary.ts`（15 词条术语注册表 + lookup functions）— Phase 29 Batch 177 |
| 前端 — ProjectMapDrawer 项目地图 | ✅ 完成 | 2026-06-24 | `frontend/src/components/layout/ProjectMapDrawer.tsx` — Props-driven 右侧滑入抽屉（5 段：项目介绍/消息旅程/流程图/页面导航/概念速查），Header 地图按钮触发，流程图段懒加载 MermaidDiagram — Phase 29 Batch 177-178 |
| 前端 — 文档页组件 | ✅ 完成 | 2026-06-22 | `frontend/src/components/learn/AnswerCard.tsx`（L0-L3 渐进披露）+ `QuestionList.tsx`（章标签页 + 优先级圆点）+ `ConfidenceBadge.tsx` + `frontend/src/lib/content/`（8 章 93 问数据层 + 类型定义 + 访问函数）— Phase 28 Batch 129 |
| 前端 — ContextualLens 组件 | ✅ 完成 | 2026-06-26 | `frontend/src/components/chat/ContextualLens.tsx` — 可复用展开/收起组件（trigger button → expanded card），聊天页上下文感知微型教学入口。3 处集成：ChatMessage token 透镜 (q4.1)、ErrorDisplay 错误透镜 (q7.6)、OnionPanel 溢出透镜 (q1.1)。标题可点击收起。IntenPill onClick 打开深度抽屉 — Phase 35 Batch 1-3 |
| 前端 — extractMermaid 工具 | ✅ 完成 | 2026-06-26 | `frontend/src/lib/content/extractMermaid.ts` — 从 Answer/Markdown 提取 mermaid 代码块，复用 AnswerCard 正则 — Phase 35 Batch 1 |
| 前端 — 测试体系 | ✅ 完成 | 2026-06-24 | 前端 594 tests / 52 文件：useChat hook + OnionPanel + 93 问 + ContextBar/ThemeToggle/LearnPage + API client + HealthDashboard + LogViewer + FourPillar + ParamSliders + Sidebar + ProfileCard + ModelInferencePanel + JourneyHistoryBrowser + LabShell + Lab 5 Tab 全面板 + ExplainTooltip/ExplainPopover + ProjectMapDrawer + MermaidDiagram + ExperimentComparePanel + CostWaterfallPanel |
| 前端 — Observability 页 | ✅ 完成 | 2026-07-08 | `frontend/src/components/observability/` — ObserveShell + HealthDashboard + HealthCard + LogViewer + API 契约层 + ARIA role="tabpanel" + h1 sr-only 页面标题 — Phase 28 Batch 155-157 + Phase 66 B111 |
| 前端 — M3.5 聊天页补齐 | ✅ 完成 | 2026-06-23 | Phase 28 Batch 158-162: ✅ Header 副标题 + ✅ 好奇心引导 + ✅ 滚动收折 + ✅ 系统状态 (158) + ✅ 四支柱全景面板 (159) + ✅ Sidebar 认知参数上 (160) + ✅ Sidebar 认知参数下 L5+L6 (161) + ✅ Profile 动态卡片 (161b) + ✅ Sidebar 收尾 (162) |
| 前端 — Sidebar 认知参数 | ✅ 完成 | 2026-06-23 | `ParamSliders.tsx`（L2/L3/L5/L6 四折叠块 + SelectControl + SliderControl 基元 + ForgettingCurveSVG）+ `ChatParamsContext.tsx`（state + toChatParams 接线）+ `useChat.ts`（getter 模式参数传递）+ `Sidebar.tsx`（衰减触发 + 会话统计）+ `ProfileCard.tsx`（头像 + 标签云 + 三态）— Phase 28 Batch 160-161b |
| 前端 — Profile 卡片 | ✅ 完成 | 2026-06-23 | `ProfileCard.tsx` — 头像（首字母大写圆形 bg-brand）+ 标签云 pills（三档置信度颜色）+ `GET /memory/tag-summary` API 端点 + `api.getTagSummary()` + 三态管理（loading/error/success）— Phase 28 Batch 161b |
| 迁移遗漏审计 | ✅ 完成 | 2026-06-23 | Streamlit 29 组件 × Next.js 22 组件全量 diff，发现 39 项遗漏，4 项 P0 立即补，35 项分 M3.5/Phase 29 两期消化。详见 roadmap Phase 28 M3.5 登记表 |
| Layout — AppShell | ✅ 完成 | 2026-06-25 | `frontend/src/components/layout/AppShell.tsx` — CSS Grid 根布局（header+sidebar+main+footer），DrawerProvider + ChatParamsProvider 注入，ProcessDrawer + ProjectMapDrawer 全局抽屉 |
| Layout — Header | ✅ 完成 | 2026-06-25 | `frontend/src/components/layout/Header.tsx` — 固定顶栏：Logo + 5 导航链接（聊天/文档/可观测/实验室/画像）+ ThemeToggle + 项目地图按钮，scroll 收折效果 |
| Layout — Footer | ✅ 完成 | 2026-06-25 | `frontend/src/components/layout/Footer.tsx` — 全局底栏：品牌声明 + GitHub 链接 |
| Layout — Sidebar | ✅ 完成 | 2026-06-25 | `frontend/src/components/layout/Sidebar.tsx` — 侧边栏：会话统计 + 记忆衰减触发 + 重置流程 + ParamSliders（L2/L3/L5/L6） + ProfileCard |
| Layout — ProjectMapDrawer | ✅ 完成 | 2026-06-25 | `frontend/src/components/layout/ProjectMapDrawer.tsx` — 右滑入项目地图抽屉（5 段：项目介绍/消息旅程/流程图/页面导航/概念速查） |
| UI — Logo | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/Logo.tsx` — GlassCortex 品牌图标 + 文字 |
| UI — ThemeToggle | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/ThemeToggle.tsx` — 亮/暗主题切换按钮，localStorage 持久化 + beforeInteractive FOUC 防护 |
| UI — Drawer | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/Drawer.tsx` — 通用抽屉外壳：动画状态机（entering→open→exiting）+ backdrop + panel shell + body scroll lock |
| UI — CollapsibleSection | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/CollapsibleSection.tsx` — 统一折叠组件：3 variant（ghost/bordered/card）+ 受控/非受控 + A11（aria-expanded/aria-hidden） |
| UI — KVRow | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/KVRow.tsx` — Key-Value 行组件：左标签右值 + error 高亮 + className/data-testid |
| UI — DataState | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/DataState.tsx` — 三态统一包装（loading/empty/error），替代 16 处本地 FetchState |
| UI — CopyButton | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/CopyButton.tsx` — 复制到剪贴板按钮（2s "已复制"反馈） |
| UI — RefreshButton | ✅ 完成 | 2026-06-25 | `frontend/src/components/ui/RefreshButton.tsx` — 刷新按钮（ghost/bordered 双 variant） |
| Chat — ChatInput | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ChatInput.tsx` — 聊天输入框：Enter 发送 + Shift+Enter 换行 + 自动高度 + disabled 态 |
| Chat — ChatMessage | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ChatMessage.tsx` — 聊天消息气泡：用户/助手双角色 + Markdown 渲染 + 时间戳 |
| Chat — ChatPanel | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ChatPanel.tsx` — 聊天面板：消息列表 + ChatInput + 滚动到底 + 空状态欢迎卡片 |
| Chat — DrawerContext | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/DrawerContext.tsx` — 抽屉上下文：openDrawer(trace)/closeDrawer/isOpen + provider 外使用报错 |
| Chat — ProcessDrawer | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ProcessDrawer.tsx` — L3 深度抽屉：LLM 调用档案四段（Request/Response/Parse/Token）+ KVRow 数据展示 |
| Chat — SessionHarvest | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/SessionHarvest.tsx` — 会话收获摘要：消息数/记忆数/会话时长 + 数据主权信息（db_size_bytes/has_index） |
| Chat — IntentPill | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/IntentPill.tsx` — 意图分类胶囊：5 类意图（chat/question/command/analysis/other）颜色编码 |
| Chat — JourneyCards | ✅ 完成 | 2026-07-02 | `frontend/src/components/chat/JourneyCards.tsx` — 消息旅程六卡片 3×2 网格（理解/召回/组装/花费/回复/记忆）+ 点击展开视觉化详情面板（复用 FourPillar 的 MemoryVisualDetail/ContextVisualDetail/TokenVisualDetail/PlanningVisualDetail 导出）。Phase 66 重设计：彩色左边框替代渐变 accent bar · RiArrowDownSLine 展开指示器 · StatPill 升级 · 简约大气风格 |
| Chat — FourPillar | ✅ 完成 | 2026-07-02 | `frontend/src/components/chat/FourPillar.tsx` — 四支柱全景卡片（记忆设计/上下文工程/Token 效率/任务规划），导出 MemoryVisualDetail（Episode/Fact 软卡片）/ ContextVisualDetail（渐变进度条+StatPill）/ TokenVisualDetail（渐变堆叠柱图+StatPill）/ PlanningVisualDetail（SVG 置信度环），被 JourneyCards 复用。Phase 66 v2 完全重写：COLLAPSED 干净卡片 + EXPANDED 视觉化详情 + PillarFlowChart 四步流程
| Chat — ParamReplay | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ParamReplay.tsx` — 参数回放面板：展示当前会话的认知参数快照 |
| Chat — ChatParamsContext | ✅ 完成 | 2026-06-25 | `frontend/src/components/chat/ChatParamsContext.tsx` — 聊天参数上下文：L2/L3/L5/L6 状态管理 + toChatParams 导出 + resetToDefaults |
| Profile — ProfileModal | ✅ 完成 | 2026-06-25 | `frontend/src/components/profile/ProfileModal.tsx` — Profile 创建/切换模态窗：输入用户名 + Enter 提交 + Esc 关闭 |
| Profile — ProfileShell | ✅ 完成 | 2026-07-08 | `frontend/src/components/profile/ProfileShell.tsx` — Profile 画像页外壳：ProfileCard + 标签详情 + 事实列表 + TagCloud hover 增强 (hover:bg-surface-alt/30 + hover:rounded-gm-sm 微妙 pill 感) — Phase 66 B112 |
| Lab — LabShell | ✅ 完成 | 2026-07-08 | `frontend/src/components/lab/LabShell.tsx` — Lab 实验台外壳：5 Tab（上下文/管线/数据/图谱/实验）+ TabBar 导航 + ARIA role="tabpanel" 三向链接 — Phase 66 B111 |
| 编号体系统一 | ✅ 完成 | 2026-06-26 | 全 docs/ 171 处旧 Batch 编号格式 → `Phase N Batch M` 统一两层编号 + Backlog 任务码去冲突 (C→Q/R→X/A→S) |
| 内容可视化 — Phase 34 Batch 1 主题映射 | ✅ 完成 | 2026-06-26 | `MermaidDiagram.tsx` 一行映射 `"dark"`→`"neutral"` + 测试同步 |
| 内容可视化 — Phase 34 Batch 2 渲染管线 | ✅ 完成 | 2026-06-26 | `AnswerCard.tsx` renderMarkdown 支持 ` ```mermaid ` fenced code → base64 placeholder → useEffect 水合 |
| 内容可视化 — Phase 34 Batch 3 流程图试点 | ✅ 完成 | 2026-06-26 | q1.1 L1 嵌入策略决策图 + 3 张流程图嵌入管线端到端验证 |
| Planner 包重构 | ✅ 完成 | 2026-06-27 | `src/planner.py` → `src/planner/` 包（intent.py L1 分类器 + plan.py L2 PlanGenerator 骨架 + `__init__.py`），删除原文件，更新 8 处 imports — Phase 37 Batch 1 |
| PlanGenerator L2 引擎 | ✅ 完成 | 2026-06-27 | `src/planner/plan.py` — LLM 任务分解 DAG + PlanResult 不可变 dataclass + 三阶回退解析（JSON→块提取→兜底）+ TokenLedger 注入 + `POST /planner/generate-plan` 端点 + contract snapshot 监控 — Phase 37 Batch 1 |
| Chat 管线 Plan 注入 | ✅ 完成 | 2026-06-27 | `api/routers/chat.py` 步骤 4 — PlanGenerator.generate_plan() 调用 → plan_subtasks/dag_edges/rationale/confidence/token_usage 注入 api_trace extras，失败不阻塞管线。`plan_generation_enabled` 独立开关 — Phase 37 Batch 2 |
| ProcessDrawer Section 5 任务规划 | ✅ 完成 | 2026-06-27 | `ProcessDrawer.tsx` — 新增 "任务规划" 折叠区：MermaidDiagram 渲染 DAG + KVRow（子任务数/置信度/理由）+ plan token 统计卡片。`buildPlanDAGChart()` 从 trace 数据生成 flowchart TD。空状态安全（无 plan 数据不渲染）— Phase 37 Batch 2 |
| ChatMessage Plan ContextualLens | ✅ 完成 | 2026-06-27 | `ChatMessage.tsx` — 新增 "分解为 N 个子任务 · 怎么拆的?" 触发标签（ContextualLens 组件），展开显示实际任务 DAG 图。仅 api_trace 含 plan_subtasks 时渲染 — Phase 37 Batch 2 |
| Planner 内容答案 q3.4 + q3.5 | ✅ 完成 | 2026-06-27 | `ch3.ts` — 两篇 L0-L3 答案：q3.4 任务规划手段对比（规则模板/HTN/LLM 三路线）+ q3.5 LLM 任务规划流程（四步管道 + prompt 设计 + 三阶回退代码路径）— Phase 37 Batch 3 |
| ReplanDetector 重规划检测引擎 | ✅ 完成 | 2026-06-27 | `src/planner/replan.py` — `detect_drift()` 余弦相似度 + LLM 二次确认 + `generate_replan()` 修正计划 + 三阶回退解析 + `POST /planner/detect-replan` 端点 — Phase 37 Batch 4 |
| ReplanComparePanel | ✅ 完成 | 2026-06-27 | `frontend/src/components/lab/ReplanComparePanel.tsx` — 三列布局（原始计划/差异摘要/修正计划）+ mini Mermaid DAG + mock 数据自包含 — Phase 37 Batch 5 |
| q3.9 重规划对比答案 | ✅ 完成 | 2026-06-27 | `ch3.ts` — L0-L3 四层：三种漂移类型 + ReplanDetector 工程实现 + 行业实践 — Phase 37 Batch 5 |
| ReflectionEngine 后端引擎 | ✅ 完成 | 2026-06-30 | `src/planner/reflection.py` — LLM 驱动反思 + 事后总结(post_mortem) + 元知识提取(extract_meta_knowledge) + 计划蒸馏(distill_plan_template) + 三阶回退解析 + `reflection_insights` 持久化表 + 47 tests — Phase 61 全量闭环 |
| SidebarReflectionCard | ✅ 完成 | 2026-06-27 | `frontend/src/components/layout/SidebarReflectionCard.tsx` — 三状态卡片（idle/reflecting/done），反思文本 + 改进建议 + 质量评分 + 置信度，Sidebar 集成 — Phase 37 Batch 7 |
| q3.15 + q3.16 答案 | ✅ 完成 | 2026-06-27 | `ch3.ts` — 两篇 L0-L3：作者模型偏差（能力高估/资源低估/环境变化/工具限制）+ 元规划（复杂度阈值/意图→粒度映射/学习型决策）— Phase 37 Batch 7 |
| API client reflect | ✅ 完成 | 2026-06-27 | `client.ts` — `api.reflect()` + `ReflectionRequest`/`ReflectionResponse` TypeScript 类型 — Phase 37 Batch 7 |
| Ch1 内容 q1.2+q1.3 | ✅ 完成 | 2026-06-28 | `ch1.ts` — q1.2 输出溢出 + q1.3 重复信息三层去重 L0-L3 + mermaid 流程图 — Phase 42 Batch 1 |
| ChatMessage 窗口分区透镜 | ✅ 完成 | 2026-06-28 | `ChatMessage.tsx` — 助理消息新增 ContextualLens 显示分区图（usage_pct 百分比 + "怎么分的？"展开面板）；`OnionPanel.tsx` L3 新增「📐 窗口分区怎么分的？」分区 ContextualLens；`lib/` `buildPartitionChart()` 适配剩余 token 显示 — Phase 42 Batch 2 |
| q1.4 噪声信息内容 | ✅ 完成 | 2026-06-28 | `ch1.ts` — 噪声信息 L0-L3 + mermaid：主题偏离检测 + 格式噪声区分 + 与去重/不一致语义边界辨析 — Phase 42 Batch 3 |
| ChatMessage context_meta 守卫 | ✅ 完成 | 2026-06-28 | `ChatMessage.tsx` — `?.usage_pct`/`?.total_estimated_tokens` 可选链守卫，context_meta 缺失时分区透镜优雅降级隐藏而非崩溃 — Phase 42 Batch 3 |
| q1.5 不一致信息内容 | ✅ 完成 | 2026-06-28 | `ch1.ts` — 不一致信息 L0-L3 + mermaid：三源分类 → 三步法（检测/裁决/标记）→ 与去重/噪声边界辨析三角流程图 — Phase 42 Batch 4 |
| q1.8 上下文组装策略内容 | ✅ 完成 | 2026-06-28 | `ch1.ts` — 上下文组装 L0-L3 + mermaid：四步决策（预算→分区→筛选→排序）→ Lost-in-the-Middle 排列策略 — Phase 42 Batch 5 |
| Lab URL 参数路由 | ✅ 完成 | 2026-06-28 | `LabShell.tsx` — `useSearchParams` 读取 `?tab=` 参数初始选中 Tab；`lab/page.tsx` Suspense 包裹 — Phase 43 Batch 1 |
| LabLink 桥接按钮 | ✅ 完成 | 2026-06-28 | `types.ts` — `LabLink { tab; label? }` 接口 + `Answer.labLinks?`；`AnswerCard.tsx` — L3 后 RiFlaskLine 桥接按钮组 `/lab?tab=<key>` 跳转 — Phase 43 Batch 2 |
| 跨章 labLinks 注册 | ✅ 完成 | 2026-06-28 | `ch1.ts`/`ch2.ts`/`ch3.ts` — ch1 q1.1-q1.5+q1.8→context，ch2 7 题→data/graph，ch3 6 题→context — Phase 43 Batch 3 |
| q2.4 信息压缩手段对比 | ✅ 完成 | 2026-06-29 | `ch2.ts` — 信息压缩 L0-L3 + mermaid：五手段对比（LLM 语义压缩/溢出策略压缩/事实蒸馏/向量嵌入/硬截断）+ 代码引用段 + 对比表 — Phase 46 Batch 1 |
| q2.5 LLM 压缩反幻觉 | ✅ 完成 | 2026-06-29 | `ch2.ts` — 反幻觉 L0-L3 + mermaid：六道防线（Prompt 铁律/分块压缩/事实锚定/一致性检查/引用保留/优雅降级）+ 代码引用段 + 防线效果对比表 — Phase 46 Batch 2 |
| Ch1 收官（q1.6+q1.7+q1.9-q1.17） | ✅ 完成 | 2026-06-29 | `ch1.ts` — 9 题 L0-L3 填充完毕，Ch1 answeredCount 17/17 闭环。覆盖：多语言/多任务/消息角色/提示词/结构化/迷失中间/格式编码/指令冲突/时间维度/水合— Phase 47 Batch 1-6 |
| Ch2 记忆系统 15 题收官 | ✅ 完成 | 2026-06-29 | `ch2.ts` — 15 题 L0-L3 填充完毕，Ch2 answeredCount 26/26 闭环。覆盖：记忆固化/不一致/定期更新/长期存储/画像/分层/更新/冷启动/污染/免疫/灾难性/因果/内隐/情绪/程序性 — Phase 48 Batch 1-6 |
| Ch3 任务规划 16 题收官 | ✅ 完成 | 2026-06-29 | `ch3.ts` — 16 题 L0-L3 填充完毕，Ch3 answeredCount 16/16 闭环。B1: q3.3 失败/q3.6 拆解/q3.7 工具/q3.8 验证 — B2: q3.10 协作/q3.11 语言/q3.12 记忆/q3.13 中断/q3.14 否决 — B3: 48 条跨章关联（Ch1/Ch2/Ch4/Ch5）|
| CrossChapterConnection 类型 | ✅ 完成 | 2026-06-29 | `types.ts` — `CrossChapterType` 5 类 + `CrossChapterConnection` 接口 + `Answer.crossChapterConnections` 可选字段。`AnswerCard.tsx` 渲染区：类型标签+图标+点击导航到目标问题 — Phase 49 Batch 3 |
| Ch7 透明化设计 6 题收官 | ✅ 完成 | 2026-06-29 | `ch7.ts` — 6 题 L0-L3 全部填充，Ch7 answeredCount 6/6 闭环。覆盖：多视角表述/q7.2 三视角实操/透明化边界/叙事vs数据/q7.5 渐进式信息披露/q7.6 错误教学化 — Phase 50 Batch 3-4 |
| Ch6 时间与节奏 6 题收官 | ✅ 完成 | 2026-06-29 | `ch6.ts` — 6 题 L0-L3 全部填充，Ch6 answeredCount 6/6 闭环。覆盖：q6.1 对话内时间/q6.2 会话间时间/q6.3 昼夜节律/q6.4 成长轨迹/q6.5 信息时效性/q6.6 实时批处理 — Phase 51 Batch 1-3 |
| Ch8 元认知 6 题收官 | ✅ 完成 | 2026-06-29 | `ch8.ts` — 6 题 L0-L3 全部填充，Ch8 answeredCount 6/6 闭环。覆盖：q8.1 置信度校准/q8.2 已知的未知/q8.3 自我质疑/q8.4 能力边界/q8.5 求助升级粒度/q8.6 元认知成本。**93 问全线闭环 🎉** — Phase 52 Batch 1-5 |
| Plan 存储全链路 | ✅ 完成 | 2026-06-30 | `schema.sql` +2 表 (`plan_runs`/`plan_subtasks`)、`store.py` +4 方法、`api/routers/planner.py` +2 GET 端点、`api/routers/chat.py` Step 4.5 管线持久化（feature flag 门控）、前端 `ReplanComparePanel` + `SidebarReflectionCard` mock→真 — Phase 53 Batch 1-2 |
| 多层记忆分级 (tier.py) | ✅ 完成 | 2026-06-30 | `src/memory/tier.py` — TierClassifier 热力评分（三权重：新鲜度 0.4 + 访问频率 0.3 + 重要性 0.3）+ TierLevel(HOT/WARM/COLD) StrEnum + TierResult frozen dataclass + classify/classify_batch/get_tier_distribution — Phase 54 Batch 1 |
| 模型路由引擎 | ✅ 完成 | 2026-06-30 | `src/chat/model_router.py` (~180 行) — `ModelRouter` 类 (decide + is_retryable_error + execute_with_fallback) + `RoutingDecision`/`RoutingResult` frozen dataclass + `FallbackExhaustedError` 自定义异常。5 公开 API 符号。配置: `routing_enabled`/`simple_model`/`complex_model`/`simple_intents` — Phase 55 Batch 1-3 |
| 敏感信息本地分流 | ✅ 完成 | 2026-07-01 | `src/chat/local_router.py` (~320 行) — `SensitiveInfoDetector` 类（七类检测器：身份证/手机/银行卡/地址/密码/邮箱/API密钥）+ `SensitiveCategory` StrEnum + `SensitiveMatch`/`SensitiveInfoResult`/`LocalRouteDecision` 三数据类 + `route_local()` 本地路由函数（skip 外部 API，仅本地 recall + 模板合成回复）+ `_build_recall_summary()` 记忆摘要辅助。`src/config.py` +`local_routing_enabled` flag。`tests/test_local_router.py` 57 tests。纯规则引擎，零 LLM 依赖 — Phase 65 Batch 1 |
| ModelRoutingCard 前端路由卡片 | ✅ 完成 | 2026-06-30 | `frontend/src/components/layout/ModelRoutingCard.tsx` (~145 行) — Sidebar 三态路由展示（自动/手动/未初始化）+ 模型覆盖下拉。`ChatParamsContext` +`lastRouting`/`routingOverrideModel` 状态 + `toChatParams()` override 逻辑。`ChatResponse` +`routing: RoutingInfo` 字段 — Phase 55 Batch 4 |
| 记忆固化 (consolidate.py) | ✅ 完成 | 2026-06-30 | `src/memory/consolidate.py` (~320 行) — `ConsolidationCore` 类。B1 日终慢降温（乘性衰减 ×0.98/次，grace_period 豁免）+ B2 动态重要性（tanh 归一化访问频率，"用进废退"）+ `protect_hot()` 遗忘豁免（连续 N 次召回 → importance 加性提升）。`consolidate_if_stale()` 机会主义触发先保护后冷却。`src/memory/store.py` +`set_importance_batch`(3-tuple, 冷却路径) +`update_importance_batch`(2-tuple, 保护路径)。`src/config.py` +10 字段。零新 DB 表 · 零 API/前端变更 — Phase 56 Batch 1-2 |
| 步骤执行监控 (StepStatus/StepRecord) | ✅ 完成 | 2026-06-30 | `src/planner/replan.py` — `StepStatus` 5 态枚举（pending/running/success/failed/skipped）+ `StepRecord` 数据类（6 字段 + 可变状态转换）+ `monitor_step()`/`get_step_summary()`/`reset_monitor()` 三钩子 — Phase 57 Batch 1 |
| 局部重规划 (PartialReplanResult) | ✅ 完成 | 2026-06-30 | `src/planner/replan.py` — `PartialReplanResult` frozen dataclass + `generate_partial_replan()` 主入口（基于步骤监控数据，仅替换失败/未完成步骤）+ `_call_partial_replan_api()` LLM 调用 + `_parse_partial_replan_response()` 二阶回退 + `_merge_partial_plan()` 合并逻辑 — Phase 57 Batch 2 |
| 用户干预接口 (PlanOverride + PATCH) | ✅ 完成 | 2026-06-30 | `api/schemas.py` — `PlanOverrideAction` StrEnum + `PlanOverride`/`PlanOverrideRequest`/`PlanOverrideResponse` 模型。`src/memory/store.py` — `update_subtask()` 存储方法。`api/routers/planner.py` — `PATCH /planner/plans/{plan_id}` 端点（批量干预，终态保护，最多 16 条/请求）。`ReplanComparePanel.tsx` — 逐步骤（✓接受/✕拒绝/⏭跳过）+ 批量（接受全部/拒绝全部）干预按钮 + 反馈提示 — Phase 57 Batch 3 |
| 面板叙事层 (q7.4 实现) | ✅ 完成 | 2026-06-30 | `CacheStatsPanel` + `DecayDistributionPanel` + `TokenDashboardPanel` + `StrategyComparePanel` — 4 面板各追加叙事解释函数（getHealthLabel / getDecaySpeedLabel / getDominantCallPoint / getRecommendationNarrative）。数据展示与叙事解释共存，不替换只追加。视觉层级 `text-muted/70 italic` 低于数据行。— Phase 1000 Batch 18 |
| core_issues.md 四缺失话题 | ✅ 完成 | 2026-06-30 | 93→97 问。新增 1.18 流式上下文组装 (P1) · 2.27 多Profile记忆隔离 (P2) · 3.17 并行计划执行 (P3) · 4.11 Token成本预估 (P1)。联动更新 chapters.ts + 统计汇总表。— Phase 1000 Batch 19 |
| CSS Token 补齐 (U5/U17/U8/U18) | ✅ 完成 | 2026-07-01 | P2 CSS 问题清零：U5(z-index 硬编码 1→token)·U17(Header compact 6px→token)·U8(Sidebar 280px 死代码删除)·U18(accent bar 高度 3/4px 统一) + globals.css ~12 处 px→token 迁移 — Phase 1000 Batch 30 |
| Lab SVG Zoom ×3 | ✅ 完成 | 2026-07-01 | KnowledgeGraphPanel/EmbeddingSpacePanel/DecayDistributionPanel 三面板各加 SVG 缩放交互（useRef + useState zoom + ImageViewer 集成）+ 2 组件测试补齐 — Phase 1000 Batch 31 |
| L2 召回参数后端接线 | ✅ 完成 | 2026-07-01 | `recall_top_k`/`recall_threshold`/`recall_mmr_lambda` 从 ChatRequest → chat pipeline → RecallEngine.recall() 全链路透传。`api/schemas.py` +3 可选字段、`src/memory/recall.py` mmr_lambda 新参数（None→config 默认值）、前端 `types-chat.ts` 同步 — Phase 1000 Batch 32 |
| CSS 架构四文件拆分 | ✅ 完成 | 2026-07-01 | globals.css (1092 行) → tokens.css (268) + theme.css (86) + animations.css (45) + components.css (694)。`layout.tsx` 单 import → 四文件按序导入。CSS 变量/类名/选择器零变更，语义等价纯拆分 — Phase 1000 Batch 33 |
| useIsDarkTheme hook | ✅ 完成 | 2026-07-02 | `frontend/src/hooks/useIsDarkTheme.ts` — MutationObserver 监听 `html[data-theme]` 属性变化 → `isDark` 布尔状态。Scene + Panel 共享，消除重复 observer 逻辑 — Phase 1000 Batch 53 |
| KnowledgeGraphScene (ECharts) | ✅ 完成 | 2026-07-02 | `frontend/src/components/lab/KnowledgeGraphScene.tsx` — ECharts 2D 力导向图（~270 行），GraphColors 独立色板（getGraphColors(isDark)），零 3D 依赖，双主题感知 + 置信度筛选 + force layout 拖拽/缩放/邻接高亮 — Phase 1000 Batch 49-53 |
| Shared Module Governance 框架 | ✅ 完成 | 2026-07-03 | `tools/check_shared_modules.py` — 61 共享模块自动扫描 · 三级风险分类 (🔴Critical/🟠High/🟡Medium) · Feature Flag 消费者影响矩阵 · Risk Assessment 交叉检查 · `make check-docs` L2f 集成 — Phase 1000 B56 |
| Risk Assessment ×3 (schemas/config/store) | ✅ 完成 | 2026-07-03 | `api/schemas.py` (14C·5L) · `src/config.py` (28C·5L) · `src/memory/store.py` (22C·5L) — Consumer Impact Analysis + 5-Layer Abstraction Enumeration + Key Findings — Phase 1000 B57-B59 |
| Risk Assessment ×9 🟠🟡 缺口补齐 | ✅ 完成 | 2026-07-07 | 🟠 `formatTime.ts` (9C·3L — fmtRelativeTime/fmtMs/fmtTimestamp) · `labels.ts` (5C·3L — STEP_LABELS/CALL_POINT_LABELS/CALL_POINT_COLORS) · `ErrorBoundary.tsx` (5C·2L — class boundary + ErrorDisplay fallback). 🟡 `useCodeHighlight.tsx` (4C·2L — Prism + CopyButton DOM) · `useLocalStorage.ts` (3C·3L — SSR-safe JSON persist) · `formatChapter.ts` (3C·2L — toChineseNumeral/formatChapterTitle) · `formatNum.ts` (3C·1L — toLocaleString) · `estimateReadingTime.ts` (3C·2L — 中英混合估算/格式化) · `WindowSizeInput.tsx` (3C·2L — 数字输入+preset 组合). 全 9 模块 Risk Assessment 写入 `docs/archive/architecture-ra-b89.md` — Phase 66 B89 |
| Risk Assessment — `confidence.ts` | ✅ 完成 | 2026-07-08 | 🟡 `confidence.ts` (3C·1L — getConfidenceTier/CONFIDENCE_HIGH/CONFIDENCE_MEDIUM). 3 消费者: TagCloud(ProfileShell) · TagDetailDrawer · TagPill(ProfileCard). 品类：纯函数/常量模块 — 无状态、无副作用、无异步。变更风险极低：接口稳定（函数签名+导出常量），消费者仅依赖返回值类型 (ConfidenceTier="high"/"medium"/"low")。新增阈值常量需同步更新所有消费者视觉预期 — Phase 1000 B114 |
| 治理工具链增强 (Feature Flag/Settings/Backlog) | ✅ 完成 | 2026-07-03 | 13 flags 审计矩阵 · `Settings.__post_init__` 验证 · master-backlog v2 (366→93 行) · CLAUDE.md 瘦身 (190→175) + 文件健康诊断 · 发现即待办规则 19 — Phase 1000 B61-B65 |
| L5 补拉通五批 (B115-B119) | ✅ 完成 | 2026-07-08 | Context/Pipeline Tab (B115) · Tooltip 即时化 (B116) · Lab Tab 增强 (B117) · Experiment Tab (B118) · Data Tab + 共享 lib DRY (B119) — ~30 Batch 延迟 L5 检查全量闭环 · pre-commit hook 路径修复 + 机械门禁恢复 |
| 门禁全绿收官 (B120) | ✅ 完成 | 2026-07-08 | 补 2 条 L5 自检验证方式 → check-docs 146/146 · eslint 0e 0w · 日报追记 B115-B120 |
| Windows Server 部署基础设施 | ✅ 完成 | 2026-07-09 | FAISS→usearch 替换 (消除 Windows 部署阻塞点) · Next.js standalone 构建 · Nginx 反向代理配置 · NSSM Windows Service 注册脚本 · 一键部署脚本 — Phase 67 Batch 1 |
| Windows Server 部署文档 + B1 缺口修补 | ✅ 完成 | 2026-07-09 | 修 install-services.ps1 standalone bug (next start → node server.js) · deploy.ps1 补目录兜底 + 健康检查 · 新增 .env.example + deploy/README.md (7 章主手册) + deploy/offline-model.md (离线模型 SOP) — Phase 67 Batch 2 |
| 移动端 Drawer sidebar slot 线程 | ✅ 完成 | 2026-07-15 | `MobileSidebarDrawer.tsx` — 新增 `sidebarSlot` prop · AppShell 透传 `sidebar` prop → 三态路由（undefined→默认/false→无/ReactNode→自定义）· `.sidebar-panel` CSS 拆为基础层 + 桌面专属层 (`@media (min-width: 1024px)`) · `/learn` 移动端 Drawer 从聊天参数面板切换为 QuestionList 目录 — Phase 66 B119 |
| 移动端 QuestionList 精简 | ✅ 完成 | 2026-07-15 | `QuestionList.tsx` — 4 处 CSS 响应式 class：过滤芯片行 gap/px/py 收紧 · 章节进度条 ×2 `hidden lg:block` · 最近阅读 section `hidden lg:block` · 非目录 chrome 从 ~200px (40%) 降至 ~120px (25%)，目录可视面积 +~60% — Phase 66 B120 |
| 过渡 token 标准化 (总² 启动) | ✅ 完成 | 2026-07-15 | `components.css` + `ImageViewer.tsx` + `MermaidDiagram.tsx` + `ContentDashboard.tsx` + `OnionPanel.tsx` + `ProjectMapDrawer.tsx` + `CostWaterfallPanel.tsx` — 10 处硬编码过渡时长 → 5 档 `var(--gm-duration-*)` token · 全站 167 交互元素四态扫描（36% focus-visible / 13% active）排 B122-B125 — Phase 66 B121 |
| UI 共享组件四态补齐 | ✅ 完成 | 2026-07-15 | 8 文件 14 处：CopyButton/RefreshButton/ThemeToggle/WindowSizeInput/ErrorDisplay/ImageViewer/CollapsibleSection/ConfirmModal — 统一 `focus-visible:ring-2` + `active:scale-[0.98]` — Phase 66 B122 |
| API — Admin 管理路由 | ✅ 完成 | 2026-08-07 | `api/routers/admin.py` — 3 端点：`GET /api/admin/health`（check-docs JSON 透传，超时/异常保护）+ `GET /api/admin/docs`（文档清单分组归类）+ `GET /api/admin/docs/{name}`（内容读取，路径沙箱防穿越）— Phase 68 B2 |
| 前端 — Admin 管理页面 | ✅ 完成 | 2026-08-07 | `frontend/src/app/admin/AdminShell.tsx` + `page.tsx` — 密码门禁（NEXT_PUBLIC_ADMIN_PASSWORD + sessionStorage）+ 健康仪表盘（摘要卡片 + 门禁明细 + 最近提交）+ 文档浏览器（分组折叠 + 在线阅读 + Prism 代码高亮）+ ThemeToggle 主题切换 + 手动刷新 — Phase 68 B3-B4 |

## 架构决策记录

### ADR-001: 记忆存储 — SQLite + FAISS 双引擎

**背景**：项目核心差异点是"展示记忆过程"。存储方案必须在语义检索能力和可解释性之间取得平衡。

**决策**：SQLite 存储结构化元数据（内容、时间戳、重要性、艾宾浩斯参数），FAISS 存储向量索引用于语义检索。两者通过 faiss_id 外键关联。

**备选方案及放弃理由**：
- 纯 SQLite + numpy 余弦相似度：放弃，O(n) 暴力检索在记忆增长时不可持续
- Chroma / Pinecone 等外部向量库：放弃，多一个服务多一层黑盒，违背可解释性原则
- FAISS 单独使用不用 SQLite：放弃，向量只管相似度，管不了时间、重要性、遗忘曲线

**影响范围**：整个记忆引擎的数据层设计。

### ADR-002: 记忆模型 — 双层模型（Episode + Fact）

**背景**："用户喜欢猫"和"3 天前聊了 200 行猫粮话题"是两类不同记忆，存储和召回策略应不同。

**决策**：Episode 记录原始对话片段，按艾宾浩斯时间衰减；Fact 记录抽取的事实知识，按重要性 + 使用频率加权。

**备选方案及放弃理由**：
- 单层模型：放弃，颗粒度太粗，不同遗忘策略无法应用

**影响范围**：MemoryStore 的 schema 设计、RecallEngine 的召回策略。

### ADR-003: 遗忘机制 — 艾宾浩斯曲线 + 召回增强

**背景**：遗忘是记忆系统的核心特征之一，也是可视化的重要素材。

**决策**：`strength = initial × e^(-λt)`，每次成功召回后 initial 上浮。这是认知科学基础模型，参数可解释、曲线可绘制。

**备选方案及放弃理由**：
- 纯 TTL 过期删除：放弃，没有"半忘不忘"的中间态，可视化没东西画
- 优先级淘汰：放弃，工程实用但缺乏认知科学支撑

**影响范围**：ForgettingEngine、RecallEngine 的重排序逻辑、可视化模块。

### ADR-004: 界面策略 — CLI 先行，增量迭代到 Streamlit → 已废弃 (M4)

**背景**：UI 是最直接的效果反馈回路，不能拖到引擎"做完"才动手。但项目核心价值在记忆引擎，不在 UI 框架。

**决策（已废弃）**：Phase 1 用 rich 库做终端级可视化，后续 Phase 用 Streamlit 做 Web 交互界面。

**M4 更新 (2026-06-23)**：Streamlit 已完全切除。最终技术栈：Next.js App Router + FastAPI + Python 引擎。CLI 保留共存。详见 ADR-010。

### ADR-005: Embedding — 本地 all-MiniLM-L6-v2

**背景**：语义 recall 需要向量化，选型影响成本、延迟、可控性。

**决策**：sentence-transformers 的 all-MiniLM-L6-v2，本地运行，模型约 100MB，输出 384 维向量。有 GPU 用 GPU，没有 CPU 也够用。

**备选方案及放弃理由**：
- API 方案（OpenAI embeddings）：放弃，花钱、有延迟、依赖外部
- 纯关键词 TF-IDF：放弃，语义理解太弱

**影响范围**：Embedding 模块、RecallEngine 的输入。

### ADR-006: 对话生成 — DeepSeek API (openai 兼容协议)

**背景**：Phase 1 CLI 只做存储+召回，无 AI 回复。"会聊天"是项目定义的第一位功能。需要为 CLI 接入对话生成能力，但 Anthropic API 在中国大陆不可达。

**决策**：用 `openai` SDK 调 DeepSeek API（`https://api.deepseek.com`），模型 `deepseek-chat`（V3）。回复生成后以 `[Assistant]` 前缀存入 episodic memory（importance=0.4），让 AI 回复也能被后续召回。

**备选方案及放弃理由**：
- Anthropic SDK：放弃，墙内不可达
- Ollama 本地模型：备选，但需要额外环境配置（ollama serve + 拉模型），DeepSeek API 开箱即用
- 回复不存记忆：放弃，会导致记忆闭环只覆盖用户侧，AI 说过的内容无法召回

**影响范围**：`src/chat/engine.py`（新组件）、`src/chat/cli.py`（主循环更新）、`src/visualize/panel.py`（新增 render_response）。

### ADR-007: Web 界面 — Streamlit 替代 CLI 作为默认交互入口 → 已废弃 (M4)

**背景**：ADR-004 决策 CLI 先行验证数据流，Web 在引擎稳定后增量加。Phase 1+2 完成后，Web 迁移条件成熟。

**决策（已废弃）**：用 Streamlit 构建 Web UI。CLI 保留共存。

**M4 更新 (2026-06-23)**：Streamlit 已完全切除。当前 Web 前端为 Next.js App Router，通过 FastAPI 中间层与 Python 引擎通信。详见 ADR-010 (Phase 28)。

### ADR-008: Pipeline Chain 可视化 — 内容块 + 并行拓扑

**背景**：ADR-007 决定用 Streamlit 做 Web UI，但链路的可视化粒度只到"有这个步骤"。每步是黑盒子——用户看到"嵌入"但不知道用了什么模型、输出了什么维度。且真实架构的 fork-join 并行结构在可视化中被压扁成串行。

**决策**：
1. 每 step 携带 `blocks` 列表，每个 block 是一种内容类型（text / code / kv_table / formula / vector_bars / candidate_list / scorecard / fact_list），描述"输入→变换→输出"三要素
2. 每 step 可选 `parallel_group` 字段，连续同组 step 用 `st.columns(N)` 并排渲染
3. 串联步用 ↓ 连接符，并行组内不加连接符
4. trace 数据在 app.py 的编排层采集，不侵入引擎代码

**备选方案及放弃理由**：
- 直接让引擎吐出 trace：放弃，引擎该是无 UI 感知的纯逻辑，trace 是编排层的职责
- 所有步骤都串行渲染：放弃，架构本身就是 fork-join，可视化应该诚实反映拓扑结构

**影响范围**：`src/web/components.py`（`_render_block`, `_render_trace_step`, `_group_by_parallel`, `render_storage_chain`, `render_recall_chain`），`src/web/app.py`（trace 数据富化），`tests/test_web.py`（+16 tests）。

### ADR-009: A/B 实验框架 — 临时单例交换

**背景**：研究策略要求每个 Sprint 产出可独立对比和评估。Settings 已支持多实例，但引擎构造函数内部读取模块级 `src.config.settings` 单例，导致无法在单进程中同时运行两套参数。

**决策**：`init_engines()` 新增 `settings_override` 参数——函数内部临时替换 `src.config.settings`，构造完引擎后 `finally` 恢复。`ExperimentRunner` 为每次运行创建独立临时数据目录，确保 A/B 互不污染。Web UI 侧边栏提供预设选择器和自定义参数覆盖。

**备选方案及放弃理由**：
- 重构全部 6 个引擎构造函数接受 Settings 参数：放弃，改动量大、回归风险高、收益有限
- 使用 contextvars 做线程级隔离：放弃，Streamlit 单线程，过度设计

**影响范围**：`src/bootstrap.py`（init_engines 签名变更）、`src/experiment.py`（新模块）、`src/web/components.py`（对比可视化）、`src/web/app.py`（侧边栏集成）、`tests/test_experiment.py`（+36 tests）。

### ADR-010: 产品方向 — 从"研究平台"到"逐层探索之旅"

**背景**：Batch 13 完成 A/B 实验框架后，四个研究命题（记忆设计/上下文处理/Token效率/任务规划）并行推进，但缺乏统一的叙事主线。用户提出"从用户视角出发，由外到内逐层揭开 AI 的运行机制"。

**决策**：将产品定位从"研究平台功能面板"升级为"逐层探索之旅"。定义 10 层递进模型（L0-L10），每层回答一个用户自然会问的问题，按认知深度向外到内排列：消息旅程 → 当前会话 → 记忆召回 → 上下文窗口 → 系统提示词 → 模型推理 → 遗忘曲线 → 知识提取 → 向量空间 → 成本会计 → 数据主权。在哪层揭开就在哪层给控制权（L4 系统提示词和 L10 数据主权暂为只读）。

**备选方案及放弃理由**：
- 维持四轨研究并行：放弃，方向分散、缺乏统一叙事，用户感知不到进展
- 直接开始 L8（向量空间可视化）：放弃，跳过了用户建立认知所需的中间层

**影响范围**：`docs/roadmap.md` Phase 7 完整路线（Batches 14-24）、Web UI 渐进重构方向。

### ADR-011: 项目重定位 — 从"LLM 运行时透明化"到"AI Robot 认知层解剖"

**背景**：项目原名 GlassMind，定位为"LLM 运行时透明化研究平台"，暗示在解剖基模内部推理过程（attention、神经元激活、token 概率分布）。但实际构建的一直是基模外围的认知层——记忆、上下文、Token 核算、意图识别。名称和描述与实质工作之间存在根本性偏差。

**决策**：
1. 项目更名为 **GlassCortex**（基模 = 基底核，我们 = 大脑皮层）
2. 英文副标题：See How AI Remembers, Thinks, and Plans
3. 中文价值主张：逐层解剖 AI Robot 工作原理
4. 核心能力从"L0-L10 十层透明化"重新组织为**四大支柱**：记忆与遗忘 / 上下文工程 / Token 监控与节省 / Planner 意图识别与任务规划
5. 远期能力：MCP 工具调用 / RAG 检索增强
6. 明确边界：不越界做基模推理透明化或通用 Agent 框架

**备选方案及放弃理由**：
- 保留 GlassMind 名称仅修改描述：放弃，名称本身暗示"mind=大脑内部"，与"我们只做皮层"的定位冲突
- 改为通用名称（如 AI Lab、Memory Studio）：放弃，缺少概念锚点，Cortex 与基底核的解剖学类比精准且易记

**影响范围**：项目身份文件（pyproject.toml / README.md / CLAUDE.md）、代码标识符（logger 名 / 日志文件名 / UI 文本）、设计原则段重写。

## 端到端数据流（聊天请求生命周期）

```
 👤 用户                Next.js            FastAPI         Embedding        FAISS+SQLite     ChatEngine      DeepSeek
  │                      │                  │                │                 │               │               │
  │  输入问题            │                  │                │                 │               │               │
  ├─────────────────────►│                  │                │                 │               │               │
  │                      │  POST /chat      │                │                 │               │               │
  │                      ├─────────────────►│                │                 │               │               │
  │                      │                  │  embed(text)   │                 │               │               │
  │                      │                  ├───────────────►│                 │               │               │
  │                      │                  │◄───────────────┤                 │               │               │
  │                      │                  │  [0.12,...]    │                 │               │               │
  │                      │                  │                                │               │               │
  │                      │                  │  FAISS.search(k=20)            │               │               │
  │                      │                  ├───────────────────────────────►│               │               │
  │                      │                  │◄───────────────────────────────┤               │               │
  │                      │                  │  [ep_42, ep_15, ...]           │               │               │
  │                      │                  │                                │               │               │
  │                      │                  │  ┌─ SQLite: 查 episodes ─┐    │               │               │
  │                      │                  │  │  SQLite: 查 facts     │    │               │               │
  │                      │                  │  └─ 并行查询 ────────────┘    │               │               │
  │                      │                  │                                │               │               │
  │                      │                  │  ┌─ 艾宾浩斯强度计算 ──┐      │               │               │
  │                      │                  │  │  Fact 置信度评分     │      │               │               │
  │                      │                  │  └─ 并行评分 ──────────┘      │               │               │
  │                      │                  │                                │               │               │
  │                      │                  │  综合排序 Merge → top_k=5     │               │               │
  │                      │                  │                                │               │               │
  │                      │                  │  generate(msg, ctx, recall)    │               │               │
  │                      │                  ├───────────────────────────────────────────────►│               │
  │                      │                  │                                                │  /completions │
  │                      │                  │                                                ├──────────────►│
  │                      │                  │                                                │◄──────────────┤
  │                      │                  │                                                │  response     │
  │                      │                  │◄───────────────────────────────────────────────┤               │
  │                      │                  │  reply                                         │               │
  │                      │                  │                                │               │               │
  │                      │                  │  FactExtractor: 抽取事实+去重                  │               │
  │                      │                  │                                                ├──────────────►│
  │                      │                  │                                                │◄──────────────┤
  │                      │                  │                                                │  facts        │
  │                      │                  │                                │               │               │
  │                      │                  │  ┌─ FAISS.add(embedding) ─┐   │               │               │
  │                      │                  │  │  SQLite: INSERT ep+fact │   │               │               │
  │                      │                  │  └─ 并行写入 ─────────────┘   │               │               │
  │                      │                  │                                │               │               │
  │                      │  JSON response   │                                │               │               │
  │                      │◄─────────────────┤                                │               │               │
  │                      │  {reply,intent,  │                                │               │               │
  │                      │   trace,...}     │                                │               │               │
  │  渲染回复+洋葱面板    │                  │                                │               │               │
  │◄─────────────────────┤                  │                                │               │               │
```

> 一次聊天请求的完整链路：语义检索 → 并行查库 → 评分排序 → LLM 生成 → 事实抽取 → 双写存储。
> 聊天页 OnionPanel 按四层渐进披露展开查看各阶段细节。

## 设计原则

- **边界明确**：AI Robot 认知层透明化 — 上下文工程 / 记忆与遗忘 / Token 监控与节省 / Planner 意图识别与任务规划。远期：MCP / RAG。不越界做基模推理透明化或通用 Agent 框架
- **可解释性优先**：消息旅程四阶段卡片是核心叙事入口，每张卡片用自然语言摘要 + 大号数字，展开后展示技术细节
- **四支柱并行推进**：每支柱独立交付、独立验证，横切能力（消息旅程/模型推理/可观测性）穿插其中
- **在哪层解剖就在哪层控制**：参数控制权跟随认知层走，不做独立配置面板
- **简单至上**：用最简单的方案解决问题，不过度设计

## 关联文档

- `methodology.md` — AI 辅助开发端到端工作流方法论（可迁移到其他项目）
- `research-strategy.md` — 研究策略全景（四块命题 + 横切关注点 + 执行路径）
- `roadmap.md` — 分批次任务明细 + 验证标准 + 执行状态
- `requirements-log.md` — 需求变更链路追踪 + 验证方式标注
- `pitfalls.md` — 踩坑记录
- `lessons-learned.md` — 经验沉淀
- `ui-ux-patterns.md` — UI/UX 通用模式手册（跨框架可迁移）
- `model-comparison.md` — 模型能力对比追踪（候选编程 agent 评估唯一真相源）
