import type { Answer } from "../types";

/** 第 7 章：透明化设计 答案列表 */
export const CH7_ANSWERS: Answer[] = [
  {
    id: "q7.1",
    question: '多视角表述：同一机制如何在开发者/研究者/终端用户不同视角下表述？',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P1",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.90 },
    overallConfidence: 0.90,
    l0: '同一个 AI 机制，三种人看到三个完全不同但同样真实的东西——就像你、修车师傅和汽车设计师看同一台引擎。给用户的画面是「踩油门就走」，给开发者的是「节气门位置传感器→ECU 喷油脉宽→点火提前角」，给设计师的是「扭矩-转速曲线的最佳工况窗口」。都在说同一件事，但说的方式决定了对方能否理解。',
    l1: `假设你造了一栋楼。你骄傲地跟住户说「框架剪力墙结构，抗震设防烈度 8 度」——住户只会露出困惑的表情。但如果你说「这栋楼很安全，8 级地震也不倒」——住户懂了，而且信任你。

这是透明化设计最根本的挑战：**同一个事实，对不同的人说不同的话**——不是隐瞒，而是翻译。

GlassCortex 面对三群读者——终端用户（好奇 AI 怎么工作）、开发者（自己也要造 Agent）、设计师/研究者（想理解透明化的设计原理）。同一套记忆召回系统，给这三种人看三种画面：

| | 👤 终端用户 | 🔧 开发者 | 🔬 研究者 |
|---|------------|-----------|----------|
| 想知道 | AI 为什么记得这件事？ | 召回 pipeline 每一步多少 ms？ | 召回策略的精准度-多样性帕累托前沿？ |
| 画面 | ChatMessage 上下文 lens「我记得你说过喜欢猫」 | ProcessDrawer SQL × FAISS × rank 三段流水线 | Lab 面板不同 λ 下的多样性-精度对比 |
| 载体 | ContextualLens · TokenCostBadge · 欢迎卡片 | ProcessDrawer · OnionPanel L2-L3 · Sidebar 参数面板 | Lab Tab · Mermaid 图 · Architecture.md |

### 同一个机制，三张图纸

以「记忆召回」为例——用户说了一句「我喜欢猫」，系统从记忆库中找到相关事实。三个视角的画风完全不同。

**终端用户看到的：**

一条普通的 ChatMessage，下方有一行小字「我记得你说过喜欢猫🐱」。他点开 ContextualLens 看到一句话：「从上一轮的对话中找到了这条相关记忆。」——够了。用户不需要知道 FAISS 索引、不用知道 MMR 重排、不用知道衰减曲线的 λ 参数。他只需要知道：系统记得，而且知道是怎么记的。

**开发者看到的：**

同一件事情，ProcessDrawer 展开 3 步流水线：

> **步骤 1：SQL 查询** — \`WHERE predicate = '偏好' AND profile = current\` — 2ms
> **步骤 2：FAISS 向量检索** — 检索 top_k=5，余弦相似度 0.87 — 15ms
> **步骤 3：MMR λ=0.5 重排序** — 最终选中 1 条 — 3ms

他关心的是每个环节的耗时、错误率、参数设置。ProcessDrawer 的 Section 1 到 Section 4 就是在回答他的问题——不需要美化，不需要类比，直接给原始数据。

**研究者看到的：**

他打开了 Lab 页的「上下文」Tab，在 RecallRacePanel 里看到了三条检索路线（SQL 纯关键词 / FAISS 纯向量 / MMR 混合）的并排对比：

> | 路线 | 召回率 | 精准度 | 平均延时 |
> |------|:-----:|:-----:|:-------:|
> | SQL | 0.62 | 0.88 | 2ms |
> | FAISS | 0.78 | 0.84 | 15ms |
> | MMR λ=0.5 | 0.74 | 0.92 | 18ms |

研究者看了会点头——原来 MMR 多花了 3ms 换来了 8% 的精准度提升。这个对比是他独有的视角。

\`\`\`mermaid
%% title: 图：同一机制的三视角映射
graph TD
    subgraph "📦 同一事实源: 记忆召回"
    FACT["ApiTrace: 用户说过喜欢猫<br/>SQL + FAISS + MMR"]
    end
    FACT --> U["👤 终端用户"]
    U --> U1["ChatMessage • ContextualLens"]
    U1 --> U2["「我记得你说过喜欢猫」"]
    U1 --> U3["💡 点开: 「从上一轮对话中召回」"]
    FACT --> D["🔧 开发者"]
    D --> D1["ProcessDrawer • OnionPanel L2"]
    D1 --> D2["步骤1 SQL: 2ms<br/>步骤2 FAISS: 15ms<br/>步骤3 MMR: 3ms"]
    D1 --> D3["💰 TokenCostBadge: ≈¥0.03"]
    FACT --> R["🔬 研究者"]
    R --> R1["Lab Tab • Architecture.md"]
    R --> R1A["RecallRacePanel 三路线对比<br/>λ=0.5 vs λ=0.3 差异"]
    R --> R1B["Mermaid 流程图<br/>召回管线全貌"]
    style FACT fill:#6366f1,stroke:#4338ca,color:#fff
    style U fill:#34d399,stroke:#059669,color:#064e3b
    style D fill:#fbbf24,stroke:#d97706,color:#78350f
    style R fill:#60a5fa,stroke:#2563eb,color:#1e3a5f
\`\`\`

### 不是「深浅」，是「不同」

三个视角不是一层比一层深——它们是**不同维度**的展开。终端用户视角回答「能做什么」，开发者视角回答「怎么做的」，研究者视角回答「为什么这么做、还能更好吗」。

OnionPanel 的 L0→L3 递进本质上是一个视角内部的渐进披露，不是视角切换。用户从「系统记得我」（L0）看到「召回来源」（L3），始终站在终端用户的立场上——只是披露深度递增。真正的视角切换发生在跨页面时：Chat 页（用户视角）→ ProcessDrawer（开发者视角）→ Lab 页（研究者视角）。

这正是 Phase 43 labLinks 的设计意图——一条从 Learn 页的桥接按钮，把一个题目对应的 Lab 面板带到用户面前，同时完成了一次视角切换。`,
    l2: `### 三层共享，一层渲染

GlassCortex 的三个视角并非三个独立的数据管线——它们共享同一个真相源：**\`ApiTrace\`**（\`api/schemas.py\`）。这个 dataclass 在设计时并没有刻意考虑多视角，只保留了每一步的原始数据——恰恰因为这个「中立」的设计，它天然支持多视角消费。

\`\`\`python
@dataclass
class ApiTrace:
    prompt_tokens: int
    completion_tokens: int
    total_cost: float
    latency_ms: int
    step: str
    token_breakdown: dict  # chat / intent / fact_extraction
    context_partitions: dict  # system / recall / history / tools
    trace_extras: dict  # 召回详情 / plan 数据
    \# ... 更多字段
\`\`\`

渲染侧的分工：

| 视角 | 消费组件 | 使用的 ApiTrace 字段 | 渲染风格 |
|------|---------|-------------------|---------|
| 终端用户 | OnionPanel L0-L1 · ContextualLens · TokenCostBadge | 摘要字段 + 聚合值 | 自然语言 + 图标 |
| 开发者 | ProcessDrawer · OnionPanel L2-L3 · Sidebar | 完整所有字段 + extras | 表格 + 代码块 |
| 研究者 | Lab 面板 · Mermaid 图 · 文档 | 聚合统计 + 实验对比 | 图表 + 对比参数 |

这种架构的关键在于：**不因为视角不同而复制数据**。同一条 \`ApiTrace\`，Chat 页渲染为 TokenCostBadge 的「≈¥0.03 · 465 token」，Lab 页渲染为 TokenDashboardPanel 的柱状图——展现形式不同，数据来源相同。

### 跨页视角切换：labLinks 机制

Phase 43 Batch 2-3 实现了 Learn→Lab 的桥接按钮。这个按钮的本质就是一次**视角切换**：

\`\`\`typescript
// types.ts — labLinks 定义
export interface LabLink {
  tab: string;         // Lab 的 Tab 名 (context / pipeline / data / graph / experiment)
  label: string;       // 按钮文案
  description: string; // 短描述
}

// Answer 类型中的字段
export interface Answer {
  // ...
  labLinks?: LabLink[]; // 指向 Lab 页对应 Tab 的桥接
}
\`\`\`

用户在 Learn 页读 q2.14「混合检索策略权衡」，看到 L3 末尾的「拉通 Lab」按钮。点击后 URL 变为 \`/lab?tab=context\`，LabShell 读取 \`useSearchParams\` 跳转到「上下文」Tab——此时 RecallRacePanel 正在展示三条检索路线的并排实时数据。**读者变成了研究者**——同一个主题，换了看它的方式。

### 关键设计原则

1. **ApiTrace 中立性**：不加"视角标记"字段，不给 ApiTrace 增加视角元数据。视角是消费端的选择，不是生产端的标签。
2. **组件即视角**：不建单一的"视角切换器"——不同组件天然属于不同视角。ChatMessage 是用户视角，ProcessDrawer 是开发视角，Lab 是研究视角。
3. **边界不完美也没关系**：有些组件跨视角（OnionPanel L0-L1 偏用户，L2-L3 偏开发者）——这不是设计缺陷，而是因为用户和开发者本身就是连续光谱。接受模糊边界，比强制一刀切更好。

> 置信度：0.93`,
    l3: `### 行业对标

- **Apple Human Interface Guidelines**「角色适配」原则：macOS 的"高级"选项默认隐藏，需要显式开启。系统根据用户角色（新手/专家/开发者）调整信息密度——不给新手造成认知负担，不给专家造成操作障碍。这本质上是**二分法**（新手/专家），而 GlassCortex 的三角模型（用户/开发者/研究者）更进一步，区分了"怎么做"和"为什么"。
- **Stripe API 文档**的「三档切换」：Quick Start（给商户的 5 步入门）→ Developer Guide（给开发者的集成指南）→ API Reference（给技术团队的完整字段表）。三份文档讲同一套 API，但筛选的信息不同。这和 GlassCortex 的三视角异曲同工——更可贵的是 Stripe 三档之间互相引用（Quick Start 里嵌了「详见 Developer Guide §3.2」），形成交叉路径，不像 GlassCortex 的三视角目前各自独立。
- **Notion AI**：同样一份 AI 输出，编辑者看到的是"生成建议 × 继续调整"，查看者看到的是已经生效的内容——角色决定信息颗粒度，用户不需要选择自己的角色，系统从上下文中推断。

### 未解决的问题

1. **角色自动识别**：目前三个视角是用户手动切换的（Chat 页 → 用户视角，Lab 页 → 研究者视角）。能不能根据用户行为自动识别当前需要的视角？比如频繁打开 ProcessDrawer → 自动增加开发视角内容密度；常在 Lab 停留 → 在 Chat 页也展示更多研究视角数据。

2. **跨视角一致性维护**：同一个 \`ApiTrace\` 在三个视角下表述不能自相矛盾。但当代码更新了、ApiTrace 字段变了——谁负责确保三处的文案同步？目前靠单元测试的契约快照（\`make check-contracts\`）兜底字段完整性，但文案层面的回归需要人工审查。

3. **混合视角用户**：很多读者同时是"懂一点开发的普通用户"或"想做产品调研的研究者"。OnionPanel 的 L0→L3 递进解决了用户在"自己"视角内的深度需求，但当用户想在 Chat 页快速看一下 Lab 的研究数据时——他必须跳转到 Lab 页。是否可以局部嵌入？

### GlassCortex 的后续方向

可在 \`/profile\` 页添加「默认视角」设置（终端用户 / 开发者 / 研究者），影响 OnionPanel 默认展开层数、Sidebar 密度、ProcessDrawer 是否自动弹出。更高级的形态是根据用户行为——点 ProcessDrawer 的次数、Lab 页停留时长——自动推断视角偏好并调整内容密度。

> 置信度：0.90`,
  },
  {
    id: "q7.4",
    question: '叙事 vs 数据的平衡：仪表盘数字旁边是不是应该有句解释？',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P1",
    confidence: { l0: 0.97, l1: 0.94, l2: 0.92, l3: 0.88 },
    overallConfidence: 0.88,
    l0: '数字不会骗人，但数字也不会说话。「缓存命中率 83%」——这是数据。「缓存命中率 83% ↗ 较昨日 +5%，最近 7 天持续上升」——这是叙事带着数据。多出来的那半句话，决定了用户是「看到了一个数字」还是「理解了一个状态」。',
    l1: `你收到一份体检报告。上面写「血小板计数 246」。这个数字本身有意义吗？对大多数人来说没有——直到报告告诉你「参考范围 125-350，您的数值处于正常区间」。那个参考范围就是叙事——没有它，数字是死的。

GlassCortex 犯过同样的错误。早期版本的 SessionHarvest 组件直接把 6 个指标堆在一起：

> 消息数：38 ｜ 记忆数：128 ｜ Token 总消耗：4,682 ｜ 平均延时：1.2s ｜ 缓存命中：47% ｜ 召回条数：12

用户在屏幕前看了两秒，问了一个问题——「这些数字正常吗？」

问题在于：**用户没有「正常值」的心智模型**。唯一有参考意义的是「和上次比」「和极限比」「系统觉得好不好」。于是后来的版本加了 narrativized metrics：

> 缓存命中 47%（🟡 偏低，建议复查缓存策略）
> 平均延时 1.2s（✅ 低于 2s 阈值，系统响应健康）

### 叙事何时必要、何时多余？

| 场景 | 数据示例 | 需要叙事？ | 理由 |
|------|---------|:---------:|------|
| Token 使用量 | \`4,682 tokens\` | ❌ 不需要 | 数字本身有意义，越大越贵，没有歧义 |
| 缓存命中率 | \`47%\` | ✅ 需要 | 47% 是好是坏取决于业务场景——低延迟应用可接受，高召回应用不可接受 |
| 响应延迟 | \`1.2s\` | ⚠️ 边界 | 1.2s 对聊天场景正常，对搜索场景偏慢——需要场景标签而非叙事 |
| 置信度 | \`0.85\` | ✅ 需要 | 0.85 是什么级别？比 0.5 高但比 0.95 低——没有比较基准的数字是噪音 |
| 消息计数 | \`38 条\` | ❌ 不需要 | 计数本身就是完整的语义 |
| 衰减参数 λ | \`0.8\` | ✅ 需要 | 非技术人员完全看不懂——需要「衰减较快 / 适中 / 缓慢」的标签化 |

### 数据的仪式感

有意思的是，有时候**数据自己就是叙事**。纯数字布局在 UI 上有一种「仪器的诚实感」——像飞行员面前的仪表盘，给你的是原始读数，不修饰不解释。这种风格天然传递一种信号：「我们在给你看最原始的东西，没有加工」。

这就是为什么 GlassCortex 的 NutritionLabel（营养标签）选择了类 FDA 的纯数据风格——每个分区精确到 token 个数，没有颜色、没有 emoji、没有叙事。因为它面向的是一种**审计检查**的场景——用户需要精确数字来做自己的判断，不是被引导的结论。这种场景下，叙事反而是干扰。

两个模式在系统中共存：

\`\`\`mermaid
%% title: 图：叙事 vs 原始模式的选择路径
graph TD
    D["📊 原始数据窗口"] --> Q{"用户此时<br/>需要理解还是核实？"}
    Q -->|"理解——<br/>这个数字什么含义？"| N["📖 叙事模式"]
    N --> N1["ContextHealthBadge"]
    N1 --> N1A["83% · 🟡 偏高<br/>一句话说明趋势和含义"]
    N --> N2["TokenCostBadge"]
    N2 --> N2A["≈¥0.03 · 465 token<br/>金额 + 数量二元叙事"]
    N --> N3["SessionTokenGauge"]
    N3 --> N3A["油表隐喻<br/>绿→黄→红三段警示"]
    Q -->|"核实——<br/>我要精确数字"| R["🔢 原始模式"]
    R --> R1["NutritionLabel"]
    R1 --> R1A["system: 2,185<br/>recall: 892<br/>history: 1,240<br/>tools: 365"]
    R --> R2["TokenDashboardPanel"]
    R2 --> R2A["柱状图 · 无注释<br/>纯数据展示"]
    R --> R3["DecayDistributionPanel"]
    R3 --> R3A["坐标轴 + 数据点<br/>零叙事文字"]
    style D fill:#6366f1,stroke:#4338ca,color:#fff
    style N fill:#34d399,stroke:#059669,color:#064e3b
    style R fill:#9ca3af,stroke:#6b7280,color:#1f2937
\`\`\``,
    l2: `### ExplainTooltip：最小的叙事介入

系统中最小粒度的「叙事」载体是 \`ExplainTooltip\`（Phase 29 Batch 177）。它的设计哲学是：**数字默认显示，叙事按需获取**——hover 一下就有解释，不 hover 也不损失信息密度。

\`\`\`tsx
<KVRow
  label="衰减参数 λ"
  value={decayLambda}
  explain="λ 控制记忆衰减速度：λ 越大、遗忘越快。推荐值 0.5-1.0。当前值 0.8 属中等衰减。"
/>
\`\`\`

这种设计平衡了数据密度和可理解性——不牺牲信息量（数字永远展示），但提供了按需获取叙事的路径。ExplainTooltip 在整个系统中注册了 15+ 个词条（Phase 29 Batch 177 的数据），覆盖了 Token、λ、MMR、Truncation、top_k 等核心参数。

### ContextHealthBadge：数字 + 状态标签的二元叙事

\`\`\`typescript
// 状态标签 + 百分比 的二元叙事
const HEALTH_MAP = {
  healthy:  { label: '正常',  color: 'var(--gm-emerald-500)' },
  warning:  { label: '偏高',  color: 'var(--gm-amber-500)' },
  critical: { label: '严重',  color: 'var(--gm-red-500)' },
} as const;
\`\`\`

数字（83%）给精读用户，标签（正常）给扫读用户——两种消费模式在同一个组件里共存。这是 GlassCortex 中最成功的「叙事 vs 数据」平衡案例：一行代码实现了语言和数字的并行传输。

### 反模式：叙事溺爱

早期版本（Phase 29 Batch 174 之前的 ContextBar 原型）走过另一个极端——每个数字旁边都有一段解释。结果是面板膨胀一倍、垂直空间翻倍、用户学会自动忽略那半段话。

更隐蔽的问题是：**叙事需要维护**。当缓存统计口径改变（从「请求次数命中率」改为「token 量命中率」），叙事文案必须同步更新。如果出现「数字说 47%，文案说偏低」，但实际 47% 在新口径下已经是正常值——叙事就变成了错误信息，比没有叙事更糟糕。

教训：不是每个数字都需要叙事。叙事适用于**带基准判断的数值**和**非直观的指标**。对于自解释的计数器（消息数、时长）、技术参数（ms、tokens），不加叙事是更好的选择——加叙事反而让人困惑「为什么这里需要解释」。

> 置信度：0.92`,
    l3: `### 行业对标

- **Edward Tufte《定量信息的视觉展示》（The Visual Display of Quantitative Information, 1983）**：提出「数据-墨水比」（data-ink ratio）——图表中的每一滴墨水都应该传达信息。应用于叙事 vs 数据：叙事增加的每一个字符都应该帮助读者理解数字的意义，否则就是「叙事噪音」（chartjunk）。GlassCortex 的反模式「叙事溺爱」正是数据-墨水比原则的被迫补课。
- **Google Material Design 3 数据面板规范**：推荐「数据可视化优先，文本摘要辅助」。面板第一眼应该是图表（数据），叙事作为辅助说明放在下方。这与 GlassCortex NutritionLabel 优先展示数字、把解释留给外部 ExplainTooltip 的模式一致。
- **华尔街日报数据可视化团队**：图表标题一律是叙事（「通胀放缓但未消退」），图表本身是纯数据（逐月 CPI 趋势线）。叙事设定阅读框架，数据提供验证路径。两者缺一不可。

### 未解决的问题

1. **叙事的个性化**：第一次来系统的用户需要更多叙事来解释每个数字（「λ 控制衰减速度……」「命中率 47% 意味着……」），但第 20 次来的用户已经不需要了。是否可以根据组件访问次数逐步缩减叙事密度？最简单的方案是用 localStorage 记录「已熟悉」的指标，下次只显示数字不显示叙事。

2. **叙事的多语言成本**：数字不需要翻译，叙事需要。在 q1.6 讨论的多语言问题在这里体现得最充分——「缓存命中率 47%」全球都看得懂，但「🟡 偏低，建议复查缓存策略」需要每个语言版本各一。对于国际化场景，数据的优势更明显——无本地化成本、无歧义。

3. **叙事的客观性**：叙事本质上是编辑行为——系统告诉用户「这个是偏高还是偏低」。如果系统判断错了呢？用户信任叙事，但叙事不可靠时，造成的问题比不提供叙事更大。对于「置信度 0.85——偏高」，如果实际 0.85 在开发者眼中是「不够高」，叙事就产生了方向性的误导。

### GlassCortex 的后续方向

一个比叙事标签更中立的方案：**在数字和叙事之间加一层「基准」**——每个指标自带迷你 sparkline 或比较基准，而不写叙事文案来解释「83% 正常还是偏高」。比如「缓存命中率 47%」旁边放过去 7 次的趋势 mini chart，用户自己看曲线判断——把「叙事的判断权」交还给用户。这比 "🟡 偏低" 更诚实，也更容易维护。

> 置信度：0.88`,
  },
  {
    id: "q7.2",
    question: '同一信息在不同视角下的表述转换：一条召回记忆，三个视角看',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P2",
    confidence: { l0: 0.95, l1: 0.92, l2: 0.88, l3: 0.85 },
    overallConfidence: 0.85,
    l0: '同一张星球照片——天文爱好者看形状，天体物理学家看大气成分，望远镜工程师看曝光参数。数据相同，维度不同——不是谁比谁懂，是各自带着不同的问号看的。一条被召回的「用户喜欢黑猫」记忆也是这样：AI 用户看到自己被理解了，开发者看到管线跑了 20ms，研究者看到 MMR 参数是否需要调。',

    l1: `### 实操走查：一条记忆的三次人生

让我们走一遍真实的管线。用户在第一轮对话中说了「我喜欢黑猫」，系统将其存入记忆库。用户开启新会话，问「你知道我喜欢什么颜色的猫吗？」——触发记忆召回。

同一批数据沿管子走四个步骤，每一步三个视角看到的完全不同。

**Step 1: SQL 查询（2ms）**

| 视角 | 看到的内容 | 关心什么 |
|------|-----------|---------|
| 👤 终端用户 | 看不到，也不关心。ChatMessage 直接展示结果即可。 | 无 |
| 🔧 开发者 | ProcessDrawer Section 2：\`SQL: WHERE subject='偏好' AND object LIKE '%猫%' — 2ms, 2 条命中\` | SQL 条件对不对？延迟正常吗？ |
| 🔬 研究者 | Lab→pipeline Tab：同场景 SQL 路线平均召回率 0.62、精准度 0.88，与历史对比如何 | SQL 路线在这个查询类别上的相对表现 |

**Step 2: FAISS 向量检索（15ms）**

| 视角 | 看到的内容 | 关心什么 |
|------|-----------|---------|
| 👤 终端用户 | ContextualLens: 「从记忆中找到了相关的信息」 | 系统确实还记得我 |
| 🔧 开发者 | ProcessDrawer Section 2：\`FAISS search top_k=5, cosine sim 0.87, 15ms\` | top_k 够不够？相似度阈值合理吗？ |
| 🔬 研究者 | Lab→数据 Tab：query 向量在 2D 空间的投影，与 5 个候选向量的余弦距离可视化 | 向量空间质量——同类事实是否聚簇？ |

**Step 3: MMR λ=0.5 重排序（3ms）**

| 视角 | 看到的内容 | 关心什么 |
|------|-----------|---------|
| 👤 终端用户 | 看不到——MMR 是对用户透明的内部优化步骤 | 无 |
| 🔧 开发者 | ProcessDrawer Section 2：\`MMR λ=0.5, 5 候选→保留 2 条, 3ms\` | 重排序参数是否合适？多样性是否足够？ |
| 🔬 研究者 | Lab→上下文 Tab：RecallRacePanel — λ=0.5 vs λ=0.3 vs 无 MMR 三条路线并排对比 | 这个场景下哪个 λ 最优？λ=0.5 的 3ms 额外开销是否值得？ |

**Step 4: 渲染输出**

| 视角 | 看到的内容 | 关心什么 |
|------|-----------|---------|
| 👤 终端用户 | ChatMessage: 「我记得你之前说过喜欢黑猫🐱」 | 系统理解了我的偏好 |
| 🔧 开发者 | ChatMessage 下方 \`context_meta\`：\`recall: 2 items, 0.03¢\` | 召回开销是否在预算内 |
| 🔬 研究者 | Lab→graph Tab：Token 瀑布图——recall 部分在整体 token 消耗中的占比 | 召回开销占比是否合理？是否有优化空间？ |

### 对照表的本质

这张表不是在展示「谁看得多谁看得少」——它展示的是 **同一份原始数据，沿渲染管线走出的三个分支**。数据不变，解释变，展现变。

这个设计不是偶然的。Phase 38 Batch 6（SessionTokenGauge）和 Phase 43 Batch 2-3（labLinks）分别奠定了两个基石：
1. **数据中立**：ApiTrace 和 RecallItem 在设计时没考虑视角——它们只保留原始数据，视角是消费端的选择
2. **组件即视角**：不建全局视角切换器，而是让不同组件天然服务不同视角——ChatMessage 是用户视角、ProcessDrawer 是开发视角、Lab 是研究视角

对照表的每一步都在回答同一个问题：**这条数据在哪个视角下最有价值？**`,

    l2: `### 同一条数据，三路渲染

代码层面的核心原则：**不因为视角不同而复制数据**。

\`\`\`python
# src/memory/recall.py:42 — 唯一召回引擎方法
class MemoryStore:
    def recall(
        self, query: str, top_k: int, ...
    ) -> list[dict[str, object]]:
        # 一条管线：embed → FAISS search → dedup → score → return
        # 返回的 dict 含 composite_score, similarity, content, importance ...
\`\`\`

\`\`\`python
# api/schemas.py:171 — 数据传输层：RecallItem
class RecallItem(BaseModel):
    id: int
    content: str            # 事实原文
    importance: float | None
    composite_score: float | None   # MMR 综合分数
    similarity: float | None        # FAISS 余弦相似度
    subject: str | None             # 三元组主语
    relation: str | None            # 三元组关系
    object: str | None              # 三元组宾语
    # ... 合计 18 个字段
\`\`\`

这个 \`RecallItem\` 作为 \`RecallResponse.items\`（\`api/routers/memory.py\`）的一部分通过 REST API 流入前端。三个组件消费同一份数据，取不同字段：

\`\`\`tsx
// 1. ChatMessage.tsx — 用户视角
// 取: content
<ChatBubble>
  {recallItem.content}
  <ContextualLens source="memory" />  {/* 「从记忆中召回」 */}
</ChatBubble>

// 2. ProcessDrawer Section 2 — 开发者视角
// 取: 完整 RecallItem + tracing 元数据
<KVRow label="FAISS" value={\`top_k=\${params.top_k}, sim=\${item.similarity}\`} />
<KVRow label="MMR" value={\`λ=\${mmrLambda}, candidates \${count}\`} />
<KVRow label="Cost" value={\`\${cost} tokens · ≈\${costInCents}¢\`} />

// 3. LabPage 面板 — 研究者视角
// 取: 多条管线对比 → 图表
<RecallRacePanel
  routes={[
    { name: "SQL", recallRate: 0.62, precision: 0.88, latencyMs: 2 },
    { name: "FAISS", recallRate: 0.78, precision: 0.84, latencyMs: 15 },
    { name: "MMR λ=0.5", recallRate: 0.74, precision: 0.92, latencyMs: 18 },
  ]}
/>
\`\`\`

### 架构映射

\`\`\`
MemoryStore.recall()  →  RecallItem (同一份数据)
    ↓                            ↓
API 层 (RecallResponse)  →  三个消费组件
    ↓
    ├─ ChatMessage      →  content 字段      → 「我记得你喜欢黑猫」
    ├─ ProcessDrawer    →  字段全量 + 元数据   → top_k / λ / latency / score
    └─ LabPanel         →  多路线对比数据集    → 图表 X/Y 轴数据
\`\`\`

三个组件共享同一份 \`RecallItem\` 数据——它们只是**取不同字段、用不同方式渲染**。这比造三套 API（\`/recall-for-user\`、\`/recall-for-dev\`、\`/recall-for-researcher\`）简单一个数量级，且天然保证一致性——数据只有一份，不会三份不同步。

### 关键设计决策

1. **API 层不做视角过滤**：\`RecallResponse\` 返回完整的 \`RecallItem\`，不加 \`?view=user\` 参数。过滤（只返回 \`content\`）是前端的职责。理由：API 不知道前端需要哪些字段——ProcessDrawer 需要全部，ChatMessage 只需要一条。让 API 做最少的假设。
2. **Renderer 即视角**：没有「视角枚举」——不在组件里写 \`if (view === 'developer') …\`。视角是通过选择不同组件来表达的，不是通过条件分支。ChatMessage 天然就是用户视角，不需要加 \`viewType="user"\` 属性。
3. **不共享状态**：ChatMessage、ProcessDrawer、LabPage 之间不共享渲染状态。它们各自拿到 \`RecallItem\` 后，完全独立渲染——没有「主视角」和「子视角」的关系。这一决策在 q7.3 的窗帘原则中有更完整的讨论：跨组件视角状态同步引入了不必要的复杂度（"Lab 页正在对比 λ，Chat 页需要知道吗？"——不需要）。`,

    l3: `### 行业对标

- **Stripe API 文档三档切换**：Quick Start（商户）→ Developer Guide（集成者）→ API Reference（技术团队）。同一套 Charges API 在三份文档中筛出不同的信息——Quick Start 只展示 \`create\` 和 \`retrieve\`，Developer Guide 展示完整的生命周期和 webhooks，API Reference 展示所有字段和错误码。GlassCortex 当前三个视角各自独立（Chat 页 / ProcessDrawer / Lab 页），缺少 Stripe 式「文末交叉引用」——用户在 Chat 页看到记忆召回后，不知道还可以去 Lab 页对比召回策略参数。

- **GitHub Issue 三重视角**：Issue List（标题 + 时间，管理者快速扫读）→ Issue Detail（完整讨论，参与者跟进）→ Issue Events 时间线（操作日志，审计者追溯）。与 q7.2 对照表同构：List=用户视角、Detail=开发者视角、Events=研究者视角。更有意思的是 GitHub Events Tab 嵌入在 Issue Detail 页面内部——允许在同一页面内切换视角，而不像 GlassCortex 需要跨页面跳转。这是值得借鉴的「组件级视角切换」。

- **Apple HIG 细节揭示层级**：macOS 的「高级」选项默认隐藏，需显式开启。视角的粒度由系统版本（regular vs advanced）和用户意愿共同决定——与 ProcessDrawer 默认折叠 Section 2 的逻辑一致。但 Apple 更进一步：一旦用户开启「高级」模式，设置在所有相关页面生效，有记忆性。GlassCortex 的视角切换目前没有记忆性——Lab 页关闭，选中的 Tab 和参数即丢失。

### 未解决的问题

1. **跨组件盲区**：用户在 ProcessDrawer 看到 MMR λ=0.5 的参数，想在同一页面看到 SQL 路线的对比——但他需要跳到 Lab 页。目前没有「顺手拉一个 SQL 对比」的轻量操作。视角切换是全页面级的，不是组件级的——无法在 ChatMessage 旁边内嵌一个 mini RecallRacePanel。

2. **视角切换的上下文记忆**：用户从 Chat 页跳到 Lab 页查了 RecallRacePanel，返回 Chat 页——Lab 页打开的 Tab、选中的 λ 值、滚动位置全部丢失。Phase 43 的 labLinks 解决了「跳过去」的问题，但「跳回来」的上下文没有保留。理想的方案是 URL query 参数保存 Lab 页状态（\`/lab?tab=context&lambda=0.5&route=mmr\`），但 Chat 页回到 Lab 页时不会自动恢复这些参数——两个页面之间没有状态桥接。

3. **「忘记怎么切了」的认知负担**：新用户不知道 ChatMessage 下方的 ContextualLens 图标点开可以展开 ProcessDrawer，不知道 ProcessDrawer Section 2 再点可以展开完整 recall 详情——每个视角切换点都需要用户自己发现。GlassCortex 靠 onboarding tour（Phase 29 Batch 178）引导，但 tour 是一次性的。有没有更隐性的引导方式？比如用户首次打开 ProcessDrawer 时，自动展开 Section 2 并标一个「这里有更多」的提示脉冲小动画。

### GlassCortex 的后续方向

可考虑在 ProcessDrawer 中嵌入「一键拉通」按钮——在当前 Section 2 的 MMR 参数旁加一个 \`→ 看 SQL 对比\` 链接，点击后 ProcessDrawer 内部展开一个 mini RecallRacePanel，不需要跳转到 Lab 页。这相当于在开发者视角中局部嵌入研究者视角的 widget，打破了当前「视角即页面」的强绑定，又在同一页面内完成了视角切换。

> 置信度：0.85`,
  },
  {
    id: "q7.3",
    question: '透明化的边界：什么不应该透明？透明化的"窗帘"在哪里？',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P1",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.88 },
    overallConfidence: 0.88,
    l0: '全透明的玻璃房子看起来很酷，但你不会在里面换衣服。透明化的窗帘和玻璃一样重要——知道藏什么才知道露什么。没有窗帘的透明不是诚实，是展览主义。',
    l1: `用你住的房子打比方——有窗户（让阳光进来、让别人看到你在做饭看书），也有窗帘（别人不该看到你在换衣服）。没有窗的房子是监狱，没有窗帘的房子是鱼缸。透明化设计也是一样——不是一切都要公开。

GlassCortex 设计了四类「窗帘」——这不是技术缺陷，是刻意的边界。

### 四类窗帘

#### 一、🔒 安全窗帘：不该暴露的敏感信息

**不暴露**：API key、数据库文件路径（\`data/default/memory.db\`）、FAISS 索引路径、内部网络地址、SQL 表结构。

**为什么**：这些东西暴露给用户，用户既无法理解也无法利用——反而为攻击者提供了信息。一个「API 未配置，已降级为离线模式」的提示就够了，不需要说「DeepSeek API key 未在 \`.env\` 中配置，\`openai.ChatCompletion.create()\` 调用失败」。

**GlassCortex 的做法**：\`ApiTrace\` 和日志中从不记录密钥原文。健康检查端点只返回 \`llm_api: {"status": "ok"}\`，不显示 key 的前缀或过期时间。

#### 二、📢 噪音窗帘：不该干扰用户的实现细节

**不暴露**：JSON 解析回退路径、重试循环次数、\`try/except Exception\` 的 traceback、内部变量名（\`_parsed_result\` / \`_retry_count\`）。

**为什么**：开发者在调试时看到这些会点头（「啊，三阶回退到兜底了」），但用户看到只会困惑（「到底出了错还是没出错？」）。噪音会使信任下降，而不是上升——用户会觉得系统不稳定，因为「一直在报错」。

**GlassCortex 的做法**：ProcessDrawer 的 Section 4（系统提示词）只展示最终传给模型的 prompt 文本，不展示 prompt 模板的拼接过程（\`{system_preamble}\\n{recalled_facts}\\n{recent_history}\\n{user_query}\`）。用户不需要知道模板变量替换的细节——那是实现，不是透明。

#### 三、🙈 隐私窗帘：不该跨用户共享的信息

**不暴露**：其他用户的对话内容、全局统计中的个体识别信息、原始用户 ID。

**为什么**：这不是透明化的问题，这是基本的隐私保护。透明化不能以隐私为代价——展示「系统有多少活跃用户」可以，展示「张三今天说了什么」不可以。

**GlassCortex 的做法**：记忆系统和对话引擎都是多 profile 隔离的——每个用户只能看到自己的事实和对话历史。健康检查端点返回的「总记忆数 128」是全局聚合，不包含个体信息。

#### 四、🧠 帮助窗帘：不该消耗用户认知的底层细节

**不暴露**：Token 的逐级分解（subword 分片）、注意力权重分布、tokenizer 词汇表查找过程。

**为什么**：透明化的目标是**帮助理解**，不是**展示复杂度**。如果暴露的信息超过了用户的认知负荷，它就从「透明」变成了「炫技」。一个 Token 透镜告诉用户「整个回复用了 465 个 token」就够了——不需要展示「其中 'hello' 占 1 个 token、'world' 占 1 个 token、'!' 又占 1 个 token……」

**GlassCortex 的做法**：TokenCostBadge 展示聚合的「≈¥0.03 · 465 token」，不展示每个词的 token 分片。想看更细的？去 Lab 页的 TokenDashboardPanel——但那是「主动探索」不是「被动展示」。

### 窗帘决策框架

判断一个信息「应该透明还是应该遮住」的四步测试：

| 步骤 | 问题 | 不通过 → 遮住 |
|:---:|------|:-------------:|
| ① | **暴露后是否造成安全风险？** | 🔒 安全窗帘 |
| ② | **暴露后是否会频繁产生噪音？** | 📢 噪音窗帘 |
| ③ | **暴露后是否侵犯他人隐私？** | 🙈 隐私窗帘 |
| ④ | **暴露后是否帮助用户理解？** | 是 → ✅ 透明 · 否 → 🧠 帮助窗帘 |

四条都通过 → 可以展示。任何一条不通过 → 遮住或降级展示。

\`\`\`mermaid
%% title: 图：窗帘决策树
graph TD
    INFO["🤔 有信息<br/>要不要透明化？"] --> Q1{"① 安全风险？<br/>API key / 路径 / 密钥"}
    Q1 -->|"是"| S["🔒 安全窗帘"]
    S --> S1["不展示 · 仅记录日志"]
    Q1 -->|"否"| Q2{"② 噪音风险？<br/>解析重试 / 内部变量"}
    Q2 -->|"是"| N["📢 噪音窗帘"]
    N --> N1["展示聚合结果<br/>不展示过程"]
    Q2 -->|"否"| Q3{"③ 隐私风险？<br/>身份信息 / 跨用户数据"}
    Q3 -->|"是"| P["🙈 隐私窗帘"]
    P --> P1["仅展示聚合统计<br/>不展示个体信息"]
    Q3 -->|"否"| Q4{"④ 帮助理解？<br/>用户能从这个信息<br/>学到什么/做什么"}
    Q4 -->|"是"| SHOW["✅ 透明展示"]
    SHOW --> SHOW1["用户可理解的语言<br/>合适的呈现方式"]
    Q4 -->|"否"| H["🧠 帮助窗帘"]
    H --> H1["默认隐藏<br/>专家模式下可探索"]
    style INFO fill:#6366f1,stroke:#4338ca,color:#fff
    style S fill:#ef4444,stroke:#dc2626,color:#fff
    style N fill:#f59e0b,stroke:#d97706,color:#fff
    style P fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style H fill:#9ca3af,stroke:#6b7280,color:#fff
    style SHOW fill:#34d399,stroke:#059669,color:#064e3b
\`\`\``,
    l2: `### GlassCortex 的三层窗帘机制

#### 第一层：编译时隔离（最严格）

\`ErrorDisplay\` 的 \`technicalDetail\` prop 仅在非生产环境渲染——编译时通过 \`typeof process\` guard 判断，生产环境直接跳过这个 DOM 节点：

\`\`\`typescript
// 防 jsdom crash + 生产环境不暴露内部细节
const showTechnical = process.env.NODE_ENV !== "production"
    && typeof process !== "undefined";
\`\`\`

这是最严格的窗帘——代码层面直接隔离，不存在「用户不小心打开了」的可能性。适用于安全等级最高的信息。

#### 第二层：角色隔离（按需暴露）

ProcessDrawer（开发者视角）是默认**折叠**的——用户必须主动点击才能看到每个 Section 的内容。Section 4（系统提示词）还额外需要展开 Code Pre 才能看到完整 prompt 文本：

\`\`\`typescript
// ProcessDrawer 的默认展开策略（Phase 35 Batch 4）
// Section 1（时间线）始终展开
// Section 2（模型响应）仅 rawResponse 非空时展开
// Section 3-5（解析/规划/常量）默认折叠
\`\`\`

这不是「不让看」，是「想好再看」——降低噪音但不拒绝探索。适用于噪音窗帘和信息密度较高的开发者视角。

#### 第三层：聚合隔离（信息降级）

TokenDashboardPanel 展示的是**聚合值**（每条调用点的总 token），不展示 TokenLedger 中每个 \`record_chat_call\` / \`record_intent_classification\` 的逐条记录。用户看到的是「意图分类：152 token」，不是 3 次调用的分别 58 + 62 + 32 token。

\`\`\`typescript
// TokenLedger 的 call_point 聚合（token_ledger.py）
def summary(self) -> dict:
    // 返回按 call_point 聚合的 token 用量
    // 不返回每条记录的逐条明细
    ...

// API 层进一步聚合（api/routers/chat.py）
// token_breakdown 只有 chat/intent/fact_extraction 三个桶
// 没有每个桶内部的子调用分布
\`\`\`

适用于帮助窗帘——用户知道「意图分类花了 152 token」就够了，不需要知道每次调用的各自分布。

### 窗帘不是缺陷，是设计

一个没有窗帘的透明化系统不是「更透明」，而是「更懒惰」——因为它把「什么该展示」的决策推给了用户。好的透明化系统自己做这个决策：把 80% 的噪音挡在窗帘后面，让剩下的 20% 真正有用。

这四条窗帘规则不是功能需求文档里写的——它们是从用户错误中归纳的。Phase 33 Batch 2 修复的 \`technicalDetail\` 泄漏（Pattern D）、Phase 31 Batch 1 的 \`categorizeError\` 统一分类、Phase 38 Batch 1 的定价配置化——每一个都是因为曾经「透明过度」而被迫加的窗帘。

> 置信度：0.93`,
    l3: `### 行业对标

- **Apple Human Interface Guidelines**「错误信息的层级」：系统级错误不展示技术细节（「网络连接不可用」），开发级错误在调试模式展示。开发者可以通过配置描述文件（Configuration Profile）开启更详细的日志级别——把决定权交给系统管理员，而不是每个用户。
- **Stripe API** 的错误响应设计：生产环境返回 \`card_declined\`（通用错误码），不返回为什么被拒的具体原因（风控规则细节）。只有商户通过 Stripe Dashboard 才能看到更详细的失败原因——这是最成熟的「角色隔离窗帘」实践。
- **GitHub Copilot** 的透明策略：用户看到的是「Copilot 正在思考…」的简单状态。当模型推理失败时，显示的是「Copilot 遇到了问题。请稍后再试。」——没有 token 消耗数据、没有模型选择依据、没有回复被截断的原因。这是一种极端的窗帘策略——什么有价值的信息都没给。

### 未解决的问题

1. **谁来决定窗帘**：目前四条规则是设计原则，不是代码门禁。谁来判断一个信息属于哪类窗帘？如果开发者 A 觉得「这个重试次数应该透明给用户看」，开发者 B 觉得「这是噪音窗帘」——谁来裁决？

2. **窗帘的可配置性**：一个开发者用户可能想要看到噪音窗帘后面的内容——因为他正在调试。目前的「编译时隔离」没有给用户覆盖的机会。如果可以配置自己的「透明化级别」（普通/高级/开发者/调试），是不是比一刀切的窗帘更好？

3. **窗帘的信息不对称风险**：设计师知道「我遮住了噪音」，用户不知道。如果遮得太多了，会不会变成另一种形式的欺骗？窗帘和隐瞒之间的界限在哪里——是不是所有「不给用户看的信息」都需要一个解释说明（「这段信息已折叠，点击展开后可看到原始 AI 响应」）？

4. **窗帘的维护成本**：窗帘的位置需要随着代码演进同步更新——如果新加了一个 API 调用，是否自动获得了窗帘保护？目前靠 code review 人工检查，随着项目增长，漏掉的可能性在增加。

### GlassCortex 的后续方向

可以让用户配置「透明化曝光级别」——一组从「最小」到「完整」的滑块（安全/噪音/隐私/帮助 四组独立控制）。默认值是「最小」（最强的窗帘），开发者用户可以选择「完整」（仅安全窗帘保留）。但更有意思的方向是**让窗帘变成动态的**——系统根据用户与透明化组件的交互频率（ProcessDrawer 打开次数、Lab Tab 停留时长），自动增减窗帘的透明度。和 q7.1 的「视角自动识别」是同一个问题。

> 置信度：0.88`,
  },
  {
    id: "q7.5",
    question: '渐进式信息披露：L0→L1→L2→L3 的递进模型是否统一应用于所有组件？',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P1",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.92, l3: 0.88 },
    overallConfidence: 0.88,
    l0: 'L0→L3 模型是统一的内容骨架，但不是每个组件都用满四层——有些组件天生只有一层（TokenCostBadge），有些天生需要四层（ProcessDrawer）。强求所有组件走四层结构，就像要求每扇窗户都用同一种窗帘——反而破坏了透明化的初衷。统一的是递进逻辑，不是层数。',
    l1: `你在宜家买过柜子吗？安装说明书有四页——第一页是成品图（我要装出什么），第二页是零件清单（需要什么工具），第三页是分步图（怎么装），第四页是保养说明（怎么维护）。但如果你买的是一把螺丝刀，说明书只有一行：「用来拧螺丝」。不是因为螺丝刀不配拥有四页说明书——而是因为它不需要。

GlassCortex 的 L0→L1→L2→L3 模型就是这个逻辑：

- **L0（一句话结论）** — 所有组件的默认状态。一眼扫过去就知道「这个组件在说什么」。TokenCostBadge 的 "≈¥0.03" 就是 L0——不需要展开，不需要解释。
- **L1（核心解释）** — 点开/悬停后看到的结构化说明。ContextualLens 展开后的记忆来源说明是 L1——什么、为什么、怎么看。
- **L2（深度探索）** — 技术实现和代码级透明。ProcessDrawer 的 Section 3-5 是 L2——SQL 查询、FAISS 参数、MMR λ 配置。
- **L3（前沿与未解）** — 最深的探索层。Lab 页的 RecallRacePanel 是 L3——三路召回对比、超参调整、实时实验。

### 三档组件分类

不同组件落在不同的 L0-L3 深度上，形成三个档位：

#### 档位 A：全量 L0→L3（完整四层）

这些组件是 GlassCortex 透明化设计的旗舰——它们的职责就是"讲清楚这件事的一切"，从一句话结论到实验级深度。

| 组件 | L0 | L1 | L2 | L3 | 典型场景 |
|------|:--:|:--:|:--:|:--:|---------|
| ProcessDrawer | ✅ 时序图缩略 | ✅ 4 Section 面板 | ✅ 代码级参数 | ✅ Lab 路由 | 开发者查看完整管线 |
| ChatMessage | ✅ 消息气泡 | ✅ context_meta 微展 | ✅ ContextualLens | ❌（无实验级别） | 日常对话透明化 |
| ReplanComparePanel | ✅ 重规划标识 | ✅ 对比摘要 | ✅ SQL 查询参数 | ❌ | 规划偏移诊断 |

ChatMessage 在 q7.1 中展示了三种视角的切换——终端用户的 L0 气泡、开发者的 L1 context_meta 微展、研究者的 L2 ContextualLens。它缺了 L3 是因为普通消息本身不是实验载体——你不需要在一条 AI 回复旁边跑 A/B 测试。

#### 档位 B：L0→L1（两级展开）

这些组件设计为「一眼可知，一点可究」。默认状态下给出 L0 摘要，展开后获得 L1 结构化解释。L2-L3 不存在于这些组件中——不是因为"没做完"，而是因为"到此为止信息足够了"。

| 组件 | L0 | L1 | L2-L3 | 设计理由 |
|------|:--:|:--:|:-----:|---------|
| TokenCostBadge | ¥0.03 标签 | 悬浮 tooltip 含 call_point 明细 | ❌ | 价格信息不需要实验级深度 |
| SessionTokenGauge | 会话总 token 油表 | 分桶统计（chat/intent/extract） | ❌ | 实时概览不求全量分解 |
| ContextHealthBadge | 健康状态色块 | 缓存命中率百分比 | ❌ | 状态通知追求瞬时理解 |
| NutritionLabel | 数字矩阵四格 | tooltip 解释每个指标含义 | ❌ | 纯数据面板，L1 已完整叙述 |

#### 档位 C：只有 L0（单层快照）

最小的透明化单位——一个数字、一个色块、一个状态标签。展开没有意义，因为它承载的信息本身就是原子化的。

| 组件 | L0 | L1+ | 设计理由 |
|------|:--:|:---:|---------|
| ErrorDisplay 状态色带 | 红/黄/绿色条 | ❌ | 错误等级本身不需要分层——红了就是严重 |
| ChatInput 表情反馈 | 👍/👎 计数 | ❌ | 反馈是动作不是信息——点击后无需深度展开 |
| 搜索框进度条 | 搜索中动画 | ❌ | 瞬态状态，用户只关心"好了没" |

### 层数不是品质指标

一个组件用满四层**不代表**它比单层组件"更透明"。ProcessDrawer 用四层是因为它需要同时服务三种视角（q7.1 的终端/开发者/研究者），而 TokenCostBadge 只用两层是因为它的职责就是让用户知道「花了多少钱」——多给三层反而违反了 q7.4 的"数据-墨水比"原则（叙事噪音）。

判定原则：**层数 = 信息所需曝光深度 ÷ 用户主动程度**。

\`\`\`mermaid
%% title: 图：组件 L 层深度频谱
graph LR
    C1["🎛️ FeedBack<br/>L0-only"] --> C2["🏷️ TokenBadge<br/>L0→L1"]
    C2 --> C3["🩺 HealthBadge<br/>L0→L1"]
    C3 --> C4["🧩 ContextLens<br/>L0→L1→L2"]
    C4 --> C5["💬 ChatMessage<br/>L0→L1→L2"]
    C5 --> C6["🔄 ReplanPanel<br/>L0→L1→L2"]
    C6 --> C7["📋 ProcessDrawer<br/>L0→L1→L2→L3"]
    style C1 fill:#9ca3af,stroke:#6b7280,color:#fff
    style C2 fill:#fcd34d,stroke:#f59e0b,color:#78350f
    style C3 fill:#fcd34d,stroke:#f59e0b,color:#78350f
    style C4 fill:#93c5fd,stroke:#3b82f6,color:#1e3a5f
    style C5 fill:#93c5fd,stroke:#3b82f6,color:#1e3a5f
    style C6 fill:#93c5fd,stroke:#3b82f6,color:#1e3a5f
    style C7 fill:#6366f1,stroke:#4338ca,color:#fff
\`\`\`

**读法**：从左到右 L 层递增。灰色 = L0 单层，黄色 = L0→L1 两级，蓝色 = L0→L2 三级，靛蓝 = L0→L3 全量。不是高低之分，是职责不同。

> 置信度：0.95`,
    l2: `### OnionPanel 的 L0→L3 渲染机制

\`\`\`typescript
interface OnionPanelProps {
  l0: string;       // 一句话结论——始终可见
  l1: string;       // 核心解释——点击展开
  l2?: string;      // 深度探索——可选
  l3?: string;      // 前沿与未解——可选
  defaultOpen?: boolean;  // 是否默认展开到 L1（周活跃用户 > 1 次访问时用）
}
\`\`\`

关键设计决策：

1. **L0 强制、L2-L3 可选**——核心接口里 L0 和 L1 是必填（\`string\`），L2 和 L3 是可选（\`string | undefined\`）。这正是"非统一深度"的架构体现：一个组件可以只实现 L0+L1，编译器不会报错，因为这就是正确用法。

2. **defaultOpen 感知用户活跃度**——默认折叠到 L0（新用户第一步只看 L0），周活跃用户 L1 自动预展开。这是 Phase 41 Batch 2 实现的阅读位置记忆基础上增加的「活跃度感知层数」。用户来得越频繁，系统给的初始深度越深。

### 各组件实际层数清单

Phase 49 Batch 3 跨章关联完成后，可以制作完整的组件层数清单：

| 组件 | L0 内容 | L1 内容 | L2 内容 | L3 内容 | 对应批号 |
|------|---------|---------|---------|---------|---------|
| ProcessDrawer | 时序图 + 状态摘要 | Section 1-4（时间/参数/解析/规划） | Section 5（系统提示词） | Lab 路由（实验对比） | Phase 35 B1-B4 |
| ChatMessage | 消息气泡本体 | context_meta（召回记忆摘要） | ContextualLens（流水线明细） | — | Phase 42 B2 |
| ContextualLens | 透镜图标 + 来源简述 | SQL × FAISS × MMR 三段标签 | 调用链耗时 + 参数值 | — | Phase 35 B1 |
| TokenCostBadge | 金额 + token 数 | 悬浮 tooltip（call_point 聚合） | — | — | Phase 38 B6 |
| SessionTokenGauge | 仪表盘主体 | 分桶统计（chat / intent / extract） | — | — | Phase 38 B6 |
| ContextHealthBadge | 状态色块（正常/偏高/严重） | tooltip 命中率百分比 | — | — | Phase 31 |
| NutritionLabel | 四格数字矩阵 | tooltip 指标含义解释 | — | — | Phase 31 |
| ReplanComparePanel | 重规划标识 | 前后参数对比表 | SQL 查询参数 | — | Phase 37 B5 |
| ErrorDisplay | 状态色带（红/黄/绿） | — | — | — | Phase 33 B2 |
| FeedbackButton | 👍/👎 图标计数 | — | — | — | Phase 33 |

### 反向案例：强行四层之恶

早期原型（Phase 31 Batch 1 的 ContextBar 第一版）曾经要求每个组件强制实现 L2-L3。结果是 TokenCostBadge 有了一个名为 "深层" 的选项卡——打开后显示 tokenizer 的分词表。没有人点过它。不仅浪费了实现时间（分词表需要从 \`tiktoken\` 库中提取并格式化渲染），还引出了隐私窗帘（q7.3）的问题——分词表长度暴露了 tokenizer 的词汇量大小，属于不必要的信息泄露。

教训：**层数的上界由信息本身决定，不是由架构规范决定**。组件作者判断「这个信息展开到 L1 已经足够回答了」时，强行加 L2 只会制造无人问津的 "空层"。

> 置信度：0.92`,
    l3: `### 行业对标

- **Apple HIG 的渐进式披露**（Progressive Disclosure）：推荐设计层级为「Primary → Secondary → Tertiary」。Primary 永远可见，Secondary 通过点击/点击展开，Tertiary 通过滑动/搜索进入。GlassCortex 的 L0→L1→L2→L3 和这个三级模型几乎同构——区别在于 Apple 的模型面向通用 UI（"更多设置在齿轮里"），GlassCortex 的模型面向信息密度（"L3 留给最深的探索者"）。
- **Material Design 3 的信息层次**：定义了三层——「High information（关键指标，始终可见）」「Medium information（支持决策的补充数据，可折叠）」「Low information（参考数据，搜索或滚动可见）」。
- **Stripe 的 Dashboard 信息分层**：列表页（L0）→详情页（L1）→API 日志（L2）→GraphQL 查询（L3）。最突出的是 Stripe **不同数据类型用不同层数**——支付记录用四层（列表→详情→日志→调式），而 Dashboard 摘要卡片只用一层（数字 + 趋势箭头，无详情可展开）。相同的信息模型，不同的层数因数据类型而异。
- **GitHub 的 Issue/PR 信息分层**：列表页（L0 标题+标签）→详情页头部（L1 描述+状态）→详情页评论区（L2 讨论）→详情页 Events（L3 操作日志）。但 GitHub 不会要求 README 文件也用四层展示——README 就是 README，一页全量。这和 GlassCortex 的 NutritionLabel "数据不需要分层"是一致的。

### 未解决的问题

1. **层数边界的模糊性**：ContextualLens 现在有 L0（透镜图标）、L1（来源简述）、L2（流水线明细）。一个来自研究者的反馈说：「我想在 ContextualLens 里看到 MMR 的 λ 值和 SQL 的 k 参数，这算 L2 还是 L1？」——当用户期望某个信息在特定层、但设计者把它放在了另一层时，产生了心智模型错位。是否需要为每个组件标注层内目录（"L1 包含：来源、时间、相关度"）？

2. **L3 的访问门槛**：ProcessDrawer 的 L3（Lab 路由）需要用户点击两次（展开 Section + 切换 Tab），而 ChatMessage 根本没有 L3。如果用户习惯了 ProcessDrawer 的四层结构，到了只有两层的组件时会不会觉得「这个组件有隐藏内容我没找到」？L2 的「空层」问题反向——用户期待多层时发现没有，产生失望。

3. **层数与移动端适配**：当前 L0→L3 模型是为桌面宽屏设计的（L0 在 OnionPanel 标题栏、L1 在折叠面板、L2-L3 在更深的分页）。在移动端（Phase 33 Batch 1 之后），ProcessDrawer 的 L1 面板已经做了垂直滚动适配，但 L3 Lab 路由在小屏幕上体验仍然不佳。移动端是否需要压缩到 L0-L1 两层？如果是，那 L0-L3 模型就不再是「统一的跨组件模型」了——在桌面端和移动端也是不一样的。层数是否需要响应屏幕宽度？

### GlassCortex 的后续方向

一个更严谨的模型：不是「L0-L3 四层统一规格」，而是「每层深度由组件自己的 **LayerContract** 定义」——组件声明自己实现了哪些层、每层包含什么、最多多少字。这个 LayerContract 可以列在组件的 README 或 Architecture.md 中，作为透明化设计的模块清单。这样既保留了 L0-L3 的统一逻辑（从表面走向深度），又解耦了层数必须一致的伪约束。

> 置信度：0.88`,
  },
  {
    id: "q7.6",
    question: '错误教学化 vs 错误隐藏：什么时候该展示错误让用户理解系统局限？',
    chapter: "ch7",
    chapterTitle: "第 7 章：透明化设计",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.9 },
    overallConfidence: 0.9,
    l0: '错误处理有两个极端——静默 fallback（什么都不说，假装没出错）和原始报错（把 traceback 甩用户脸上）。好的做法在中间：用三段叙事告诉用户「发生了什么、为什么、我能做什么」——让错误成为理解系统边界的窗口，而不是信心的粉碎机。',
    l1: `你坐上一辆自动驾驶汽车。突然车子减速了，中控屏亮了一下。你问「怎么了？」如果屏幕显示 \`Error code 0x7B: LiDAR segmentation fault at 0x1A2F\`——你更慌了。如果屏幕显示「前方有雾，能见度降低。已自动减速以保证安全。雾散后恢复正常速度」——你虽然有点紧张，但你知道发生了什么、为什么这样做、接下来会怎样。

这就是[错误教学化](https://baike.baidu.com/item/错误处理)和错误隐藏的核心区别。不是「该不该提示用户」的二元选择，而是**在什么场景下、用什么样的语言、给用户多少信息**的频谱。

### 三种错误处理层级

**第一层：静默 Fallback（什么都不说）**

出错后悄悄切到备用方案，用户完全不知道发生了什么。比如 API key 没配，ChatEngine 静默降级为离线模式，回复面板显示一句「API 未配置，无法生成回复」。

- **适用场景**：用户无法解决的系统级问题（API key、网络、服务配置）。你告诉用户「DeepSeek API 返回 401 Unauthorized」——用户能做什么？去注册 DeepSeek？改代码？更多时候只会增加焦虑。
- **风险**：静默 fallback 让系统看起来「好像还能用」，但实际上功能残缺。用户不知道为什么回复突然变短了、为什么记忆好像不管用了——他们只会觉得「这个 AI 不太聪明」。

**第二层：原始报错（把 traceback 甩脸上）**

错误信息原样透传——\`sqlite3.OperationalError: database is locked\`。给开发者的调试信息原封不动地给用户看。

- **这是一个反模式**。Traceback 对用户不仅无意义，而且有伤害——它让用户觉得「这个产品还没做完」「我是不是搞坏了什么」。更危险的是，traceback 可能泄露系统路径、API key 前缀、数据库结构等敏感信息。

**第三层：教学化错误（三段叙事）**

这正是 GlassCortex 的三段叙事错误设计（已迁移至 Next.js ErrorDisplay 组件）——把每个用户能看见的错误翻译成三段叙事：

\`\`\`
**发生了什么**
一句话描述当前状态，用非技术语言。

**为什么**
根因说明，不给 traceback，给原因。

**我能做什么**
可操作的下一步指引。如果用户什么都做不了，至少说「系统已自动使用备用方案」。
\`\`\`

一个真实的例子——当 AI 生成回复失败时，GlassCortex 显示的是：

> **发生了什么**：AI 回复生成失败。
>
> **为什么**：DeepSeek API 返回了错误——可能是网络超时或临时服务故障。
>
> **我能做什么**：你可以再试一次。如果连续失败，稍等片刻再发送消息，或检查网络连接。

对比如果不做教学化，用户看到的是：\`openai.APIError: Connection timeout after 30s\`——一句让人皱眉的 techno-babble。

### 什么时候展示、什么时候隐藏？

| 场景 | 策略 | 理由 |
|------|------|------|
| API key 未配置 | 静默 fallback + info 提示 | 用户无法解决，但需要知道功能受限 |
| LLM API 超时/报错 | 教学化 warning | 用户可重试，需要知道发生了什么 |
| 上下文窗口溢出 | 教学化 warning（当前已使用 N%）| 用户可以调整——缩短对话或切换策略 |
| 事实抽取失败 | 静默 fallback（跳过本轮抽取）| 不影响核心对话体验，后台记录日志 |
| 记忆编辑内容为空 | 教学化 error（「编辑内容不能为空」）| 用户操作失误，告诉用户怎么改 |
| JSON 解析错误 | 静默 fallback + 日志 | 内部容错机制，用户不应感知 |
| 数据库写入失败 | 教学化 error + 严重性警告 | 用户的数据可能丢失，需要告知 |

GlassCortex 在 7 个调用点使用了 \`format_error_narrative()\`：API key 缺失（chat 页）、上下文溢出、LLM 生成失败、知识抽取失败、JSON 解析错误、记忆编辑为空、溢出沙箱加载失败。前 3 个在聊天页（用户高频接触），中间 2 个在画像页（偶尔遇到），后 2 个在 Lab 页和记忆管理（低频操作）。

### 为什么不全部都教学化？

因为教学化本身有成本——每条教学化错误需要人工设计叙事文案，而且需要维护（如果 API 换了，错误原因可能也变了）。更重要的是，**错误教学化占屏幕空间**——如果聊天页每条消息旁边都弹一个三段叙事 warning，用户很快会产生「这个 AI 怎么到处都是 bug」的印象。选择哪些错误值得教学化的标准是：**用户是否有可能因为这个错误而改变行为**。如果用户无法改变任何事，静默 fallback + 日志记录是最优解。

\`\`\`mermaid
%% title: 图：错误教学化决策树
graph TD
    ERR["⚠️ 系统错误发生"]
    ERR --> Q{"用户能否改变结果？"}
    Q -->|"不能<br/>API key未配 · JSON解析<br/>内部容错"| SILENT["🔇 静默 Fallback"]
    SILENT --> S1["记录详细日志<br/>供开发者调试"]
    SILENT --> S2["用户侧：轻度提示<br/>或自动降级"]
    Q -->|"能<br/>重试 · 修改输入<br/>调整设置"| TEACH["📖 教学化错误"]
    TEACH --> T1["「发生了什么」<br/>非技术语言描述"]
    T1 --> T2["「为什么」<br/>根因 · 不给 traceback"]
    T2 --> T3["「我能做什么」<br/>具体可操作步骤"]
    T3 --> SEV{"严重度判定"}
    SEV -->|"信息提示"| INFO["🔵 info<br/>API key 未配置"]
    SEV -->|"警告"| WARN["🟡 warning<br/>超时 · 溢出 · 生成失败"]
    SEV -->|"错误"| ERR2["🔴 error<br/>编辑为空 · DB 失败"]
    style ERR fill:#4f46e5,stroke:#4338ca,color:#fff
    style SILENT fill:#9ca3af,stroke:#6b7280,color:#fff
    style TEACH fill:#34d399,stroke:#059669,color:#111
    style INFO fill:#93c5fd,stroke:#3b82f6,color:#1e3a5f
    style WARN fill:#fcd34d,stroke:#f59e0b,color:#78350f
    style ERR2 fill:#fca5a5,stroke:#ef4444,color:#7f1d1d
\`\`\`

> 置信度：0.95`,
    l2: `### \`format_error_narrative()\` 的设计

\`\`\`python
def format_error_narrative(what: str, why: str, action: str) -> str:
    """格式化三段式教学化错误消息。纯函数，零 Streamlit 依赖。"""
    return f"**发生了什么**\\n{what}\\n\\n**为什么**\\n{why}\\n\\n**我能做什么**\\n{action}"
\`\`\`

关键设计决策：

1. **纯函数，零依赖**——不 import 前端框架特定 API、不读全局状态、不调后端 API。调用方自己决定用 error / warning / info 哪种容器渲染（Next.js 中对应 ErrorDisplay 组件的 variant 属性）。这保证了错误渲染本身不会因为框架版本升级而崩溃——如果连错误提示都崩了，用户面对的就是一面白墙。

2. **三段固定结构**——不是自由格式，不是模板填空。每段一行标题 + 一段正文。结构固定意味着每个调用点的维护者不需要思考「这段错误的格式应该长什么样」——复制一个现有调用点，改三段文字即可。

3. **不带技术细节**——what 段不写「\`APIError: Connection timeout on https://api.deepseek.com/v1/chat/completions after 30.0s\`」，而写「DeepSeek API 返回了错误——可能是网络超时或临时服务故障」。技术细节保留在日志中（\`logger.warning(...)\`），用户只看到人类可读的翻译。

### 7 个调用点分布

| 调用点 | 容器 | 严重度 | 用户可操作 |
|--------|------|--------|-----------|
| API Key 未设置 | info 提示 | 信息 | 设置 API key |
| 上下文窗口溢出 | warning 提示 | 警告 | 缩短对话/切换策略 |
| AI 生成失败 | warning 提示 | 警告 | 重试 |
| 知识抽取失败 | warning 提示 | 警告 | 无（静默跳过） |
| JSON 解析错误 | error 提示 | 错误 | 无（自动回退） |
| 编辑内容为空 | error 提示 | 错误 | 修改输入 |
| 溢出沙箱失败 | error 提示 | 错误 | 重试 |

info 提示用于不需要用户焦虑的信息提示（API key 缺失是配置问题，不是运行时故障）。warning 提示用于需要用户知道但不需要立即行动的。error 提示用于需要用户立即纠正的操作失误。

### 反模式：错误隐藏的代价

错误分类重构（Batch 编号统一为 Phase N Batch M 体系）前，7 个调用点中有 5 个使用的是原始技术错误消息或静默 fallback 无提示。用户面对的情况：
- LLM 调用失败 → 聊天输入框卡住，没有任何反馈 → 用户反复点发送 → 仍然卡住 → 关掉页面
- 知识抽取失败 → 用户画像页空白 → 用户以为「系统没学到东西」→ 但实际上只是解析 bug

**错误隐藏会制造「对系统的错误心智模型」**——用户以为 AI 记住了某些事，实际上没有；用户以为 AI 变笨了，实际上只是 API 超时。教学化错误暴露了系统的真实边界——这是透明化设计的核心，不是锦上添花的 UI 优化。

> 置信度：0.93`,
    l3: `### 当前行业实践

- **Stripe 的错误消息设计**（业界标杆）：每个 API 错误返回结构化 JSON——\`type\`（错误分类）、\`code\`（精确错误码）、\`message\`（人类可读描述）、\`doc_url\`（指向文档的链接）。开发者可以决定「给用户看 message」「给用户看 doc_url」「自己翻译后再展示」。这是一个完整的错误透明度层级。
- **Apple Human Interface Guidelines**：错误分为「用户可纠正」和「系统级」。前者必须显示清晰的解决步骤；后者只显示通用提示 + 自动重试，不做技术细节展示。
- **GitHub Copilot**：当模型推理失败时，不显示错误详情——显示「Copilot 遇到了问题。请稍后再试。」这是典型的「静默 + 通用提示」策略，因为用户完全无法干预模型推理。

### 未解决的问题

1. **累积错误的疲劳感**：如果用户连续遇到 3 个教学化错误——「AI 回复失败」「知识抽取失败」「溢出警告」——三条三段叙事叠在一起，用户是变得更理解系统了，还是更焦虑了？是否需要「错误聚合」——多个同类错误合并为一条摘要提示？

2. **错误的个性化教学**：不同用户对错误的容忍度不同。开发者在调试模式下**想要**看到技术细节；普通用户想要简单的「重试」按钮。是否可以根据用户画像调整错误的粒度？

3. **错误频率的自适应**：同一个错误第一次出现 → 教学化叙事。同一个错误第 10 次出现 → 用户已经知道怎么回事了，重复教学化是噪音。是否需要「错误冷却」——同类错误在 N 分钟内只展示一次完整叙事，后续简化为一行提示？

4. **教学化错误的 A/B 测试**：怎么证明教学化错误**真的**改善了用户体验？指标是什么——用户重试率？会话时长？用户手动关闭错误的频率？目前这些都是主观判断，缺少量化证据。

### GlassCortex 的后续方向

错误消息可以从静态函数参数升级为结构化错误对象——包含错误码、严重度、重试建议、冷却时间。结合用户画像（开发者 vs 普通用户），动态选择展示粒度。

> 置信度：0.90`,
  },
];