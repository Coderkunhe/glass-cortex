import type { Answer } from "../types";

/** 第 6 章：时间与节奏 答案列表 */
export const CH6_ANSWERS: Answer[] = [
  {
    id: "q6.1",
    question: '对话内的时间：哪些认知操作必须同步（阻塞回复），哪些可以异步（后台后处理）？',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P2",
    confidence: { l0: 0.97, l1: 0.94, l2: 0.92, l3: 0.90 },
    overallConfidence: 0.90,
    l0: 'GlassCortex 的认知管线目前是纯同步的——意图分类、记忆召回、上下文组装、LLM 生成串行执行，直到回复发出后才进入存储和后处理环节。衰减计算、知识图谱更新、会话统计等操作在技术上可以异步化，但项目目前没有异步队列基础设施，这是一个已知的工程缺口。',
    l1: `想象一家只有一个厨师的餐厅。客人点菜后，厨师从备料开始——洗菜、切菜、下锅、装盘、上菜——全程一个人搞定。这才是真正的"全栈"。但如果客人等菜的时候后厨也在洗碗、拖地、盘库存，那客人可能等 40 分钟才吃上一碗面。

GlassCortex 的认知管线就是这个"一个人全包"的模式。从你发出一条消息到看到回复，经过的步骤串在一条链上：

> **同步链**（阻塞回复的每一步）：
> 意图分类 → 记忆召回 → 上下文组装 → LLM 生成

每一环必须等上一环完成。在 \`src/chat/engine.py:153\` 的 \`generate()\` 方法里，这几步顺序排列，没有任何并行或异步分叉。等回复送到前端之后，\`generate_and_store()\`（同文件:302）再接棒做事实提取和数据库写入——这一步也是同步的，用户不会看到它执行，但它占用的是同一个请求生命周期。

区别在哪？\`generate()\` 的前四步你**必须等**——没有意图分类结果就不知道召回了什么，没有召回结果就不知道上下文是什么，没有上下文 LLM 就不知道该说什么。但回复发出之后的那些事——比如衰减计算、知识图谱更新、会话统计——它们不需要在请求时间内完成。就算延迟 10 秒再做，下一次对话时数据仍然是对的。

看一眼当前管线的完整调用链：

\`\`\`mermaid
%% title: 图：GlassCortex 认知管线——同步链 vs 可异步操作
graph LR
    subgraph 同步["🔗 同步链（阻塞回复）"]
        INTENT["① 意图分类<br/>intent_classify()"]
        RECALL["② 记忆召回<br/>recall()"]
        CONTEXT["③ 上下文组装<br/>_build_system_prompt()"]
        GENERATE["④ LLM 生成<br/>generate()"]
    end
    INTENT --> RECALL
    RECALL --> CONTEXT
    CONTEXT --> GENERATE

    subgraph 异步候选["⏳ 当前同步但可异步"]
        STORE["⑤ 事实提取 + 存储<br/>store_response()"]
        DECAY["⑥ 衰减计算<br/>decay_all()"]
        STATS["⑦ 会话统计<br/>TokenLedger 记账"]
        REGRET["⑧ 遗憾分析<br/>RegretAnalysis"]
    end
    GENERATE -.->|"回复发出后串行"| STORE
    STORE -.-> DECAY
    DECAY -.-> STATS
    DECAY -.-> REGRET

    style INTENT fill:#fef9c3,stroke:#ca8a04
    style GENERATE fill:#4f46e5,stroke:#4338ca,color:#fff
    style STORE fill:#e0e7ff,stroke:#6366f1
    style DECAY fill:#e0e7ff,stroke:#6366f1
    style STATS fill:#e0e7ff,stroke:#6366f1
    style REGRET fill:#e0e7ff,stroke:#6366f1
\`\`\`

那为什么不拆成异步？主要三件事挡住了这条路的性价比：

1. **请求生命周期**——Python FastAPI 的请求-响应模型天然同步。一个请求进来，你可以在后台开一个 \`asyncio.create_task()\`，但请求返回后这个 task 随时可能被进程回收杀掉。要做可靠的后台处理需要独立的工作进程（Celery/RQ）。
2. **数据一致性**——衰减计算依赖事实库的当前状态，而状态又可能被下一次对话改掉。在同步语境下没有竞态条件，数据一致性是隐式的。拆异步后需要处理"正在衰减时用户又发了条消息"的并发问题。
3. **不值得**——衰减计算 (\`forget.py:32\` \`decay_all()\`) 一次几毫秒，不用拆。真正耗时的是 LLM 调用的那几秒。异步优化的 ROI 在前四步而不在后四步。

核心观察：**当前的同步模型不是设计选择，而是默认值。** 它正确但不优化。如果哪天 GlassCortex 需要处理高并发或长尾后台任务，异步队列会是第一个要加的工程设施。

> 置信度：0.94`,
    l2: `### 管线的七步时间分布

各步骤占一个完整请求的耗时比例（估算，基于典型情况——非冷启动、中等记忆量）：

| 步骤 | 函数 | 耗时占比 | 可异步？ |
|------|------|:-------:|:-------:|
| 意图分类 | \`planner/intent.py:84\` \`classify_intent()\` | ~2% | ❌ 必需 → 决定是否召回 |
| 记忆召回 | \`memory/recall.py\` \`recall()\` | ~1% | ❌ 必需 → 决定上下文内容 |
| 上下文组装 | \`engine.py:76\` \`_build_system_prompt()\` | ~1% | ❌ 必需 → LLM 输入 |
| LLM 生成 | \`engine.py:153\` \`generate()\` 内 LLM 调用 | ~90% | ❌ 用户等待的就是这个 |
| 事实存储 | \`engine.py:292\~300\` \`store_response()\` | ~3% | ✅ 回复已到前端后可执行 |
| 衰减计算 | \`forget.py:32\` \`decay_all()\` | <1% | ✅ 毫秒级，但当前串行执行 |
| Token 记账 | \`token_ledger.py\` \`TokenLedger.add_call()\` | <1% | ✅ 纯内存操作 |

**关键洞察**：LLM 生成占了 90%，其余六步加起来不到 10%。即使把后三步全部异步化，响应时间优化的上限也只有 ~10%。这不是一个"异步化能极大提升性能"的领域——它本质受限于 LLM 推理速度。异步化的真正价值不在提速，而在**释放请求生命周期**：让请求快速返回，后台慢慢收尾。

### 如果硬要做异步，路径是什么

一个轻量方案不需要引入 Celery。利用 FastAPI 的 \`BackgroundTasks\`：

\`\`\`python
# 伪代码——当前不存在
from fastapi import BackgroundTasks

@router.post("/chat")
async def chat(request: ChatRequest, tasks: BackgroundTasks):
    response = engine.generate(request.messages)
    tasks.add_task(engine.post_process, response)  # 衰减 + 统计
    return response
\`\`\`

但 \`BackgroundTasks\` 和请求生命周期绑定——请求返回后不保证执行。真正的方案需要：

1. 一个独立的工作进程（或线程池）
2. 一个任务队列（Redis → Celery 或更轻量的 \`asyncio.Queue\`）
3. 失败重试和死信处理

> 置信度：0.92`,
    l3: `### 行业实践

| 平台/框架 | 同步/异步 | 方案 | 参考 |
|-----------|:--------:|------|------|
| OpenAI Assistants API | ✅ 异步 | 创建 Run → 轮询状态，非阻塞 | polling-based |
| LangChain | ✅ 混合 | CallbackHandler 机制，同步链 + 异步回调 | callback pattern |
| Anthropic Messages API | ❌ 同步 | 请求-响应，单次返回 | request-response |
| AutoGPT / BabyAGI | ✅ 异步 | 独立事件循环，自主执行 | event loop |
| GlassCortex | ❌ 纯同步 | 无异步队列 | 当前状态 |

### 未解决的三个问题

1. **失败归属**——后台衰减计算如果失败了算谁的？下一次对话时用户发现"上次我聊完之后，我的记忆好像没更新"，这个错误无归属。
2. **操作顺序**——用户连发三条消息，后台有三个衰减任务同时跑。它们应该队列执行（避免竞态）还是并行（快但可能覆盖彼此结果）？
3. **资源治理**——后台任务如果失控，谁来杀掉？当前同步模型的天然约束（一个请求一个回复）恰好也是一种流量控制。

GlassCortex 目前不处理这三个问题——因为它还没走出同步舒适区。

> 置信度：0.90`,
    crossChapterConnections: [
      {
        questionId: "q1.1",
        type: "prerequisite",
        relationship: "上下文组装（Ch1）是同步链的一环——溢出策略的选择直接影响管线是阻塞还是回退"
      },
      {
        questionId: "q3.1",
        type: "parallel",
        relationship: "意图分类（Ch3）作为同步链的第一环，它的失败会阻塞整条管线；异步化在此没有替代方案"
      },
      {
        questionId: "q2.26",
        type: "application",
        relationship: "衰减计算（Ch2）是典型可异步操作——毫秒级，不依赖回复内容的正确性，适合后台处理"
      },
    ],
  },
  {
    id: "q6.2",
    question: '会话间的时间：衰减曲线按自然时间走 vs 按对话次数走——哪个更合理？',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P2",
    confidence: { l0: 0.96, l1: 0.94, l2: 0.92, l3: 0.90 },
    overallConfidence: 0.90,
    l0: 'GlassCortex 当前用自然时间（墙钟时间）驱动记忆衰减——`ForgettingEngine.current_strength()` 以 `updated_at` 和当前时间戳的差值为基准计算记忆强度。对话次数衰减（每条新消息刷新一次衰减步）是可行的替代方案，在对话密集型场景中更合理，但需要追踪额外状态。没有绝对正确的选择，取决于你的用户一天发几条消息。',
    l1: `想想你手机上的联系人列表。你记得一个老朋友的电话，哪怕三个月没联系——这是因为自然时间里的记忆像酒，放久了浓度变化不大。但如果你每天都和同一个人发微信，一周不聊就会觉得"咦好久没见了"——这是因为频繁交互放大了时间感知。

这就是自然时间衰减和事件时间衰减的区别。前者以"距离上次访问的秒数"为计量单位，后者以"距离上次访问中间发生了多少次新交互"为计量单位。

GlassCortex 选择的是前者。在 \`src/memory/forget.py:25\`，\`ForgettingEngine.current_strength()\` 的实现：

> 强度 = 上次强度 × e^(-λ × Δt)

其中 Δt 是距上次访问的**自然时间差**（单位：秒），λ 是衰减率。每次你提到某个记忆（比如回复中涉及的事实被重新加载），\`strengthen()\`（同文件:57）给它加一个脉冲。

那为什么不是按对话次数衰减？就是每次你发一条新消息，所有未被访问的记忆都衰减一步。两种方案各有场景：

| 场景 | 自然时间合理 | 对话次数合理 |
|------|:----------:|:----------:|
| 用户每天聊 100 条 | → 过于苛刻，半天忘了 | ✅ 自然衰减，不受消息数影响 |
| 用户三天聊一次 | ✅ 正常衰减曲线 | → 中间断三天的衰减突然变慢 |
| 两条消息间隔 10 分钟 | → 几乎无衰减，合理 | ✅ 衰减一步 |
| 放假 15 天没聊 | ✅ 大幅衰减 | → 仅衰减一步（不准确） |

看这张对比图：

\`\`\`mermaid
%% title: 图：自然时间 vs 对话次数衰减曲线对比
graph TD
    subgraph 自然时间["⏰ 自然时间衰减（当前方案）"]
        T0["t=0: 记忆强度 S₀"]
        T1["t=1d: S = S₀ × e^(−λ) <br/>两天不聊 → 减弱"]
        T2["t=7d: S = S₀ × e^(−7λ) <br/>放假一周 → 大幅减弱"]
        T3["t=30d: S → 0 <br/>一个月不聊 → 遗忘"]
    end
    subgraph 事件时间["💬 对话次数衰减（替代方案）"]
        E0["第 0 条: 强度 S₀"]
        E1["第 10 条: S = S₀ × e^(−λ) <br/>10 次对话没提 → 减弱"]
        E2["第 50 条: S = S₀ × e^(−5λ) <br/>50 次对话没提 → 大幅减弱"]
        E3["第 200 条: S → 0 <br/>200 次没提 → 遗忘"]
    end

    style T0 fill:#fef9c3,stroke:#ca8a04
    style E0 fill:#e0e7ff,stroke:#6366f1
    style T1 fill:#fbbf24,stroke:#d97706
    style E1 fill:#a5b4fc,stroke:#6366f1
    style T2 fill:#fb923c,stroke:#ea580c,color:#fff
    style E2 fill:#818cf8,stroke:#4f46e5,color:#fff
\`\`\`

> 为什么 GlassCortex 选了自然时间？**因为简单。** 自然时间不需要额外状态——\`updated_at\` 字段在数据库里，\`time.time()\` 在 Python 标准库里，一个减法就拿到了 Δt。对话次数衰减需要计数器：每个 memory 条目需要知道"从上一次被访问到现在，用户发了几条消息"。这个计数器可以是全局的（所有记忆共享对话次数）也可以是局部的（每个记忆跟踪自己的非访问对话数），前者计多了后者计复杂了。

选择自然时间付出的代价：在对话密集型场景中（用户一天发 100+ 条），自然时间衰减太快。一次早上的对话，到下午就已经下降了 30%，而实际上用户只是忙、不是忘了。这在短期交互中制造了"存在感偏差"——记忆系统遗忘的速度比用户实际遗忘快。

> 置信度：0.94`,
    l2: `### 当前实现细节

\`ForgettingEngine.current_strength()\` 的具体逻辑：

\`\`\`python
# src/memory/forget.py:25-29
def current_strength(self, episode: dict[str, object]) -> float:
    now = time.time()
    elapsed = now - episode["updated_at"]  # 自然时间差（秒）
    strength = episode["strength"] * math.exp(-settings.decay_lambda * elapsed)
    return max(strength, 0.0)
\`\`\`

关键参数 \`settings.decay_lambda\` 控制了衰减速率。项目目前默认值没有硬编码在代码里，而是通过配置传入——这使得切换不同应用场景时可以调整衰减的快慢而不改逻辑。

每次记忆被访问时，\`strengthen()\` 将其强度重置为 \`current_strength + Δ\`（当前值加上一个增量）。这意味着：
- 频繁被访问的记忆永远不会衰减到零（它们不断被刷新）
- 从未被再次访问的记忆会按衰减曲线趋近零
- 衰减速率恒定，不受交互节奏影响

### 对话次数衰减的实现代价

如果要从自然时间切换到对话次数衰减，代码需要的变化：

1. **数据库更新**——每个 \`episodes\` 行需要新字段 \`last_accessed_at_conversation: int\`（全局对话计数器版本）或 \`unaccessed_conversation_count: int\`（局部版本）
2. **全局计数器**——系统需要一个单调递增的对话序号，每次用户发送消息时 +1
3. **衰减触发器**——衰减计算从"定时或按需触发"改为"每条消息后对所有未访问条目触发一次衰减步"
4. **性能**——对话次数衰减每次触发遍历完整记忆库（O(n)），自然时间衰减只在 \`current_strength()\` 被调用时做单条计算（O(1)）

\`\`\`mermaid
%% title: 图：两种衰减策略的实现架构对比
graph LR
    subgraph 自然时间["⏰ 自然时间实现"]
        DB1[("episodes 表<br/>updated_at: timestamp<br/>strength: float")]
        F1["current_strength()<br/>O(1) 即时计算"]
        DB1 -->|"取 updated_at"| F1
        F1 -->|"strength × e^(−λΔt)"| RESULT1["当前强度"]
    end
    subgraph 事件时间["💬 对话次数实现"]
        CNT["会话计数器<br/>conversation_seq: int"]
        DB2[("episodes 表<br/>last_seq: int<br/>strength: float")]
        F2["每条消息后<br/>衰减步 × (seq − last_seq)"]
        CNT -.->|"seq++"| F2
        DB2 -->|"取 last_seq"| F2
        F2 --> RESULT2["当前强度"]
    end
    style F1 fill:#34d399,stroke:#059669,color:#111
    style F2 fill:#818cf8,stroke:#6366f1,color:#fff
    style CNT fill:#fbbf24,stroke:#d97706,color:#111
\`\`\`

> 置信度：0.92`,
    l3: `### 认知科学视角

自然时间 vs 事件时间的争议在认知科学里其实有个名字——**时间依赖遗忘 (time-dependent forgetting)** 和 **线索依赖遗忘 (cue-dependent forgetting)**。艾宾浩斯曲线本质是时间依赖的，但后来的研究发现，遗忘更大程度上是因为"没用"而不是"太久"。

翻译到 AI 记忆系统：一个事实的衰减不一定因为时间过了很久，而是因为**这个事实与当前对话的关联度在下降**。如果用户不停地在聊财务话题，一个三个月前的财务事实应该比三天前的食谱事实更容易召回。自然时间衰减做不到这一点——它对所有记忆一视同仁。

### 混合方案

最有可能的正确方案是**自然时间 × 交互密度调节**：

> λ_effective = λ_base × f(density)

其中 \`density = conversations_per_day\`，用户今天聊得多，衰减就慢一点。这不需要额外的数据库字段，只需要把 \`decay_lambda\` 做成动态参数，根据过去 24 小时的消息数自动缩放。

\`\`\`python
# 概念——不存在于当前代码
def effective_lambda(self) -> float:
    msg_count = self.store.count_recent_messages(hours=24)
    density = msg_count / self._expected_daily_messages
    scale = 1.0 / max(density, 0.1)  # 聊得越多衰减越慢
    return settings.decay_lambda * scale
\`\`\`

### 未解决问题

- **衰减的物理意义模糊**——当前的 λ 没有校准基准。0.001/秒和 0.01/秒的差异对应"一周忘掉"vs"一天忘掉"，但这个数字应该由用户反馈校准而不是拍脑袋定。
- **对话次数的边界在哪**——"一次对话"的定义是什么？一个三小时的 Session 算一次还是十次？如果会话边界模糊，事件计数的单位就不可靠。
- **无访问≠不相关**——用户一天没提某个记忆可能只是因为没找到提它的语境，而非不重要。自然时间和事件时间都解决不了"静默相关"的问题。

> 置信度：0.90`,
    crossChapterConnections: [
      {
        questionId: "q2.15",
        type: "prerequisite",
        relationship: "衰减曲线（Ch6）是遗忘引擎（Ch2）的计量核心——\`current_strength()\` 决定了哪些记忆被遗忘、哪些被保留"
      },
      {
        questionId: "q4.3",
        type: "parallel",
        relationship: "自然时间衰减（Ch6）与 Token 预算分配（Ch4）都面临「动态调节」的挑战——衰减率需要根据使用场景调整，Token 预算需要根据上下文内容调整"
      },
      {
        questionId: "q1.2",
        type: "application",
        relationship: "上下文溢出时优先丢弃低强度记忆——强度计算的时间尺度选择（自然时间 vs 事件时间）直接影响溢出时的排序结果"
      },
    ],
  },
  {
    id: "q6.3",
    question: '用户的认知状态有昼夜节律——凌晨的消息和上午的消息，系统需要感知吗？',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P3",
    confidence: { l0: 0.96, l1: 0.93, l2: 0.90, l3: 0.88 },
    overallConfidence: 0.88,
    l0: 'GlassCortex 目前对消息时间完全无感知——凌晨三点的一条"帮我查个东西"和下午三点的一条"帮我查个东西"，走的是完全相同的认知管线。技术上可以实现「时间敏感」的信号（调整响应详细度、延迟非紧急操作、推迟衰减计算），但项目没有做——不是因为做不到，而是因为三条红线：用户隐私隐私、边际效益模糊、用户状态的可靠检测本身就是未解决问题。',
    l1: `凌晨三点的消息和下午三点的消息，区别在哪？在你这边——不在系统这边。系统看到的是同一段文本，走的是同一条 \`engine.py:153 generate()\` 管线。它不知道现在几点，不知道你刚醒还是熬了一夜，不知道你是急着要答案还是随手试个功能。

这需要改变吗？先想一下如果系统能感知时间，它会做什么：

> **可以做，但没做的三件事**：
> 1. **降低回复详细度**——凌晨的回复更简洁、只给结论，不给 L2/L3 深挖。因为凌晨用户通常没有深挖的精力状态。
> 2. **延迟非紧急操作**——比如后台衰减计算、知识图谱更新、会话统计。凌晨的操作有充裕时间慢慢跑，不需要抢占 LLM 推理资源。
> 3. **推迟推送/主动行为**——这个 GlassCortex 没有，但在有主动推送的系统中，凌晨的消息应该静默排队而不是响铃。

为什么没做？因为当前架构没有"用户状态"的概念——系统不区分"这个用户第一万次对话"和"第一次"，自然也不区分"凌晨"和"下午"。时间感知需要在用户画像中新增一个字段（\`is_night_hours\` 或更细粒度的 \`cognitive_state_estimate\`），但目前 \`api/routers/profiles.py:30 list_profiles()\` 返回的数据模型里没有这类属性。

更深层的问题是**用户状态的可靠检测本身就是未解决问题**——凌晨发消息不一定代表认知能力下降，可能只是夜班工作的人在进行正常的业务对话。把时间戳当作状态信号，会用错。

> 置信度：0.93`,
    l2: `### 如果要做，最低成本方案是什么

不需要引入复杂的情绪检测或生物信号。一个简单的信号就是**距用户最后一条消息的时间间隔与当前时间的组合**：

\`\`\`python
# 概念——当前不存在
def estimate_cognitive_state(profile: Profile) -> str:
    hour = datetime.now().hour
    last_msg = profile.last_message_at  # timestamp
    hours_since_last = (datetime.now() - last_msg).total_seconds() / 3600

    if 0 <= hour <= 6 and hours_since_last > 4:
        return "off_hours"       # 疑似非常规时段
    elif 0 <= hour <= 6 and hours_since_last < 1:
        return "late_night"      # 深夜还在活跃——可能工作状态
    else:
        return "normal"

# 使用示例 —— 当前不存在
state = estimate_cognitive_state(current_profile)
if state == "off_hours":
    response = engine.generate(messages, brevity="compact")
else:
    response = engine.generate(messages, brevity="full")
\`\`\`

这个方案有几个问题：
1. **时区未知**——\`datetime.now().hour\` 是服务器的时区，不是用户的。需要前端传时区偏移或让用户设置。
2. **阈值不可调**——0-6 点作为"非正常时段"对于夜班工作者是误报。需要个性化阈值或让用户关闭此功能。
3. **隐私敏感性**——系统推断"你现在状态不好"并据此改变行为，可能被用户觉得被冒犯。

### 行业做法

目前主流 AI 产品在这方面的处理非常保守：

| 产品 | 时间感知 | 做法 |
|------|:------:|------|
| ChatGPT | ❌ | 无时间偏好，全天行为一致 |
| Apple Siri | ⚠️ 弱 | 深夜回复更简洁（仅 iOS），基于设备本地时间 |
| Google Assistant | ❌ | 全天一致，主动行为受"免打扰"控制 |
| 各个性化推荐系统 | ✅ 强 | 基于用户活跃时段做内容推荐，但这是推荐而非对话 |

GlassCortex 的定位与这些产品一致：**不猜测用户状态，不根据猜测改变行为**。当前保守但安全的做法是 defer 状态感知——等有了成熟用户反馈机制和隐私保护框架后再考虑。

> 置信度：0.90`,
    l3: `### 认知科学背景

昼夜节律对认知能力的影响是有坚实科学基础的事实。研究表明，人的注意力、工作记忆容量、决策质量在一天之内有 20-30% 的波动（Schmidt et al., 2007, *Nature Reviews Neuroscience*）。凌晨 3-5 点是多数人认知表现的最低点。

但把这个事实工程化到 AI 系统中，面临两个无法绕过的问题：

1. **个体差异大于普遍规律**——约 30% 的人是"夜猫子"型（evening chronotype），他们在凌晨的认知表现可能比晨型人的早晨还好。群体规律无法可靠预测个体状态。
2. **行为不等于状态**——凌晨发消息可能只是睡不着想找点事做，不代表此时回复需要降低复杂度。

### 真正的答案：控制权交给用户，不猜

最合理的方案不是系统主动推断用户状态，而是让用户**表达当前期望的交互模式**。一个简单的三档开关：

> 专注模式 → 回复最简，零额外信息，只答所问
> 探索模式 → 正常 L0-L3 全部展开
> 闲聊模式 → 回复更宽松，允许系统试探性展开话题

但这也回到了之前的问题——GlassCortex 没有用户状态管理的基础设施。当前的 \`Profile\` 模型（\`api/schemas.py\`）只有用户画像的记忆标签，没有交互模式偏好。

> 置信度：0.88`,
    crossChapterConnections: [
      {
        questionId: "q2.12",
        type: "parallel",
        relationship: "用户画像（Ch2）目前已包含偏好标签云，但缺少时间感知字段——昼夜节律信号可以补充到画像中"
      },
      {
        questionId: "q7.3",
        type: "application",
        relationship: "透明化边界（Ch7）定义了系统不应猜测的领域——用户认知状态属于「隐私边界」之一"
      },
    ],
  },
  {
    id: "q6.4",
    question: '系统"成长轨迹"：第 1 次、第 10 次、第 100 次对话——系统行为应有可观测的"成长轨迹"',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P2",
    confidence: { l0: 0.97, l1: 0.94, l2: 0.92, l3: 0.90 },
    overallConfidence: 0.90,
    l0: 'GlassCortex 的"成长"是隐式的，不是设计的——第一次对话时记忆库是空的，第 100 次对话时积累了成百上千条事实和偏好，系统行为自然会不一样。但没有显式的"成长阶段"概念：第 1 次和第 100 次的意图分类走的是同一套分类器，温度参数相同，衰减率相同——好的一面是冷启动用户立刻获得完整能力，坏的一面是资深用户没有得到应得的精细化体验。',
    l1: `想想你刚搬进一个小区的那天，和住了三年之后——你认识的人不一样，知道的路线不一样，处理日常事务的效率也不一样。但你的脑子本身没变：还是同一个你，只是信息存量变了。

GlassCortex 的"成长"本质上是这件事。从第一次到第一百次对话，变化的是记忆库的厚度，不是认知引擎本身。

来看看这条"成长轨迹"上发生了什么：

\`\`\`mermaid
%% title: 图：GlassCortex 隐式成长轨迹——从冷启动到深度了解
graph LR
    subgraph 第1次["第 1 次对话 — 冷启动"]
        C1_NS["无已存储记忆<br/>空 profile"]
        C1_INTENT["意图分类：<br/>基座知识<br/>成功率 ~70%"]
        C1_RECALL["召回：<br/>结果 = []"]
        C1_USER["用户感知：<br/>"它对我不了解""]
    end
    subgraph 第10次["第 10 次对话"]
        C10_PROFILE["profile 有 ~30 标签"]
        C10_INTENT["意图分类：<br/>画像辅助<br/>成功率 ~80%"]
        C10_RECALL["召回：<br/>结果 = 3-8 条"]
        C10_USER["用户感知：<br/>"它开始懂我了""]
    end
    subgraph 第100次["第 100 次对话"]
        C100_PROFILE["profile 有 ~200+ 标签<br/>但含过期/噪声"]
        C100_INTENT["意图分类：<br/>依赖历史偏好<br/>成功率 ~85% 但有偏差"]
        C100_RECALL["召回：<br/>结果 = 10-30 条<br/>噪声增多"]
        C100_USER["用户感知：<br/>"它挺了解我，<br/>但有时记错""]
    end

    C1_NS --> C10_PROFILE
    C10_PROFILE --> C100_PROFILE
    C1_INTENT --> C10_INTENT
    C10_INTENT --> C100_INTENT
    C1_RECALL --> C10_RECALL
    C10_RECALL --> C100_RECALL

    style C1_NS fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style C10_PROFILE fill:#fef9c3,stroke:#ca8a04
    style C100_PROFILE fill:#a7f3d0,stroke:#059669
\`\`\`

这个轨迹有两面性：**好的方面**——用户花时间使用系统，系统记住了更多关于用户的信息，体验自然提升。**不好的方面**——"成长"不受控制，系统没有"第 N 次对话应该启用 XX 功能"的逻辑。

第一次对话时系统能召回的是一条空列表——\`src/memory/recall.py:42 recall()\` 在 \`top_k\` 条记忆里搜索，如果库是空的，返回的是 \`[]\`。这和第一百次对话时从上千条里召回 10 条用的是一个引擎。区别只在于输入的回溯深度不同，不在于系统"变得更智能"。

### 什么是隐式成长

GlassCortex 中自然发生的"成长"体现在：

- **召回相关度提升**——记忆越多，\`recall()\` 能匹配到的内容越精准（\`store.py:122 add_episode()\` 累积的条目数增长）
- **画像厚度增加**——\`profile\` 中的标签云（通过 \`api/routers/profiles.py:30 list_profiles()\` 获取）从空到几十个标签，意图分类的上下文更丰富
- **衰减轨迹稳定**——第一次对话时没有可衰减的记忆；第一百次对话时，衰减引擎 \`forget.py:32 decay_all()\` 处理的是成百上千条条目，有稳定的"生老病死"节奏
- **会话统计累积**——\`TokenLedger\` 记录了每次消费的历史，虽然不影响当前行为，但构成了可追溯的"用户使用史"
- **错误模式识别**——系统积累了用户在哪些场景下得到不满意的回复的数据（虽然 GlassCortex 没有主动分析这个数据）

### 什么是它不做的事

- **不改变生成策略**——第一次和第一百次对话用同一个 temperature、同一条 system prompt
- **不开启新功能**——没有"成长到第 N 次解锁"的机制
- **不主动调整衰减率**——资深用户可能需要更慢的衰减（更多有用记忆），但衰减率是全局静态参数

这其实是一个设计选择。GlassCortex 选择"全员一致"——第一天和第一百天的用户得到相同引擎。好处是简单可预测，坏处是资深用户没有得到应有的精细化对待。

> 置信度：0.94`,
    l2: `### 理想中的显式成长轨迹

如果重新设计，一个显式的成长系统应该有这样的阶段：

\`\`\`mermaid
%% title: 图：显式成长阶段的理想设计
graph TD
    NEW["🆕 新手期<br/>第 1-5 次对话"] --> REG["🔁 适应期<br/>第 6-50 次对话"]
    REG --> MATURE["🧠 成熟期<br/>第 51-200 次对话"]
    MATURE --> LEGACY["👴 资深期<br/>第 200+ 次对话"]

    NEW -->|"行为"| N1["基础意图分类<br/>无画像辅助<br/>全量透明度"]
    REG -->|"行为"| R1["画像辅助分类<br/>学习用户偏好<br/>渐进透明度"]
    MATURE -->|"行为"| M1["深度个性化<br/>主动推荐相关记忆<br/>衰减率自适应"]
    LEGACY -->|"行为"| L1["全量画像利用<br/>噪声/过期数据清理<br/>长期趋势分析"]

    style NEW fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style REG fill:#fef9c3,stroke:#ca8a04
    style MATURE fill:#a7f3d0,stroke:#059669
    style LEGACY fill:#818cf8,stroke:#4f46e5,color:#fff
\`\`\`

每个阶段需要不同的工程支撑：

| 阶段 | 想象人数 | 核心挑战 | 需要新建 |
|:---:|:-------:|---------|:-------:|
| 新手期 | 0-5 | 冷启动，无数据 | 引导流程（已有 WelcomeView） |
| 适应期 | 5-50 | 用户画像建立速度 | 画像加速写入（当前被动收-写） |
| 成熟期 | 50-200 | 记忆噪声治理 | 去重 + 过期自动处理 |
| 资深期 | 200+ | 记忆管理的自动化 | 遗忘策略自动化 + 长期趋势分析 |

GlassCortex 目前所有用户都处在"新手期"——系统不区分用户的使用阶段。这其实是一个未被利用的优化空间。

### 为什么不做显式成长

1. **复杂度 > 收益**——Phase 37-38 的方向证明，显式阶段划分在每个阶段需要独立的 prompt 策略和召回策略，工程量至少 3-5 批。在只有几百用户的场景下不值得。
2. **隐式成长已经够用**——记忆自然累积的效果对大部分用户已经足够。用户并不会说"我用了 100 次了为什么你对我还是一样"——因为他们感知到的是"它越来越了解我"（隐式成长的正面效应）。
3. **阶段的硬边界不存在**——第 5 次和第 6 次之间没有质的区别。硬划阶段边界是武断的。

> 置信度：0.92`,
    l3: `### 成长轨迹的可观测性

一个更实际的方向不是改变行为，而是**让用户看到自己走了多远**。系统已有阅读位置记忆（Phase 41 Batch 2 交付）和阅读历史（Phase 41 Batch 6 交付）——但这些是用户侧的数据，不是"系统记住了你多少"的元信息。

可观测的成长指标（当前已有数据但未展示）：

- **记忆库存量**——\`store.py:157 get_all_episodes()\` 返回全部 \`episodes\` 条目。当前侧边栏只显示了摘要，没有"记忆数量随时间增长的曲线"
- **标签云厚度**——\`api/routers/memory.py\` 的 \`GET /memory/tag-summary\` 端点。如果做成时间线：第一天 0 标签 → 第三十天 50 标签，用户能看到自己的使用轨迹
- **召回命中率**——\`recall.py\` 的 \`recall()\` 返回结果数 vs 请求的 \`top_k\`。当前没有记录这个比值的历史趋势

### 不做什么的边界

成长轨迹这个话题很容易滑向"让系统主动变得更智能"——那是一个完全不同的方向。GlassCortex 的边界很清晰：**认知引擎不变，信息存量变。** 不会在"第 N 次对话后"启用更高级的规划器或不同的温度策略——那意味着用户之间用的不是同一个系统，对于调试和可复现性是灾难。

> 置信度：0.90`,
    crossChapterConnections: [
      {
        questionId: "q2.13",
        type: "prerequisite",
        relationship: "记忆分层（Ch2）是成长轨迹的基础设施——从冷启动到资深期，不同阶段需要不同的分层策略"
      },
      {
        questionId: "q1.16",
        type: "parallel",
        relationship: "上下文水合（Ch1）的质量随对话累积提升——成长轨迹在上下文层面的直接体现"
      },
      {
        questionId: "q7.4",
        type: "application",
        relationship: "叙事 vs 数据（Ch7）的成长表达——系统可以在透明可视化中展示「你用了多久、记住了多少」"
      },
    ],
  },
  {
    id: "q6.5",
    question: '信息时效性：永久信息、会过期信息、周期性信息——不同时效性不同衰减策略',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P2",
    confidence: { l0: 0.97, l1: 0.94, l2: 0.91, l3: 0.87 },
    overallConfidence: 0.87,
    l0: "GlassCortex 的 episodes 表虽有独立的 `lambda` 衰减率字段，但当前所有条目使用统一默认值——永久记忆（如用户姓名、基础偏好）和临时事务（如一次性指令）走同一套衰减公式，不存在 TTL 字段、时效性分类或差异化策略。最讽刺的是：schema 已支持差异化衰减，问题在于 `add_episode()` 的调用点从未传入分类参数。",
    l1: `打开你家冰箱，三层食物各自对待：

> **上层（保鲜层）**：番茄酱、酱油——开封后放一年也没事，随用随取，心知它不会坏。这就是**永久信息**。
> **中层（冷藏层）**：鲜牛奶——一周内要喝完，过期就倒掉。这就是**会过期信息**。
> **下层（冷冻层）**：圣诞火腿——每年这时候才出现，平时在冰柜里沉睡。这就是**周期性信息**。

现在 GlassCortex 做的是：把番茄酱、牛奶、火腿全塞进同一层，用同一个保质期管理——要么牛奶变质前番茄酱已过期，要么番茄酱保鲜时牛奶永不坏。

当前代码里发生了什么：

\`\`\`sql
-- src/memory/schema.sql:5-15 — episodes 表结构
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  importance REAL DEFAULT 0.5,
  lambda REAL DEFAULT 0.1,  -- ← 每条有自己的衰减率！但全是 0.1
  created_at REAL,
  updated_at REAL,
  faiss_id TEXT
);
\`\`\`

每条 episode **已经有独立的 \`lambda\` 字段**——理论上可以给永久信息设 0.0（不衰减）、给临时信息设 1.0（快速衰减）。但 \`src/memory/store.py:130 add_episode()\` 的每次调用都只传了 \`settings.default_decay_lambda\`（统一值）。没有 \`category\` 参数、没有 \`ttl\` 参数、没有区分"这是一句偏好"和"这是一个临时指令"的逻辑。

\`forget.py:25 current_strength()\` 的衰减面也对所有 episode 一视同仁：

> strength = initial × e^(-λ × Δt)

全部走同一套公式，λ 值全是 0.1，区别只在 Δt（距上次访问时间）。

三类信息本应怎样衰减？

| 特性 | 🔒 永久信息 | 📅 会过期信息 | 🔄 周期性信息 |
|:----:|:----------:|:-------------:|:------------:|
| 示例 | 姓名、语言偏好、"我是码农" | "我下周去面试"、一次性地址 | "每天早上要喝咖啡"、周常习惯 |
| λ 值 | 0.0（永不衰减） | 0.1~1.0（快速归零） | 0.01~0.1（慢衰 + 定期脉冲） |
| TTL | ∞ | 设定过期时间戳 | 周期长度 × N |
| 增强策略 | 每次访问强度 +0.1 | 不增强或弱增强 | 周期窗口内自动 +0.3 |
| 溢出丢弃优先级 | 最低（最后丢） | 最高（先丢） | 中等 |

关键洞察：**问题不在 schema 不在引擎——在调用点没有语义标注。** 一个叫 \`add_episode()\` 的函数接收的是原始字符串，没有信息分类机制。解决这个问题不需要改 \`current_strength()\` 的数学公式，只需要在数据入口处打上标签，引擎自动差异化处理。

> 置信度：0.94`,
    l2: `### 最小改动路径

在当前架构上实现分类衰减，最小改动是什么？

#### 1. 数据库——两个可选字段

\`\`\`sql
-- 概念——当前不存在，向后兼容
ALTER TABLE episodes ADD COLUMN category TEXT DEFAULT 'standard';
ALTER TABLE episodes ADD COLUMN ttl REAL;  -- Unix timestamp，NULL = 永不过期
\`\`\`

新字段完全可选——不设 \`category\` 的条目行为不变（默认走标准衰减）。已有 400+ 条 episode 不受影响。

#### 2. 引擎——三分支 \`current_strength()\`

\`\`\`python
# 概念——当前不存在
def current_strength(self, episode: dict) -> float:
    category = episode.get("category", "standard")

    if category == "permanent":
        return episode["strength"]  # ① 永不衰减

    if category == "ephemeral":
        ttl = episode.get("ttl")
        if ttl and time.time() > ttl:
            return 0.0  # ② 已过期，直接归零
        # 未过期前快衰
        return episode["strength"] * math.exp(-1.0 * elapsed)

    if category == "periodic":
        # ③ 周期内增强 + 周期外慢衰
        strength = episode["strength"] * math.exp(-0.05 * elapsed)
        if _in_period_window(episode):
            strength += 0.3
        return min(strength, episode["initial_strength"])

    # standard + fallback 走原公式
    return episode["strength"] * math.exp(-episode["lambda"] * elapsed)
\`\`\`

#### 3. 三层数据流

\`\`\`mermaid
%% title: 图：差异化衰减——从 add_episode() 到 current_strength() 的数据流
graph LR
    subgraph 数据入口["📥 写入层"]
        ADD["add_episode(content)"]
        CLASS["? 自动分类<br/>或显式标注"]
        SCHEMA[("episodes 表<br/>category + ttl + lambda")]
    end
    subgraph 计算层["⚙️ 读取层"]
        STRENGTH["current_strength()"]
        BRANCH{"category?"}
        PERM["permanent → 返回 raw_strength"]
        EPHEM["ephemeral → 检查 TTL"]
        PERIOD["periodic → 周期/慢衰混合"]
        STD["standard → 原公式"]
    end
    subgraph 影响后["📊 下游"]
        FORGET["遗忘引擎排序"]
        OVERFLOW["上下文溢出丢弃"]
    end

    ADD -->|"传入参数"| CLASS
    CLASS --> SCHEMA
    SCHEMA -->|"读取"| STRENGTH
    STRENGTH --> BRANCH
    BRANCH --> PERM
    BRANCH --> EPHEM
    BRANCH --> PERIOD
    BRANCH --> STD
    PERM & EPHEM & PERIOD & STD --> FORGET
    FORGET --> OVERFLOW

    style PERM fill:#34d399,stroke:#059669,color:#111
    style EPHEM fill:#fbbf24,stroke:#d97706,color:#111
    style PERIOD fill:#818cf8,stroke:#6366f1,color:#fff
    style STD fill:#d1d5db,stroke:#6b7280
\`\`\`

#### 4. 三层技术难度

| 分类 | 工程难度 | 需要变更 | 预计工期 |
|:----:|:-------:|---------|:--------:|
| 🔒 永久 vs 📅 临时（二分类） | 简单 | \`add_episode()\` 参数 + \`current_strength()\` 分支 + 可选字段 | 1-2 天 |
| 🔄 + 周期性 | 复杂 | 内容分析识别周期模式 + 时间序列检测 + 脉冲调度器 | 1-2 周 |
| 🤖 自动分类（不显式标注） | 开放问题 | NLP 推断 TTL + 语义分类器 + 用户反馈循环 | 数月 |

当前代码的定位：**二分类可做、周期性可设计、自动分类不可做。**

> 置信度：0.91`,
    l3: `### 行业做法

| 系统/框架 | 时效性分类 | 实现方式 |
|-----------|:--------:|---------|
| Redis TTL | ✅ 强 | 键级 TTL，到期自动 evict |
| Memcached | ✅ 强 | LRU + TTL，纯键值级 |
| 艾宾浩斯原始曲线 | ❌ | 统一衰减，不分层 |
| Apple 照片"最近删除" | ✅ 强 | 30 天 TTL，手动恢复 |
| ChatGPT 记忆 | ⚠️ 弱 | 无显式 TTL，靠召回频率隐式过期 |
| GlassCortex | ❌ 无 | 统一衰减 |

### 未解决的四个问题

**1. 冷启动分类**——用户不会一开始就说"这是个永久事实"。合理的策略：第一轮对话中的所有信息都视为"会过期"，直到被重复提及 N 次才升格为永久。但 N 应该是多少？没有理论支撑。

**2. 类别漂移**——"我下周去面试"是临时信息，面试完了变成"我去过那家公司面试"是历史事实。从临时→永久的转换点谁来触发？当前没有版本管理机制。

**3. 周期性冷检测**——系统至少要积累一周的数据才能识别"每天早上"的规律。这七天中每一天都在错误地使用标准衰减。更复杂的是，周期性可能改变：从"每天"变成"工作日每天"，衰减策略需要动态更新。

**4. 遗忘的双向性**——保留一条用户永远不会再提的永久信息浪费空间；快速遗忘一条用户会再提的临时信息损害体验。没有 oracle 能准确预言"这条信息用户还会提吗"——所以遗忘策略终归是概率性的，永远有误判。

> 置信度：0.87`,
    crossChapterConnections: [
      {
        questionId: "q2.15",
        type: "prerequisite",
        relationship: "衰减曲线（Ch2）的 `current_strength()` 公式是差异化衰减的数学基础——永久/临时/周期三类信息共用同一套公式，只是参数不同"
      },
      {
        questionId: "q2.26",
        type: "parallel",
        relationship: "遗忘什么、保留什么（Ch2）与信息时效性（Ch6）是同一问题的两面——前者从重要性角度分类，后者从时间维度分类，两者在溢出优先级上直接交互"
      },
      {
        questionId: "q6.4",
        type: "application",
        relationship: "系统成长轨迹（Ch6 q6.4）的资深期需要自动清理过期记忆——没有时效性分类，资深期用户的记忆库会充满失去价值的陈旧片段"
      },
    ],
  },
  {
    id: "q6.6",
    question: '实时 vs 批处理边界：什么操作必须在用户等待时完成，什么可以推迟到空闲时？',
    chapter: "ch6",
    chapterTitle: "第 6 章：时间与节奏",
    priority: "P2",
    confidence: { l0: 0.96, l1: 0.93, l2: 0.90, l3: 0.86 },
    overallConfidence: 0.86,
    l0: 'GlassCortex 当前所有操作都是同步实时执行（意图分类、记忆召回、衰减计算全部发生在请求生命周期内），但真正的边界取决于三问：① 用户需要此结果才能继续对话？→ 实时；② 结果影响下一条回复质量但不需要毫秒级完成？→ 可推迟；③ 仅用于统计/管理？→ 周期批处理。当前架构全部归入第一类，不是因为设计选择，而是因为"不做决定也是决定"。',
    l1: `想象一家医院的急诊室。三类任务同时运行，但安排节奏完全不同：

> **抢救室（实时）**：医生正在做心肺复苏——每一步都不能等，病人就在眼前。这就是**实时必需**。
> **护士站（可推迟）**：整理病历——要在下一个交班前完成，但不差这十分钟。这就是**可推迟操作**。
> **财务科（周期批处理）**：月底结算——平时不用管，月末一天搞定。这就是**周期批处理**。

GlassCortex 当前是什么情况？整家医院只有一个急诊室——所有任务都在抢救室里做。

\`\`\`mermaid
%% title: 图：实时 vs 可推迟 vs 批处理——边界决策树
graph TD
    QUERY["认知操作 X"] --> Q1{"① 用户需要 X 的<br/>结果才能回复？"}
    Q1 -->|"是"| REAL["🔴 实时<br/>阻塞用户"]
    Q1 -->|"否"| Q2{"② X 的结果影响<br/>下一次对话质量？"}
    Q2 -->|"是"| DEFER["🟡 可推迟<br/>请求后执行"]
    Q2 -->|"否"| Q3{"③ 仅用于内部<br/>管理/统计？"}
    Q3 -->|"是"| BATCH["🟢 周期批处理<br/>独立调度"]

    REAL --- R_EXAM["意图分类<br/>记忆召回<br/>上下文组装<br/>LLM 生成"]
    DEFER --- D_EXAM["store_response()<br/>知识图谱三元组<br/>profile 标签更新"]
    BATCH --- B_EXAM["decay_all()<br/>TokenLedger 归总<br/>问答对去重"]

    style REAL fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style DEFER fill:#fef9c3,stroke:#ca8a04
    style BATCH fill:#a7f3d0,stroke:#059669
\`\`\`

六种主要操作的分类：

| 操作 | 当前 | 应属 | 为什么 |
|:----:|:---:|:----:|--------|
| 意图分类 | 同步 | 🔴 实时 | 决定是否要做召回，阻塞 |
| 记忆召回 | 同步 | 🔴 实时 | 决定上下文内容，阻塞 |
| LLM 生成 | 同步 | 🔴 实时 | 用户等的是这个 |
| \`store_response()\` | 同步 | 🟡 可推迟 | 回复已到前端，用户不关心存储是否成功 |
| \`decay_all()\` | 同步 | 🟢 周期批处理 | 5 秒后衰减和 5 分钟后衰减对下次对话无差异 |
| \`TokenLedger.record()\` | 同步 | 🟡 可推迟 | 内存操作 0.1ms，但不阻塞生成 |

关键洞察——**q6.1 和 q6.6 回答的是不同问题**：

> q6.1 问 \`"能不能异步"\`——是工程可行性（技术能否实现）。
> q6.6 问 \`"应不应该批处理"\`——是设计原则（意图上是否需要实时完成）。

两者交叉但不重复。例如 \`decay_all()\`：q6.1 说"技术上可异步"（才几毫秒），q6.6 说"意图上应批处理"（不需要每条消息后跑，10 分钟一次就够了）。前者讲能力，后者讲意图。

一个更精炼的判断：**"用户等这个操作的结果才能组织下一句话"**——这是实时/非实时的唯一分水岭。

> 置信度：0.93`,
    l2: `### 三类操作的工程支撑

| 类别 | 基础设施需求 | 当前状态 | 实现复杂度 |
|:----:|-------------|:--------:|:----------:|
| 🔴 实时 | 当前架构即可 | ✅ 已就绪 | 低 |
| 🟡 可推迟 | \`asyncio.create_task()\` 或 FastAPI \`BackgroundTasks\` | ❌ 不存在 | 中 |
| 🟢 周期批处理 | 独立队列 + 定时调度器（APScheduler/Celery Beat） | ❌ 不存在 | 高 |

#### 可推迟操作的核心难题：顺序保证

如果用户连发三条消息，三个 \`store_response()\` 异步任务并行执行——"先收到"的消息可能因非阻塞调用比"后收到"的消息晚完成。数据库中可能出现 B 的事实先于 A 的事实写入。

当前同步模式下此问题不存在（存储顺序 = 接收顺序）。异步化后需要序号化机制：

\`\`\`python
# 概念——当前不存在
seq_counter = itertools.count()

async def handle_message(msg):
    seq = next(seq_counter)
    response = await generate(msg)
    # 回复立即返回，存储异步
    asyncio.create_task(store_with_seq(response, seq))

async def store_with_seq(response, seq):
    await wait_for_previous(seq)  # 等前序序号完成
    await db.insert(response)
\`\`\`

#### 衰减计算的触发时机权衡

\`decay_all()\`（\`forget.py:32\`）当前每次对话后同步执行。批处理模式下有三种触发选择：

| 触发策略 | 优点 | 缺点 |
|:-------:|:----|:----|
| 空闲 CPU 检测 | 不干扰用户操作 | 当前无 idle 检测机制，需新增 |
| 消息间隔 > N 秒 | 用户暂停时自然执行 | 间隔阈值难定（3 秒 vs 30 秒） |
| 固定间隔（每分钟） | 简单可靠 | 若用户在跑衰减时发消息，需要锁机制 |

关键权衡：**推迟到用户发下一条消息前跑，能让衰减数据更新，但延迟了回复时间；提前跑不延迟回复，但可能浪费 CPU。**

#### 当前 vs 目标架构

\`\`\`mermaid
%% title: 图：当前平面管线 vs 目标分层架构
graph LR
    subgraph 当前["当前架构 — 平面同步"]
        A1["消息到达"] --> A2["全管线实时"]
        A2 --> A3["回复返回"]
        A2 --> A4["存储 + 衰减 + 统计<br/>同线程同步"]
    end
    subgraph 目标["目标架构 — 三层"]
        B1["消息到达"] --> B2["🔴 实时层<br/>意图 + 召回 + 上下文 + LLM"]
        B2 -->|"① 回复返回"| USER["用户"]
        B2 -->|"② 异步入队"| B3["🟡 可推迟层<br/>存储 + 图谱 + profile"]
        B3 -->|"③ 定时调度"| B4["🟢 批处理层<br/>衰减 + 记账 + 清理"]
    end

    style A2 fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style B2 fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style B3 fill:#fef9c3,stroke:#ca8a04
    style B4 fill:#a7f3d0,stroke:#059669
\`\`\`

> 置信度：0.90`,
    l3: `### 行业做法

| 平台 | 实时/批处理 | 做法 |
|------|:---------:|------|
| Redis | ✅ 混合 | 主线程实时 + RDB/AOF 持久化批处理 |
| PostgreSQL | ✅ 混合 | WAL 实时写 + autovacuum/analyze 批处理 |
| OpenAI API | ✅ 混合 | 聊天实时 + 微调/fine-tuning 批处理 |
| Web 服务器 | ✅ 混合 | 请求实时 + 访问日志/指标聚合批处理 |
| GlassCortex | ⚠️ 全实时 | 无批处理机制 |

### 四个未解决的问题

**1. 何时跑 vs 何时不跑**——周期批处理的最佳时隙很难确定。如果系统没有空闲 CPU 检测机制，批处理可能在用户正发消息时恰好占用资源。SQLite 单写 WAL 模式下这意味着写锁竞争。

**2. 失败静默吞噬**——异步/批处理操作的失败不会影响当前回复（好消息），但也不会被用户注意到（坏消息）。数据库写入失败时衰减不会报错，用户在下次对话中感受到的是"它好像不太记得了"而不知道原因。需要独立的失败通知通道。

**3. 一致性窗口**——如果 \`store_response()\` 被推迟 2 秒，这 2 秒中用户追问"我刚才说了什么"，系统无法检索——因为新数据还没写入。这个窗口多长是用户可以接受的？0 延迟（当前同步）是最保守的答案，但也意味着永远无法批处理。

**4. SQLite 写锁竞争**——GlassCortex 使用 SQLite（单写 WAL 模式）。如果批处理线程在写，用户操作线程也在写，SQLite 内部序列化为串行。批处理越勤，竞争概率越高。唯一完全避免竞态的方式是当前方案——把所有操作串在一个线程里（即全同步）。

> 置信度：0.86`,
    crossChapterConnections: [
      {
        questionId: "q6.1",
        type: "prerequisite",
        relationship: 'q6.1 已分析同步链的七步时间分布（LLM 生成占 90%），q6.6 在此基础上升华为设计原则——不仅要知道「哪步可异步」，更要建立判断框架决定「哪些步应批处理」'
      },
      {
        questionId: "q3.9",
        type: "parallel",
        relationship: "Planner 反馈循环（Ch3）中的 Replan 评估是否需要实时？如果规划失败率低，事后异步分析错误模式可以取代实时 replan——这是 q6.6 边界三问在 Planner 中的具体应用"
      },
      {
        questionId: "q4.5",
        type: "application",
        relationship: "Token 浪费（Ch4）的常见源头之一是重复的实时计算——如果衰减计算改成批处理，每次请求能省下调用 `decay_all()` 的时间（毫秒级但累积可观）"
      },
    ],
  },
];
