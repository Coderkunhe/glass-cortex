import type { Answer } from "../types";

/** 第 8 章：元认知 答案列表 */
export const CH8_ANSWERS: Answer[] = [
  {
    id: "q8.1",
    question: '置信度校准：系统输出的置信度数值和实际准确率是否一致？',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P3",
    confidence: { l0: 0.93, l1: 0.91, l2: 0.88, l3: 0.85 },
    overallConfidence: 0.85,
    l0: 'GlassCortex 有完整的置信度赋值体系——四个 Planner 模块共享同一套常量（_FALLBACK_CONFIDENCE=0.3 / _DEFAULT_CONFIDENCE=0.5），事实层有 merge boost + conflict penalty 的置信度更新机制，召回的 score 是 similarity × confidence——但所有这些数字都没有与"实际准确率"做对比的反馈回路，校准链路在当前代码中是断开的。',
    l1: `假设你雇了一个天气预报员。每天早晨他说"今天有 70% 的概率下雨"，你打开窗一看——晴空万里。第二天、第三天同样的事发生。问题是：这个 70% 的"置信度"和实际的下雨频率之间没有任何校准机制——预报员从不回头看"我说 70% 的那些天，到底下了多少天雨"。

GlassCortex 的置信度系统恰好处于这个状态。它有足够精准的数字，但校准回路是断开的。

### 置信度的三处产生点

GlassCortex 里置信度数字在三个地方产生：

**1. Planner 层 — 四个模块共享同一套常量**

在 \`src/planner/intent.py:34-35\`、\`src/planner/plan.py:28-29\`、\`src/planner/replan.py:29-30\`、\`src/planner/reflection.py:28-29\`，每个 Planner 模块都定义了一模一样的常量：

\`\`\`
_FALLBACK_CONFIDENCE = 0.3   # LLM 调用失败时使用
_DEFAULT_CONFIDENCE = 0.5    # JSON 解析成功但缺少 confidence 字段
_CONFIDENCE_MIN = 0.0
_CONFIDENCE_MAX = 1.0
\`\`\`

这四组常量的含义：LLM 调用失败 → 置信度 0.3（"我不确定，但给你一个保守估计"）；LLM 返回了结构化结果但忘了写 confidence 字段 → 置信度 0.5（"有一半把握"）——这些都是启发式赋值，不是从数据中学来的。

**2. 事实层 — 动态更新 but 无校准参考**

\`src/memory/fact.py:307\` 的 merge 增强公式：
\`\`\`python
delta = settings.fact_delta_base + settings.fact_delta_sim_multiplier * 0.95
# = 0.05 + 0.1 * 0.95 = 0.145
\`\`\`
当同样的 (subject, relation, object) 三元组再次出现，置信度增加 0.145。

\`src/memory/fact.py:328-351\` 的冲突惩罚：
\`\`\`python
conflict_penalty = settings.conflict_confidence_penalty  # 0.2
new_conf = max(0.0, old_conf - conflict_penalty)
\`\`\`
当同样的 (s, r) 但不同的 o 出现，旧事实置信度降 0.2，新事实以（初始值 - 0.2）起步。

这些数值（\`src/config.py:78-81\`）是手工调的参数，不是从事实的历史准确率数据中拟合出来的。

**3. 召回层 — 置信度作为过滤因子**

\`src/memory/recall.py:87-90\` 的召回过滤：
\`\`\`python
confidence = cast(float, fact["confidence"])
if confidence < threshold:  # 默认 0.1 (src/config.py:51)
    continue
score = similarity * confidence
\`\`\`
低置信度的事实直接被丢弃。但如果某个置信度 0.15 的事实实际上准确率很高，系统永远不会知道——它被自己设的门槛挡住了。

### 校准回路的缺失

整个流程是这样的：

\`\`\`mermaid
%% title: 图：置信度赋值与校准断点——数字有出处，反哺无回路
graph TD
    subgraph 赋值["✅ 置信度赋值（已实现）"]
        C1["Planner 层<br/>FALLBACK=0.3 DEFAULT=0.5"]
        C2["事实层<br/>merge +0.145 conflict -0.2"]
        C3["召回层<br/>score = sim × confidence"]
    end
    C1 --> C3
    C2 --> C3

    subgraph 校准["❌ 校准回路（缺失）"]
        CAL["实际准确率<br/>反馈采集"]
        ADJ["参数自调整<br/>_FALLBACK_CONFIDENCE 更新"]
    end
    C3 -.->|"断开"| CAL
    CAL -.->|"断开"| ADJ
    ADJ -.->|"断开"| C1

    style C1 fill:#6366f1,stroke:#4338ca,color:#fff
    style C2 fill:#6366f1,stroke:#4338ca,color:#fff
    style C3 fill:#6366f1,stroke:#4338ca,color:#fff
    style CAL fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style ADJ fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
\`\`\`

\`src/config.py:67\` 的 \`default_confidence = 0.5\` 是整个系统唯一可调的"旋钮值"。其他所有置信度常量和公式参数都是硬编码的，没有运行时自调整机制。

### 三处置信度的对比

| 产生源 | 赋值方式 | 能否被验证 | 代码位置 |
|--------|---------|:--------:|---------|
| Planner 常量 | 启发式硬编码 (0.3/0.5) | ❌ 无反馈采集 | \`intent.py:34\` \`plan.py:28\` \`replan.py:29\` \`reflection.py:28\` |
| Fact merge boost | 公式固定 (+0.145) | ❌ | \`fact.py:307\` \`config.py:78-79\` |
| Fact conflict penalty | 固定 (-0.2) | ❌ | \`fact.py:328-351\` \`config.py:81\` |
| Recall filtering | threshold=0.1 | ❌ | \`recall.py:87\` \`config.py:51\` |

> 置信度：0.91`,
    l2: `### 置信度的完整生命周期（事实层视角）

一条事实从产生到被召回，置信度经历以下变化：

\`\`\`mermaid
%% title: 图：事实置信度生命周期——从入库到召回的全路径
graph LR
    A["① 新建事实<br/>confidence=0.6<br/>config.py:80"]
    B["② 被确认<br/>同样三元组再次出现<br/>merge: +0.145"]
    C["③ 被挑战<br/>同(s,r)不同o<br/>conflict: -0.2"]
    D["④ 被遗忘<br/>DecayEngine.decay_all()<br/>按衰减曲线降权"]
    E["⑤ 被过滤<br/>confidence < threshold(0.1)<br/>recall.py:88 直接丢弃"]

    A -->|"再次出现"| B
    A -->|"冲突出现"| C
    B --> D
    C --> D
    D --> E
    B -.->|"循环"| B

    style A fill:#818cf8,stroke:#6366f1,color:#fff
    style B fill:#34d399,stroke:#059669
    style C fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style D fill:#fef9c3,stroke:#ca8a04
    style E fill:#d1d5db,stroke:#6b7280
\`\`\`

这个生命周期里每一步都是**单向**的——没有一步回头看看"我之前给的置信度 0.6，这件事后来被验证是对还是错"。

### 如果要做校准，需要什么

校准链路的关键瓶颈不在于算法——二分类校准（概率输出 vs 实际标签）是一个被充分研究的问题。瓶颈在于**标签收集**：谁来告诉你"这件事是对的"？

可能的标签来源：

| 标签来源 | 可靠性 | 延迟 | 成本 |
|---------|:-----:|:---:|:---:|
| 用户主动纠正 | 高（用户最了解自己） | 分钟-天 | 低 |
| 下游事实冲突 | 中（冲突≠错误） | 实时 | 零（已有） |
| LLM 自我评估 | 低（自我确认偏误） | 实时 | token 成本 |
| 人工标注 | 高 | 天-周 | 极高 |

GlassCortex 已有第一和第二种信号——\`api/routers/memory.py:132\` 的 \`POST /memory/facts/{fact_id}/confidence\` 允许用户手动调置信度，\`src/memory/fact.py:328-351\` 的冲突检测自动降权。但它们只是信号源，不是校准链路——没有一个 PID 控制器在背后跑着说"我给了 100 次置信度估计，其中 73 次被验证正确，我高估了，下降 0.05"。

> 置信度：0.88`,
    l3: `### 行业实践

| 系统/方法 | 校准方式 | 核心思想 |
|-----------|---------|---------|
| OpenAI logprobs | 输出 token 级别对数概率，但无后验校准 | 透明度 > 精度：给你看原始数字，自己判断 |
| Anthropic Constitutional AI | 基于规则的自我评估，无定量校准 | 用规则代替代数——定性 > 定量 |
| Platt Scaling | 对分类器输出做逻辑回归校准 | 最经典的后校准方法，需要一个带标签的验证集 |
| Isotonic Regression | 非参数更灵活的校准曲线拟合 | 比 Platt 更灵活，但需要更多数据 |
| Bayesian Truth Serum | 基于"你猜别人会怎么答"来校准你的置信度 | 不需要真值标签，用同伴预测做代理 |
| GlassCortex | 启发式常量 (.3/.5)，无反馈回路 | 赋值体系完整，校准回路断开 |

### 未解决的三个问题

1. **标签从哪来**——置信度校准需要一个"正确答案"作为参照物。但 AI 系统的很多输出没有客观正确答案——"最好的回答方式"在不同用户眼里不同。校准的前提是存在一个可以被多数人认同的"正确"标准。

2. **校准的代价**——如果每一轮对话后都跑一次置信度校准更新，这本身就是一次额外的计算。对于每分钟几百条消息的系统，累积成本不低。但如果只在夜间批量跑，校准的时效性又不够。需要在实时校准和批处理之间找到平衡点。

3. **过度校准的风险**——如果系统把置信度从 0.85 校准到 0.92（因为过去 10 次都对了），它就变得更加自信。但这 10 次正确可能只是因为问题类型恰好是它的强项。校准可能放大数据的偏斜，而不是消除它。一个被"过度校准"的系统比一个未经校准的系统更危险——因为它对错误也充满信心。

> 置信度：0.85`,
    crossChapterConnections: [
      {
        questionId: "q2.9",
        type: "prerequisite",
        relationship: "Ch2 的不一致记忆处理中，冲突检测 (conflict_penalty=0.2) 正是置信度校准的最基本信号——两个事实打架时，谁的置信度该降？降多少？",
      },
      {
        questionId: "q4.3",
        type: "parallel",
        relationship: "Token 预算的动态调整（Ch4 q4.3）和置信度参数的动态校准是同一类问题——两者都需要反馈回路，两者当前都没有闭环。",
      },
      {
        questionId: "q7.6",
        type: "application",
        relationship: '置信度数字本身不说明任何事——用户看到「置信度 87%」和看到「我猜是这样」是完全不同的体验。如何把数字翻译成叙述，是 Ch7 透明化设计的核心命题。',
      },
    ],
  },
  {
    id: "q8.2",
    question: '已知的未知：系统能不能识别"这个问题我回答不了" vs "我有信息但不确定"？',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P3",
    confidence: { l0: 0.93, l1: 0.90, l2: 0.88, l3: 0.84 },
    overallConfidence: 0.84,
    l0: 'GlassCortex 有两种机制区分「有信息但不确定」和「完全没有信息」——loss_detection_enabled (config.py:82) 触发事实抽取的完整性自检（知道可能有遗漏），planner_enabled 关闭时返回 confidence=0.0（知道完全无能为力）——但这个区分是隐式的，代码里没有一个显式的「知识边界」概念在运行时被系统查询。',
    l1: `一个图书管理员站在你面前。你问："你们有 18 世纪法国诗歌的原版吗？" 她可以有两种回答：

- A："我不确定。我们的诗歌区在二楼，法国文学在靠窗那排，但我没具体查过 18 世纪的库存。你可以去那里翻翻，或者我帮你查一下目录。"（**已知的未知**——她知道信息在哪，知道怎么查，但不确切知道答案）
- B："我没办法回答你——我们的目录系统今天坏了，我完全不知道架子上有什么。"（**未知的未知**——她连"不知道"的边界在哪里都不知道）

这两个回答的质量完全不同。A 给了你下一步行动（"去二楼翻翻""帮你查目录"），B 只是关上大门。GlassCortex 有没有机制区分 A 和 B？

### 当前的两个天然分界点

**分界点 1：loss_detection_enabled — 「我知道可能有遗漏」**

在 \`src/config.py:82\`，有一个不起眼的开关：

\`\`\`
loss_detection_enabled: bool = True
\`\`\`

当它为 True 时，\`src/memory/fact.py:182-183\` 在事实抽取的系统提示词末尾追加一句：

\`\`\`python
system_prompt += "7. 提取完成后，复查原始消息——如有遗漏的重要用户信息，请补充\\n"
\`\`\`

这一行就是 GlassCortex 最接近「已知的未知」的代码。它在说：「你刚才提取了用户消息中的事实，但你可能漏了一些——回头看一眼。」这是系统对自己认知能力的怀疑——它知道自己的事实抽取器不完美，所以加了复查步骤。

**分界点 2：planner_enabled 关闭 — 「我无能为力」**

\`src/planner/intent.py:161-162\` 的 gate：

\`\`\`python
if not settings.planner_enabled:
    return IntentResult("提问", 0.0, "Planner 已禁用"), {}
\`\`\`

这里 confidence=0.0 的意义不是「我不确定」而是「我完全没有能力做这件事」。它是一个硬性边界——能力被撤销了，不是暂时失效。

\`\`\`mermaid
%% title: 图：已知的未知 vs 未知的未知——双通道检测模型
graph TD
    MSG["用户消息到达"] --> INTENT["意图分类<br/>intent.py:161"]
    INTENT --> CHECK{"planner_enabled?"}
    CHECK -->|"❌ 否"| UNK_UNK["🔴 未知的未知<br/>confidence=0.0<br/>系统完全无法处理"]
    CHECK -->|"✅ 是"| FACT["事实抽取<br/>fact.py:182"]
    FACT --> LOSS{"loss_detection<br/>enabled?"}
    LOSS -->|"✅ 是"| KNOWN_UNK["🟡 已知的未知<br/>复查遗漏、冲突检测<br/>fact.py:183 · fact.py:319"]
    LOSS -->|"❌ 否"| BEST["🟢 尽力而为<br/>无完整性自检<br/>不知道是否遗漏"]

    KNOWN_UNK --> RECALL["认知操作继续<br/>recall.py:87 置信度过滤<br/>score = sim × confidence"]
    BEST --> RECALL

    style UNK_UNK fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style KNOWN_UNK fill:#fef9c3,stroke:#ca8a04
    style BEST fill:#34d399,stroke:#059669
\`\`\`

### 为什么是隐式的

当前的两个分界点都不是被设计出来的「已知未知识别层」——它们是别的功能的副作用：

| 机制 | 原始目的 | 副产品 |
|------|---------|--------|
| \`loss_detection_enabled\` | 提升事实抽取召回率 | 暗示系统知道「我可能漏了东西」 |
| \`planner_enabled\` | 开关 Planner 功能 | 暗示系统知道「我现在做不了这个」 |
| 冲突检测 (\`fact.py:319-337\`) | 防止矛盾事实积累 | 暗示系统知道「我之前可能记错了」 |
| 召回置信度过滤 (\`recall.py:87-88\`) | 排除低质量记忆 | 暗示系统知道「这段记忆不太可靠」 |

四个机制，四种不同形式的「知道自己不确定」，但没有任何一个代码路径显式地说：「我是已知的未知，让我告诉用户。」

> 置信度：0.90`,
    l2: `### 四个机制的具体行为

**1. loss_detection_enabled — 最接近「已知的未知」**

\`src/memory/fact.py:182-183\` 的复查提示词是事后检查——它在抽取结束后问 LLM「有没有漏掉的」。这个设计有一个微妙的局限：它只能检测到「抽取不完整」（漏了某些事实），不能检测到「抽取错误」（把事实搞错了）。换句话说，它知道可能「少了什么」，不知道「什么搞错了」。

**2. planner_enabled — 最接近「未知的未知」**

\`src/planner/intent.py:161-162\` 当 planner 被禁用时返回 confidence=0.0。但这和真正的「未知的未知」有一个关键区别——它不是因为系统发现自己做不到，而是因为管理员关了开关。真正的未知的未知应该是系统在运行时自检后发现「这个问题超出我的能力」，而不是被配置项挡在外面。

**3. 冲突检测 — 隐式的「我可能记错了」**

\`src/memory/fact.py:319-337\` 在检测到同一个 (subject, relation) 出现不同的 object 时：

\`\`\`python
conflict_penalty = settings.conflict_confidence_penalty  # 0.2
new_conf = max(0.0, old_conf - conflict_penalty)
\`\`\`

冲突检测是双通道的——确实出现了矛盾的信号，系统降低了旧事实的置信度并创建了新事实。但这段代码只处理「两个事实打架」的情况——它不能处理「我只有一个事实，但我怀疑它可能不准」。前者需要矛盾证据，后者需要自知之明。

**4. 召回置信度过滤 — 隐式的「我不够确定」**

\`src/memory/recall.py:87-88\` 在召回时直接丢弃低置信度事实，threshold 默认 0.1（\`src/config.py:51\`）。这是一个静默操作——用户永远不会知道有一条低置信度的事实被扔掉了。如果被扔掉的恰好是用户最需要的信息，这个「已知的未知」变成了「遗忘的遗忘」——不仅不知道，而且不知道「自己不知道」。

### 如果做一个显式的「知识边界查询」

\`\`\`python
# 伪代码 —— 这不存在于当前代码库
def query_knowledge_boundary(self, question: str) -> KnowledgeBoundary:
    """回答之前先自检：关于这个话题，我知道多少？"""
    facts = self.memory.recall(question)
    if not facts:
        return KnowledgeBoundary.UNKNOWN  # 未知的未知
    if all(f.confidence < 0.3 for f in facts):
        return KnowledgeBoundary.LOW_CONFIDENCE  # 已知的未知
    return KnowledgeBoundary.CONFIDENT  # 确信
\`\`\`

这个思路的难题在于：「相关事实为零」和「我没找到相关事实」在工程上是同一个结果——空列表。区分它们需要一层元数据：不仅要返回召回了什么，还要返回「为什么不召回更多」的原因。

> 置信度：0.88`,
    l3: `### 行业实践

| 系统/方法 | 「已知的未知」处理方式 | 核心策略 |
|-----------|:-----------------:|---------|
| RAG 系统 (如 Perplexity) | 低相关性片段被丢弃，不告知用户 | 静默降级——用户不知道有不确定性 |
| Claude | 训练数据中包含「I\'m not sure」表述，但触发条件不透明 | 模型自行判断何时不确定 |
| 主动学习 (Active Learning) | 显式查询不确定性样本，请求人工标注 | 最纯粹的「已知的未知」——数据驱动 |
| 异常检测 (Anomaly Detection) | 输入与训练分布偏差过大 → 标记为 OOD | 分布外检测就是「这是未知的未知」 |
| GlassCortex | 四个隐式机制（loss_detection / planner gate / conflict / recall threshold）工作但不暴露 | 知道但不说 |

### 未解决的三个问题

1. **「遗忘的遗忘」**——如果一条低置信度事实在 recall.py:88 被丢弃，用户不会知道。但如果这条被丢弃的事实恰好包含了用户当前问题的关键信息，系统既不知道答案，也不知道「自己曾经有过答案但扔掉了」。这是元认知的递归陷阱——你不知道你不知道什么。

2. **区分缺失和沉默**——空列表可能意味着「我没存储相关信息」（真的不知道），也可能意味着「我存储了但没找到」（有但不知道在哪），也可能意味着「我找到了但置信度太低扔掉了」（有但不敢相信）。这三种情况对用户的含义完全不同，但当前代码把它们全部折叠成了「没有召回结果」。

3. **已知未知的表达成本**——如果每次回答前都先声明「关于这个话题，以下是我的不确定假设」，用户会感到重复。但如果只有不确定性高的时候才声明，如何定义「高」又回到了 q8.1 的校准问题。元认知的每一层都互相缠绕。

> 置信度：0.84`,
    crossChapterConnections: [
      {
        questionId: "q1.10",
        type: "prerequisite",
        relationship: '上下文溢出（Ch1 q1.10）丢弃的信息就是系统对用户的「未知」——溢出的瞬间，系统从「可能知道」变成了「不知道」。loss_detection 是在事件发生后尝试补救。',
      },
      {
        questionId: "q2.20",
        type: "parallel",
        relationship: 'Ch2 的记忆污染和本问的「已知的未知」是同一枚硬币的两面——污染是「记错了但不知道」，已知的未知是「不确定但知道自己在不确定」。',
      },
      {
        questionId: "q8.5",
        type: "application",
        relationship: '区分完「已知的未知」和「未知的未知」之后，下一步就是怎么告诉用户——q8.5 的分级求助语言正是这个表达层的实现。',
      },
    ],
  },
  {
    id: "q8.3",
    question: '自我质疑：在生成回复前，系统能不能跑一个快速的"自我审查"？',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P3",
    confidence: { l0: 0.93, l1: 0.90, l2: 0.88, l3: 0.83 },
    overallConfidence: 0.83,
    l0: 'GlassCortex 的规划系统有 4 个已交付子阶段——Intent（intent.py 289 行）→ Plan（plan.py 341 行，含 plan_history 历史注入）→ Replan（replan.py 809 行，含 StepStatus/StepRecord 步骤监控）→ Reflection（reflection.py 1079 行，含 post_mortem 事后偏差分析 + distill_plan_template 知识蒸馏）——它们构成完整的意图→执行→纠偏→反思闭环。冲突检测（fact.py:319-337）在事实层是实时自审查，但其审查范围仅限于「两个事实是不是打架」，不覆盖回复内容质量。"回复发出前的强制闸门"（逐条 LLM 输出质量审查）仍为远期方向。',
    l1: `假设你是一个写作者，刚写完一篇长文章的初稿。你有两种习惯可选：

- **习惯 A**：写完直接发给编辑，编辑看到了错别字和逻辑漏洞，退回来让你改。
- **习惯 B**：写完以后，你先对着一份自检清单过一遍——「核心论点是否在第一段出现了？」「每个段落的证据是否足够？」「有没有用词重复？」，修完一遍之后再发给编辑。

习惯 A 是**事后反馈**（别人帮你发现问题），习惯 B 是**事前自我审查**（你自己先过一遍）。GlassCortex 目前处于 A 阶段——它有事后审查能力，但缺少回复发出前的强制闸门。

### 两个已有的事后自我审查机制

**ReflectionEngine — 会话结束后反思**

\`src/planner/reflection.py\`（1079 行）的 \`reflect()\` 方法在会话结束后运行。它会拿用户消息、意图类别、生成的计划和对话摘要，交给 LLM 去评价：
- 计划是否匹配了实际对话？
- 有什么遗漏或冗余？
- 有什么可以改进的？

Phase 61 扩展了反思能力——\`post_mortem()\` 对比实际 vs 计划偏差并合成 LLM 改进建议，\`distill_plan_template()\` 从成功计划蒸馏最佳实践模板，\`extract_meta_knowledge()\` 将跨会话的通用规律写入 \`reflection_insights\` 表。输出包含 \`ReflectionResult\`（plan_quality_score + improvement_suggestions）和 \`PostMortemResult\`（deviations + recommendations）。

反思已从纯展示升级为知识闭环——reflection_insights 表持久化元知识，供后续计划生成参考。

**ReplanDetector — 检测意图漂移**

\`src/planner/replan.py\`（809 行）已升级为完整的动态重规划引擎——\`detect_replan()\` 检测意图漂移，\`monitor_step()\` 通过 StepStatus/StepRecord 监控每步执行（5 态：pending/in_progress/completed/failed/skipped），\`generate_partial_replan()\` 从失败步骤局部重规划，DAG 依赖自动重算。ReplanComparePanel 前端并排展示原计划 vs 修正计划。用户可通过 PATCH API 逐步骤干预（跳过/修改/补充）。

但仍然是事后的——它在用户纠正或步骤失败后运行，不是在回复发出前运行。

**冲突检测 — 唯一的实时自我审查**

\`src/memory/fact.py:319-337\` 在每次事实入库前跑冲突检测。这是 GlassCortex 唯一在「写入」前执行的自我审查——如果一个事实和已有记忆矛盾，它在入库前就被标记了。但冲突检测的范围仅限于「两个事实是否矛盾」，不检测「这个事实本身是不是对的」或「这个回复质量是否足够」。

\`\`\`mermaid
%% title: 图：自我审查机制——已有的事后能力 vs 缺失的事前闸门
graph LR
    subgraph 已有["✅ 已有 — 事后审查"]
        REFLECT["ReflectionEngine<br/>会话结束后反思<br/>reflection.py"]
        REPLAN["ReplanDetector<br/>用户纠正后检测<br/>replan.py"]
        CONFLICT["冲突检测<br/>事实入库前检查<br/>fact.py:319"]
    end

    subgraph 缺失["❌ 缺失 — 事前闸门"]
        GEN["LLM 生成内容"]
        GATE["回复质量闸门<br/>（不存在）"]
        SEND["发送给用户"]
    end

    GEN -->|"❌ 无审查"| GATE
    GATE -.->|"跳过"| SEND

    REFLECT -.->|"事后报告<br/>不阻止"| SEND
    REPLAN -.->|"事后修正<br/>不阻止"| SEND
    CONFLICT -->|"实时但<br/>仅事实层"| GEN

    style REFLECT fill:#818cf8,stroke:#6366f1,color:#fff
    style REPLAN fill:#818cf8,stroke:#6366f1,color:#fff
    style CONFLICT fill:#fef9c3,stroke:#ca8a04
    style GATE fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
\`\`\`

### 如果要在回复前加一道闸门

最简单的做法是在 \`src/chat/engine.py\` 的 \`generate()\` 返回前插入一个 \`_self_check()\`：

\`\`\`python
def generate(self, messages: list[dict]) -> tuple[str, dict]:
    response = self._call_llm(messages)
    if self._self_check_enabled:
        issues = self._self_check(response, messages)
        if issues:
            response = self._rewrite(response, issues)
    return response
\`\`\`

但问题的关键不在于「能不能加一个调用」——加一个额外的 LLM 调用永远都能做到。关键问题是：
1. **审查质量**：用一个 LLM 去审查另一个 LLM 的输出——审查者也可能犯错。审查者的 blind spot 如果和被审查者的一样，审查就是无效的。
2. **审查成本**：每次回复多跑一次 LLM 调用，token 成本翻倍。
3. **审查时机**：审查发现的问题如果要求重写，重写后要不要再审查一次？这变成了递归——永远可以多查一遍。

> 置信度：0.90`,
    l2: `### 两种审查范式的对比

| 范式 | GlassCortex 实现 | 在哪个阶段 | 是否阻断 |
|------|:--------------:|:--------:|:------:|
| 事后反思（Reflection） | \`reflection.py\` | 会话结束后 | ❌ 不阻断，仅展示 |
| 事后修正（Replan） | \`replan.py\` | 用户纠正后 | ❌ 不阻断，仅记录 |
| 入库前自检（Conflict） | \`fact.py:319-337\` | 写数据库前 | ⚠️ 降价但不拒绝 |
| 回复前自检（目标） | 不存在 | 生成后，发送前 | ✅ 应阻断/修正后发 |

### 冲突检测的自审查模型——一个可以推广的模式

\`src/memory/fact.py:319-337\` 的冲突检测之所以有效，是因为它有一个明确的可证伪标准：**同一个 (s, r) 出现不同的 o = 矛盾**。这个逻辑是机械的、不需要 LLM 调用的、不依赖自然语言理解的。

如果要在回复层做类似的机械检查，需要定义一组可机械执行的规则：

| 检查项 | 实现方式 | 是否需要 LLM |
|--------|:------:|:----------:|
| 回复是否为空 | \`len(response) == 0\` | ❌ |
| 是否和上一条回复完全相同 | hash 比对 | ❌ |
| 是否含有禁止的代码模式 | 正则匹配 | ❌ |
| 事实陈述是否和记忆库一致 | 需要 LLM 或检索 | ✅ |
| 逻辑是否自洽 | 需要 LLM | ✅ |
| 语气是否符合场景 | 需要 LLM | ✅ |

前三条是免费的——可以加在回复前而零 token 成本。后三条是昂贵的——每条都需要至少一次 LLM 调用。一个务实的渐进方案是先加免费检查，再逐步增加昂贵但高价值的检查。

### 事实抽取失败的静默处理——一次自我审查的缺席

\`src/chat/engine.py:324-331\` 的事实抽取异常处理是刻意的静默：

\`\`\`python
try:
    _, fact_trace = self._fact_extractor.extract_and_store(...)
except APIError, RuntimeError, ValueError:
    logger.warning("事实抽取失败", extra={"component": "chat"})
    # 不 raise，不通知用户
\`\`\`

这是对的——一个后台维护操作不应该阻断对话。但它暴露了自我审查的根本矛盾：**如果审查发现了问题，应该中断还是记录？** 事实抽取选择了记录（静默），但如果回复生成本身出了问题，静默可能不是最优选择——用户有权被告知「这条回复可能不对」。

> 置信度：0.88`,
    l3: `### 行业实践

| 系统/方法 | 自我审查方式 | 关键特点 |
|-----------|:----------:|---------|
| Constitutional AI (Anthropic) | 用预定义的「宪法」规则集合审查输出，违规 → 重写 | 规则审查，不是 LLM 自审查 |
| RLHF (OpenAI) | 人类反馈训练隐式自我审查能力 | 审查内化在模型权重中，不可见 |
| Self-Refine (学术) | LLM 生成 → LLM 评论 → LLM 改进 | 同模型三阶段审查，但无终止条件 |
| LangChain Self-Critique | 链式提示：生成 → 批评 → 修改 | 显式但非强制性 |
| GlassCortex | ReflectionEngine（事后）+ ReplanDetector（事后）+ 冲突检测（实时但范围窄） | 有三件工具，但没有一件是回复前的闸门 |

### 未解决的三个问题

1. **审查者和被审查者是同一个 LLM**——如果同一个模型同时负责生成和审查，它们的 blind spot 可能是同构的。就像一个作家无法完全客观地校对自己的文章——他会在同一个地方反复犯错而不自知。真正的独立审查需要一个不同的模型，或者至少一个和生成模型不同的温度/提示策略。

2. **审查递归**——如果审查发现问题 → 重写 → 再审查。这个过程在理论上是无限的。现实中的工程做法是限制重写次数（通常 2-3 次），但这就意味着系统可能带着未被发现的错误通过闸门——只不过是「查了三次没发现」。

3. **过度审查的沉默风险**——如果系统把自己审查到认为每条回复都「不够好」，它可能陷入分析瘫痪——永远不发回复，因为永远不够完美。自我质疑的程度需要和任务的容错度匹配——问路可以不确定，开药方必须经三次审查。

> 置信度：0.83`,
    crossChapterConnections: [
      {
        questionId: "q3.9",
        type: "prerequisite",
        relationship: 'ReplanDetector（Ch3 q3.9 重规划对比）正是系统对自己「之前的计划可能不对」的质疑——它检测到漂移并生成修正计划，是现有最接近「回复前自审查」的机制。',
      },
      {
        questionId: "q2.9",
        type: "parallel",
        relationship: '冲突检测（Ch2 q2.9 不一致记忆处理）和回复前的自我审查是同一个模式——在错误到达用户之前拦截它。一个在事实层，一个在回复层。',
      },
      {
        questionId: "q6.6",
        type: "application",
        relationship: '自我审查如果做成实时的（Ch6 q6.6 实时 vs 批处理），每次回复都会被闸门延迟——审查 token 成本 + 延迟增加。批处理审查（积累一批再审查）省 token 但牺牲时效。',
      },
    ],
  },
  {
    id: "q8.4",
    question: '能力边界自画像：系统知道自己能做什么、不能做什么',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P3",
    confidence: { l0: 0.94, l1: 0.91, l2: 0.89, l3: 0.85 },
    overallConfidence: 0.85,
    l0: 'GlassCortex 的能力边界由 10 个布尔开关显式定义（planner_enabled / plan_generation_enabled / plan_storage_enabled / plan_history_enabled / mmr_enabled / loss_detection_enabled / routing_enabled / tier_enabled / consolidation_enabled / session_boundary_enabled）和 8 个 API 路由模块隐式定义（chat / memory / context / planner / traces / metrics / profiles / session）——系统"能做什么"在 config.py 和 api/routers/ 中有明确的代码证据，但系统缺少一个运行时能力自画像：它不会在启动时自检"我有哪些能力可用"，也不会在用户问"你能做什么"时查询自己的配置——能力清单是给人看的，不是给系统自己查的。',
    l1: `想象你买了一台多功能打印机，它上面有十个物理开关：打印、扫描、复印、传真，还有彩色模式、双面、装订、折叠、打孔、网络共享。每个开关旁边有一个小绿灯——开着的时候亮，关着的时候灭。你走到机器前，看一眼那些灯，就知道这台机器现在能做什么。

GlassCortex 恰好处于这个状态——它有十个显式的功能开关，但缺一个"抬头看灯"的动作。

### 十个显式能力开关

GlassCortex 的能力边界在 \`src/config.py\` 中以十个布尔开关的形式存在：

| 开关 | 默认值 | 控制的能力 | 关闭后的行为 | 来源 Phase |
|------|:-----:|-----------|-------------|:---------:|
| \`planner_enabled\` (L89) | True | 意图分类（5 类） | \`intent.py:161\` 返回 confidence=0.0，跳过 LLM 调用 | Phase 37 |
| \`plan_generation_enabled\` (L92) | True | 任务规划 DAG 生成 | \`plan.py:122\` 返回空 PlanResult + rationale="任务规划已禁用" | Phase 53 |
| \`plan_storage_enabled\` (L93) | False | 任务规划持久化存储 | 不写入 plan_runs 表 | Phase 53 |
| \`plan_history_enabled\` (L95) | False | 历史计划检索注入 | \`PlanHistoryRetriever\` 不查询历史计划 | Phase 60 |
| \`mmr_enabled\` (L57) | True | MMR 多样性召回重排 | 回退到纯相关性排序，无多样性保证 | Phase 29 |
| \`loss_detection_enabled\` (L82) | True | 事实抽取完整性自检 | \`fact.py:182\` 不在系统提示词末尾追加复查指令 | Phase 1 |
| \`routing_enabled\` (L101) | False | 模型路由（简单任务→轻量模型） | ModelRouter 不执行路由决策 | Phase 55 |
| \`tier_enabled\` (L107) | False | 热/温/冷三层记忆分级 | TierClassifier 不执行分层，所有记忆统一处理 | Phase 54 |
| \`consolidation_enabled\` (L116) | False | 日终慢降温记忆固化 | ConsolidationCore 不调整 importance/λ | Phase 56 |
| \`session_boundary_enabled\` (L129) | False | 会话边界检测与摘要 | 不自动产生 SessionSummary | Phase 61 |

这十个开关是系统对自己能力的显式认知。当 \`planner_enabled=False\` 时，\`intent.py:161-162\` 明确返回 \`IntentResult("提问", 0.0, "Planner 已禁用")\`——系统知道自己不能做意图分类，并且把这个信息编码进了返回值。

### 八个隐式能力域（API 路由模块）

除了十个开关，系统的能力还分布在 8 个 API 路由模块中（\`api/routers/\`）：

| 路由模块 | 提供的能力 | 是否有开关 | 代码行数 |
|---------|-----------|:--------:|:------:|
| \`chat.py\` | 对话生成 + 流式响应 | ❌ 无开关 | 283 |
| \`memory.py\` | 事实 CRUD + 置信度手动调整 | ❌ 无开关 | 226 |
| \`context.py\` | 上下文窗口查询 + 分区 | ❌ 无开关 | 94 |
| \`planner.py\` | 意图分类 + 任务规划 + 反思 | ✅ planner_enabled | 336 |
| \`traces.py\` | 管线追踪数据查询 | ❌ 无开关 | 93 |
| \`metrics.py\` | Token 使用统计 | ❌ 无开关 | 47 |
| \`profiles.py\` | 用户画像管理（Profile/session 摘要） | ❌ 无开关 | 183 |
| \`session.py\` | 会话管理（总结/反思查询） | ❌ 无开关 | 65 |

这八个模块的能力没有一个在运行时被系统本身查询。没有一个函数叫 \`get_my_capabilities()\`，没有一个启动自检说"我现在有对话能力、记忆能力、上下文能力……但 Planner 关了"。能力清单分布在 config 和路由注册中，是给人（开发者）看的架构文档，不是给系统自己查的运行时数据。

\`\`\`mermaid
%% title: 图：能力边界的四层——显式开关 / 隐式模块 / 缺失能力 / 未知能力
graph TD
    subgraph 已知["✅ 系统明确知道的能力"]
        SWITCH["🔘 十个显式开关<br/>planner · plan_generation · plan_storage<br/>plan_history · mmr · loss_detection<br/>routing · tier · consolidation<br/>session_boundary"]
        ROUTES["📦 八个路由模块<br/>chat · memory · context<br/>planner · traces · metrics<br/>profiles · session"]
    end

    subgraph 能做但不知道["⚠️ 能做但未声明"]
        EMBED["嵌入模型<br/>all-MiniLM-L6-v2<br/>384 维向量"]
        CACHE["缓存层<br/>bootstrap.py<br/>embedding + fact 缓存"]
        DECAY["遗忘引擎<br/>decay_all()<br/>按小时衰减"]
    end

    subgraph 不能做["❌ 明确不能做"]
        NORECUR["递归自我审查<br/>（生成→审查→重写→再审查）"]
        NOCALIB["置信度自动校准<br/>（无反馈回路）"]
        NOMULTI["多模型协作<br/>（仅单一 deepseek-v4-flash）"]
    end

    SWITCH -->|"运行时生效"| ROUTES
    EMBED -.->|"存在但<br/>不自知"| ROUTES
    NORECUR -.->|"设计<br/>空白"| EMBED

    style SWITCH fill:#34d399,stroke:#059669,color:#fff
    style ROUTES fill:#818cf8,stroke:#6366f1,color:#fff
    style EMBED fill:#fef9c3,stroke:#ca8a04
    style DECAY fill:#fef9c3,stroke:#ca8a04
    style CACHE fill:#fef9c3,stroke:#ca8a04
    style NORECUR fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style NOCALIB fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
    style NOMULTI fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
\`\`\`

### 能力自画像的缺失——系统不知道自己有什么

当前的能力边界信息分散在三个地方：
- \`src/config.py\`：十个开关的值
- \`api/routers/\`：八个路由模块的注册
- \`src/bootstrap.py\`：启动时的初始化顺序（嵌入模型加载 → 缓存预热 → 索引加载）

这三处信息没有一个统一的"能力清单"数据结构。如果用户在对话中问"你能做什么？"，系统只能靠 LLM 的通用知识回答——它不会去查询自己的 config 或路由表来给出针对性的答案。一个真正的"能力边界自画像"应该是系统在启动时构建一个能力清单，并在被问到时能引用它。

> 置信度：0.91`,
    l2: `### 能力清单的完整映射——以代码路径为证

把 GlassCortex 的 14 项能力按"系统是否自知"分组：

**🔘 显式开关控制（4 项）——系统明确知道自己能做/不能做**

| 能力 | 开关 | 禁用时行为 | 代码位置 |
|------|------|-----------|---------|
| 意图分类（5 类） | \`planner_enabled\` | 返回 confidence=0.0，跳过 LLM 调用 | \`intent.py:161\` |
| 任务规划 DAG | \`plan_generation_enabled\` | 返回空 PlanResult + rationale | \`plan.py:122\` |
| MMR 多样性召回 | \`mmr_enabled\` | 静默回退纯相关性排序 | \`config.py:57\` |
| 事实抽取完整性自检 | \`loss_detection_enabled\` | 不在 prompt 末尾追加复查指令 | \`config.py:82\` / \`fact.py:182\` |

**📦 隐式常驻（10 项）——能做但"不自知"，无开关，永不关闭**

| 能力 | 代码位置 | 能力 | 代码位置 |
|------|---------|------|---------|
| 对话生成 | \`chat/engine.py\` | Token 计量 | \`token_ledger.py\` |
| 流式响应 | \`api/routers/chat.py\` | 嵌入向量化 | \`embed.py\` |
| 记忆 CRUD | \`api/routers/memory.py\` | 缓存（embedding+fact） | \`bootstrap.py\` / \`cache.py\` |
| 上下文分区查询 | \`api/routers/context.py\` | 遗忘衰减 | \`memory/forget.py\` |
| 反思引擎 | \`planner/reflection.py\` | 重规划检测 | \`planner/replan.py\` |

14 项能力中，4 项有显式开关（自知），10 项隐式常驻（能做但"不自知"）——后 10 项默默工作，默默失败，默默不存在。

### 能力边界的三类"不知道"

**第一类：能做但不知道**——嵌入、缓存、遗忘引擎、反思引擎这些能力在代码中存在且正常工作，但没有任何机制让系统在运行时自检"我有这些能力"。如果用户问"你能做反思吗？"，系统无法查询 \`reflection.py\` 的存在来回答——它只能靠 LLM 的训练数据猜测。

**第二类：不能做但不知道自己不能做**——系统没有多模型协作（只有一个 deepseek-v4-flash）、没有置信度自动校准（q8.1）、没有递归自我审查（q8.3）。但这些"不能做"没有被显式记录为能力边界的"负数空间"。一个真正的自画像应该同时包含"我能做什么"和"我不能做什么"。

**第三类：能做但条件性的**——\`plan_generation_enabled\` 依赖 \`planner_enabled\` 为 True（如果 planner 都关了，plan generation 不可能工作）。这是能力之间的依赖关系，但当前代码中没有显式的依赖图——\`plan.py:122\` 做了自己的 gate 检查，但没有检查上游的 \`planner_enabled\`。

### 如果做一个能力自画像查询

\`\`\`python
# 伪代码 —— 不存在于当前代码库
def get_capability_profile(settings: Settings) -> CapabilityProfile:
    """启动时构建系统能力自画像。"""
    capabilities = []

    # 从 config 读取显式开关
    if settings.planner_enabled:
        capabilities.append(Capability("意图分类", tier="L1", gate="planner_enabled"))
        if settings.plan_generation_enabled:
            capabilities.append(Capability("任务规划", tier="L2", depends_on=["planner_enabled"]))

    # 从路由注册读取隐式能力
    for router in registered_routers:
        capabilities.append(Capability(router.name, tier="always_on"))

    # 显式列出已知的能力边界
    limitations = [
        "不支持多模型协作——仅使用 {settings.llm_model}",
        "不支持置信度自动校准——依赖启发式常量",
        "不支持递归自我审查——审查不触发重写循环",
    ]

    return CapabilityProfile(capabilities=capabilities, limitations=limitations)
\`\`\`

这个思路的真正挑战不在于收集能力清单——config 和路由注册已经包含了足够的信息。挑战在于**维护**这份清单——每次新增一个路由或一个功能开关，能力自画像也需要更新。在快速迭代的项目中，能力和自画像之间的同步是最大的工程成本。

> 置信度：0.89`,
    l3: `### 行业实践

| 系统/方法 | 能力自画像方式 | 特点 |
|-----------|:------------:|------|
| Claude | 训练数据中包含能力描述，但无运行时自检——模型"知道"自己能做什么是基于训练，不是基于实时配置 | 静态自画像，非运行时 |
| ChatGPT Plugins | 插件清单在启动时注册，模型可以看到可用插件列表并据此回答 | 最接近运行时能力查询 |
| AWS Lambda | 函数配置（内存、超时、环境变量）显式定义能力边界 | 基础设施即配置，边界清晰 |
| Kubernetes | 每个 Pod 的资源 requests/limits 定义了能力边界，调度器据此决策 | 能力量化 + 自动调度 |
| LangChain Agent | 工具列表在 Agent 初始化时传入，Agent 能看到"我能用什么工具" | 工具即能力，清单即自画像 |
| GlassCortex | 四开关 + 六路由模块，但能力清单分散在 config 和路由注册中，无统一查询接口 | 能力存在但不自知 |

### 设计权衡：三种能力自画像架构

构建能力自画像有三种路线，它们在维护成本、准确性和实现复杂度上各有取舍：

| 维度 | 🏷️ 静态清单 | 🔍 运行时自检 | ⚖️ 混合模式 |
|------|:---------:|:---------:|:---------:|
| **怎么做** | 手写一份能力清单，部署时随 config 加载 | 系统启动时扫描路由注册表 + config 开关，自动生成 | 核心能力手写 + 次要能力自动扫描 + 两者 merge |
| **维护成本** | 🔴 高——每次新增路由/开关必须同步更新清单 | 🟢 低——新增模块自动出现在清单中 | 🟡 中——核心能力需手动维护，其余自动 |
| **准确性** | 🟡 取决于维护纪律——容易过时 | 🟢 始终与代码一致 | 🟢 核心能力可靠 + 次要能力自动更新 |
| **实现复杂度** | 🟢 最低——就是一个 markdown 文件 | 🟡 需要约定命名规范 + 反射机制 | 🔴 最高——需要两套逻辑 + merge 策略 |
| **适合阶段** | 项目早期，能力 < 10 项 | 能力膨胀到 > 20 项后 | 需要对外暴露能力清单的产品阶段 |

GlassCortex 当前处于"静态清单"阶段——能力的真相在代码里，但自画像是给人看的文档，不是给系统自己查的数据。从静态清单升级到混合模式的触发点不是技术能力，而是用户开始问"你能做什么"并且期待一个配置感知的回答。

**核心张力**：能力清单的维护成本和准确性是零和博弈——越自动越准确但越复杂，越手动越简单但越容易过时。选择一个方案就是在"维护负担"和"过时风险"之间下注。

> 置信度：0.85`,
    crossChapterConnections: [
      {
        questionId: "q3.14",
        type: "prerequisite",
        relationship: 'Planner 可否决性（Ch3 q3.14）正是能力边界的最直接表达——"这个计划你可以否决"意味着系统知道自己的规划不是绝对的。能力自画像和可否决性共享同一个设计原则：让用户知道系统的边界。',
      },
      {
        questionId: "q8.1",
        type: "parallel",
        relationship: '置信度校准（q8.1）和能力自画像（q8.4）是元认知的两个面——前者回答"我做得好不好"，后者回答"我能做什么"。一个完整的元认知系统需要两者：知道自己的能力范围，并且知道在这个范围内自己做得怎么样。',
      },
      {
        questionId: "q1.15",
        type: "application",
        relationship: 'System Prompt（Ch1 q1.15 指令层级冲突）中定义的"你是谁""你能做什么"本质上就是一份静态的能力自画像。当前 GlassCortex 的 system prompt 没有从 config 动态生成能力描述——如果 planner_enabled 关闭了，system prompt 仍然会说"我可以帮你规划任务"。',
      },
    ],
  },
  {
    id: "q8.5",
    question: '求助升级粒度：怎么向用户表达？"我不确定" / "我猜是 X 但建议核实" / "我完全不知道"',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P2",
    confidence: { l0: 0.94, l1: 0.92, l2: 0.89, l3: 0.86 },
    overallConfidence: 0.86,
    l0: 'GlassCortex 的 Planner 层有一个三档隐式分级——LLM 成功返回（正常置信度）、LLM 调用失败（_FALLBACK_CONFIDENCE=0.3）、Planner 完全禁用（confidence=0.0）——这三档恰好对应了"我确信""我不确定""我不能回答"的用户表达层级，但目前这些内部信号没有转换为面向用户的差异化语言。',
    l1: `你去看医生。年轻医生听完你的描述后，有三种说法可选：

- A："你的症状是感冒，按时吃药就好。"（自信，但如果是误诊会耽误治疗）
- B："我不知道你什么问题，你去别的科室问问吧。"（诚实，但等于说"我帮不了你"）
- C："根据你的发烧和咳嗽，我认为是感冒，但我建议你做个血常规确认一下，如果不是的话我们再排查其他可能。"（不确定但给出了下一步）

A 是过度自信，B 是甩锅，C 是**分级求助**——它给了你能行动的答案，同时画出了"我不确定"的边界。

这就是 q8.5 的核心命题：系统内部的置信度数字，怎么翻译成用户能理解并据此行动的表述？

### GlassCortex 的三档天然分级

如果把当前代码里所有返回"低置信度"的场景列出来，三档天然存在：

| 档位 | 置信度区间 | 内部触发条件 | 理想的用户表述 | 代码位置 |
|:---:|:--------:|------------|--------------|---------|
| 🟢 **确信** | ≥ 0.7 | LLM 成功返回，字段完整 | 直接给出答案，不附加不确定性声明 | 正常运行路径 |
| 🟡 **不确定** | 0.3-0.7 | LLM 调用失败（_FALLBACK_CONFIDENCE=0.3）或 JSON 解析降级（_DEFAULT_CONFIDENCE=0.5） | "我认为是 X，但建议你核实一下" | \`intent.py:34\` \`plan.py:28\` \`replan.py:29\` \`reflection.py:28\` |
| 🔴 **无法回答** | < 0.3 或 0.0 | Planner 完全禁用（intent.py:161-162）或 ReplanDetector 解析失败兜底（replan.py:349-355） | "我现在无法回答这个问题，但我可以……" | \`intent.py:161-162\` \`replan.py:349-355\` |

这三档不是人为设计的——它们是从代码的异常处理路径中自然生长出来的。设计者可能没有想过"求助升级粒度"，但他们在写 try-catch 时已经做出了三档决策。

\`\`\`mermaid
%% title: 图：Planner 三档求助升级——从内部置信度到用户表述的映射
graph TD
    START["用户发来消息"] --> INTENT["意图分类<br/>intent.py:161"]
    INTENT --> CHECK{"planner_enabled?"}
    CHECK -->|"❌ 禁用"| TIER3["🔴 无法回答<br/>confidence=0.0<br/>'Planner 已禁用'"]
    CHECK -->|"✅ 启用"| CALL["LLM 调用<br/>分类 + 解析"]
    CALL --> PARSE{"JSON 解析"}
    PARSE -->|"✅ 成功"| TIER1["🟢 确信<br/>正常 confidence<br/>直接给出答案"]
    PARSE -->|"❌ 异常"| TIER2_F["_FALLBACK=0.3<br/>API 调用失败"]
    PARSE -->|"⚠️ 降级"| TIER2_D["_DEFAULT=0.5<br/>字段缺失回退"]
    TIER2_F --> TIER2["🟡 不确定<br/>'我认为是 X，但建议核实'"]
    TIER2_D --> TIER2

    style TIER1 fill:#34d399,stroke:#059669,color:#fff
    style TIER2 fill:#fef9c3,stroke:#ca8a04
    style TIER3 fill:#fca5a5,stroke:#dc2626,color:#7f1d1d
\`\`\`

### 为什么当前没有做

三档天然存在，但没有任何代码把它们翻译成用户语言。原因不是技术上的——是架构上的。Planner 层和 ChatEngine 的回复生成层是分立的：Planner 知道置信度，ChatEngine 知道怎么说话，但两者之间没有一个"翻译层"把置信度值映射为表述策略。

在 \`src/chat/engine.py:324-331\`，事实抽取失败被静默吞咽——这是正确的底线设计（抽取失败不应阻断对话），但它也意味着用户永远不会被告知"我这轮对话没记住你说了什么"。一个真正的分级机制应该在某些层"静默降级"，在另一些层"告知用户"——区分这两者正是求助升级粒度的设计核心。

> 置信度：0.92`,
    l2: `### 各 Planner 模块的降级策略——单一是最好的分档起点

| 模块 | LLM 成功 | API 失败 | JSON 解析失败 | 完全禁用 |
|------|:--------:|:--------:|:----------:|:------:|
| IntentClassifier | 正常分类 + confidence | _FALLBACK_CONFIDENCE=0.3 | 三阶回退解析 → 最低兜底 | confidence=0.0 (\`intent.py:161\`) |
| PlanGenerator | PlanResult + confidence | _FALLBACK_CONFIDENCE=0.3 | 三阶回退解析 → 空 PlanResult | rationale="任务规划已禁用" (\`plan.py:122\`) |
| ReplanDetector | 检测结果 + confidence | _FALLBACK_CONFIDENCE=0.3 | 兜底 drift_detected=False (\`replan.py:349\`) | drift_detected=False (\`replan.py:136\`) |
| ReflectionEngine | 反思结果 + confidence | _FALLBACK_CONFIDENCE=0.3 | 空反思列表 | "已跳过反思" (\`reflection.py:108\`) |

这四个模块共享同一套降级策略但各自独立实现。如果要加一个统一的"求助升级"翻译层，最自然的做法是在 ChatEngine 的 \`generate()\` 返回前插入一个 \`_format_confidence_hint()\` 方法——把 Planner 的置信度信号转换为一条面向用户的话。

\`\`\`python
# 伪代码 —— 这不存在于当前代码库
def _format_confidence_hint(self, intent: IntentResult) -> str:
    if intent.confidence >= 0.7:
        return ""  # 不附加任何话
    elif intent.confidence >= 0.3:
        return "以上判断基于当前信息，建议进一步核实。"
    else:
        return "我目前无法对此问题给出可靠回答，但我可以尝试从以下角度帮你思考……"
\`\`\`

这个思路的问题在于：**沉默也是一种信息**。如果系统总是不加声明地给出答案，某天突然说"我不确定"，用户会以为系统变差了——实际上它只是变诚实了。分级求助的落地不只是代码改动，还涉及用户预期管理。

### 异常处理层级——什么时候沉默，什么时候开口

\`src/chat/engine.py:324-331\` 的事实抽取异常处理展示了一个刻意的设计选择：

\`\`\`python
try:
    _, fact_trace = self._fact_extractor.extract_and_store(...)
except APIError, RuntimeError, ValueError:
    logger.warning("事实抽取失败", extra={"component": "chat"})
    # 不 raise，不通知用户
\`\`\`

vs \`api/routers/chat.py:80-89\` 的 LLM 生成失败：

\`\`\`python
# 生成失败 → HTTPException(503)，用户看到错误页
\`\`\`

这两处的不同处理揭示了一个设计原则：**与回复内容直接相关的失败必须告知用户；后台维护操作的失败可以静默处理。** 事实抽取属于后者——用户不会感知到"这轮对话我没被记住"。

这个原则是求助升级粒度的基石。如果未来要做一个完整的分级表达系统，它应该这样划分：

| 失败类型 | 用户感知 | 示例 |
|---------|:------:|------|
| L0 核心功能失败 | 🔴 必须告知 | LLM 生成失败 → 503 |
| L1 辅助功能失败 | 🟡 选择性告知 | 记忆召回失败 → "我暂时无法访问你的历史信息" |
| L2 后台操作失败 | 🟢 静默降级 | 事实抽取失败 → 静默，下轮重试 |

> 置信度：0.89`,
    l3: `### 行业实践

| 系统/产品 | 不确定性表达方式 | 特点 |
|-----------|:-------------:|------|
| ChatGPT | 不加区分——回答时总是自信（即使内容是错的），用户需要自己去判断 | 不暴露内部置信度 |
| Claude | 有时附加限定语（"I believe..." "Based on what I know..."）但触发条件不透明 | 有分级但阈值对用户不可见 |
| Perplexity | 通过"信息来源"间接表达——有引用 = 有依据，没引用 = 自己编的 | 用引用替代置信度 |
| GitHub Copilot | 代码补全灰字 = "建议"，不强制——用户选或不选本身就是置信度反馈 | 隐式分级，让用户在行为中表达置信度 |
| Wolfram Alpha | 显示"假设"列表——"我假设你想要 X，如果不是，点击这里修改" | 直接列出假设，把不确定性暴露为交互点 |
| GlassCortex | 不分级——所有 Planner 结果以同等自信度呈现给用户 | 三档隐式存在但未转化为用户语言 |

### 未解决的三个问题

1. **沉默的锚定效应**——如果系统 90% 的时候不加声明地给出正确答案，用户会形成"它总是对的"的印象。当系统第 91 次说"我不确定"时，用户会感到被背叛——而不是感激系统诚实。分级求助的落地需要先建立用户的"不确定性预期"。

2. **过度求助的问题**——如果系统每次都说"我不确定，建议核实"，用户会开始忽略这个提示（狼来了效应）。分级求助需要足够稀疏才能保持信号强度——但"稀疏"的阈值又回到了置信度校准问题（q8.1）。

3. **交互成本**——分级求助的每一种表述都占用回复空间。"我认为是 X 但建议你核实"比直接说"X"多了一倍的字。如果每轮都附加不确定性声明，累积的 token 开销不小。需要权衡：多出来的字是在帮用户还是在浪费用户的时间？

> 置信度：0.86`,
    crossChapterConnections: [
      {
        questionId: "q8.1",
        type: "prerequisite",
        relationship: "分级求助的三个档位（确信/不确定/无法回答）直接映射到 q8.1 的置信度阈值——如果校准是断的，分级就是瞎分。",
      },
      {
        questionId: "q7.6",
        type: "parallel",
        relationship: "Ch7 的「错误教学化 vs 错误隐藏」和本问的「分级求助」是同一个问题从两个方向看——错误时说什么（q7.6），不确定时说什么（q8.5）。",
      },
      {
        questionId: "q3.14",
        type: "application",
        relationship: "Ch3 的 Planner 可否决性——用户有权说'这个计划不对'——正是求助升级的终极形式：把'我不确定'的权力交给用户。",
      },
    ],
  },
  {
    id: "q8.6",
    question: '元认知本身的 token 成本：每加一层自我审查就多一次 LLM 调用',
    chapter: "ch8",
    chapterTitle: "第 8 章：元认知",
    priority: "P3",
    confidence: { l0: 0.94, l1: 0.92, l2: 0.89, l3: 0.86 },
    overallConfidence: 0.86,
    l0: 'GlassCortex 当前每轮对话最少 2 次、最多 6 次 LLM 调用——核心对话 1 次，元认知层 1-5 次（意图分类 + 事实抽取 + 任务规划 + 重规划检测 + 反思）。反思调用（Phase 61）内部包含 post_mortem 事后偏差分析和 distill_plan_template 知识蒸馏两个子操作——它们共享同一次 LLM 调用，不产生独立成本。元认知层中部分为零 LLM 调用（ModelRouter 规则链决策、PlanHistoryRetriever Jaccard 相似检索、StepRecord 步骤监控、计划历史注入的模式提取）——这些是机械执行，不产生 token 消耗。元认知成本已经不是一个"可以忽略"的后台开销——它在最坏情况下接近核心对话成本的 60-80%。',
    l1: `假设你是一家餐厅的厨师长。你每做一道菜，都有一个质检员站在旁边。他的工作是：

- 你开始做菜前，他先判断"这道菜应该是什么菜系？"（意图分类）
- 你做完之后，他把菜的所有食材记录到本子上（事实抽取）
- 如果这是一桌宴席，他把每道菜的上菜顺序画成一张图（任务规划）
- 如果你中途换了一道菜的做法，他记下来"原计划改了"（重规划检测）
- 客人吃完离席后，他坐下来写"今天哪些菜做得好，哪些需要改进"（反思）

所有这些质检工作的成本是多少？质检员也是要发工资的——他的每一次检查都需要调用 LLM，而 LLM 调用是要花钱的。

现在问题来了：这个质检员的工资已经超过了你做菜的成本。

### 当前每轮对话的 LLM 调用全链路

\`\`\`mermaid
%% title: 图：一轮对话的 LLM 调用全景——6 次调用，元认知层超过核心层
graph TD
    USER["用户消息到达"] --> INTENT["① 意图分类<br/>max_tokens=128<br/>intent.py:209"]
    INTENT --> PLAN{"plan_generation<br/>_enabled?"}
    PLAN -->|"✅ 是"| PLAN_CALL["② 任务规划<br/>max_tokens=256<br/>plan.py:173"]
    PLAN -->|"❌ 否"| CHAT
    PLAN_CALL --> CHAT["③ 对话生成<br/>max_tokens=1024<br/>engine.py:185"]
    CHAT --> FACT{"FactExtractor<br/>存在?"}
    FACT -->|"✅ 是"| FACT_CALL["④ 事实抽取<br/>max_tokens=512<br/>fact.py:212"]
    FACT -->|"❌ 否"| REPLAN
    FACT_CALL --> REPLAN{"用户纠正<br/>意图漂移?"}
    REPLAN -->|"✅ 是"| REPLAN_CALL["⑤ 重规划检测<br/>max_tokens=256<br/>replan.py:231"]
    REPLAN -->|"❌ 否"| REFLECT
    REPLAN_CALL --> REFLECT{"会话结束?"}
    REFLECT -->|"✅ 是"| REFLECT_CALL["⑥ 反思<br/>max_tokens=256<br/>reflection.py:183"]
    REFLECT -->|"❌ 否"| DONE["返回用户"]
    REFLECT_CALL --> DONE

    style INTENT fill:#fef9c3,stroke:#ca8a04
    style PLAN_CALL fill:#fef9c3,stroke:#ca8a04
    style FACT_CALL fill:#fef9c3,stroke:#ca8a04
    style REPLAN_CALL fill:#fef9c3,stroke:#ca8a04
    style REFLECT_CALL fill:#fef9c3,stroke:#ca8a04
    style CHAT fill:#34d399,stroke:#059669,color:#fff
\`\`\`

黄色节点是元认知层（5 次调用），绿色节点是核心对话（1 次调用）。在最坏情况下，5 次元认知调用的 max_tokens 总和是 1408——比核心对话生成的 1024 还多 37%。

### 成本分解——按调用目的

| 调用 | max_tokens | 触发条件 | 是元认知吗 | 每 1M token 成本（输出） |
|------|:--------:|---------|:--------:|:---------------------:|
| ③ 对话生成 | 1024 | 每轮必调 | ❌ 核心 | ¥2.00 |
| ④ 事实抽取 | 512 | FactExtractor 存在时每轮 | ✅ 记忆元认知 | ¥1.00 |
| ② 任务规划 | 256 | plan_generation_enabled=True | ✅ 规划元认知 | ¥0.50 |
| ⑤ 重规划检测 | 256 | 用户纠正时 | ✅ 纠错元认知 | ¥0.50 |
| ⑥ 反思 | 256 | 会话结束时 | ✅ 反思元认知 | ¥0.50 |
| ① 意图分类 | 128 | planner_enabled=True | ✅ 分类元认知 | ¥0.25 |

> 按 2026 年中期 DeepSeek 定价（¥1/1M input, ¥2/1M output），以上为输出 token 的理论最大成本。实际消耗通常远低于 max_tokens 上限——分类结果通常 20-30 token，规划 80-120 token。

### 成本递增的三层

**第一层 — 基础对话**：仅对话生成（③），1 次 LLM 调用。这是所有 AI 聊天系统的最小成本基线。

**第二层 — 当前 GlassCortex**：最少 2 次（对话生成 + 意图分类），最多 6 次（全部元认知调用触发）。元认知层平均增加 3-4 次额外 LLM 调用。每次调用不仅是 token 成本——还有网络延迟。串行 API 调用的延迟累积可以超过对话生成本身的时间。部分元认知操作（ModelRouter 决策、PlanHistoryRetriever 检索、StepRecord 监控）为零 LLM 调用，不增加成本。

**第三层 — 加上"回复前审查闸门"**：q8.3 讨论的 \`_self_check()\` 如果在每次回复前运行，就是第 7 次 LLM 调用。如果审查发现问题要求重写，第 8 次（重写）+ 可能第 9 次（再次审查）——这是一个可递归的成本结构。

### 哪些元认知是"免费"的

不是所有元认知都花钱。以下机制是机械执行、零 LLM 调用的：

| 机制 | 实现方式 | LLM 调用 | 代码位置 |
|------|:------:|:------:|---------|
| 冲突检测 | \`fact.py:319-337\` 比较 (s,r) 的 o 值 | 0 | \`fact.py\` |
| 置信度过滤 | \`recall.py:87-88\` threshold 比较 | 0 | \`recall.py\` |
| MMR 重排 | \`recall.py\` 内积计算 | 0 | \`recall.py\` |
| 衰减引擎 | \`forget.py\` 指数衰减公式 | 0 | \`forget.py\` |
| loss_detection 复查 | \`fact.py:182\` prompt 中追加指令 | 0（复用已有 LLM 调用） | \`fact.py\` |

这些"免费"的元认知层是务实的工程设计——在已有的 LLM 调用中嵌入元认知逻辑（loss_detection 在事实抽取的 system prompt 中追加一行），或在代码中做机械检查（冲突检测）。它们证明了一个原则：**不是所有元认知都必须花钱——能免费的就免费做，只有确实需要 LLM 判断的才额外调用。**

> 置信度：0.92`,
    l2: `### 逐模块的 Token 消耗实测

以下数据来自各模块的 \`max_tokens\` 设置和实际 API trace 的范围：

**① 意图分类（intent.py:209）**

\`\`\`python
max_tokens=settings.planner_max_tokens,  # 128
\`\`\`

- System prompt 约 380 token（5 类分类指令 + 格式说明）
- User prompt = 用户原始消息（通常 20-200 token）
- 输入总计：400-600 token
- 输出：通常 20-30 token（一行 JSON）
- **每轮成本**：输入 ¥0.0005 + 输出 ¥0.00005 ≈ **¥0.00055**

**④ 事实抽取（fact.py:212）**

\`\`\`python
max_tokens=settings.fact_extraction_max_tokens,  # 512
\`\`\`

- System prompt 约 500 token（三元组格式 + loss_detection 复查指令）
- User prompt = 用户消息 + 系统回复（200-800 token）
- 输入总计：700-1300 token
- 输出：通常 50-150 token（3-5 条三元组）
- **每轮成本**：输入 ¥0.0010 + 输出 ¥0.0002 ≈ **¥0.0012**

**② 任务规划（plan.py:173）**

\`\`\`python
max_tokens=_PLAN_MAX_TOKENS,  # 256
\`\`\`

- System prompt 约 600 token（DAG 格式 + 子任务约束）
- User prompt = 用户消息 + 意图分类结果（60-250 token）
- 输入总计：660-850 token
- 输出：通常 80-120 token（子任务 DAG JSON）
- **每轮成本**：输入 ¥0.00075 + 输出 ¥0.0002 ≈ **¥0.00095**

**⑥ 反思（reflection.py:183）**

\`\`\`python
max_tokens=_REFLECTION_MAX_TOKENS,  # 256
\`\`\`

- System prompt 约 450 token（反思指令 + 格式）
- User prompt = 对话摘要 + 计划 + 结果（300-1000 token）
- 输入总计：750-1450 token
- 输出：通常 60-150 token（反思文本 + 改进建议）
- **每轮（会话级均摊）成本**：输入 ¥0.0011 + 输出 ¥0.0002 ≈ **¥0.0013**

**汇总——一轮对话的元认知总成本**

| 场景 | LLM 调用 | 总输入 token | 总输出 token | 估算成本 | 延迟叠加 |
|------|:------:|:----------:|:----------:|:------:|:------:|
| 最小（仅 chat） | 1 | ~1000 | ~500 | ¥0.002 | 1× |
| 典型（chat + fact + intent） | 3 | ~2500 | ~600 | ¥0.004 | 2-3× |
| 完整（全部 6 次） | 6 | ~4500 | ~900 | ¥0.008 | 4-6× |
| 完整 + 审查闸门 | 7-8 | ~5500 | ~1100 | ¥0.010 | 6-8× |

> 按 DeepSeek ¥1/1M input + ¥2/1M output 估算。实际成本因消息长度、LLM 输出长度而异。延迟叠加取决于调用是否并行——当前所有调用是串行的。

### 并行化——未利用的优化空间

当前所有 LLM 调用是串行的——意图分类 → 任务规划 → 对话生成 → 事实抽取。但意图分类和任务规划都不依赖对话生成的结果——它们可以在用户消息到达后立即并行执行。

\`\`\`python
# 伪代码 —— 当前不存在的并行优化
async def process_message(user_msg: str):
    # 这三个调用互不依赖——可以并行
    intent_task = asyncio.create_task(intent_classifier.classify(user_msg))
    plan_task = asyncio.create_task(plan_generator.generate(user_msg))
    recall_task = asyncio.create_task(memory.recall(user_msg))

    intent, plan, recalled = await asyncio.gather(intent_task, plan_task, recall_task)

    # 只有对话生成依赖上述三个结果
    response = await chat_engine.generate(user_msg, recalled, intent, plan)
    return response
\`\`\`

并行化可以把"完整场景"的 6 次串行调用压缩为 3-4 个并行阶段，将延迟从 6× 降到 3-4×——不减少总 token 消耗，但显著改善用户感知的响应速度。

### 为什么没有做——工程优先级

并行化的代码不复杂，但在当前阶段没有做。原因不是技术上的——是设计优先级：GlassCortex 的首要目标是"透明化"而不是"高性能"。串行执行的 trace 更容易理解和展示——每一步的顺序清晰，延迟数据直接对应思考步骤。并行执行会让 trace 面板的"步骤 → 延迟"映射变得复杂——两个并行步骤中，哪个延迟是瓶颈？

等透明化的基础打牢后，性能优化（包括并行化）是自然的下一步——但它会让"理解系统在做什么"变得更难。

> 置信度：0.89`,
    l3: `### 行业实践

| 系统/方法 | 元认知开销策略 | 核心思路 |
|-----------|:------------:|---------|
| Claude | 内部机制不透明，但单次调用完成所有推理——无额外元认知层 | 元认知内化在模型权重中，零额外调用 |
| GPT-4 + LangChain Agent | 每步推理（Thought → Action → Observation）都额外调用 | 元认知显式但昂贵——3-5 次调用完成一步推理 |
| Anthropic 系统提示缓存 | 长 system prompt 被缓存，重复使用不重复计费 | 用缓存减少元认知指令的重复成本 |
| 多 Agent 协作（AutoGen/CrewAI） | 每个 Agent 独立调用 LLM，审查 Agent 单独运行 | 元认知由独立 Agent 承担，成本线性增长 |
| 投机解码（Speculative Decoding） | 用小模型草稿 → 大模型校验 | 审查由便宜模型完成，降低单位成本 |
| GlassCortex | 元认知 5 层显式调用，串行执行，无并行优化 | 元认知层数 > 核心层，成本 > 核心层 |

### 六层元认知的 ROI 评估

把 GlassCortex 的 6 个 LLM 调用点按"成本"和"价值"两个维度放入 2×2 矩阵：

| | 💰 低成本（≤256 token） | 💰💰 高成本（>256 token） |
|------|:------------------:|:------------------:|
| **📈 高价值**<br>（直接影响回复质量） | ① 意图分类（128 token）<br>决定后续所有处理方向 | ③ 对话生成（1024 token）<br>核心产出，不可削减<br>④ 事实抽取（512 token）<br>记忆持久化的唯一入口 |
| **📉 低价值**<br>（间接影响/事后分析） | ② 任务规划（256 token）<br>仅 plan_generation_enabled 时触发<br>⑤ 重规划检测（256 token）<br>仅用户纠正时触发 | ⑥ 反思（256 token）<br>会话结束后运行，不影响当前轮 |

**优化路线**——按优先级排序：

| 优先序 | 动作 | 理由 | 节省潜力 |
|:----:|------|------|:------:|
| 1 | 并行化 ①+②+④（互不依赖的调用同时发出） | 零功能损失，纯延迟优化 | 延迟 4-6× → 2-3× |
| 2 | 将 ⑥ 从实时改为会话级批处理 | 反思本就不影响当前对话，等 5 秒和等 5 分钟用户无感知 | 每轮省 ¥0.0013 |
| 3 | 将 ②+⑤ 改为 \`planner_enabled\` 关闭时彻底跳过 | 已有开关，但当前代码路径可能仍有残余调用 | 关闭时省 2 次调用 |
| 4 | 审查 ④ 是否可降频（每 2-3 轮抽取一次而非每轮） | 相邻轮次的事实重叠度高，降频不会显著丢失信息 | 每 2 轮省 ¥0.0012 |

**核心判断**：第一优先级不是砍调用，是并行化——在不牺牲任何元认知能力的前提下，让用户感知的延迟从 6 次串行降到 2-3 次并行窗口。

> 置信度：0.86`,
    crossChapterConnections: [
      {
        questionId: "q4.4",
        type: "prerequisite",
        relationship: '跨模型成本优化（Ch4 q4.4）和元认知成本是同一类问题——"花在思考上的钱"vs"花在回答上的钱"。q4.4 讨论不同模型的价格差异，q8.6 讨论同一模型内元认知层和核心层的分配比例。',
      },
      {
        questionId: "q4.9",
        type: "parallel",
        relationship: 'Token 与延迟的权衡（Ch4 q4.9）和元认知成本（q8.6）是同一维度的两个切面——前者关注"生成更多 token 的速度代价"，后者关注"生成更多认知层的 token 代价"。',
      },
      {
        questionId: "q6.6",
        type: "application",
        relationship: '实时 vs 批处理（Ch6 q6.6）是元认知成本的一个直接优化方向——有些元认知操作（如反思）不必须在实时对话中执行，可以批量延后处理，在不增加用户感知延迟的前提下获取元认知收益。',
      },
    ],
  },
];
