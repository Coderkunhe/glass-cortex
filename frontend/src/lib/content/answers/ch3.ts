import type { Answer } from "../types";

/** 第 3 章：任务规划 答案列表 */
export const CH3_ANSWERS: Answer[] = [
  {
    id: "q3.1",
    question: '如何进行意图识别？都有哪些手段？各有什么优缺点？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.9 },
    overallConfidence: 0.9,
    l0: '意图识别有三种路线：关键词规则（快但傻）、机器学习分类器（需要训练数据）、LLM 分类（最灵活但最贵）——实际工程中通常是规则兜底 + LLM 主分类的混合方案，因为意图识别一旦错了，后面整个管线都跑偏。',
    l1: `想象你去一家餐厅。服务员走过来，你说「我饿了」——这是闲聊。你说「有菜单吗」——这是提问。你说「来一份牛排，七分熟」——这是指令。你说「我在想，如果牛是蓝色的，牛排会是什么颜色」——这是探索。你说「等一下，刚才你说的那个酱是什么酱来着」——这是澄清。

人类服务员一瞬间就判断出来了。但对 AI 来说，这五句话的区别决定了整个后续管线的走向——是调用知识库检索（提问）、调用工具执行（指令）、开启长链推理（探索）、寒暄回应（闲聊）、还是回到上一条补充细节（澄清）。如果第一步就判断错了，后面再精密的机制都是在错误的轨道上跑步。

> **关键洞察**：GlassCortex 将对话意图分为 5 类：**提问 / 指令 / 探索 / 闲聊 / 澄清**。边界并非总是清晰——「你能帮我写邮件吗」既是提问（能不能）也是指令（写邮件）。分类原则是「按主导意图归类」。详见 \`src/planner.py\`。

意图识别有三种主流技术路线，从简陋到智能，各有各的用武之地：

### 路线一：关键词规则匹配

**最简单的做法：定义关键词 → 匹配 → 归类。** 比如「天气」「几度」「下雨」→ 天气查询意图。「帮我」「请」「能不能」→ 指令意图。

- **优点**：零延迟、零成本、行为完全可预测。你永远知道为什么系统把这条消息归为某类——因为匹配到了某个关键词。调试极其友好。
- **缺点**：覆盖面极窄。你不可能穷举所有表达方式。「帮我个忙」和「可以麻烦你一下吗」说的是同一件事，但关键词系统很难关联。更致命的是，**关键词有歧义**——「Python 怎么学」是提问，「帮我写 Python」是指令。规则写着写着就变成了一地鸡毛的 if-else 嵌套。

> **笔记**：经典反模式：开始只有 5 条规则，3 个月后变成 500 条互相冲突的规则，没人敢改。老一辈聊天机器人（ELIZA、早期 Siri）就是这个路线的受害者。

### 路线二：机器学习分类器

**用标注数据训练一个分类模型。** 收集几千条「用户消息 → 意图标签」的标注样本，训练一个文本分类器（SVM/CNN/BERT），上线后对每条新消息做推理。

- **优点**：比关键词灵活得多——不需要精确匹配，模型能从上下文中学到「帮我 X」≈ 指令、「什么是 X」≈ 提问。能处理未见过的表达。推理速度可控（小模型可以很快）。
- **缺点**：需要标注数据。**标注数据本身就是意图识别的最大瓶颈**——5 个类别各 500 条，就是 2500 条人工标注，成本不低。意图分布是长尾的，模型对分布外样本（OOD）的处理是黑盒——你不知道它什么时候会错、为什么错。更麻烦的是，**意图体系会演化**——今天只有 5 类，三个月后产品加了「支付意图」「退款意图」，你得重新标注重新训练。

### 路线三：LLM 分类（当前最优解）

**把定义好的意图体系写成 prompt，让 LLM 自己判断。** 这就是 GlassCortex 的做法——在 \`src/planner.py\` 中，\`PlannerEngine._classify_via_api()\` 方法将一个精心设计的系统提示词发给 DeepSeek，提示词中列出了 5 种意图的定义、示例和边界说明。LLM 返回一个 JSON：\`{"category":"提问","confidence":0.95,"rationale":"用户询问事实性知识"}\`。

- **优点**：最灵活。意图体系变了？改 prompt 就行，不需要重新标注数据。能处理复杂的、模棱两可的消息——LLM 对自然语言的理解远强于任何浅层分类器。还能同时给出置信度和判断依据（rationale），这对透明化至关重要——用户点击意图标签可以看到「AI 为什么觉得我在提问」。
- **缺点**：贵——每次意图识别都是一次 LLM API 调用，消耗 token。慢——网络往返 + 模型推理，延迟通常在 200-800ms。**而且 LLM 自己也会出错**——prompt 里写的 5 类它可能输出第 6 类，JSON 格式可能不合法，confidence 可能乱填。

### GlassCortex 的设计：LLM 分类 + 三层容错

解决 LLM 输出不稳定的工程方案——在 \`src/planner.py\` 中，\`_parse_intent()\` 实现了三层递进容错解析：

> **防护**：**第一层：标准 JSON 解析** — \`json.loads(raw)\`，直接拿到 category/confidence/rationale。约 85% 的情况走这条路。

> **防护**：**第二层：提取 JSON 块** — 如果 LLM 在 JSON 前后多说了话（「好的，分类结果是：{...}」），用 \`raw.find("{")\` 定位第一个 \`{\` 到最后一个 \`}\` 之间的内容再解析。约 10% 的情况在此层挽救。

> **防护**：**第三层：正则回退** — 如果 JSON 彻底不可解析，遍历 5 个中文意图名看哪个出现在原始响应中。找到了就给 confidence=0.5，标记为低置信度。约 4% 的情况在此层兜住。

三层全失败——返回默认分类「提问」，confidence=0.3，日志记录警告。这个设计保证了**意图分类永远不会让管线崩溃**——最坏情况下系统假设你在提问，按知识查询的方式回应，不算完美但比崩掉好。

> **配置**：\`planner_enabled\` 配置开关提供了更彻底的降级：设为 \`False\` 则 \`classify_intent()\` 直接返回「提问」(confidence=0.0)，跳过 LLM 调用。调试、测试或用户显式关闭 Planner 时使用。

\`\`\`mermaid
%% title: 图：意图识别三种路线对比
graph TD
    MSG["💬 用户消息"]
    MSG --> Q{"意图识别：三种路线"}
    Q -->|"路线一"| KW["🔑 关键词规则<br/>定义关键词→匹配→归类"]
    Q -->|"路线二"| ML["📊 ML 分类器<br/>标注数据→训练模型→推理"]
    Q -->|"路线三 ✅"| LLM["🤖 LLM 分类<br/>写Prompt→API调用→返回JSON"]
    KW --> KW_P["零延迟 · 零成本 · 完全可预测<br/>覆盖面窄 · 歧义多 · 规则爆炸"]
    ML --> ML_P["灵活 · 不依赖精确匹配<br/>需标注数据 · OOD盲区 · 需重训"]
    LLM --> LLM_P["最灵活 · 改Prompt即可演化<br/>200-800ms · API成本 · 输出不稳定"]
    LLM_P --> TOLERANT["🛡️ GlassCortex 三层容错解析<br/>_parse_intent()"]
    TOLERANT --> L1["一层 json.loads 直接解析<br/>成功率约 85%"]
    L1 -->|"失败"| L2["二层 提取 {...} 块再解析<br/>成功率约 10%"]
    L2 -->|"失败"| L3["三层 正则匹配中文意图名<br/>成功率约 4%"]
    L3 -->|"失败"| FB["兜底返回 '提问' confidence=0.3<br/>管线永不崩溃"]
    L1 -->|"成功"| OUT["📤 IntentResult<br/>category · confidence · rationale"]
    L2 -->|"成功"| OUT
    L3 -->|"成功"| OUT
    FB --> OUT
    style MSG fill:#4f46e5,stroke:#4338ca,color:#fff
    style LLM fill:#34d399,stroke:#059669,color:#111
    style LLM_P fill:#d1fae5,stroke:#34d399,color:#065f46
    style TOLERANT fill:#818cf8,stroke:#6366f1,color:#fff
    style OUT fill:#f59e0b,stroke:#d97706,color:#111
\`\`\`

> 置信度：0.95`,
    l2: `### Planner 的完整调用链路

\`\`\`
用户消息
  │
  ▼
classify_intent(user_msg)           # 公开入口
  │
  ├─ planner_enabled == False? ──→ 返回默认"提问"(0.0)
  │
  ▼
_classify_via_api(user_msg)         # LLM 调用
  │
  ├─ system_prompt = 5类定义 + 示例 + JSON格式
  ├─ 调用 DeepSeek API (max_tokens=50, temperature=0)
  ├─ TokenLedger 记录消耗
  │
  ▼
_parse_intent(raw_response)         # 三层容错解析
  │
  ├─ Layer 1: json.loads(raw)       → 成功率 ~85%
  ├─ Layer 2: extract { ... }       → 成功率 ~10%
  ├─ Layer 3: regex match 中文       → 成功率 ~4%
  │
  ▼
IntentResult(category, confidence, rationale)  # frozen dataclass
\`\`\`

### 三种路线对比

| 维度 | 关键词规则 | ML 分类器 | LLM 分类 |
|------|-----------|----------|---------|
| 准确率（常见表达） | 低（覆盖面窄） | 中-高（训练数据内） | 高 |
| 准确率（罕见表达） | 极低 | 低（OOD 盲区） | 中-高 |
| 延迟 | <1ms | 1-10ms | 200-800ms |
| 单次成本 | 零 | 零（推理时） | ~0.1-0.5 token（分类专用） |
| 维护成本 | 高（规则爆炸） | 中（重新标注） | 低（改 prompt） |
| 可解释性 | 最高（匹配到哪个词） | 低（黑盒） | 高（LLM 输出 rationale） |
| 意图体系演化 | 改规则，容易出错 | 重新标注+训练 | 改 prompt 即可 |
| 离线可用 | 是 | 是 | 否（需要 API） |
| 适合场景 | 简单、固定、高频场景 | 有大量标注数据 | 复杂、多变、需要解释 |

> **总结**：**没有银弹，只有取舍。** LLM 分类在灵活性和可解释性上碾压前两者，代价是延迟和成本。对于需要透明化的 AI 助手场景，这个取舍是值得的——用户有权知道「AI 为什么觉得我在提问」，而这个答案只有 LLM 能给。

### 代码关键点

\`IntentResult\` 是 frozen dataclass——不可变设计保证分类结果不会被后续处理意外修改：

\`\`\`python
@dataclass(frozen=True)
class IntentResult:
    category: str      # 5 种之一: 提问/指令/探索/闲聊/澄清
    confidence: float  # 0.0-1.0
    rationale: str     # LLM 的判断依据，供 UI 透明化展示
\`\`\`

> **注意**：解析时对 confidence 做 clamp——\`max(0.0, min(1.0, confidence))\`——防止 LLM 返回 -0.5 或 3.7 这种非法值。这是 prompt 工程的基本防御：「永远不信任 LLM 输出的类型和范围」。

> 置信度：0.93`,
    l3: `### 当前行业实践

- **OpenAI Function Calling / Tool Use**：将意图识别内化到模型推理中——不是「先分类再处理」，而是「模型直接判断这个请求该调用哪个函数」。本质上把意图识别从独立步骤变成了推理的副产品。好处是不需要单独的意图分类器；代价是意图和工具调用耦合在一起，不如独立分类灵活。
- **Rasa**：开源对话机器人框架，使用 DIET 分类器（Dual Intent and Entity Transformer）——基于 BERT 的多任务模型，同时做意图分类和实体抽取。适合有大量标注数据且需要离线运行的场景。
- **Amazon Lex / Google Dialogflow**：商业对话平台，底层混合了规则引擎 + ML 分类。意图定义通过控制台配置（类似写规则），但匹配由训练过的 NLU 模型完成——本质上是「规则做兜底 + ML 做泛化」。

### 未解决的问题

1. **多层意图（Multi-Intent）**：一条消息可能有多个意图。「帮我查天气然后发邮件给老板」——天气查询 + 邮件发送。当前 GlassCortex 只支持单意图分类。多层意图需要意图检测 + 意图排序 + 子任务拆分，难度成倍增加。

2. **意图漂移**：用户在对话中途可能切换意图。「帮我写邮件……算了，先查一下上次的会议记录」——从「指令」漂移到「提问」。单轮分类无法感知这种对话级别的意图变迁，需要对话状态跟踪（DST）来建模。

3. **隐式意图**：「你觉得呢」——这句话依赖上一轮上下文才能判断意图。上一轮在讨论代码 →「澄清」；上一轮在聊人生 →「探索」。隐式意图需要上下文感知的意图模型，而不是只看当前消息。

4. **低成本分类**：每条消息都调一次 LLM 做意图分类，大量用户场景下成本不低。能否用更小的模型（如 BERT 蒸馏版）做第一层筛选——只对 ML 模型不确定的消息才升级到 LLM 分类？

5. **意图和情绪的交叉**：用户说「帮我写邮件」（指令）和「烦死了帮我写个邮件」（指令+情绪），意图分类可能一样但处理方式应该不同。情绪是否为意图体系增加一个维度，还是应该独立建模？

### GlassCortex 已交付方向

任务规划支柱的两个升级已交付：

- **Plan 生成/存储**（Phase 53）：PlanGenerator 将意图自动分解为子任务 DAG，PlanStore 通过 \`plan_runs\` + \`plan_subtasks\` 表持久化。
- **记忆引导规划**（Phase 60）：PlanHistoryRetriever 检索相似历史计划，将其成功/失败模式注入 PlanGenerator 的 \`plan_history\` 参数。

> 置信度：0.90`,
    labLinks: [{ tab: "context", label: "意图测试面板" }],
    crossChapterConnections: [
      { questionId: "q1.4", type: "parallel", relationship: "噪声信息干扰意图分类准确率，两者都讨论影响分类质量的外部因素" },
      { questionId: "q5.1", type: "prerequisite", relationship: "上下文组装质量（Ch1）直接决定 L1 意图分类的输入质量，是 Ch1↔Ch3 交互的核心接口" },
      { questionId: "q2.20", type: "contrast", relationship: "记忆污染导致基于历史经验的意图误判，与纯 LLM 即时分类形成对比——一个有记忆偏差，一个无历史依赖" },
    ],
  },
  {
    id: "q3.2",
    question: '如果使用 LLM 进行意图识别，具体流程是什么？评分依据是什么？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.94, l2: 0.92, l3: 0.85 },
    overallConfidence: 0.85,
    l0: 'LLM 意图识别是四步流水线：写一个定义 5 种意图的系统提示词 → 把用户消息发给 LLM 让它分类 → 用三层容错机制解析返回的 JSON → 输出 `IntentResult`（类别 + 置信度 + 理由）。评分依据就是 LLM 给出的 `confidence` 值（0-1 之间），代表它自己对这个分类的把握程度——不存在「对所有类别打分再排序」的过程，LLM 只输出一个分类。',
    l1: `意图识别不是把用户消息和 5 个类别标签一个一个比对打分——而是把「分类逻辑写进 prompt」让 LLM 一次性判断。这是一个端到端的分类任务：相同的 LLM 既负责「理解」也负责「判断」，中间没有独立的评分模型。

### 四步流程

\`\`\`mermaid
%% title: 图：LLM 意图识别完整流程
graph TD
    USER["👤 用户消息"]
    USER --> SYSTEM["📝 构造 System Prompt<br/>5 种意图定义<br/>+ JSON 格式约束"]

    SYSTEM --> API["🔗 LLM API 调用<br/>system + user 两条消息<br/>max_tokens + temperature 控制"]

    API --> PARSE["🔍 三层容错解析<br/>_parse_intent()"]

    PARSE --> L1["第一层 严格 JSON<br/>json.loads + 类别校验"]
    PARSE --> L2["第二层 提取 JSON 块<br/>find{ } + 再解析"]
    PARSE --> L3["第三层 正则中文匹配<br/>INTENT_CATEGORIES 逐个匹配"]

    L1 -->|成功| OK["✅ 输出 IntentResult"]
    L2 -->|成功| OK
    L3 -->|成功| OK
    L1 -->|全部失败| FB["🔄 兜底默认值<br/>'提问' + 0.3"]
    L2 -->|全部失败| FB
    L3 -->|全部失败| FB

    OK --> CAT["🏷️ category<br/>提问 / 指令 / 探索 / 闲聊 / 澄清"]
    OK --> CONF["📊 confidence<br/>0.0 ~ 1.0"]
    OK --> RAT["💬 rationale<br/>一句话判断依据"]

    style USER fill:#6366f1,stroke:#4f46e5,color:#fff
    style SYSTEM fill:#818cf8,stroke:#6366f1,color:#fff
    style API fill:#f59e0b,stroke:#d97706,color:#111
    style PARSE fill:#ef4444,stroke:#dc2626,color:#fff
    style FB fill:#6b7280,stroke:#4b5563,color:#fff
    style OK fill:#34d399,stroke:#059669,color:#111
    style L1 fill:#fee2e2,stroke:#fca5a5,color:#7f1d1d
    style L2 fill:#fee2e2,stroke:#fca5a5,color:#7f1d1d
    style L3 fill:#fee2e2,stroke:#fca5a5,color:#7f1d1d
\`\`\`

### 第一步：构造系统提示词（System Prompt）

GlassCortex 的提示词包含两大部分（见 \`src/planner/intent.py\` 的 \`_classify_via_api()\`）：

**意图定义段**——精确描述 5 种对话意图，每种附带 1-2 个典型例子：

| 意图 | 定义 | 例句 |
|:----|------|------|
| 提问 | 询问事实、知识、解释或建议 | 「什么是量子计算？」「今天天气怎么样？」 |
| 指令 | 要求执行操作、生成内容或完成任务 | 「帮我写一封邮件」「把这段代码改成 Python」 |
| 探索 | 开放式探索、头脑风暴或深度讨论 | 「如果人类能永生会怎样？」 |
| 闲聊 | 寒暄、情感表达、无明确信息目标的社交对话 | 「你好！」「今天真开心」 |
| 澄清 | 对上一轮回复的追问、修正或细化 | 「你刚才说的第二点能再详细解释吗？」 |

**输出格式约束段**——指定 LLM 必须返回严格 JSON：

\`\`\`json
{"category":"<意图>","confidence":<0-1>,"rationale":"<一句话判断依据>"}
\`\`\`

> 意图定义和格式约束放在同一个 system prompt 中，既是分类器又是格式控制器。这是 GlassCortex 设计的关键——不依赖后处理结构化，prompt 本身承担了 80% 的结构化工作。

### 第二步：LLM API 调用

**只有两条消息**：system（提示词）+ user（用户原文）。没有对话历史、没有检索结果——意图分类是对话管线的第一站，在召回记忆和工具调用之前。

调用参数：\`model=settings.llm_model\`、\`max_tokens=settings.planner_max_tokens\`、\`temperature=settings.planner_temperature\`。每次调用完成后，如果有 TokenLedger 注入，自动记录 prompt/completion tokens 用于成本追踪。

> **为什么只发两条消息？**意图分类不需要对话历史——「帮我写邮件」无论在第几轮发出，要判断的只是这句话本身的意图。混入历史反而引入噪音（上一条消息是「今天天气不错」→ 系统纠偏说「帮我写邮件」→ 可能误判为闲聊的延续）。

### 第三步：三层容错解析（\`_parse_intent()\`）

LLM 输出不稳定是工程上的硬骨头。GlassCortex 设计了三层递进解析：

**第一层：严格 JSON 解析（成功率约 85%+）**

\`json.loads(raw)\` 直接解析。取 \`category\` 做白名单校验（是否在 INTENT_CATEGORIES 中），\`confidence\` 做 clamp(\`0.0 ~ 1.0\`)，\`rationale\` 作字符串提取。如果 LLM 输出了合法的 JSON——这条路是最高效的。

**第二层：提取 JSON 块再解析（挽救约 10%）**

如果 LLM 在 JSON 前后加了多余的文字（比如「根据分析，分类结果为 {...}」），用 \`raw.find("{")\` 和 \`raw.rfind("}")\` 定位 JSON 结构的边界，隔离出纯 JSON 块再解析。校验逻辑与第一层完全一致。

**第三层：正则中文意图名匹配（挽救约 3%）**

如果 JSON 完全不可解析——LLM 可能只输出了一个中文词而没有包裹 JSON——遍历 \`INTENT_CATEGORIES\`（"提问", "指令", "探索", "闲聊", "澄清"），看原始响应中是否包含其中任意一个。匹配到则输出该类别，置信度给固定的 0.5。

**兜底：默认分类**——最终防护：如果三层全部失败，返回 \`"提问"\` 类别 + 置信度 \`0.3\`（\`_FALLBACK_CONFIDENCE\`），并记录 parse error。

> 这个设计的原则是：**意图识别可以模糊，但不能失败阻塞管线**。一个错误的但不是 100% 荒谬的默认分类（"提问"是最安全的默认值——大多数用户输入都可以归为提问），比一个「系统错误」的崩溃体验好得多。

### 第四步：输出 \`IntentResult\`

最终输出是一个 \`@dataclass(frozen=True)\` 对象：

| 字段 | 类型 | 含义 |
|:----|:----|:------|
| \`category\` | \`str\` | 5 种意图之一（提问/指令/探索/闲聊/澄清） |
| \`confidence\` | \`float\` | 0.0~1.0 置信度——LLM 自评对这个分类的把握 |
| \`rationale\` | \`str\` | 一句话判断依据——透明化关键，用户可以看「为什么 AI 觉得这是提问」 |

Frontend ProcessDrawer 中的 IntentResultCard 渲染这三个字段。

### 评分依据到底是什么？

核心答案：**LLM 自评置信度（self-reported confidence）**，而非跨类别评分排行。

具体来说：
- LLM 在输出 JSON 时，同时判断"这是什么意图"和"我有多确定"——这是同一个推理步骤的两个输出，不是先列 5 个分数再选最高的
- \`confidence\` 值范围 0.0~1.0，输出端做 clamp 确保不越界
- 技术本质：\`confidence\` 是 LLM 输出的一个 token 序列被解析为浮点数，**不是经过 softmax 的概率**——所以不同 LLM 的置信度分布不同，不能跨模型比较
- **不存在「评分相同」的场景**：因为 LLM 不输出 5 个意图各自的分数，只输出一个分类。没有排名 = 没有同分问题

> **理解偏差预警**：很多读者会联想到「分类器输出概率向量 → softmax → argmax」的模式。LLM 意图分类不一样——它不是对预定义类别逐个打分，而是用自然语言推理一次性判断。你可以认为 LLM 内部隐式做了评分排行，但对外暴露的 API 只输出了最终胜者和自评置信度。

### 异常与边界情况

| 场景 | 表现 | 工程处理 |
|:----|:----|:---------|
| LLM JSON 格式错误 | category 不在白名单 | 三层解析捕获，防御性降级提问+0.3 |
| LLM 输出 confidence=0.99 | 过于自信 | clamp(0.0,1.0) 确保上限，不额外惩罚 |
| LLM 不输出 confidence | 缺少字段 | \`data.get("confidence", 0.5)\` 给默认值 |
| 多次连续失败 | API 异常 | 外层 \`try/except\` 捕获，返回"提问"+0.3 |
| Planner 已禁用 | 配置关闭 | \`classify_intent()\` 首先检查 \`settings.planner_enabled\`，返回空结果 |

> 置信度：0.85`,
    l2: `以下是 GlassCortex 意图分类的具体实现——从 Prompt 构造到 API 调用再到三层容错解析。整个流程在 \`src/planner/intent.py\` 中，约 200 行代码实现了完整的高可靠意图分类管线。

### 1. 数据结构：IntentResult

\`\`\`python
@dataclass(frozen=True)
class IntentResult:
    """意图分类结果。"""

    category: str
    confidence: float
    rationale: str
\`\`\`

\texttt{frozen=True}\ 确保分类结果创建后不可修改——意图识别是管线第一站，下游所有模块依赖这个结果是稳定的。

意图类别定义为常量元组：

\`\`\`python
INTENT_CATEGORIES = ("提问", "指令", "探索", "闲聊", "澄清")
\`\`\`

前端 ProcessDrawer 用 \`INTENT_COLORS\` 映射类别到颜色：

\`\`\`python
INTENT_COLORS: dict[str, str] = {
    "提问": "var(--gm-info)",
    "指令": "var(--gm-accent)",
    "探索": "var(--gm-success)",
    "闲聊": "var(--gm-text-muted)",
    "澄清": "var(--gm-warning)",
}
\`\`\`

### 2. 入口方法：\`classify_intent()\`

\`\`\`python
def classify_intent(self, user_msg: str) -> tuple[IntentResult, dict[str, object]]:
    """分类用户消息意图。返回 (IntentResult, trace_dict)。"""
    if not settings.planner_enabled:
        return IntentResult("提问", 0.0, "Planner 已禁用"), {}

    try:
        return self._classify_via_api(user_msg)
    except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "意图分类失败，使用默认分类",
            extra={"component": "planner", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
        )
        return IntentResult("提问", _FALLBACK_CONFIDENCE, "分类不可用"), {}
\`\`\`

关键设计：
- **全局开关**：\`settings.planner_enabled\` 为 False 时跳过整个分类——测试环境或降级场景不必依赖 LLM
- **异常兜底**：外层 try/except 捕获 API 错误、运行时错误、JSON 解析错误等所有异常类型，统一降级为"提问"+0.3 置信度
- **双返回值**：返回 \`(IntentResult, trace_dict)\`——前者是消费侧使用的分类结果，后者是透明化追踪数据

### 3. Prompt 构造与 API 调用：\`_classify_via_api()\`

\`\`\`python
def _classify_via_api(self, user_msg: str) -> tuple[IntentResult, dict[str, object]]:
    system_prompt = (
        "你是一个对话意图分类器。将用户消息精确分类为以下 5 种意图之一：\\n"
        "\\n"
        "1. 提问 — 询问事实、知识、解释或建议"
        "（例：「什么是量子计算？」「今天天气怎么样？」）\\n"
        "2. 指令 — 要求执行操作、生成内容或完成任务"
        "（例：「帮我写一封邮件」「把这段代码改成 Python」）\\n"
        "3. 探索 — 开放式探索、头脑风暴或深度讨论"
        "（例：「如果人类能永生会怎样？」）\\n"
        "4. 闲聊 — 寒暄、情感表达、无明确信息目标的社交对话"
        "（例：「你好！」「今天真开心」）\\n"
        "5. 澄清 — 对上一轮回复的追问、修正或细化"
        "（例：「你刚才说的第二点能再详细解释吗？」）\\n"
        "\\n"
        "响应格式（严格 JSON）：\\n"
        '{"category":"<意图>","confidence":<0-1>,'
        '"rationale":"<一句话判断依据>"}'
    )

    api_trace: dict[str, object] = {
        "system_prompt": system_prompt,
        "user_prompt": user_msg,
        "raw_response": "",
        "parse_error": None,
        "token_usage": None,
    }

    response = self.client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        max_tokens=settings.planner_max_tokens,
        temperature=settings.planner_temperature,
    )
    if self._ledger is not None and response.usage is not None:
        self._ledger.record(
            "planner",
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
        )
        api_trace["token_usage"] = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        }
    raw = response.choices[0].message.content or ""
    api_trace["raw_response"] = raw
    result, parse_error = self._parse_intent(raw)
    if parse_error:
        api_trace["parse_error"] = parse_error
    return result, api_trace
\`\`\`

这段代码有三个值得注意的设计点：

**1. \`api_trace\` 作为透明化契约**

这是 GlassCortex 整个透明化架构的缩影——每一步 LLM 调用都记录完整轨迹。前端 ProcessDrawer 用 \`api_trace\` 渲染 "为什么 AI 认为这条消息是 X 意图"，用户可以看到原始 prompt、LLM 返回、以及解析过程中是否出错。

**2. TokenLedger 延迟注入**

\`self._ledger\` 通过 setter 注入而非构造注入——因为 TokenLedger 在对话会话开始时创建，晚于 PlannerEngine 的初始化。这种延迟注入模式贯穿整个系统（PlanGenerator、ReplanDetector 都是如此）。

**3. 配置驱动的 LLM 参数**

\`model\`、\`max_tokens\`、\`temperature\` 全部来自 \`settings\`——这意味着意图分类的 LLM 可以和对话 LLM 不同（分离模型架构）、temperature 可以单独调参。

### 4. 三层容错解析：\`_parse_intent()\`

\`\`\`python
@staticmethod
def _parse_intent(raw: str) -> tuple[IntentResult, str | None]:
    """解析 LLM 返回的 JSON 为 IntentResult，容错处理。"""
    # 第一层：严格 JSON 解析
    try:
        data = json.loads(raw)
        category = str(data.get("category", "提问"))
        confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
        rationale = str(data.get("rationale", ""))
        if category not in INTENT_CATEGORIES:
            category = "提问"
        return IntentResult(
            category=category,
            confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
            rationale=rationale,
        ), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # 第二层：提取 {} 之间的 JSON 块
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            category = str(data.get("category", "提问"))
            confidence = float(data.get("confidence", _DEFAULT_CONFIDENCE))
            rationale = str(data.get("rationale", ""))
            if category not in INTENT_CATEGORIES:
                category = "提问"
            return IntentResult(
                category=category,
                confidence=max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence)),
                rationale=rationale,
            ), None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # 第三层：正则匹配中文意图名
    for cat in INTENT_CATEGORIES:
        if cat in raw:
            return IntentResult(
                category=cat,
                confidence=_DEFAULT_CONFIDENCE,
                rationale=f"正则匹配: {raw[:_RAW_PREVIEW_MAX_LEN]}",
            ), None

    # 兜底
    return (
        IntentResult("提问", _FALLBACK_CONFIDENCE, f"解析失败: {raw[:_ERROR_MSG_MAX_LEN]}"),
        f"JSON 解析失败，原始响应: {raw[:_ERROR_MSG_MAX_LEN]}",
    )
\`\`\`

三个值得注意的工程细节：

**clamp 永远生效**：\`max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX, confidence))\`——即使 LLM 输出了 confidence=1.5，也会被 clamp 回 1.0。"永远不信任 LLM 输出的类型和范围"是这个系统最核心的防御原则。

**白名单校验**：\`if category not in INTENT_CATEGORIES: category = "提问"\`——LLM 可能自创一个新类别（比如"需求"），直接被降级为默认值。这不是妥协——5 种意图是系统设计时定死的边界，下游模块按这 5 种做分支路由，多一个少一个都会出 bug。

**parse_error 信号**：容错层不是沉默地消化错误——第二/三层成功后返回 \`None\` 表示无解析错误；只有兜底成功时返回 error 字符串。前端可以据此判断"这个分类是精确结果还是容错结果"。

### 5. Token 成本追踪

每次 intent 分类调用的 token 消耗通过 \`TokenLedger\` 记录：

\`\`\`python
if self._ledger is not None and response.usage is not None:
    self._ledger.record(
        "planner",
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
    )
\`\`\`

意图识别通常只需要 200-500 tokens（system prompt ~150 tokens + user message + 响应），但一次对话可能调用多次（重规划/反思）。TokenLedger 按阶段分类统计，确保在 Token 透明化面板中可以看到"planner"阶段的累计消耗。

> 注：以上代码节选自 \`src/planner/intent.py\`，为简化移除了类型注释和部分日志细节。完整实现约 200 行。`,
    l3: `### 1. 当前局限

**置信度校准问题**：LLM 自评的 confidence 不是经过校准的概率——你今天问它可能输出 0.85，明天问同样的话可能输出 0.92。这种波动不是 bug，而是 LLM 输出层的随机性。学术界研究（尤其是 alignment 和 RLHF 相关论文）反复确认了这一点：**语言模型的自评置信度整体偏高，且分布不均**——简单任务 0.99，难的任务可能也是 0.99。

GlassCortex 当前的应对是粗放型的——clamp 边界、给默认值。更成熟的做法是引入校准曲线（calibration curve）：收集大量分类样本，对比模型输出 confidence 和实际准确率，然后做 Platt scaling 或 isotonic regression 把 confidence 校准到真实概率。但这是工程投入 vs 收益的问题——对大部分实际场景来说，"0.85" 和 "0.92" 的差别不影响下游决策树的分支选择。

**少数类识别弱**：「澄清」和「探索」在日常对话中占比极低（可能不到 5%），LLM 对这些类别不敏感。如果训练数据的隐式先验让 LLM 更倾向于输出"提问"或"指令"，少量涌入的澄清消息更容易被误判——而这恰恰是那些最需要被准确识别的消息（澄清意味着用户发现之前的理解错了）。

### 2. 多层意图体系

当前系统是**单层 5 分类**——每条消息最多对应一个意图。实际对话中用户消息可能携带多层意图："帮我写封邮件，顺便解释一下附件里的数据"——前半句是指令（写邮件），后半句是提问（解释数据）。

更成熟的架构是分层：L1 做粗粒度分类（工作型/社交型/系统型），L2 在粗粒度内再做细分。或者用多标签分类替代单标签——每条消息可以同时属于多个意图类别，每个类别附带独立 confidence。

GlassCortex 当前不走这条路线的原因：单层 5 分类已经覆盖了 95% 的命令场景，多标签增加了下游管线的复杂度——如果一条消息同时是指令和提问，应该先走指令分支还是提问分支？这又需要额外的优先级裁决逻辑。

### 3. 动态意图图谱

静态的 5 分类方案在对话早期工作良好。但随着对话深入，用户的表达方式会收敛——第 1 轮说"帮我写个方案"（指令），第 5 轮说"我的意思是……"（澄清），这些轮次的分布在会话层面形成一张**意图迁移图谱**——记录了用户在对话中如何从 A 意图迁移到 B 意图。

这个图谱可以做什么？
- **预测下一轮意图**：如果在当前会话中，用户从"提问"→"澄清"出现了 3 次，那么第 4 次提问后用户又说了一句较短的话时，系统可以更倾向"澄清"分类
- **检测对话瓶颈**：如果每次用户问完一个问题都紧跟着澄清——可能意味着检索结果不匹配用户期望

### 4. 上下文辅助分类

当前分类只用当前消息（user_msg），不参考历史。改进方向：注入前 1-2 轮对话上下文作为辅助信号。一条消息"那第二个呢"单独看无法分类——可以是提问的延续，也可以是对某条回复的澄清追问。但如果前文是"三种方法分别是..."，那这句显然是提问（追问第二种方法）；如果前文是"我刚才说的哪里不对？"，那这句是澄清。

不过，引入上下文的代价是 prompt 变长、token 成本增加、并且"历史上下文影响分类"本身也需要透明化——ProcessDrawer 需要展示"因为前一条是 X，所以这条被视为 Y"。这些开销在当前阶段可能不值得。

### 5. 与 ReplanDetector 的联动

意图分类是整个规划管线的前哨——classify_intent 的输出直接决定了是否需要触发重规划。当用户消息被归类为"澄清"时，ReplanDetector 更倾向于检测到漂移（因为澄清本质上是对上一轮理解的修正）。当前这个联动是隐式的——澄清 → 高概率漂移 → 重规划。显式联动的方案是把 IntentResult 注入 replan 的入参，让 ReplanDetector 参考 "上轮意图 vs 本轮意图" 的变化幅度来做漂移检测。`,
    labLinks: [{ tab: "context", label: "意图测试面板" }],
    crossChapterConnections: [
      { questionId: "q1.8", type: "prerequisite", relationship: "上下文组装策略决定了分类 prompt 中包含哪些辅助信息，影响意图分类的准确率" },
      { questionId: "q4.1", type: "application", relationship: "每次 intent_classify 调用都消耗 token（~200 tokens 含 prompt），TokenLedger 记录每次调用开销" },
      { questionId: "q2.12", type: "parallel", relationship: "用户画像（Ch2）与意图识别（Ch3）都是输入信号——画像辅助判断'这个用户通常想做什么'，分类判断'这条消息想做什么'" },
    ],
  },
  {
    id: "q3.3",
    question: '如果意图识别失败，除了道歉、还有什么更好的解决办法？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P1",
    confidence: { l0: 0.90, l1: 0.87, l2: 0.90, l3: 0.77 },
    overallConfidence: 0.77,
    l0: `### 意图识别不是在「成功」和「失败」之间二选一——它是灰度信号，降级不阻塞管线

意图识别没有「失败」——只有「置信度不足」。\`classify_intent()\` 的最终输出永远是一个合法的 \`IntentResult\`，即使 LLM 返回了完全不可解析的内容。秘诀是四层递进降级路径：

strict JSON → 提取 JSON 块 → 正则中文匹配 → 兜底默认值（提问 + 0.3 置信度）

道歉是最糟糕的应对——它把一次分类器的低置信度事件变成了用户体验事故。正确的做法是：**降级运行但标记不确定性**，让下游知道这个分类不可靠。

> 🟢 置信度: 0.90`,
    l1: `### 意图识别的灰度体系：置信度信号

\`IntentResult\` 的 \`confidence\` 字段不只是给前端 ProcessDrawer 展示用的——它是一个真实的信号，告诉下游「这次分类有多靠谱」。

| 置信度范围 | 含义 | 下游行为 |
|:----------:|:-----|:---------|
| 0.8 - 1.0 | 高置信度，LLM 完全确定 | 正常执行管线 |
| 0.5 - 0.8 | 中等置信度，可能有歧义 | 保留后续修正通道 |
| 0.3 - 0.5 | 低置信度，来自正则或降级 | 下游应保持警惕，必要时主动确认 |
| 0.0 - 0.3 | 兜底气泡，三层全部失败 | 标记不确定性，不触发关键操作 |

#### 「失败」的四种微观场景

不是所有「失败」都该被一样对待——它们分四种：

**1. JSON 解析失败 —— 最常见，最无害**

LLM 在 JSON 前后加了多余文字（「经过分析，分类结果为 {...}」），或者 JSON 格式略有问题（多了一个逗号、引号不匹配）。\`_parse_intent()\` 的第二层「提取 JSON 块」专门处理这种情况——成功率约 10%，最终输出完全正常。

**2. 类别白名单校验失败 —— LLM 输出超纲**

LLM 输出了合法的 JSON，但 category 不在 \`INTENT_CATEGORIES = ("提问", "指令", "探索", "闲聊", "澄清")\` 中——比如输出了「聊天」而不是「闲聊」。第一层校验会拒绝它，回退到第二层重新解析。

**3. 完全不可解析 —— 三层全灭**

LLM 的响应是一段完整的自然语言而不是 JSON，且其中不包含任何意图名匹配。三层全部失败，触发兜底 \`IntentResult("提问", _FALLBACK_CONFIDENCE, "分类不可用")\`。注意这里没有返回 None、没有抛异常——\`classify_intent()\` 的顶层 try/except 确保任何异常都被捕获。

**4. API 异常 —— 外部服务不可用**

LLM API 超时、网络断开、认证失败。\`_classify_via_api()\` 抛异常 → 被 \`classify_intent()\` 的 \`except (APIError, RuntimeError, ...)\` 捕获 → 同样输出兜底默认值。管线继续，只是意图分类信号变成了弱信号。

#### 为什么道歉是最差的策略

道歉的本质是「系统放弃了自己的责任，把问题抛给用户」。而意图识别失败后的用户体验完全可以通过降级运行来维护——即使 LLM 识别错了、三层全部失败，管线不应该在这个节点中断。

一个好的设计是：\`classify_intent()\` 的输出始终合法，下游可以根据 confidence 决定是否采信。而非让「识别失败」冒泡到用户面前。

> 📌 **交叉引用**：三层容错解析的完整实现详见 [q3.2 LLM 意图识别流程]；置信度的意义和局限详见 [q3.1 意图识别手段]。

> 🟢 置信度: 0.87`,
    l2: `### 核心代码

#### classify_intent — 顶层入口，try/except 兜底一切

\`\`\`python
# src/planner/intent.py:159-171
def classify_intent(self, user_msg: str) -> tuple[IntentResult, dict[str, object]]:
    if not settings.planner_enabled:
        return IntentResult("提问", 0.0, "Planner 已禁用"), {}
    try:
        return self._classify_via_api(user_msg)
    except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "意图分类失败，使用默认分类",
            extra={"component": "planner", "error": str(exc)[:_ERROR_MSG_MAX_LEN]},
        )
        return IntentResult("提问", _FALLBACK_CONFIDENCE, "分类不可用"), {}
\`\`\`

关键设计：
- **无空返回值**：无论内部如何出错，函数保证返回合法的 \`(IntentResult, dict)\` 元组
- **宽异常捕获**：4 类异常全部拦截——APIError（网络/服务端）、RuntimeError（客户端初始化失败）、JSONDecodeError（LLM 输出异常）、ValueError（其他类型异常）
- **降级置信度**：\`_FALLBACK_CONFIDENCE = 0.3\` — 不是 0，因为 0 意味着「完全不确定」，而 0.3 表明「有猜测但不可靠」——下游可以据此决策

#### _parse_intent — 三层容错解析

\`\`\`python
# src/planner/intent.py:232-281
@staticmethod
def _parse_intent(raw: str) -> tuple[IntentResult, str | None]:
    # 第一层：strict JSON parse
    try:
        data = json.loads(raw)
        cat = data.get("category", "")
        if cat in INTENT_CATEGORIES:
            conf = max(_CONFIDENCE_MIN, min(_CONFIDENCE_MAX,
                       float(data.get("confidence", _DEFAULT_CONFIDENCE))))
            rat = str(data.get("rationale", ""))
            return IntentResult(cat, conf, rat), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # 第二层：extract JSON block
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            ...
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # 第三层：keyword match
    for cat in INTENT_CATEGORIES:
        if cat in raw:
            return IntentResult(cat, _DEFAULT_CONFIDENCE, f"正则匹配: {cat}"), None

    # 兜底
    return IntentResult("提问", _FALLBACK_CONFIDENCE, "分类不可用"), "三层解析全部失败"
\`\`\`

每层逐步放宽解析条件，但置信度递减：strict JSON（保留 LLM 原始置信度）→ extracted JSON（同上）→ keyword match（\`_DEFAULT_CONFIDENCE=0.5\`）→ fallback（\`_FALLBACK_CONFIDENCE=0.3\`）。

#### 兜底常量

\`\`\`python
# src/planner/intent.py:32-36
_FALLBACK_CONFIDENCE = 0.3
_DEFAULT_CONFIDENCE = 0.5
_CONFIDENCE_MIN = 0.0
_CONFIDENCE_MAX = 1.0
\`\`\`

> 🟢 置信度: 0.90`,
    l3: `### 前沿方向：让失败本身成为信息

#### 置信度门控下游行为

当意图识别置信度低于阈值时，下游模块应主动调整行为——例如置信度 <0.5 时不触发需要明确指令的操作（如文件写入/工具调用）。这个门控逻辑目前不存在——\`classify_intent()\` 的置信度没有被下游消费者（PlanGenerator）参考。

#### 二次确认对话

当意图识别置信度 < 0.4 时，系统不应假装不确定的东西是确定的——可以向用户输出「我理解您可能是想……对吗？」的二次确认。这是当前能力空白的直接应用场景：系统知道「我不确定」但不表达。

#### 上下文辅助推断

当前 \`classify_intent()\` 只传入用户最新一条消息。如果结合对话历史（前几轮的意图 + 分类结果），在低置信度时可以用「上一条是提问，内容刚相关，所以这条大概率是澄清」的逻辑做上下文推断。这不需要改现有解析器——在 \`classify_intent()\` 外包装一层上下文增强。

#### 失败模式的仪表化

当前系统只记日志不聚合失败模式。如果将三层解析的失败率按天聚合——「今天 strict JSON 成功率 83%，keyword match 触发了 7 次」——就能发现 LLM 输出质量退化的早期信号。

> 📌 **交叉引用**：意图识别的完整流程详见 [q3.2 LLM 意图识别流程]；置信度作为管线信号详见 [q3.5 LLM 任务规划流程]。

> 🟢 置信度: 0.77`,
    crossChapterConnections: [
      { questionId: "q1.4", type: "prerequisite", relationship: "噪声信息是导致意图识别失败的核心外部原因之一——L1 分类器被噪声干扰时 confidence 下降，理解噪声成因有助于诊断分类失败" },
      { questionId: "q1.5", type: "parallel", relationship: "不一致信息（Ch1）与意图分类失败都导致管线信噪比下降，一个污染输入，一个污染分类" },
      { questionId: "q2.20", type: "prerequisite", relationship: "记忆污染会污染意图分类的上下文——如果历史记忆是错误的，LLM 可能基于错误信号做分类判断" },
    ],
  },
  {
    id: "q3.4",
    question: '如何进行任务规划？都有哪些手段？各有什么优缺点？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P1",
    confidence: { l0: 0.96, l1: 0.94, l2: 0.92, l3: 0.88 },
    overallConfidence: 0.88,
    l0: '任务规划有三种路线：规则模板（快但死板，适合固定流程）、分层任务网络 HTN（结构化/可验证，但需人工建模）、LLM 端到端（最灵活但需容错机制）——GlassCortex 选择 LLM 路线 + 三阶回退解析，因为任务分解的质量直接决定了后续执行的成败，而灵活性在这个取舍中比延迟更重要。',
    l1: `想象你去一家餐厅，服务员不只是接受点餐——他在脑中自动做了一整套任务规划："先记下客人要什么（意图理解）→ 把点单拆成前菜、主菜、甜点三个子任务（分层分解）→ 前菜要快所以先做，主菜需要 15 分钟所以通知后厨立刻开工，甜点等主菜快吃完再准备（依赖编排）→ 最后对一遍菜单确认没漏单（输出校验）。"

这套"知道做什么、拆成几步、排好顺序、确认一遍"的心智过程，就是任务规划。对 AI 来说，任务规划是从用户的一句话出发，生成一个结构化的执行计划——包含子任务列表、依赖关系和执行顺序。

> **关键洞察**：任务规划是意图识别之后的第一道关卡。意图识别回答"用户想干什么"，任务规划回答"怎么干"。意图错了，后面整个管线跑偏；规划错了，即使意图对了，执行也会迷路。

任务规划有三种主流路线，从机械到智能，各有各的适用场景：

### 路线一：规则模板

**最简单的做法：预定义任务模板 → 匹配触发条件 → 实例化执行。** 比如检测到"写邮件"→ 加载邮件模板（收件人确认 → 主题确认 → 正文生成 → 发送确认），按固定顺序执行。

- **优点**：零延迟、零 token 成本、行为完全可预测。调试极其友好——你永远知道为什么系统走了这几步，因为模板是人工写死的。
- **缺点**：覆盖面极窄。每个新任务类型需要人工编写模板。"帮我写邮件"和"帮我把上周的会议纪要整理成邮件发给老板"是同一个意图（写邮件），但后者需要先检索上周纪要→再整理→再写邮件，模板无法灵活组合。更致命的是，**模板数量爆炸**——20 个模板看起来还好，200 个模板的维护成本已经超过重写整个系统。

> **笔记**：规则模板在垂直领域（客服、工单系统）仍然大量使用。当任务类型可控且变更频率低时，这是最高效的方案。但通用 AI 助手的任务空间是开放的——用户可能提任何需求——模板路线注定不够用。

### 路线二：分层任务网络（HTN）

**用 AI 规划领域的经典方法——把复杂任务递归分解为更小的子任务，直到每个子任务都是可直接执行的"原子动作"。** HTN（Hierarchical Task Network）的核心思想是：不直接搜索所有可能的执行路径（那是指数级爆炸的），而是按照"方法"（method）的层次结构逐步分解——"写邮件"分解为"收集材料→生成正文→发送"，"收集材料"再分解为"检索相关对话→提取关键信息→组织成大纲"。

- **优点**：结构化程度高，分解过程可审计。每一步分解都有明确的"方法"记录（为什么拆成这几步），可验证性强——你可以在执行前检查"计划是否自洽、依赖是否满足"。学术界有大量 HTN 规划器的形式化验证工作。
- **缺点**：需要人工定义"方法库"——每个复合任务对应一个分解方法，本质上还是知识工程。领域迁移成本高——从"写邮件"迁移到"做竞品分析"需要重新定义一整套方法。**方法库的冷启动问题是 HTN 在通用场景最大的障碍。**

### 路线三：LLM 端到端（GlassCortex 选择）

**把任务规划本身交给 LLM——写一个详细的 prompt 描述规划格式，让 LLM 自己决定"这个用户需求该拆成几步、依赖关系是什么"。** 这就是 GlassCortex PlanGenerator 的做法——在 \`src/planner/plan.py\` 中，\`PlanGenerator._generate_via_api()\` 将一个精心设计的系统提示词发给 DeepSeek，提示词中包含：
- 5 种意图类型的分解粒度建议（指令 3-6 步 / 提问 1-3 步 / 探索 2-5 步 / 闲聊 1 步）
- JSON 输出格式约束（\`subtasks\` 数组 + \`rationale\` 理由 + \`confidence\` 置信度）
- 子任务描述简洁性要求（≤30 字）

LLM 返回一个 JSON，包含子任务列表和依赖关系，前端 ProcessDrawer 以 DAG 图的形式渲染出来。

- **优点**：最灵活——任何用户需求都能尝试分解，不需要预定义模板或方法库。意图体系变了？改 prompt 的分解粒度建议即可。**能同时给出置信度和规划理由（rationale），这是透明化的关键**——用户可以看到"AI 为什么把这个任务拆成这三步"。
- **缺点**：输出不稳定——LLM 可能返回不合法的 JSON、可能引用不存在的依赖、可能过度分解（10+ 子任务）。延迟和成本——每次规划都是一次 LLM API 调用。

### GlassCortex 的设计：LLM 规划 + 三层容错

解决 LLM 输出不稳定的工程方案——\`PlanGenerator._parse_plan()\` 实现了与意图分类的 \`_parse_intent()\` 完全对称的三层递进容错解析：

> **防护**：**第一层：严格 JSON 解析** — \`json.loads(raw)\`，直接拿到 subtasks/rationale/confidence。对每个子任务做类型校验和规范化（id→字符串/description→字符串/depends_on→字符串列表）。截断到最多 8 个子任务（\`_MAX_SUBTASKS\`，防止 LLM 过度分解）。约 80% 的情况走这条路。

> **防护**：**第二层：提取 JSON 块** — 如果 LLM 在 JSON 前后多说了话，用 \`raw.find("{")\` 和 \`raw.rfind("}")\` 定位 JSON 块的边界再解析。类型校验和截断逻辑与第一层一致。约 12% 的情况在此层挽救。

> **防护**：**第三层：兜底空计划** — 如果 JSON 完全不可解析，返回空 PlanResult（rationale 记录失败原因），不阻塞管线。不会像意图分类那样给默认值——因为默认的"假计划"比"没有计划"更危险（用户会看到一套貌似合理但实际是编造的任务步骤）。

**confidence 做 clamp**：\`max(0.0, min(1.0, confidence))\`——与 IntentResult 相同的防御策略，"永远不信任 LLM 输出的类型和范围"。

\`\`\`mermaid
%% title: 图：任务规划三种路线对比
graph TD
    PLAN["🧠 任务规划：三种路线"]
    PLAN --> R1["📋 路线一：规则模板<br/>预定义模板→匹配触发→实例化"]
    PLAN --> R2["🏗️ 路线二：HTN 分层网络<br/>递归分解→方法库→原子动作"]
    PLAN --> R3["🤖 路线三：LLM 端到端 ✅<br/>写Prompt→API调用→返回JSON"]
    R1 --> R1_P["零延迟 · 零成本 · 完全可预测<br/>覆盖面窄 · 模板爆炸 · 不通用"]
    R2 --> R2_P["结构化 · 可审计 · 可验证<br/>方法库冷启动 · 领域迁移成本高"]
    R3 --> R3_P["最灵活 · 改Prompt即可演化<br/>输出不稳定 · 需容错机制"]
    R3_P --> TOLERANT["🛡️ GlassCortex 三层容错解析<br/>_parse_plan()"]
    TOLERANT --> L1["一层 json.loads 直接解析<br/>成功率约 80%"]
    L1 -->|"失败"| L2["二层 提取 JSON 块再解析<br/>成功率约 12%"]
    L2 -->|"失败"| L3["三层 兜底空计划<br/>不阻塞管线"]
    L1 -->|"成功"| OUT["📤 PlanResult<br/>subtasks · dag_edges · confidence"]
    L2 -->|"成功"| OUT
    L3 --> OUT
    style PLAN fill:#4f46e5,stroke:#4338ca,color:#fff
    style R3 fill:#34d399,stroke:#059669,color:#111
    style R3_P fill:#d1fae5,stroke:#34d399,color:#065f46
    style TOLERANT fill:#818cf8,stroke:#6366f1,color:#fff
    style OUT fill:#f59e0b,stroke:#d97706,color:#111
\`\`\`

> 置信度：0.94`,
    l2: `### 三种路线对比

| 维度 | 规则模板 | HTN 分层网络 | LLM 端到端 |
|------|---------|------------|----------|
| 灵活度 | 极低（仅覆盖预定义模板） | 中（方法库内可组合） | 高（任意需求可尝试分解） |
| 延迟 | <1ms | 1-50ms（方法匹配+递归分解） | 500-1500ms（API 调用） |
| 单次成本 | 零 | 零（推理时） | ~0.3-1 token（规划专用 prompt） |
| 可验证性 | 最高（模板逻辑透明） | 高（分解路径可审计） | 中（需依赖 JSON schema + 回退解析） |
| 维护成本 | 高（模板数量爆炸） | 高（方法库冷启动+迁移） | 低（改 prompt 即可） |
| 适合场景 | 固定流程、垂直领域 | 领域知识丰富、需审计 | 开放域、灵活多变 |
| GlassCortex 使用 | ❌ | ❌ | ✅ PlanGenerator |

### PlanGenerator 完整调用链

\`\`\`
用户消息 + 意图类别
  │
  ▼
generate_plan(user_msg, intent_category)          # 公开入口
  │
  ├─ plan_generation_enabled == False? ──→ PlanResult("已禁用")
  │
  ▼
_generate_via_api(user_msg, intent_category)       # LLM 调用
  │
  ├─ system_prompt = 意图分解粒度建议 + JSON 格式约束
  ├─ 调用 DeepSeek API (max_tokens=256, temperature=0.2)
  ├─ TokenLedger 记录消耗
  │
  ▼
_parse_plan(raw_response)                          # 三层容错解析
  │
  ├─ Layer 1: json.loads(raw) + 类型校验 + 截断 ≤8  → 成功率 ~80%
  ├─ Layer 2: extract { ... } → json.loads          → 成功率 ~12%
  ├─ Layer 3: 兜底空 PlanResult                     → 剩余 ~8%
  │
  ▼
PlanResult(subtasks, dag_edges, rationale, confidence)  # frozen dataclass
  │
  ├─ _derive_dag_edges() 从 depends_on 推导 DAG 有向边
  │
  ▼
api_trace extras → ProcessDrawer Section 5 → ContextualLens
\`\`\`

### 关键设计决策

**1. 子任务上限 = 8（\`_MAX_SUBTASKS\`）**

LLM 有时会"过度分解"——把一个简单任务拆成 15 步，每一步都是废话（"第 1 步：理解需求"、"第 2 步：深入理解需求"、"第 3 步：再次确认理解"）。硬截断到 8 个是务实的工程选择——对人类用户来说，8 步以上的计划已经失去可读性。如果用户需求真的需要 8+ 步，那是执行引擎的责任（4.1 子阶段），不是透明化展示的责任。

**2. temperature = 0.2（\`_PLAN_TEMPERATURE\`）**

比意图分类（temperature=0）略高——意图分类需要确定性（同一句话总是同一意图），但任务分解需要适度的多样性（同一句话可以用不同角度分解）。0.2 是经验值：既保证分解质量稳定，又允许 LLM 在子任务粒度上有轻微变化。

**3. depends_on → dag_edges 自动推导**

LLM 输出的是子任务级的 \`depends_on\` 字段（"子任务 3 依赖子任务 1 和 2"），\`_derive_dag_edges()\` 将其转换为全局有向边列表 \`[(1,3), (2,3)]\`。这种设计把"依赖表达"和"图渲染"解耦——LLM 只需要声明局部依赖，前端用全局边列表渲染 DAG。对无效引用（指向不存在的任务 id）自动忽略。

**4. 空计划 ≠ 崩溃**

与意图分类的"三层全失败返回默认'提问'"不同，PlanGenerator 三层全失败返回的是**空 PlanResult** 而非假计划。理由：意图分类必须给一个结果（管线需要知道走哪条路径），但任务规划是可选的增值层——没有计划，管线依然能执行（只是失去了透明化展示）。给假计划比不给计划更危险。

\`\`\`python
@dataclass(frozen=True)
class PlanResult:
    """L2 任务规划结果 — 不可变数据类。"""
    subtasks: list[dict[str, object]]   # [{id, description, depends_on}, ...]
    dag_edges: list[tuple[str, str]]    # [(from_id, to_id), ...]
    rationale: str                      # LLM 的规划理由（一句中文）
    confidence: float                   # 0.0-1.0
\`\`\`

> **注意**：PlanResult 是 frozen dataclass——不可变设计保证规划结果被 ProcessDrawer 和 ContextualLens 两个消费者读取时不会被意外修改。这是防御性设计的基本功："一次规划，多处只读"。

> 置信度：0.92`,
    l3: `### 当前行业实践

- **OpenAI Structured Outputs**：2024 年推出的结构化输出功能——在 API 层面约束 LLM 的输出必须符合给定的 JSON Schema，从模型推理层面保证格式正确性。本质上是把"解析容错"从应用层下沉到模型层。如果 GlassCortex 迁移到此方案，\`_parse_plan()\` 的三层回退可以简化为单层（但仍需保留类型校验和截断——schema 不能约束"子任务不超过 8 个"这种业务规则）。
- **LangChain Plan-and-Execute**：LangChain 的经典 Agent 模式——先调用 Planner 生成多步计划，再逐步执行，每步执行完后将结果反馈给 Planner 决定是否调整。与 GlassCortex 的区别：LangChain 的计划是执行级的（驱动实际工具调用），GlassCortex 的计划是透明化级的（展示给用户看，不驱动执行）。
- **AutoGPT / BabyAGI**：2023 年兴起的自主 Agent 实验——LLM 自我规划、自我执行、自我评估的循环。实践表明纯 LLM 驱动的规划在长链任务中可靠性急剧下降——计划越长，累积误差越大。这催生了"规划+执行分离"的架构共识：规划器负责全局分解，执行器负责单步可靠执行。

### 未解决的问题

1. **规划粒度自适应**：当前 PlanGenerator 对"指令"建议 3-6 步、"提问"建议 1-3 步，这是硬编码的启发式规则。理想的方案是 LLM 自己判断粒度——但 LLM 天然倾向于过度分解（更多步骤 = 看起来更"认真"）。如何在 prompt 中校准这种倾向？

2. **计划质量评估**：PlanGenerator 输出 confidence 自评，但 LLM 对自己输出的 confidence 与计划实际质量之间相关性不高（模型越自信不意味着计划越好）。需要独立的计划质量评估器？还是让用户在 ProcessDrawer 中手动标记"这个计划有用/没用"作为反馈信号？

3. **上下文感知规划**：当前 PlanGenerator 只看当前消息的 \`user_msg\` + \`intent_category\`，不了解对话历史。一个在多轮对话中的"帮我改一下"——需要回到前几轮找到"改什么"。上下文感知规划需要将对话摘要或关键实体注入规划 prompt。

4. **计划复用**："帮我写邮件"第 1 次和第 10 次的分解方案应该逐渐趋同——用户的邮件场景相对固定。能否将历史上被用户认可的计划（ProcessDrawer 未关闭 = 用户看了计划觉得合理）缓存为"计划模板"，后续类似意图优先复用？

5. **multi-agent 协作规划**：当任务涉及多个 Agent（一个检索、一个生成、一个校验），规划不只是"分解子任务"，还要"分配执行者"。子任务和 Agent 能力的匹配问题是一个新的维度——"这一步该谁做"的难度不亚于"这一步该不该做"。

### GlassCortex 已交付方向

Phase 37 后续批次已全部交付：

- **ReplanDetector**（Phase 57）：检测对话中途的意图漂移，StepStatus/StepRecord 监控每步执行，PartialReplanResult 局部重规划，ReplanComparePanel 前端并排展示原计划 vs 修正计划。
- **ReflectionEngine**（Phase 61）：会话结束时 post_mortem 对比实际 vs 计划偏差 + LLM 改进合成，distill_plan_template() 从成功计划蒸馏最佳实践模板，\`reflection_insights\` 表持久化元知识。
- **q3.15 作者模型/自省 + q3.16 元规划**：更深层的规划理论——系统对自己能力的认知如何影响规划质量，以及"什么时候该做规划"的判断逻辑。

> 置信度：0.88`,
    labLinks: [{ tab: "context", label: "重规划对比面板" }],
    crossChapterConnections: [
      { questionId: "q1.2", type: "application", relationship: "上下文窗口溢出（Ch1）影响规划方式选择——溢出环境下需要更短更轻量的规划，反之可以更细致更全面" },
      { questionId: "q4.2", type: "parallel", relationship: "规划手段的选择本质上是在 token 预算内做成本收益优化，与上下文窗口经济学的权衡逻辑一致" },
      { questionId: "q5.3", type: "application", relationship: "Ch3↔Ch4 交互的核心——不同规划手段（ReAct/Plan+Execute/ReWOO）的 token 消耗差异巨大" },
    ],
  },
  {
    id: "q3.5",
    question: '如果使用 LLM 进行任务规划，具体流程是什么？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P2",
    confidence: { l0: 0.95, l1: 0.93, l2: 0.91, l3: 0.87 },
    overallConfidence: 0.87,
    l0: 'LLM 任务规划分四步——意图理解（知道用户要什么）、分层分解（把大任务拆成小步骤，最多 8 步）、依赖编排（标注步骤之间的先后与并行关系）、输出校验（JSON Schema 约束 + 三阶回退解析）——每一步都需要 prompt 设计和容错策略来保证输出质量，因为 LLM 的输出永远不可信，但工程手段可以让它"可用的概率足够高"。',
    l1: `想象你要搬家。搬家这件事足够大，大到你不能直接"做"——你得先把它拆开："打包 → 搬家车 → 拆箱 → 布置"。但光拆开还不够，你还需要排顺序：打包必须在搬家车之前（依赖），拆箱必须在搬家车之后（依赖），但整理厨房和整理卧室可以同时做（并行）。最后你还得对一遍：是不是每个房间都覆盖到了？有没有漏掉什么东西？

这套"理解目标 → 拆解步骤 → 排定顺序 → 校验一遍"的过程，就是 LLM 任务规划的完整流程。GlassCortex 的 PlanGenerator 把这件事交给了 LLM——通过一个精心设计的 prompt 模板 + 三阶回退解析，把用户的自然语言消息转换成一个结构化的 DAG 任务计划。

### 第一步：意图理解 — "用户到底要什么"

规划的第一步不是规划，而是理解。PlanGenerator 接收两个输入：\`user_msg\`（用户原始消息）和 \`intent_category\`（L1 意图分类结果——提问/指令/探索/闲聊/澄清）。

意图类别决定了分解粒度：
- **指令**（"帮我写邮件"）→ 多步骤执行，3-6 个子任务
- **提问**（"Transformer 的 QKV 是什么"）→ 信息检索+综合，1-3 个子任务
- **探索**（"如果我把缓存层换成 Redis 会怎样"）→ 多角度分析，2-5 个子任务
- **闲聊/澄清** → 不需要分解，1 个子任务

> **关键洞察**：意图类别是"规划的前置知识"——不知道用户想干什么就去分解，就像不知道目的地就规划路线。L1 意图分类（PlannerEngine）和 L2 任务规划（PlanGenerator）的分工就是这种"先判断再分解"的工程表达。

### 第二步：分层分解 — "拆成几步、每一步做什么"

这是计划的核心。LLM 收到 system prompt 中的分解粒度建议后，将用户消息拆解为子任务列表，每个子任务包含：
- \`id\`：子任务编号（"1", "2", ...）
- \`description\`：简洁描述（≤30 字）
- \`depends_on\`：前置依赖任务 id 列表（可选，如 ["1"] 表示必须等任务 1 完成才能做）

> **配置**：\`_MAX_SUBTASKS = 8\` 硬截断——即使 LLM 返回 15 个子任务，也只取前 8 个。理由：对透明化展示来说，8 步以上的计划已经失去可读性；更深层的执行级分解留给 4.1 子阶段。

### 第三步：依赖编排 — "谁先谁后、谁能并行"

LLM 在子任务上标注 \`depends_on\` 后，\`_derive_dag_edges()\` 函数将其转换为全局有向边列表 \`[(from_id, to_id), ...]\`。这一步把 LLM 的"局部依赖声明"变成了前端 Mermaid 图的"全局有向边"。

依赖编排的核心价值是**并行度**：没有相互依赖的子任务可以在 Mermaid DAG 中展示为并行路径，用户在 ProcessDrawer 中一眼就能看到"这三步 AI 认为可以同时做"。

### 第四步：输出校验 — "这个计划能执行吗"

LLM 的输出不可信——它可能返回非法 JSON、可能引用不存在的依赖、可能给子任务写 200 字的描述。\`_parse_plan()\` 的三阶回退解析（与 \`_parse_intent()\` 完全对称）负责把 LLM 的原始输出变成可信的 PlanResult：

> **防护**：**第一层**：\`json.loads(raw)\` 直接解析 + 对每个子任务做类型校验（id→字符串/description→字符串/depends_on→字符串列表）+ 截断到 8 个。约 80% 的情况走此路。

> **防护**：**第二层**：用 \`raw.find("{")\` 和 \`raw.rfind("}")\` 提取 JSON 块再解析。约 12% 的情况在此挽救。

> **防护**：**第三层**：返回空 PlanResult，rationale 记录失败原因。**与意图分类的关键区别**：三层全失败时不给默认计划——因为假的计划比没有计划更危险（用户看到一套貌似合理但编造的任务步骤会误导判断）。

confidence 做了 clamp：\`max(0.0, min(1.0, confidence))\`——与 IntentResult 完全一致的防御策略。

\`\`\`mermaid
%% title: 图：LLM 任务规划四步流程
graph LR
    MSG["💬 用户消息<br/>+ 意图类别"]
    MSG --> S1["① 意图理解<br/>指令3-6步 / 提问1-3步<br/>探索2-5步 / 闲聊1步"]
    S1 --> S2["② 分层分解<br/>LLM 生成子任务列表<br/>id + description + depends_on"]
    S2 --> S3["③ 依赖编排<br/>_derive_dag_edges()<br/>局部依赖→全局有向边"]
    S3 --> S4["④ 输出校验<br/>_parse_plan() 三层回退<br/>类型校验 + 截断 ≤8"]
    S4 --> OUT1["📊 ProcessDrawer<br/>任务 DAG 图"]
    S4 --> OUT2["🔍 ContextualLens<br/>N个子任务 · 怎么拆的?"]
    style MSG fill:#4f46e5,stroke:#4338ca,color:#fff
    style S1 fill:#818cf8,stroke:#6366f1,color:#fff
    style S2 fill:#34d399,stroke:#059669,color:#111
    style S3 fill:#f59e0b,stroke:#d97706,color:#111
    style S4 fill:#f472b6,stroke:#db2777,color:#fff
    style OUT1 fill:#10b981,stroke:#059669,color:#fff
    style OUT2 fill:#8b5cf6,stroke:#7c3aed,color:#fff
\`\`\`

### 完整数据流

\`\`\`
用户发送消息
  │
  ▼
PlannerEngine.classify_intent(user_msg)           # L1: 意图分类
  │
  ▼
PlanGenerator.generate_plan(user_msg, category)   # L2: 任务规划
  │
  ├─ system_prompt: 意图粒度 + JSON 格式 + 示例
  ├─ LLM API: temperature=0.2, max_tokens=256
  ├─ TokenLedger 记录: prompt_tokens + completion_tokens
  │
  ▼
_parse_plan(raw) → PlanResult                     # 三层容错解析
  │
  ▼
api_trace extras: {                               # 注入聊天管线 trace
  plan_subtasks, plan_dag_edges,
  plan_rationale, plan_confidence,
  plan_token_usage, plan_parse_error
}
  │
  ├─→ ProcessDrawer Section 5: 任务 DAG 图 + 统计
  └─→ ChatMessage ContextualLens: "分解为 N 个子任务 · 怎么拆的?"
\`\`\`

> 置信度：0.93`,
    l2: `### PlanGenerator prompt 设计剖析

\`_generate_via_api()\` 的 system prompt 是任务规划质量的"第一因"。它的结构：

\`\`\`
你是一个任务规划器。将用户的消息分解为可执行的子任务，
并标注子任务之间的依赖关系。

当前意图类别：{intent_category}。请根据意图类型调整分解粒度：
- 「指令」类型：通常需要多步骤执行，分解为 3-6 个子任务
- 「提问」类型：通常只需信息检索和综合，分解为 1-3 个子任务
- 「探索」类型：开放式，可能需要多角度分析，分解为 2-5 个子任务
- 「闲聊」/「澄清」类型：通常不需要任务分解，返回 1 个子任务即可

每个子任务描述应简洁（≤30 字），依赖关系用任务 id 引用。

响应格式（严格 JSON，不要包含其他文字）：
{"subtasks":[{"id":"1","description":"子任务描述"},
{"id":"2","description":"另一个子任务","depends_on":["1"]}],
"rationale":"<一句规划理由>","confidence":<0-1>}
\`\`\`

prompt 设计的四个要点：

1. **角色锚定**："你是一个任务规划器"——不是"你是一个 AI 助手"，角色越专一，输出越聚焦。
2. **粒度指导**：4 种意图类型的分解建议——不是空泛的"合理分解"，而是给了具体的步数范围。这是从实践中长出来的经验值：早期版本没有粒度指导，LLM 对"你好"这种闲聊也拆了 5 步。
3. **格式约束**："严格 JSON，不要包含其他文字"——这是降低解析失败率的关键。去掉这句话，LLM 可能输出"好的，规划结果如下：{...}"，被迫走第二层回退。
4. **confidence 自评**：要求 LLM 评估自己的规划质量——虽然 LLM 的自评与计划实际质量的相关性有限，但作为透明化展示的参考值仍然有用（用户在 ProcessDrawer 中看到"置信度 85%"至少知道这个计划 AI 自己也没把握）。

### \`_parse_plan()\` 三阶回退代码路径

\`\`\`python
@staticmethod
def _parse_plan(raw: str) -> tuple[PlanResult, str | None]:
    # ── 层级 1：严格 JSON 解析 ──
    try:
        data = json.loads(raw)
        subtasks_raw = data.get("subtasks", [])
        # 类型校验 + 截断 ≤ _MAX_SUBTASKS(8)
        subtasks = []
        for t in subtasks_raw[:_MAX_SUBTASKS]:
            if isinstance(t, dict) and "id" in t and "description" in t:
                subtasks.append({
                    "id": str(t["id"]),
                    "description": str(t["description"]),
                    "depends_on": (
                        [str(d) for d in t["depends_on"]]
                        if isinstance(t.get("depends_on"), list) else []
                    ),
                })
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        rationale = str(data.get("rationale", ""))
        return PlanResult(
            subtasks=subtasks,
            dag_edges=_derive_dag_edges(subtasks),
            rationale=rationale,
            confidence=confidence,
        ), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass  # 降级到第二层

    # ── 层级 2：提取 {...} 块 ──
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            # ... 同样的类型校验 + 截断逻辑
            return PlanResult(...), None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass  # 降级到第三层

    # ── 层级 3：兜底空计划 ──
    return (
        PlanResult(rationale=f"解析失败，原始响应: {raw[:100]}"),
        f"JSON 解析失败，原始响应: {raw[:200]}",
    )
\`\`\`

> **注意**：每层都做类型校验（\`isinstance\` 检查），**不信任 LLM 输出的任何字段类型**——\`confidence\` 可能是字符串 "0.85"、\`depends_on\` 可能是字符串 "1" 而非数组 ["1"]。防御性解析的代价是多几行代码，收益是解析器几乎不会因为 LLM 的类型错误而崩溃。

### 与 q3.1 意图识别的对比

| 维度 | L1 意图分类 (PlannerEngine) | L2 任务规划 (PlanGenerator) |
|------|--------------------------|---------------------------|
| 输入 | user_msg | user_msg + intent_category |
| LLM max_tokens | 50 | 256 |
| LLM temperature | 0 | 0.2 |
| 输出 | category + confidence + rationale | subtasks[] + dag_edges[] + rationale + confidence |
| 解析策略 | 三层：JSON→块提取→正则兜底 | 三层：JSON→块提取→**空计划兜底** |
| 兜底行为 | 返回默认"提问" (confidence=0.3) | 返回空 PlanResult（不给假计划） |
| 失败影响 | 管线走默认路径（可能不准） | 管线不受影响（计划是可选增值层） |

### Token 消耗拆解

一次 PlanGenerator 调用 = prompt tokens + completion tokens：

- **prompt tokens**：system prompt（~200 tokens）+ user_msg（可变，通常 20-100 tokens）→ 总计 ~220-300 tokens
- **completion tokens**：JSON subtasks（30-80 tokens per subtask）+ rationale（~20 tokens）→ 总计 ~50-256 tokens
- **单次规划总消耗**：~300-550 tokens

对比意图分类（~80-150 tokens），规划的成本显著更高——这就是为什么 \`plan_generation_enabled\` 开关存在：在不需要透明化展示的场景（如批量测试），关闭规划可以节省 ~70% 的 Planner 成本。

> 置信度：0.91`,
    l3: `### 当前行业实践

- **Anthropic's Extended Thinking**：Claude 的扩展思考机制——模型在给出最终答案前进行内部推理（类似"先想清楚再说"）。这本质上是把任务规划内化到了模型的推理过程中——用户看不到中间步骤，但模型的输出质量因"想清楚再写"而提升。GlassCortex 的路线相反——把规划外化展示给用户（透明化），牺牲了一些 token 成本换取了可解释性。
- **OpenAI o1 / o3**：推理模型通过 chain-of-thought 内部推理实现隐式规划——与 Claude Extended Thinking 类似的思路，但推理轨迹更长更结构化。关键区别：o1 的推理过程用户看不到（只显示摘要），GlassCortex 的规划过程用户全可见（ProcessDrawer DAG）。
- **ReAct (Reasoning + Acting)**：Google DeepMind 提出的经典 Agent 范式——交替进行"思考→行动→观察"循环。任务规划被嵌入到这个循环中而非独立完成——每次行动后根据观察结果决定下一步，而非一次性生成完整计划。

### 未解决的问题

1. **plan verification（计划验证）**：当前 PlanGenerator 输出计划后没有任何验证——不检查子任务之间的逻辑一致性、不检查依赖是否形成环、不检查"这个计划执行下来能不能达成用户意图"。理想方案是加一个 PlanVerifier（LLM 自检或规则引擎），但"验证一个计划的质量"本身可能比"生成一个计划"更难——你需要一个比规划器更强的评估器。

2. **iterative refinement（迭代精化）**：当前是 single-shot——一次 LLM 调用出结果。更好的方案是 iterative：生成初版计划→LLM 自查缺陷→修正→再查→输出。但每多一轮迭代就多一轮 token 成本 + 延迟。如何找到"够好"而非"完美"的停止条件？

3. **planning with tool uncertainty（工具不确定下的规划）**：当前 PlanGenerator 假设所有工具都可用。但实际上某些工具可能离线、API 可能限流、数据源可能暂时不可访问。如何在规划时建模工具可用性的不确定性？"如果 X 工具不可用，用 Y 工具替代"——这在 prompt 层面需要更复杂的条件分支逻辑。

4. **用户偏好学习**：同一个"帮我写邮件"，用户 A 喜欢「简洁-3 段-直接发送」的风格，用户 B 喜欢「正式-5 段-先预览」的风格。当前 PlanGenerator 对所有人都生成相同的分解策略。长期来看，应该从用户的历史反馈（ProcessDrawer 关闭行为 = 认可计划？Sidebar 👍/👎）中学习个性化的分解偏好。

5. **多语言规划**：当前 system prompt 是中文，子任务描述也要求中文。但用户消息可能是英文或中英混杂。LLM 在多语言环境下的规划质量是否一致？还是 prompt 需要根据用户语言动态切换？

### GlassCortex 已交付方向

- **4.1 Plan 存储**（Phase 53 ✅）：PlanStore 已实现——\`plan_runs\` + \`plan_subtasks\` 表持久化规划历史，支持"历史计划检索"。
- **4.2 记忆引导规划**（Phase 60 ✅）：PlanHistoryRetriever 从记忆系统中检索历史上相似意图的执行方案，将成功/失败模式注入 PlanGenerator 的 \`plan_history\` 参数。
- **4.3 动态重规划**（Phase 57 ✅）：ReplanDetector 检测对话中途的意图漂移，自动生成修正计划，ReplanComparePanel 前端并排展示原计划 vs 修正计划。

> 置信度：0.87`,
    labLinks: [{ tab: "context", label: "重规划对比面板" }],
    crossChapterConnections: [
      { questionId: "q1.9", type: "prerequisite", relationship: "规划 prompt 是系统提示词的核心组成部分——系统提示词的编写方式直接决定了 PlanGenerator 的行为和输出质量" },
      { questionId: "q4.7", type: "application", relationship: "不同 tokenizer 对规划 prompt 的长度估算不同，影响 PromptManager 的截断阈值设置" },
      { questionId: "q5.1", type: "prerequisite", relationship: "规划流程依赖上下文组装（Ch1）提供的输入质量——组装不完整则规划盲区——这是 Ch1↔Ch3 交互的基本面" },
    ],
  },
  {
    id: "q3.6",
    question: '任务拆解：怎么把复杂意图拆成可执行的子任务序列？拆解粒度怎么控制？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P2",
    confidence: { l0: 0.90, l1: 0.88, l2: 0.88, l3: 0.80 },
    overallConfidence: 0.80,
    l0: `### 任务拆解是规划的核心能力：LLM 端到端 DAG 分解

GlassCortex 的任务拆解引擎是 \`PlanGenerator.generate_plan()\`——把用户意图分解为一个有向无环图（DAG）的子任务序列。拆解完全由 LLM 完成，通过三个约束控制质量：**意图类型影响粒度**（指令→3-6 步、闲聊→1 步）、**JSON Schema 约束**（subtasks 数组 + depends_on 依赖）、**最大子任务数**（\`_MAX_SUBTASKS = 8\`）。

拆解的输出是一个 \`PlanResult\`，包含子任务列表 + DAG 有向边 + 规划理由 + 置信度。它不驱动实际执行——规划是透明化的展示层，真实任务执行由 ChatEngine 的对话流处理。

> 🟢 置信度: 0.90`,
    l1: `### 拆解的粒度控制：不是越细越好

任务拆解的本质是**将不可直接执行的大任务递归分解到可直接执行的小任务**。过粗（「帮用户完成工作」）和过细（「先深呼吸→再敲键盘→再检查」）同样糟糕。

#### 粒度控制的三个维度

**1. 意图类型**

\`generate_plan()\` 的 prompt 直接告诉 LLM 根据意图类型调整粒度：

| 意图类型 | 建议子任务数 | 粒度特点 |
|:---------|:-----------:|:---------|
| 指令 | 3-6 | 中粒度：主步骤覆盖，不过度展开 |
| 提问 | 1-3 | 粗粒度：检索 + 综合 + 回答 |
| 探索 | 2-5 | 中粒度：多角度覆盖 |
| 闲聊/澄清 | 1 | 极粗：通常不需要分解 |

**2. 硬上限 8**

\`_MAX_SUBTASKS = 8\` 是防呆机制——LLM 在复杂场景下有可能过度分解（把「写邮件」拆成 15 步：打开编辑器→输入收件人→输入主题……）。解析器在 \`_parse_plan()\` 中主动截断 \`subtasks_raw[:_MAX_SUBTASKS]\`。

**3. DAG 依赖关系**

子任务不是扁平列表——通过 \`depends_on\` 字段表达先后和并行关系：

\`\`\`
子任务 1: 收集用户需求  (depends_on: [])
子任务 2: 搜索候选方案  (depends_on: [])
子任务 3: 对比评估      (depends_on: ["1", "2"])  ← 需要前两者都完成
子任务 4: 给出推荐      (depends_on: ["3"])
\`\`\`

子任务 1 和 2 可以并行（无依赖关系），子任务 3 需要等待两者都完成，子任务 4 是最终输出。\`_derive_dag_edges()\` 负责从 depends_on 推导出有向边列表。

#### 当前拆解的工程实现

\`generate_plan()\` 接受两个输入：用户原始消息 + 意图分类（来自 \`classify_intent()\`）。Prompt 包含以下指令：

- 子任务描述 ≤30 字（防止 LLM 写一篇论文作为子任务描述）
- 依赖关系用任务 ID 引用（防止自然语言描述歧义）
- 严格 JSON 格式（和三阶回退解析配合使用）
- 根据意图类型调整步数（指令→多步，闲聊→少步）

输出经过三阶回退解析（和意图识别的三层容错完全相同的模式）→ \`PlanResult\`。

#### 拆解粒度控制的局限

当前粒度控制完全是 prompt 提示 + 硬上限 8，没有根据任务实际复杂度自适应调节的机制。一个「写一封邮件」的任务和「帮我规划一个 SaaS 产品的技术栈迁移」的任务使用同样的 prompt 模板——LLM 的产品经理经验决定了最终粒度，系统不做二次判断。

> 📌 **交叉引用**：意图分类如何影响任务分解粒度详见 [q3.2 LLM 意图识别流程]；PlanGenerator 完整代码详见 [q3.5 LLM 任务规划流程]。

> 🟢 置信度: 0.88`,
    l2: `### 核心代码

#### generate_plan — 规划入口

\`\`\`python
# src/planner/plan.py:109-132
def generate_plan(
    self, user_msg: str, intent_category: str = "提问"
) -> tuple[PlanResult, dict[str, object]]:
    if not settings.plan_generation_enabled:
        return PlanResult(rationale="任务规划已禁用"), {}
    try:
        return self._generate_via_api(user_msg, intent_category)
    except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("任务规划失败，返回空计划", ...)
        return PlanResult(rationale=f"规划不可用: {str(exc)}"), {}
\`\`\`

与 \`classify_intent()\` 同构的设计：全局开关 → try/except → 降级。

#### _generate_via_api — LLM 调用 + Prompt 构造

\`\`\`python
# src/planner/plan.py:136-191
def _generate_via_api(
    self, user_msg: str, intent_category: str
) -> tuple[PlanResult, dict[str, object]]:
    system_prompt = (
        "你是一个任务规划器。将用户的消息分解为可执行的子任务，"
        "并标注子任务之间的依赖关系。\\n"
        f"当前意图类别：{intent_category}。请根据意图类型调整分解粒度：\\n"
        "- 「指令」类型：分解为 3-6 个子任务\\n"
        "- 「提问」类型：分解为 1-3 个子任务\\n"
        "- 「探索」类型：分解为 2-5 个子任务\\n"
        "- 「闲聊」/「澄清」类型：返回 1 个子任务即可\\n"
        "\\n"
        "每个子任务描述应简洁（≤30 字），依赖关系用任务 id 引用。\\n"
        "响应格式（严格 JSON）：\\n"
        '{"subtasks":[{"id":"1","description":"子任务描述",'
        '"depends_on":[]}],"rationale":"<规划理由>","confidence":<0-1>}'
    )
    response = self.client.chat.completions.create(...)
    ...
    result, parse_error = self._parse_plan(raw)
    return result, api_trace
\`\`\`

#### _parse_plan — 三阶回退解析 + 截断

\`\`\`python
# src/planner/plan.py:196-230
@staticmethod
def _parse_plan(raw: str) -> tuple[PlanResult, str | None]:
    # 层级1：严格 JSON 解析 + 类型校验 + ≤8 截断
    try:
        data = json.loads(raw)
        subtasks_raw = data.get("subtasks", [])
        subtasks = []
        for t in subtasks_raw[:_MAX_SUBTASKS]:
            if isinstance(t, dict) and "id" in t and "description" in t:
                subtasks.append({
                    "id": str(t["id"]),
                    "description": str(t["description"]),
                    "depends_on": [str(d) for d in t.get("depends_on", [])]
                    if isinstance(t.get("depends_on"), list) else [],
                })
        return PlanResult(
            subtasks=subtasks,
            dag_edges=_derive_dag_edges(subtasks),
            rationale=str(data.get("rationale", "")),
            confidence=max(0.0, min(1.0, float(data.get("confidence", 0.5)))),
        ), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass  # 降级到层级2
    # 层级2：提取 {...} 块（同意图分类的 _parse_intent 模式）
    # 层级3：兜底空计划
    return PlanResult(rationale=f"解析失败"), "解析失败"
\`\`\`

#### PlanResult — 数据类

\`\`\`python
# src/planner/plan.py:37-52
@dataclass(frozen=True)
class PlanResult:
    subtasks: list[dict[str, object]] = field(default_factory=list)
    dag_edges: list[tuple[str, str]] = field(default_factory=list)
    rationale: str = ""
    confidence: float = _FALLBACK_CONFIDENCE  # 0.3
\`\`\`

#### 魔数常量

\`\`\`python
# src/planner/plan.py:32-34
_MAX_SUBTASKS = 8       # 子任务硬上限
_PLAN_MAX_TOKENS = 256  # LLM 响应长度
_PLAN_TEMPERATURE = 0.2 # 略高温度，鼓励多样化分解
\`\`\`

> 🟢 置信度: 0.88`,
    l3: `### 前沿方向：自适应拆解

#### 动态粒度调节

当前的粒度完全依赖 prompt 提示（意图类型→建议子任务数）。自适应粒度应该在 LLM 返回后做二次判断：如果 1 个子任务内包含多个隐含动作（「分析数据并发邮件给团队」），系统应该自动触发第二轮拆解。实现方式：\`ReflectionEngine\` 对 \`PlanResult\` 做事后评估——「这个子任务是否还需要进一步拆分？」

#### 递归拆解

某些任务的子任务本身足够复杂，需要进一步拆解。例如「迁移数据库」→「备份→迁移脚本→验证→切换」→其中「迁移脚本」本身需要「评估 schema 差异→生成迁移 SQL→测试」。递归拆解的挑战在于深度控制（拆到几层为止）和可视化（前端 ProcessDrawer 不支持嵌套 DAG）。

#### 子任务重叠与遗漏检测

LLM 拆解的两个常见缺陷：子任务之间内容重叠（「收集需求」和「调研用户需求」实质是同一件事）、关键步骤遗漏（迁移方案没有「回滚步骤」）。\`ReflectionEngine\` 目前只用于反思历史，但同样的模式可以用于对 \`PlanResult\` 做执行前自检。

> 📌 **交叉引用**：规划反思的完整实现详见 [q3.9 执行监控与动态重规划]；ProcessDrawer 子任务 DAG 渲染详见 [q3.15 计划的可视化]。

> 🟢 置信度: 0.80`,
    crossChapterConnections: [
      { questionId: "q1.11", type: "prerequisite", relationship: "结构化上下文（Ch1）更利于 LLM 做任务拆解——非结构化输入会导致拆解粒度不稳定" },
      { questionId: "q2.7", type: "extension", relationship: "记忆固化（Ch2）可复用历史拆解策略——类似任务上次的拆解方案可以指导当前拆解" },
      { questionId: "q4.1", type: "application", relationship: "拆解粒度直接影响 token 消耗——过细拆解（8+ 步骤）的 PlanResult 占大量上下文空间" },
    ],
  },
  {
    id: "q3.7",
    question: '工具选择与编排：在多工具环境下，怎么决定"用什么工具、按什么顺序调用"？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.85, l1: 0.82, l2: 0.88, l3: 0.73 },
    overallConfidence: 0.73,
    l0: `### 工具选择是 GlassCortex 下一个架构战役——当前规划层不涉及

\`PlanGenerator.generate_plan()\` 的输出是一个纯文本 DAG：子任务描述 + 依赖关系。它不包含 \`tool\` 字段、不分配具体工具、不感知可用工具列表。一句话：**当前的任务规划层不做工具选择**。

工具选择是 LLM API 层级的事——ChatEngine 在构造 API 请求时使用 tool-use 机制，这发生在规划层之外。规划层负责「知道做什么」，工具层负责「知道用什么做」。未来将规划 DAG 的每个节点映射到具体工具调用，是 MCP（Model Context Protocol）整合目标的一部分。

> 🟢 置信度: 0.85`,
    l1: `### 规划与工具选择的解耦设计

GlassCortex 架构中规划层和工具层是两个独立的关注点：

| 层级 | 组件 | 职责 | 是否涉及工具 |
|:-----|:-----|:-----|:-----------:|
| L1 意图识别 | PlannerEngine | 判断用户想干什么 | ❌ |
| L2 任务规划 | PlanGenerator | 分解为子任务 DAG | ❌ |
| L3 规划反思 | ReflectionEngine | 事后评估规划质量 | ❌ |
| 执行层 | ChatEngine | 构造 LLM API 请求，含 tool-use | ✅ |
| 工具层 | MCP Server（未来） | 注册/调用外部工具 | ✅ |

#### 为什么当前规划层不涉及工具？

这是有意的架构决策，不是缺陷：

1. **DAG 的可视化优先**：\`PlanResult\` 最初的设计目标是为前端 ProcessDrawer 提供可视化素材——子任务 DAG。工具分配在这个场景中是噪音：用户需要看到「先搜索→再分析→再推荐」的步骤，不需要看到「用 web_search 工具」「用 text_analyzer 工具」这样的底层细节。

2. **工具集是动态的**：GlassCortex 的工具集（如果有）可能是动态注册的——今天有 3 个工具，明天可能 8 个。规划层如果硬编码工具选择逻辑，会成为一个维护负担。

3. **LLM 的原生工具能力**：当前最流行的 LLM（DeepSeek/OpenAI/Claude）都有原生工具调用能力——\`tool_choice\` 参数让 LLM 自己决定用什么工具。既然 LLM 自己做工具选择通常做得很好，规划层不需要再重复这一层逻辑。

#### 当前架构的实际路径

当 ChatEngine 处理一条「搜索最新的 AI 论文并总结」的用户消息时，经过的路径是：

1. PlannerEngine → 意图：「指令」
2. PlanGenerator → 子任务：["搜索论文", "筛选相关", "写总结"]
3. ChatEngine → 工具调用：\`web_search("2025 AI papers")\` → 返回结果 → LLM 综合回答

第 2 步和第 3 步之间没有直接的工具分配——\`PlanResult\` 的子任务不会「绑定」到具体工具上。第 3 步的 \`web_search\` 调用是 ChatEngine 独立于规划层进行的。

#### 当前架构的局限

既然工具选择在 ChatEngine 层而非规划层，一个直接的问题是：PlanGenerator 的子任务 DAG 和目标 LLM API 调用的 tool-use 序列之间，**没有任何对齐机制**。PlanGenerator 可能规划了「搜索→分析→推荐」三步，但 LLM 的一次 tool call 同时完成了搜索和分析——两者脱节。

> 📌 **交叉引用**：LLM 调用过程中的 tool-use 机制详见 [q3.9 执行监控与动态重规划]；MCP 工具整合规划详见 [q7.x 工具调用与外部服务整合]。

> 🟢 置信度: 0.82`,
    l2: `### 核心代码：工具选择的缺失

#### PlanResult — 无 tool 字段

\`\`\`python
# src/planner/plan.py:37-52
@dataclass(frozen=True)
class PlanResult:
    subtasks: list[dict[str, object]] = field(default_factory=list)
    # 每个 subtask 的格式：{"id": "1", "description": "搜索论文", "depends_on": []}
    # 没有 tool 字段、没有 tool_params 字段、没有 expected_output 字段
    dag_edges: list[tuple[str, str]] = field(default_factory=list)
    rationale: str = ""
    confidence: float = _FALLBACK_CONFIDENCE
\`\`\`

subtask 字典只有三个字段：\`id\`、\`description\`、\`depends_on\`。没有 \`tool\`、\`tool_params\`、\`expected_output\`——没有任何字段让子任务与工具调用挂钩。

#### generate_plan — prompt 不含工具说明

\`\`\`python
# src/planner/plan.py:140-156
system_prompt = (
    "你是一个任务规划器。将用户的消息分解为可执行的子任务，"
    "并标注子任务之间的依赖关系。\\n"
    # ... 没有关于可用工具的说明
    # 没有 "可用的工具有: web_search, code_interpreter, ..."
)
\`\`\`

prompt 中完全不提及可用工具。LLM 在规划时不知道系统中注册了哪些工具，因此不可能做工具选择。

#### 规划到执行的脱节

\`\`\`python
# src/chat/engine.py 中的工具调用路径
# ChatEngine.respond() 构造 LLM API 请求时：
messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_msg},
]
# PlanGenerator 的规划结果（PlanResult）不在 API 调用的任何路径上
# 工具选择是 LLM 基于自身判断 + tool_choice 参数完成的
# 规划层的子任务 DAG 和执行层的工具调用之间没有对齐
\`\`\`

> 🟢 置信度: 0.88`,
    l3: `### 前沿方向：MCP 整合后的工具感知规划

#### 工具注册中心

未来的 \`ToolRegistry\` 在系统启动时收集所有可用工具的能力描述，进入规划 prompt：

\`\`\`
可用工具：
- web_search(query, time_range): 互联网搜索
- code_interpreter(code, language): 代码执行
- memory_retrieve(query): 记忆检索
- ...（动态注册 × N）

根据子任务选择最合适的工具，在 subtask 中填入 tool 字段。
\`\`\`

这要求 \`PlanGenerator\` 在构造 prompt 时动态注入工具列表——当前不具备这个能力，但接口（\`generate_plan()\` 的 system_prompt 构造）是可扩展的。

#### 子任务到工具的映射

每个子任务增加 \`tool\` 和 \`tool_params\` 字段，使 DAG 不仅表达步骤顺序，也表达「每一步用什么工具」：

\`\`\`json
{
  "subtasks": [
    {"id":"1", "description":"搜索2025年AI论文", "tool":"web_search", "params":{"query":"2025 AI paper"}},
    {"id":"2", "description":"分析论文摘要", "tool":"text_summarizer", "depends_on":["1"]}
  ]
}
\`\`\`

#### 工具感知的 DAG 验证

有工具分配后，\`PlanResult\` 可以做工具级别的验证：子任务 1 依赖子任务 2 的输出，但子任务 1 用的工具需要子任务 2 的格式——这齐了吗？这是规划层验证的新维度。

> 📌 **交叉引用**：ChatEngine 的工具调用机制详见 [q3.9 执行监控与动态重规划]；MCP 工具整合整体规划详见 [q7.x 工具调用]。

> 🟢 置信度: 0.73`,
    crossChapterConnections: [
      { questionId: "q2.15", type: "extension", relationship: "长期存储（Ch2）可记录工具调用历史——「这个工具上次对这个类型的问题效果如何」指导工具选择" },
      { questionId: "q5.3", type: "application", relationship: "每次工具调用消耗 token，工具编排策略直接影响 Ch3↔Ch4 交互效率" },
      { questionId: "q1.8", type: "prerequisite", relationship: "工具选择依赖当前上下文中包含的信息——上下文组装策略决定了 LLM 知道哪些工具可用" },
    ],
  },
  {
    id: "q3.8",
    question: '计划验证：执行前怎么检查"这个计划能达成用户意图"？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.85, l1: 0.82, l2: 0.87, l3: 0.74 },
    overallConfidence: 0.74,
    l0: `### 没有「执行前验证」——只有隐式校验和执行后反思

GlassCortex 的规划管线中没有专门的「执行前计划验证」步骤。验证以两种形式存在：

1. **隐式校验**：\`_parse_plan()\` 的三阶回退解析对 LLM 输出做格式和类型检查——这不验证计划内容本身，只验证结构
2. **执行后反思**：\`ReflectionEngine.reflect()\` 在计划执行后评估「这个计划是否达成了用户意图」——但已经晚了

验证的缺失是有意为之——因为计划不驱动实际执行，任务是给用户看的。如果用户看到了不合理的规划，ta 可以自己修正。真正需要验证时（未来规划与执行对接），才需要显式的前置验证。

> 🟢 置信度: 0.85`,
    l1: `### 为什么没有执行前验证

执行前计划验证的核心问题是：**验证计划需要知道计划的预期结果，而这往往与被验证的计划是同一个问题**。

「验证这个『搜索→分析→推荐』计划是否合理」和「搜索→分析→推荐本身直到实施完之前都没法真正验证」之间存在一个循环。当前的工程回答是：不对计划做前置验证，因为计划是展示层而非执行层。

#### 当前系统的两种「验证」

**1. _parse_plan() 的结构校验**

这不是内容验证，是格式验证——确保 \`PlanResult\` 是有效的 DAG：

- 每个子任务必须包含 \`id\` 和 \`description\`
- \`depends_on\` 引用的 ID 必须存在于子任务列表中（\`_derive_dag_edges()\` 会过滤掉无效引用）
- 子任务数量 ≤ \`_MAX_SUBTASKS = 8\`
- 解析失败时的兜底 \`PlanResult(rationale="解析失败")\`

如果 \`_parse_plan()\` 产生了空 \`PlanResult\`（所有三层全部失败），\`generate_plan()\` 仍然返回一个合法的空计划——不会阻塞管线。

**2. ReflectionEngine 的执行后反思**

\`ReflectionEngine.reflect()\` 在计划「执行」后评估：

\`\`\`
用户意图：帮我写一篇关于 AI 安全的文章
规划：搜索 → 整理素材 → 写文
反思：计划是否覆盖了用户需求？是否遗漏了什么？
\`\`\`

反思结果（\`ReflectionResult\`）包含评分、缺失内容和改进建议。但这个执行后验证不能阻止一个坏计划被执行——它只能告诉系统下次怎么做更好。

#### 当前模式的适用性

在 GlassCortex 的当前架构中——规划是展示层，执行是 ChatEngine——不做执行前验证是合理的：

- 展示层计划不需要「验证通过」才能运行
- 用户看到不合理的计划可以自行修正（追问一句「第三步不对，换个方式」）
- 真正的验证发生在 ChatEngine 的执行过程中——LLM 在 tool-use 和对话流中会自然地验证自己是否在正轨上

但如果未来规划要驱动实际执行（规划→执行→验证→修正 闭环），执行前验证就变得必要了。

> 📌 **交叉引用**：ReflectionEngine 的完整实现详见 [q3.9 执行监控与动态重规划]；计划可否决性的用户交互详见 [q3.14 计划的可否决性]。

> 🟢 置信度: 0.82`,
    l2: `### 核心代码

#### _parse_plan — 唯一的结构校验

\`\`\`python
# src/planner/plan.py:196-230
@staticmethod
def _parse_plan(raw: str) -> tuple[PlanResult, str | None]:
    # 层级 1：严格 JSON 解析 + 类型校验 + ≤8 截断
    try:
        data = json.loads(raw)
        subtasks_raw = data.get("subtasks", [])
        subtasks = []
        for t in subtasks_raw[:_MAX_SUBTASKS]:
            if isinstance(t, dict) and "id" in t and "description" in t:
                subtasks.append({
                    "id": str(t["id"]),
                    "description": str(t["description"]),
                    "depends_on": (
                        [str(d) for d in t["depends_on"]]
                        if isinstance(t.get("depends_on"), list) else []
                    ),
                })
        return PlanResult(
            subtasks=subtasks,
            dag_edges=_derive_dag_edges(subtasks),
            rationale=str(data.get("rationale", "")),
            confidence=max(0.0, min(1.0, float(data.get("confidence", 0.5)))),
        ), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass  # 降级到层级 2
    # ... 层级 2 和 3 同模式
\`\`\`

这是唯一的结构校验点。它检查的是 JSON 格式、字段类型、ID 引用有效性——**不是**计划内容是否合理。

#### _derive_dag_edges — 依赖有效性校验

\`\`\`python
# src/planner/plan.py:54-69
def _derive_dag_edges(subtasks: list[dict[str, object]]) -> list[tuple[str, str]]:
    task_ids = {t["id"] for t in subtasks if "id" in t}
    edges: list[tuple[str, str]] = []
    for task in subtasks:
        target = task.get("id")
        deps = task.get("depends_on", [])
        if isinstance(deps, list) and target is not None:
            for dep in deps:
                if isinstance(dep, str) and dep in task_ids:
                    edges.append((dep, str(target)))
    return edges
\`\`\`

如果 depends_on 引用了不存在的子任务 ID，该边会被静默丢弃——不是提前报错，因为展示层可以容忍「缺了某条边」但不能容忍「整个 DAG 渲染失败」。

#### 没有 validate_plan()

\`\`\`python
# 在 src/planner/plan.py 中搜索 "validate" 或 "verify"：
# 没有 PlanGenerator.validate_plan() 方法
# 没有 PlanResult 级别的完整性校验
# 没有内容合理性的自检
\`\`\`

> 🟢 置信度: 0.87`,
    l3: `### 前沿方向：主动计划验证

#### 前置条件校验

如果 plan 最终连接到实际执行，每个子任务需要验证前置条件——「搜索」需要搜索引擎可用，「发邮件」需要邮件服务器已配置。前置条件校验可以在计划生成后、执行前完成，避开「验证计划需要执行计划」的循环。

#### DAG 自洽性检查

一个 DAG 的自洽性检查至少应该覆盖：
- **环检测**：subtask A 依赖 B，B 依赖 A → 死锁，无法执行
- **孤立节点**：某个子任务不依赖任何人也不被任何人依赖 → 可能漏了连接
- **缺失末端**：DAG 的叶子节点不是一个「输出」类型的子任务 → 计划可能没有完成步骤

以上三个检查当前全部缺失。

#### 基于模拟执行验证

最理想的验证方式：对 \`PlanResult\` 做一遍「模拟执行」——逐个子任务调用 LLM 判断「以当前系统能力，这个子任务能否完成？」——而不是真正执行。这个验证不依赖计划之外的数据，可以在规划完成后立即完成。

#### 用户确认作为验证

对于高风险的子任务（涉及写入/删除/修改用户数据），验证就是「问用户」：LLM 将计划中的关键步骤转译为自然语言，用户确认后继续。这是简单可靠但用户体验取决于频率——每步都问不行，不问也不行。

> 📌 **交叉引用**：执行后反思的完整实现详见 [q3.9 执行监控与动态重规划]；用户否决计划的能力详见 [q3.14 计划的可否决性]。

> 🟢 置信度: 0.74`,
    crossChapterConnections: [
      { questionId: "q2.20", type: "prerequisite", relationship: "记忆污染会污染计划验证的判断依据——如果历史记忆中有错误事实，验证逻辑可能通过一个本不该通过的计划" },
      { questionId: "q1.5", type: "parallel", relationship: "不一致信息（Ch1）与计划验证都是质量关卡——一个过滤输入噪声，一个过滤不可执行计划" },
      { questionId: "q2.26", type: "extension", relationship: "记忆免疫系统（Ch2）提供了类似的验证保护机制——两者都是在「写」之前做「检查」的防护层" },
    ],
  },
  {
    id: "q3.9",
    question: '执行监控与动态重规划：执行过程中发现偏离，怎么感知、怎么修正？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.93, l1: 0.91, l2: 0.88, l3: 0.84 },
    overallConfidence: 0.84,
    l0: '动态重规划是任务执行的"纠偏机制"——当用户中途修正需求或系统发现执行偏离时，不是推翻重来，而是对比原始计划→识别漂移→生成修正计划。GlassCortex 用 ReplanDetector 做意图漂移检测，但核心洞察是：AI 应该承认"我理解错了"，而不是硬着头皮执行一个已经偏离用户意图的计划。',
    l1: `想象你在开车去一个陌生的餐厅，GPS 导航给你规划了一条路线。但你突然想起需要先去药店买药——你打了转向灯，偏离了原路线。一个好的 GPS 不会坚持说"请掉头回到原路线"，而是立即重新计算："好的，先去药店，再从药店到餐厅，预计多花 8 分钟"。这个"检测偏离→重新规划"的过程，就是动态重规划。

对 AI 来说，用户在执行中途改变需求——比如先说了"帮我写个邮件"，中途补充"算了，先把上周的会议纪要整理出来，再根据纪要写邮件"——系统需要做三件事：① 感知到计划漂移了（这不是同一件事了）、② 理解漂移的类型和原因、③ 生成一个能覆盖新需求的修正计划。

> **关键洞察**：如果 AI 不检测计划漂移，硬着头皮执行原始计划，结果就是"你花了 5 分钟写了一封邮件，但用户想要的根本不是这个"——浪费的不只是 token，更是用户的信任。承认"我之前理解错了，让我重新规划"比死撑一个错误的计划有价值得多。

### 三种漂移类型

不是所有"用户又说了一句"都是漂移。GlassCortex 的 ReplanDetector 将漂移分为三类：

1. **意图漂移**（Intent Drift）：用户从 A 类意图跳到 B 类意图。比如从"提问"（"Python 的 GIL 是什么？"）跳到"指令"（"帮我写个脚本绕过 GIL"）。这是最剧烈的漂移——原始计划可能完全不适用。

2. **范围变化**（Scope Change）：意图类别不变，但任务范围改变。比如从"写邮件"细化为"整理会议纪要后写邮件"——前者的计划是 3 步，后者需要先检索、再提取、再组织、再写邮件，至少 4-5 步。这是最常见也最难自动判定的漂移类型。

3. **约束变更**（Constraint Shift）：意图和范围都差不多，但约束条件变了。比如"写个简短版本"（长度约束变）、"用通俗语言"（风格约束变）、"别用 pandas，用纯 Python"（工具约束变）。不一定改变子任务结构，但改变每个子任务的执行方式。

\`\`\`mermaid
%% title: 图：重规划漂移检测流程
graph TD
    U1["👤 用户原始消息<br/>'帮我写个邮件'"]
    U2["👤 用户修正消息<br/>'算了，先整理纪要再写'"]

    U1 --> P1["📋 原始计划<br/>1. 收集收件人<br/>2. 生成正文<br/>3. 发送确认"]
    U2 --> DETECT["🔍 ReplanDetector<br/>漂移检测"]

    P1 --> DETECT

    DETECT --> COMPARE{"比较：意图类别<br/>+ 消息细化程度<br/>+ 关键词变化"}

    COMPARE -->|"无实质性变化"| STICK["✅ 保持原计划<br/>drift_detected=false"]
    COMPARE -->|"检测到漂移"| CLASSIFY["🏷️ 漂移分类<br/>范围变化 / 意图漂移 / 约束变更"]

    CLASSIFY --> REGEN["🔄 生成修正计划<br/>LLM 调用 → JSON 解析<br/>→ subtasks + DAG edges"]
    REGEN --> DIFF["📊 差异摘要<br/>+新增 / -删除 / ~重排"]
    DIFF --> OUTPUT["✅ 修正计划输出<br/>ReplanComparePanel 展示"]

    style DETECT fill:#4f46e5,stroke:#4338ca,color:#fff
    style COMPARE fill:#f59e0b,stroke:#d97706,color:#111
    style REGEN fill:#8b5cf6,stroke:#7c3aed,color:#fff
    style OUTPUT fill:#34d399,stroke:#059669,color:#111
\`\`\`

### GlassCortex 的做法

在 GlassCortex 中，ReplanDetector（\`src/planner/replan.py\`）是一个独立的检测引擎——它不驱动执行，只负责检测漂移并生成修正计划。检测结果在前端 ReplanComparePanel 中用三列对比展示（原始计划 | 差异摘要 | 修正计划），让用户直观看到"AI 是怎么意识到自己该调整的"。`,
    l2: `### ReplanDetector 的工程实现

ReplanDetector 沿袭 PlanGenerator 的构造模式，但与 PlanGenerator 有本质区别——PlanGenerator 生成初始计划，ReplanDetector 在已有计划基础上检测漂移并修正。

**构造与注入**：
\`\`\`python
# src/planner/replan.py
class ReplanDetector:
    def __init__(self, store: MemoryStore, index: IndexManager, embed_fn):
        self._store = store
        self._index = index
        self._embed = embed_fn
        self._client: OpenAI | None = None  # 延迟初始化
        self._ledger: TokenLedger | None = None  # setter 注入

    def set_ledger(self, ledger: TokenLedger) -> None:
        self._ledger = ledger
\`\`\`

通过 setter 注入（与 PlanGenerator 的 \`set_ledger()\` 对称），在 \`src/bootstrap.py\` 中创建实例并注入 PlannerEngine：
\`\`\`python
# src/bootstrap.py
from src.planner.replan import ReplanDetector
replan_detector = ReplanDetector(store, idx, embed)
replan_detector.set_ledger(ledger)
planner.set_replan_detector(replan_detector)
\`\`\`

**LLM 检测 prompt 设计**：
\`\`\`python
system_prompt = (
    "你是一个任务规划漂移检测器。比较用户的原始消息和修正消息，"
    "判断任务意图是否发生实质性变化。\\n"
    f"原始意图类别：{original_intent}\\n"
    "原始计划：\\n"
    f"{orig_plan_text}\\n"
    "判断标准：\\n"
    "- 如果修正消息只是原始消息的细化/澄清 → drift_detected=false\\n"
    "- 如果修正消息改变了任务范围、目标或约束 → drift_detected=true\\n"
    "- 如果修正消息完全推翻了原始意图 → drift_detected=true\\n"
    "响应格式（严格 JSON）：\\n"
    '{"drift_detected":true/false,'
    '"drift_reason":"<一句漂移原因>",'
    '"revised_intent":"<修正后意图类别>",'
    '"subtasks":[...],"rationale":"...","confidence":<0-1>}'
)
\`\`\`

关键设计决策：
- **Temperature=0**：检测任务需要确定性，不能用创造性温度。
- **max_tokens=256**：检测结果简洁（布尔+短文本+小 JSON），不需要长输出。
- **将原始计划文本也传入 prompt**：让 LLM 对比原始计划 vs 修正需求，而不是凭空判断。

**三阶回退解析**（与 PlanGenerator 完全对称）：
\`\`\`python
@staticmethod
def _parse_replan(raw: str, fallback_intent: str) -> tuple[ReplanResult, str | None]:
    # 层级 1：严格 json.loads(raw)
    try:
        data = json.loads(raw)
        # 类型校验 + subtask 规范化 + confidence clamp
        return ReplanResult(...), None
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # 层级 2：提取 {...} 块
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start:end + 1])
            # 与层级 1 相同的校验逻辑
            return ReplanResult(...), None
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    # 层级 3：兜底 — drift_detected=False
    return ReplanResult(
        drift_detected=False,
        drift_reason=f"解析失败: {raw[:100]}",
        revised_intent=fallback_intent,
    ), f"JSON parse error: {raw[:200]}"
\`\`\`

> **为什么兜底是 drift_detected=False 而不是 True？** 因为"假阳性"（误判漂移）比"假阴性"（漏检漂移）危害更大——误判会导致系统扔掉一个好计划重新生成，用户看到闪烁的"我重新规划了"但实际啥都没变，体验更差。漏检只意味着系统继续执行原计划，用户再纠正一次就行了。

**差异摘要生成**：
\`\`\`python
def _generate_diff_summary(original, revised) -> str:
    orig_descs = {t["description"] for t in original}
    rev_descs = {t["description"] for t in revised}
    added = rev_descs - orig_descs
    removed = orig_descs - rev_descs
    # 生成 "新增 N 步: ...; 删除 M 步: ...; 子任务数 3→4"
    ...
\`\`\`

基于集合差运算——不依赖 LLM 生成差异（那不可靠），而是从修正后的 subtasks 列表中直接计算。简单、确定、零 token 成本。

### ReplanDetector vs PlanGenerator 对比

| 维度 | PlanGenerator | ReplanDetector |
|------|:---|:---|
| 触发时机 | 用户消息 → 意图分类后 | 用户修正消息 → 检测到漂移后 |
| 输入 | 用户消息 + 意图类别 | 原始计划 + 原始消息 + 修正消息 |
| LLM 调用 | 1 次（temperature=0, 256 tokens） | 1 次（temperature=0, 256 tokens） |
| 解析策略 | 三阶回退（JSON→块→兜底空计划） | 三阶回退（JSON→块→兜底无漂移） |
| 兜底行为 | 返回空 PlanResult | 返回 drift_detected=False |
| 输出类型 | PlanResult | ReplanResult（含 diff_summary） |
| TokenLedger | ✅ | ✅ |

### API 端点

\`POST /planner/detect-replan\` — 独立于 \`/planner/generate-plan\`，用于 Lab 调试重规划检测逻辑。

**请求体**：
\`\`\`json
{
  "user_msg": "帮我写个邮件",
  "original_intent": "指令",
  "original_plan_json": "{...}",
  "revised_user_msg": "算了，先把上周的会议纪要整理出来，再根据纪要写邮件"
}
\`\`\`

**响应体**：
\`\`\`json
{
  "drift_detected": true,
  "drift_reason": "用户从'写邮件'细化为'整理纪要后写邮件'，需求范围扩大",
  "revised_intent": "指令",
  "revised_plan": { "subtasks": [...], "dag_edges": [...], "rationale": "..." },
  "diff_summary": "子任务数 3→4; 新增 3 步: ...; 删除 2 步: ...",
  "confidence": 0.85,
  "trace": { "system_prompt": "...", "raw_response": "...", "token_usage": {...} }
}
\`\`\`

\`trace\` 字段是调试关键——前端 ReplanComparePanel 可以展示 LLM 实际返回了什么，帮助用户理解"AI 为什么判断这是漂移"。`,
    l3: `### 行业实践

**Anthropic 的 "correction" 处理**：Claude 的 system prompt 中有明确的 "correction" 指令——当用户说 "no, I meant..." 或 "actually, let's do X instead" 时，模型应该承认错误并调整方向，而不是辩护原始理解。这是一种**隐式重规划**——模型在推理过程中自己纠偏，不需要外部检测器。优点是零延迟、自然对话流；缺点是隐性不可审计——你不知道模型是否真的"理解"了修正，还是只是表面的语言顺应。

**LangChain ReAct 循环**：ReAct（Reasoning + Acting）模式中，每一步执行后都有一个 "Observation" 步骤——LLM 看到工具调用结果，判断是否需要调整计划。如果 Observation 显示执行偏离了预期（比如搜索返回空结果），LLM 可以在下一个 Reasoning 步骤中调整方向。这是一种**执行驱动的重规划**——不是用户说的，而是执行过程中发现"这样不行"。

**人在回路规划**（Human-in-the-loop Planning）：对于高风险任务（如代码部署、金融交易），在关键步骤执行前暂停并请求用户确认。如果用户在确认时说"不对，第三步应该先备份"，这就是一次人工触发的重规划。AutoGPT 和 MetaGPT 的实验表明，纯自动重规划的错误率在 25-40%，加入一步人工确认可以降到 5% 以下。

**LLM-as-Judge 监控**：一种新兴范式是用一个独立的 LLM 作为"执行监督者"——每 N 步检查一次"当前执行是否仍然对齐原始目标"。这比规则检测更灵活（能理解语义层面的偏离），但成本较高（每 N 步多一次 LLM 调用）。

### 开放问题

**何时重规划 vs. 何时坚持？** 最难的判断不是"有没有偏离"（那是 LLM 可以做的），而是"偏离了要不要管"。如果偏离只是用词调整（"短一点"），重规划是过度反应。如果偏离是意图变更（"算了，换个方向"），不重规划就是无视用户。目前没有公认的阈值——GlassCortex 的做法是让 LLM 同时输出 drift_detected 和 confidence，用 confidence 做软决策。

**重规划的粒度**：是整个计划推翻重来、还是只修改受影响的部分？全文重来丢弃了未受影响的部分（浪费），局部修改可能引入碎片化（新旧计划不一致）。PlanGenerator 的当前实现是全文重来（简单、自洽），但成本较高。

**多轮修正的收敛性**：如果用户连续修正 3 次（"不是这样"→"也不是那样"→"再换一个"），系统是否应该检测到"用户自己也不确定自己要什么"并切换为澄清模式而不是继续重规划？这是一个元认知问题——重规划检测器需要检测"自己是否需要停止检测"。

### 与其他章节的连接

- **Ch1 意图识别**：漂移检测的输入是原始意图类别——意图分类越准确，漂移检测越可靠。两者形成"意图→计划→重规划"的三步管线上游。
- **Ch2 记忆系统**：理想情况下，重规划应该参考记忆中的"类似修正历史"——"这个用户之前也经常在邮件任务中补充需求，所以这次修正的可信度很高"。
- **Ch4 Token 效率**：每次重规划都是一次额外的 LLM 调用——\`drift_detected=false\` 的调用本质上是"为不重规划而付出的检测成本"。是否值得？取决于场景：高价值任务（部署、金融）值得，闲聊不值得。`,
    labLinks: [{ tab: "context", label: "重规划对比面板" }],
    crossChapterConnections: [
      { questionId: "q1.2", type: "application", relationship: "上下文窗口溢出是触发重规划的常见外部条件——溢出后系统需要重新评估当前计划是否仍然可行" },
      { questionId: "q5.2", type: "prerequisite", relationship: "记忆系统（Ch2）提供的用户行为历史可辅助判断「这次偏离是临时修正还是意图改变」——Ch2↔Ch3 交互的关键信号" },
      { questionId: "q4.2", type: "application", relationship: "重规划消耗额外 token，需要在「重规划成本」与「错误执行成本」之间做经济权衡" },
    ],
  },
  {
    id: "q3.10",
    question: '人机协作规划：什么情况下应该把决策权交回用户而不是自行推断？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P2",
    confidence: { l0: 0.92, l1: 0.90, l2: 0.88, l3: 0.78 },
    overallConfidence: 0.78,
    l0: `不是所有决定都该 AI 替你做。三类你必须自己拿主意：系统自己都没把握、涉及你的价值观判断、需要你做系统做不到的事。当前 GlassCortex 只会在 PlanResult.confidence 上标记"我不确定"，但不会主动把决策推回给你——它等你开口，而不是反过来问"你觉得呢"。

> 🟢 置信度: 0.92`,
    l1: `你去一家熟悉的餐馆，服务员问牛排几分熟。你说"你定吧"——这是信任。但如果这家店你第一次来，你可能会说七分熟——这是控制。人机协作规划的关系也在这两种模式间切换，关键是你什么时候从"你定"切换到"我来定"。

三扇需要你自己推开的门：

**第一扇：置信度不够的时候。** 如果系统自己都不确定这个方案对不对，强行执行就是赌博。\`PlanGenerator.generate_plan()\` 输出一个 \`confidence\` 值（0-1）——这是 LLM 自评的"这个计划靠谱吗"。你不到 0.6，系统其实没底。但问题是：**当前代码不会因为 confidence 低就主动问你**。它会把 0.4 置信度的计划照常展示给你，期待你自己发现"这个计划看起来不靠谱"。这不是一个良好的交互设计——置信度低恰恰是系统应该主动说话的时候。

**第二扇：涉及你的价值判断。** 写一封邮件的语气是正式还是亲切？砍掉哪个功能先做？推荐方案 A 还是 B？这些选择没有"正确答案"，只有"适合你"的答案。系统不知道你和你老板的关系、不知道你客户的偏好、不知道你团队的研发节奏。在这些场景下强行推断，往往产生"理论上对但感觉不对"的结果。

**第三扇：系统做不到的事。** 规划中如果包含"给 HR 发邮件确认"、"去数据库查看某个表的 schema"、"给老板打一个电话确认需求"——这些步骤系统做不到。它要么直接告诉你"发邮件超出我能力范围"，要么在规划中生成一个你无法执行的步骤。当前 GlassCortex 中 PlanResult 的子任务不携带 \`tool\` 字段（详见 q3.7），所以系统根本没有判断"这一步我做不做得到"的能力——这意味着所有子任务都默认是"系统能做的"，即使有些根本做不了。

> 📌 **交叉引用**：PlanResult.confidence 字段定义详见 [q3.5 LLM 任务规划流程]；工具选择与规划的脱节详见 [q3.7 工具编排]。

> 🟢 置信度: 0.90`,
    l2: `### 置信度交回机制的缺失

当前代码中，PlanResult 是单层置信度——整个计划一个 confidence 值，从 LLM 返回：

\`\`\`python
# src/planner/plan.py:37-51
@dataclass(frozen=True)
class PlanResult:
    subtasks: list[dict[str, object]] = field(default_factory=list)
    dag_edges: list[tuple[str, str]] = field(default_factory=list)
    rationale: str = ""
    confidence: float = _FALLBACK_CONFIDENCE  # 0.3
\`\`\`

confidence 是整个计划级别的。如果计划中有一个子任务置信度低（比如"搜索 API 文档"这个子任务系统没把握），它拉低的也是整个计划的 confidence。没有办法表达"步骤 1 我很有把握，步骤 2 我不确定"。

一个更精细的设计应该是 \`per-subtask confidence\`：

\`\`\`python
# 未来的设计方向
@dataclass
class Subtask:
    id: str
    description: str
    depends_on: list[str]
    confidence: float = 1.0       # 这个子任务的独立置信度
    requires_user_input: bool = False  # 是否需要用户介入
    feasible: bool = True          # 系统是否做得到
\`\`\`

这样，低置信度的子任务可以单独标记为"需要你确认"，其他步骤继续执行。而不是现在的二值方案：要么全信、要么全不信。

### ReplanDetector 的漂移作为交回信号

ReplanDetector 检测到意图漂移时，\`drift_detected = True\` 也是一个隐式的"交回用户"信号——如果系统不确定修正方向：

\`\`\`python
# src/planner/replan.py:37-55
@dataclass(frozen=True)
class ReplanResult:
    drift_detected: bool = False
    drift_reason: str = ""
    revised_intent: str = ""
    revised_plan: PlanResult = field(default_factory=PlanResult)
    diff_summary: str = ""
    confidence: float = _FALLBACK_CONFIDENCE
\`\`\`

目前这个信号只在前端 Lab 面板展示，不触发任何用户交互。一个合理的产品设计是：当 \`drift_detected = True\` 且 \`confidence < 0.7\` 时，前端弹出"我注意到你想要的可能变了，你看看这个新计划对劲吗？"的确认步骤。

> 🟢 置信度: 0.88`,
    l3: `### 自适应委托（Adaptive Delegation）

用户"交回"决策权的粒度不应该是二元的——要么全自动、要么全手动。理想的设计是**层级委托**：

1. **告知级**（最低置信）：系统展示计划和置信度，等你确认后再执行。类似"我建议这样，你觉得呢？"
2. **建议级**（中等置信）：系统执行但随时可以打断。"我开始做了，有问题我停下来问你。"
3. **全权级**（高置信）：系统自主执行，只告诉你结果。"做好了，你看看。"
4. **回顾级**（极高置信）：系统执行完也不告诉你，除非你主动查看。"例行工作，一切正常。"

这里的切换条件不是固定阈值，而是用户习惯的个性化学习——如果某个意图类型（如"写周报"）用户每次都确认通过不修改，系统应该自动从告知级升级到建议级。

### 人机协作的校准困境

最棘手的问题是：**系统知道自己置信度低，但低也可能没错**。比如 confidence=0.5 的计划，有 50% 概率是对的。如果每次 confidence<0.7 都问用户，用户会被打断到烦。如果每次都跳过不问，又可能执行了一个用户不想要的计划。

这个困境没有完美解——需要产品层面做取舍。一种折中是**展示但不打断**：把低置信度的计划显示在侧边栏（ProcessDrawer），让你看到了可以手动修正，但不在你打字聊天时弹窗中断。

> 🟢 置信度: 0.78`,
    crossChapterConnections: [
      { questionId: "q2.12", type: "prerequisite", relationship: "用户画像（Ch2）指导协作策略——技术用户可接受更高自主权，新用户需要更多确认步骤" },
      { questionId: "q1.10", type: "parallel", relationship: "消息角色（Ch1）定义了谁发出指令谁执行，人机协作（Ch3）定义了谁决策——角色分工是决策分工的基础" },
      { questionId: "q5.1", type: "extension", relationship: "用户反馈信号从上下文提取后引导计划调整——这是 Ch1↔Ch3 交互中「用户修正→重规划」闭环的关键" },
    ],
  },
  {
    id: "q3.11",
    question: '规划的"语言"：计划用什么形式表达？自然语言/JSON/DAG/代码？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P2",
    confidence: { l0: 0.95, l1: 0.93, l2: 0.92, l3: 0.82 },
    overallConfidence: 0.82,
    l0: `规划的载体决定了谁能读懂、能怎么操作。四种形式你都会用到：自然语言给人看（最灵活但不可解析）、JSON 给机器解析（GlassCortex 的选择）、DAG 可视化执行顺序（前端 ProcessDrawer 的渲染目标）、代码直接执行（最精确但最危险）。GlassCortex 选的是 JSON + DAG 组合——JSON 存结构，DAG 画流程。把你的 PlanResult 想象成一份 JSON 格式的装修图纸，而不是一本说明书。

> 🟢 置信度: 0.95`,
    l1: `给装修师傅看懂的图纸，和你口头说"我想把主卧改成暖色调"，是完全不同的两种表达。口头说的灵活但模糊，图纸精确但死板。你选择计划的"语言"，就是在可读性和可操作性之间做取舍。

四种规划语言，各有用武之地：

**自然语言**是最自然的表达——"先调研竞争对手，再分析差异点，最后写报告"。你一眼就看懂了。但机器不知道怎么解析"先"和"再"的关系——是串行还是并行？"最后"是前面所有步骤完成后，还是前两步完成后？自然语言对人类友好，对机器模糊。这是 LLM 直接输出的最常见形式——\`PlanGenerator\` 让 LLM 生成 JSON，正是因为如果让它用自然语言写计划，解析管线会变成一场噩梦。

**JSON (或类似的结构化格式)** 是当前 GlassCortex 的选择。每个子任务是一个对象，有 \`id\`、\`description\`、\`depends_on\`。依赖关系用 ID 引用，机器可以精确解析哪个步骤依赖哪个。\`PlanResult\` 的 \`subtasks\` 列表就是这样一个 JSON 数组，解析器把它转成前端可渲染的数据结构。缺点是人读起来不如自然语言直观——你很难一眼从 JSON 看出"这个计划总共几步、哪几步能并行"。

**DAG (有向无环图)** 解决的就是人读 JSON 不直观的问题。它不是一种序列化格式，而是一种可视化的关系表达——每个节点是一个子任务，箭头表示依赖关系。ProcessDrawer 接收 \`PlanResult.dag_edges\` 后，将 JSON 渲染成一张流程图。你可以一眼看出"步骤 1 和 2 可以同时做，步骤 3 等它们都完成"。

**代码**是最精确的规划语言。想象用 Python 写一个计划：\`search() → filter() → summarize()\`。每一步就是一个函数调用，输入输出类型由类型签名保证。代码不会被歧义，执行就是调用——但写计划的门槛太高了，而且容易因为语法错误卡住。

> 📌 **交叉引用**：PlanResult 的 JSON schema 详见 [q3.6 任务拆解]；ProcessDrawer 的 DAG 渲染详见 [q3.15 计划的可视化]。

> 🟢 置信度: 0.93`,
    l2: `### JSON Schema 的实际设计

\`PlanResult.subtasks\` 中每个子任务对象的 schema，由 prompt 和解析器共同约束：

\`\`\`python
# src/planner/plan.py:209-227 — 解析器的隐式 schema 校验
for t in subtasks_raw[:_MAX_SUBTASKS]:
    if isinstance(t, dict) and "id" in t and "description" in t:
        subtasks.append({
            "id": str(t["id"]),
            "description": str(t["description"]),
            "depends_on": [str(d) for d in t.get("depends_on", [])]
                if isinstance(t.get("depends_on"), list) else [],
        })
\`\`\`

关键约束：
- \`id\` 和 \`description\` 是必须字段——缺失则丢弃该子任务
- \`depends_on\` 是可选的，不存在时默认为空列表（无依赖）
- 所有字段强制转 \`str\`——LLM 有时返回数字 ID \`1\` 而非字符串 \`"1"\`
- 子任务数上限 \`_MAX_SUBTASKS = 8\`——防止 LLM 过度分解

### dag_edges 的推导

\`_derive_dag_edges()\` 负责把 depends_on 转化为机器可渲染的有向边：

\`\`\`python
# src/planner/plan.py:54-69
def _derive_dag_edges(subtasks: list[dict[str, object]]) -> list[tuple[str, str]]:
    task_ids = {t["id"] for t in subtasks if "id" in t}
    edges: list[tuple[str, str]] = []
    for task in subtasks:
        target = task.get("id")
        deps = task.get("depends_on", [])
        if isinstance(deps, list) and target is not None:
            for dep in deps:
                if isinstance(dep, str) and dep in task_ids:
                    edges.append((dep, str(target)))
    return edges
\`\`\`

一个被忽略但重要的细节：无效依赖被**静默忽略**。如果 \`depends_on:[3]\` 但实际没有 ID 为 "3" 的子任务，这条边不会出现在 dag_edges 中。这保证了即使 LLM 输出错误依赖，DAG 渲染也不会断裂。

### 为什么不选其它形式？

| 形式 | 原因 | 替代成本 |
|:-----|:----|:---------|
| 纯自然语言 | 不可解析 | 需要 NLP 解析器，准确率堪忧 |
| YAML | 太松散，大小写敏感 | 无 schema 校验 |
| XML | 太冗长 | 阅读体验差 |
| PDDL (规划领域定义语言) | 学术界标准但太重 | 需要 PDDL 编译器，LLM 不擅长生成 |
| 可执行代码 | 安全风险 | 需要沙箱执行，前端不可渲染 |

> 🟢 置信度: 0.92`,
    l3: `### 规划的编译链路：从自然语言到执行

一个完整的规划语言栈应该像编译器一样分层：

\`\`\`
用户的自然语言请求
    │
    ▼ LLM 解释
JSON 结构化计划 (PlanResult)
    │
    ▼ _derive_dag_edges
DAG 可视化的流程图
    │
    ▼ 调度器 (未来)
可执行的子任务序列 (代码/工具调用)
\`\`\`

当前 GlassCortex 走了前两步，第三步（DAG→可执行序列）是缺失的——规划停留在展示层，不驱动执行。

### 规划语言的未来方向

一种有趣的方向是**混合表达**：子任务的 \`description\` 用自然语言（保留人类可读性），但同时增加 \`code_equivalent\` 字段（用伪代码表达精确语义）。这样你看到的还是"搜索论文"，但后端可以精确知道这一步对应什么操作。

另一个方向是**可编辑的 DAG**——你在前端拖拽修改 DAG 后，系统自动反序列化回 JSON，然后重新评估计划的可行性。这比对着一堆 JSON 编辑友好得多。

> 🟢 置信度: 0.82`,
    crossChapterConnections: [
      { questionId: "q1.11", type: "prerequisite", relationship: "规划语言的选择（JSON/DAG）依赖于上下文对结构化数据的支持能力——非结构化上下文无法可靠承载 PlanResult" },
      { questionId: "q2.1", type: "parallel", relationship: "事实抽取（Ch2）与规划语言都是结构化中间表征——一个从对话中提取事实三元组，一个将意图转为 DAG，都在做「非结构化→结构化」的转换" },
      { questionId: "q4.7", type: "application", relationship: "不同 tokenizer 对 JSON 和自然语言的编码效率不同——JSON 计划比自然语言计划更节省 token（结构紧凑且有规则模式）" },
    ],
  },
  {
    id: "q3.12",
    question: '规划与记忆的双向关系：记忆如何指导规划，规划执行结果如何反哺记忆？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.92, l1: 0.90, l2: 0.88, l3: 0.78 },
    overallConfidence: 0.78,
    l0: `记忆和规划是一条双向路：记忆给规划提供经验素材（"上次这么做失败了"），规划执行的结果回写记忆（"这次这么做成功了，记下来"）。GlassCortex 中 PlanGenerator 通过 embed_fn 从 MemoryStore 检索历史相关记忆来辅助规划，ReflectionEngine 把反思结果（plan_quality_score + 改进建议）写回记忆存档——形成了一个"规划→执行→反思→存档→指导下次规划"的闭环。

> 🟢 置信度: 0.92`,
    l1: `老司机开车不需要每次都从头看导航——他记得"晚高峰那条路堵了半小时"，所以这次换一条。这不是直觉，这是记忆在指导规划决策。反过来，"我上次换了这条小路，结果绕了更远"——这个新经验又写回记忆，下次就不选了。

AI 规划系统也应该这样运转，而不是每次用户开口都从零开始。

**记忆→规划：历史给出参考**

当 \`PlanGenerator.generate_plan()\` 被调用时，它不只是看用户当前这条消息——它通过构造注入的 \`embed_fn\` 检索 \`MemoryStore\` 中与当前请求语义相似的历史记录。这些历史记录可能包含：

- 用户之前提过类似问题，系统当时规划了什么方案
- 上次类似方案的用户反馈（满意还是不满意）
- 同类问题的反思记录（"这种问题的计划质量评分偏低"）

如果检索到的历史表明"这个用户上次让你写邮件用了比较正式的语气"，新计划就可以默认走正式路线。这些约束不是写死在 prompt 里的——它们来自记忆。

**规划→记忆：经验反哺**

这是 ReflectionEngine 做的事。每次会话结束后：

\`reflection_result.plan_quality_score\` 是对本次规划质量的评分（0.4 来源于意图-计划匹配度，0.35 来源于执行完成度，0.25 来源于用户满意度）。这个评分 + ReflectionResult 中的改进建议，被写回记忆系统。

下一次类似的请求检索记忆时，就会看到"上次这种任务的计划质量评分是 0.75——中等偏上，但用户对步骤 3 不太满意"。PlanGenerator 可以通过这些历史信号微调自己的分解策略。

**当前闭环的缺口**

理想很丰满，现实有两个缺口：

1. **PlanGenerator 目前没有主动读取记忆来辅助规划**。\`generate_plan()\` 的签名是 \`(user_msg, intent_category)\`——它接收你的消息和意图类型，但不接收记忆检索结果。构造注入的 \`MemoryStore\` 和 \`IndexManager\` 在那里，但 generate_plan 内部没有调用它们。
2. **ReflectionEngine 写记忆后，触发机制是手动的**——它不是你每次对话自动运行的。需要有人在管线中主动调用 \`reflect_on_session()\`。

所以"双向"作为架构理念存在，但在代码层面还是一条半通路。

> 📌 **交叉引用**：MemoryStore 的检索接口详见 [q2.8 记忆检索]；ReflectionEngine 的评分构成详见 [q3.15 作者模型]。

> 🟢 置信度: 0.90`,
    l2: `### PlanGenerator 的记忆接入点 — 已注入但未使用

构造注入给了 PlanGenerator 访问 MemoryStore 的能力，但 \`generate_plan()\` 内部没有调用它：

\`\`\`python
# src/planner/plan.py:72-91
class PlanGenerator:
    def __init__(
        self,
        store: MemoryStore,     # 已注入！
        index: IndexManager,    # 已注入！
        embed_fn: Callable[[str], np.ndarray],  # 已注入！
    ) -> None:
        self._store = store
        self._index = index
        self._embed = embed_fn
        ...

    def generate_plan(
        self, user_msg: str, intent_category: str = "提问"
    ) -> tuple[PlanResult, dict[str, object]]:
        # ⚠️ 没有 self._store.recall() 调用
        # ⚠️ 没有 self._index.search() 调用
        # prompt 只包含用户消息和意图类别，不包含记忆上下文
        ...
\`\`\`

要激活这条通路，\`generate_plan()\` 应该在构建 prompt 前先从记忆系统检索与 \`user_msg\` 语义相似的历史记录，并将相关的反思记录、历史计划质量评分注入 prompt。这是一个明确的"未来改进"标记。

### ReflectionEngine 的回写机制

ReflectionEngine 的反思结果通过 \`_store.save()\` 写回记忆系统，但写的是反思文本而非规划相关的结构化数据：

\`\`\`python
# src/planner/reflection.py 中的回写逻辑（简化）
self._store.save({
    "type": "reflection",
    "session_id": session_id,
    "plan_quality_score": result.plan_quality_score,
    "improvements": result.improvement_suggestions,
    "raw_reflection": result.reflections,
})
\`\`\`

这些记录在 \`MemoryStore\` 中用 \`type = "reflection"\` 标记。当你下次检索记忆时，它们会被当做普通记忆记录返回——但 \`PlanGenerator\` 既然不读取记忆，它们就处于"存了但没人用"的状态。

### 对比：ChatEngine 的记忆消费

有意思的对比——ChatEngine 的 \`_build_system_prompt()\` 是真正消费记忆的：

\`\`\`python
# src/chat/engine.py 中构建 system prompt 时
recalled = self._store.recall(context_snapshot, top_k=5)
# recalled 中的记忆事实被注入到 LLM 的 system prompt 中
\`\`\`

ChatEngine 在执行层读了记忆，PlanGenerator 在规划层没读——这说明"规划-记忆双向"的工程落地优先级低于"执行-记忆双向"。对用户来说，规划 DAG 好看比规划 DAG 有经验更重要。

> 🟢 置信度: 0.88`,
    l3: `### 持续学习：从闭环到进化

如果记忆→规划→执行→反思→记忆的闭环打通了，系统就能实现**持续学习**（continual learning）——不需要重新训练模型，每次交互都在积累经验。

想象一下逐步积累的效果：

\`\`\`
第 1 次：用户说"写周报" → PlanGenerator 分解为 8 个详细子任务（包括"打开编辑器"这种废话）
第 10 次：检索到 9 次写周报的历史 → 自动压缩到 3 个子任务，粒度刚好
第 50 次：ReflectionEngine 发现"周报任务用户从来不改" → 提升到全权级，不展示 DAG
\`\`\`

这个进化的关键不是"存得更多"，而是**怎么从历史中提取即时的规划信号**——ReflectionEngine 的 \`plan_quality_score\` 就是这个目的。但需要两个触发条件：一是 PlanGenerator 主动消费记忆，二是 ReflectionEngine 自动运行而非手动触发。

### 跨会话记忆 vs 会话内记忆

另一个设计维度是**记忆的作用域**：
- 会话内记忆：前面几轮对话中的讨论影响本轮规划（当前基本实现——ChatEngine 保留对话历史）
- 跨会话记忆：昨天下雨了，用户抱怨了出行体验，今天再次规划出行时自动考虑天气（当前未实现——PlanGenerator 不读记忆）

跨会话记忆才是"规划进化"的体现，但它的工程代价高——需要长期的记忆积累 + 高精度的语义匹配 + 避免过时记忆污染规划。

> 🟢 置信度: 0.78`,
    crossChapterConnections: [
      { questionId: "q2.7", type: "prerequisite", relationship: "固化记忆（Ch2）为规划提供长期经验库——类似场景上次怎么规划的，这次可以复用或参考" },
      { questionId: "q2.15", type: "extension", relationship: "长期存储中的历史规划轨迹是「规划进化」的数据基础——跨会话积累的规划经验比单次规划更可靠" },
      { questionId: "q5.2", type: "extension", relationship: "Ch2↔Ch3 交互的核心主题——记忆指导规划（前向）与规划结果写入记忆（后向）形成双向反馈闭环" },
    ],
  },
  {
    id: "q3.13",
    question: '中断与恢复：用户在执行计划中途插入新请求，系统如何处理？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.88, l1: 0.85, l2: 0.88, l3: 0.75 },
    overallConfidence: 0.75,
    l0: `中断是常态，不是故障。你在帮人指路，他突然问起附近有什么好吃的——你不会扔掉指路这件事重新开始。当前 GlassCortex 没有专门的中断恢复机制，但 ReplanDetector 检测到的"意图漂移"（drift_detected）可以充当中断信号——系统看到意图变了，保留原计划的上下文，生成修正计划而不是完全丢弃。当前的工程缺口是：中断前的计划上下文不会被显式保留，一切靠 LLM 的对话历史间接维持。

> 🟢 置信度: 0.88`,
    l1: `你正在帮朋友规划周末行程——周六上午爬山，中午山顶野餐，下午看日落。刚说到下山后的安排，他打断你："对了，附近有什么好吃的推荐？"你不会说："好，我忘了前面所有规划，我们从爬山重新开始。"你会说："等一下，我们说回吃的——吃完午饭后你想去哪？"

AI 对话中的打断本质上是一样的。用户前一句还在问技术方案，后一句突然说"帮我查一下明天的天气"——这不是异常，这是人类自然的思维跳跃。

**三种中断类型，三种处理方式：**

**类型一：临时岔开。** 用户问完天气又回来说"接着说刚才的方案"——这是最常见的中断。系统应该保留规划上下文（前一版 \`PlanResult\`），等用户回来时恢复。当前 GlassCortex 不做显式保留，但 LLM 的对话历史中包含了上一轮讨论的内容，所以 LLM 还能"记得"刚才在说什么。问题在于：如果天气查询的对话占用了大量 token（比如详细天气预报），原计划可能会被挤出上下文窗口。

**类型二：意图漂移。** 用户不再回来——他的话题彻底变了。从"帮我设计一个技术方案"变成了"帮我写一封邮件"。这是 ReplanDetector 的检测范围——\`ReplanResult.drift_detected\` 标记了"意图变了"并生成修正计划。旧的计划不是被"丢弃"了，而是被降级为"历史上下文"——如果用户在第三轮又切换回技术方案话题，历史中的原计划还能被 LLM 识别。

**类型三：累积叠加。** 用户在一个请求中同时包含了多个任务——"帮我规划周末行程，对了顺便查一下明天天气，还有上次说的那个邮件方案你考虑了吗？"——这在代码中不是中断，而是一条复合消息。需要系统在规划阶段就识别出这是"三个独立意图"，分别处理而不是试图用一个计划覆盖所有。当前的 \`classify_intent()\` 处理单条消息的单一意图，不支持复合消息的意图分解。

> 📌 **交叉引用**：ReplanDetector 的意图漂移检测详见 [q3.9 执行监控与动态重规划]；对话上下文窗口限制详见 [q1.2 输出溢出]。

> 🟢 置信度: 0.85`,
    l2: `### Plangen 中断后的降级路径

\`PlanGenerator.generate_plan()\` 本身有两种降级状态，虽然不是"中断恢复"，但展示了系统在非正常状态下的行为：

\`\`\`python
# src/planner/plan.py:109-132
def generate_plan(
    self, user_msg: str, intent_category: str = "提问"
) -> tuple[PlanResult, dict[str, object]]:
    if not settings.plan_generation_enabled:
        # 降级 1：规划功能全局关闭 → 返回"空计划"
        return PlanResult(rationale="任务规划已禁用"), {}

    try:
        return self._generate_via_api(user_msg, intent_category)
    except (APIError, RuntimeError, json.JSONDecodeError, ValueError) as exc:
        # 降级 2：LLM 调用失败 → 返回"不可用"
        logger.warning("任务规划失败，返回空计划", ...)
        return PlanResult(rationale=f"规划不可用: {str(exc)}"), {}
\`\`\`

这两种降级都和对话历史无关——它们只处理"现在能不能规划"。这些降级路径没有与之前的规划上下文关联。如果用户之前有一个 \`PlanResult\` 存在，中断后不会和它做任何交互。

### ReplanDetector 作为隐式中断处理

ReplanDetector 的检测入口是当前消息 vs. 原始意图的差异，这可以被理解为"中断检测"：

\`\`\`python
# src/planner/replan.py 中检测意图漂移的入口
plan_result, plan_trace = plan_gen.generate_plan(user_msg, intent_category)
# 对比当前意图 vs 原始意图 → drift_detected
# 如果 drift_detected → 生成 revised_plan
# revised_plan 包含 diff_summary：说明新增/删除了哪些子任务
\`\`\`

这个 diff_summary 如果在前端展示，就是告诉用户"你的话题变了，我对计划做了调整"——这本质上就是中断恢复的 UI 表达。不过当前的 Lab 实现只展示对比面板，不在聊天界面中提示用户"原计划已调整"。

### 中断后上下文的存活时间

一个被忽略的工程问题：中断前的计划上下文应该保留多久？如果用户岔开话题 30 分钟后才回来，原计划上下文是否还应该被视为"活跃状态"？

当前没有超时机制——\`PlanResult\` 不是持久化存储的，它随 LLM 响应生成，展示完毕后就存在 LLM 的对话历史中。一旦上下文窗口满了被截断，原计划信息就丢失了。后续如果用户回来说"刚才那个方案"，LLM 可能得重新生成——而不是从存档中恢复。

> 🟢 置信度: 0.88`,
    l3: `### 多任务栈模型

中断恢复在工程上可以看作一个任务栈：

\`\`\`
栈顶 ← 当前活动任务（"查天气"）
       ─────────────────
       暂停任务1（"设计技术方案" — 已生成 PlanResult + 部分执行结果）
       暂停任务2（"写邮件" — 仅规划，未执行）
       基础任务（系统默认上下文）
栈底
\`\`\`

LLM 本身的语言能力已经能处理浅层任务栈（靠对话历史维持）。但一个工程化的任务栈管理系统可以做到：
- 显式标记"任务 A 暂停"和"任务 A 恢复"的事件
- 每个任务独立保存 PlanResult 和执行上下文
- 任务栈溢出时（比如挂了 5 个暂停任务）主动压缩或归档旧任务

> 📌 **交叉引用**：子对话记忆管理的完整讨论详见 [q5.2 子对话管理]。

### 主动恢复 vs 被动恢复

当前系统是被动恢复——等你再次提到之前的话题，LLM 从对话历史中"想起来"。更好的设计是主动恢复——当 ReplanDetector 检测到"用户似乎回到了之前的话题"时，主动展示之前的计划上下文："你刚才说的方案，我们还剩下步骤 3 和 4 没讨论，要继续吗？"

这需要 PlanResult 的持久化以及前端侧边栏的"恢复提示"组件，还没有开始设计。

> 🟢 置信度: 0.75`,
    crossChapterConnections: [
      { questionId: "q1.2", type: "prerequisite", relationship: "输出溢出（Ch1）是导致中断的常见诱因——溢出截断后原计划丢失，ChatEngine 需要从对话历史中重建上下文" },
      { questionId: "q2.7", type: "application", relationship: "固化记忆（Ch2）可保存中断前的计划状态——「记住上次做到了哪一步」让恢复不再是重新开始" },
      { questionId: "q5.1", type: "prerequisite", relationship: "恢复的核心依赖上下文状态保存——Ch1 的上下文组装策略决定了恢复时哪些信息还在、哪些已丢失" },
    ],
  },
  {
    id: "q3.14",
    question: '计划的可否决性：用户能不能说"第三步不要，换个方式"？',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P2",
    confidence: { l0: 0.92, l1: 0.88, l2: 0.90, l3: 0.80 },
    overallConfidence: 0.80,
    l0: `你可以否决整个计划——当 ProcessDrawer 展示 PlanResult 时，你可以在聊天中说"这个方案不行"或"换个思路"，系统会重新规划。但目前你做不到逐步骤否决——你不能说"第二步保留，第三步换掉"。这不是因为系统不尊重你的意见，而是因为没有设计"增量修改计划"的 UI 和代码机制。计划的可否决性目前是"全有或全无"：要么全盘接受要么全盘重来。

> 🟢 置信度: 0.92`,
    l1: `装修公司给你出了一份施工方案。你说"整个方案不行，重做"——他们回去重来。但如果你说"卫生间防水方案不错，但厨房的布局我不喜欢，换一个方案"——这就是逐步骤否决。你想要的不是全盘否定，是指定某一步要换。

AI 规划面临同样的选择。用户的行为往往不是"你说的都不对"，而是"总体上对，但第三步我不喜欢"。

**当前的全盘否决机制**

在 GlassCortex 中，当 \`PlanGenerator\` 生成一个 \`PlanResult\` 并在 ProcessDrawer 中展示给你后，你只有一条路：不满意就重新说一遍要求，让 \`PlanGenerator\` 重新规划。你不能拖拽调整子任务的顺序、不能圈住一个子任务说"换掉"、不能加一个"在第三步之前插入"的步骤。

这不算"系统忽视你的意见"——它只是把否决的粒度限定在"整份计划"级别。如果你说"搜索不要用 Bing，用 Google"，系统理解这句话是在描述第三步的修正，理论上 LLM 的下一次回答可以针对性地修改。但注意：**LLM 的回答和 PlanResult 是分离的**。你可能得到了一个正确的回复，但 ProcessDrawer 中的 DAG 仍然是旧版的，没有更新。

**逐步骤否决的工程挑战**

为什么不做？三个原因：

1. **没有状态绑定**。每个 \`PlanResult\` 是一个不可变的 frozen dataclass。要修改它，你得重新构造一个新的 PlanResult——那跟重新生成一遍差不多了。

2. **没有 UI 机制**。ProcessDrawer 是只读的，不支持拖拽、删除、添加子任务等操作。这不是技术做不到，是产品优先级没排到。

3. **计划-响应分离**。用户纠正"第三步"后，LLM 会按照修正来回答——但 PlanResult 不随 LLM 响应更新。所以 ChatMessage 中显示的回答和 Sidebar 中显示的 DAG 可能不一致。你看到了正确的结果，看到了错误的 DAG。

> 📌 **交叉引用**：PlanResult 的不可变 dataclass 定义详见 [q3.6 任务拆解]；ReplanDetector 的重新规划机制详见 [q3.9 执行监控与动态重规划]。

> 🟢 置信度: 0.88`,
    l2: `### PlanResult 不可变性的影响

\`PlanResult\` 是 frozen dataclass——创建后不可修改：

\`\`\`python
# src/planner/plan.py:37-51
@dataclass(frozen=True)
class PlanResult:
    subtasks: list[dict[str, object]] = field(default_factory=list)
    dag_edges: list[tuple[str, str]] = field(default_factory=list)
    rationale: str = ""
    confidence: float = _FALLBACK_CONFIDENCE  # 0.3
\`\`\`

如果用户说"第三步换掉"，你不能 \`plan.subtasks[2].description = "新步骤"\`——frozen 禁止属性赋值。你只能重新生成。这个设计在 Phase 37 制定时有合理考虑（不可变对象更安全、可缓存），但也直接阻塞了逐步骤修改的可能性。

变通方案：给 PlanResult 加一个 \`amend()\` 方法，返回一个新的 PlanResult 实例（类似 namedtuple._replace 的模式）：

\`\`\`python
def amend(self, subtask_id: str, **overrides) -> PlanResult:
    """返回修改指定子任务后的新 PlanResult（不变更原对象）。"""
    new_subtasks = []
    for t in self.subtasks:
        if t.get("id") == subtask_id:
            new_t = dict(t)  # 解冻：dict 可修改
            new_t.update(overrides)
            new_subtasks.append(new_t)
        else:
            new_subtasks.append(t)
    return PlanResult(
        subtasks=new_subtasks,
        dag_edges=_derive_dag_edges(new_subtasks),
        rationale=self.rationale,
        confidence=self.confidence,
    )
\`\`\`

这是个纯函数，不破坏不可变性——原 PlanResult 保留，新 PlanResult 基于修改生成。但目前没有这样的方法。

### ReplanDetector 的替代路径

ReplanDetector 提供了一个间接的"否决"通路：

\`\`\`python
# src/planner/replan.py — ReplanResult 的 diff 机制
drift_detected: bool = False  # 意图变了
revised_plan: PlanResult      # 修正后的计划
diff_summary: str             # "新增 2 步: ...; 删除 1 步: ..."
\`\`\`

如果用户在聊天中说"你那个方案第三步不好"，ChatEngine 处理这句话时会生成新的 intent。ReplanDetector 对比新 intent 和旧 intent，发现不同（diff），然后生成一个 revised_plan。结果上看，这近似于"用户否决了原计划，系统生成了新计划"——但代价是整个规划管线重新跑了一遍，而不是做了局部修正。

> 🟢 置信度: 0.90`,
    l3: `### 交互式规划编辑

未来的交互式规划应该支持：

1. **拖拽重排**：在前端 DAG 视图中拖拽子任务调整顺序，系统自动反序列化回 PlanResult。
2. **替换步骤**：右键子任务 → "替换为..." → 输入新步骤描述 → 系统重新推导依赖关系。
3. **插入步骤**：在两个子任务之间拖入新节点 → 系统自动调整 \`depends_on\` 关系。

每一次编辑后，系统可以调用一个轻量级的"可行性检查"——不需要重新调用 LLM，只需要检查新的依赖关系图是否还满足 DAG 性质（无环）。

### 会话内纠错 vs 否决

用户说"第三步不对"和用户说"等一下，刚才那个方案我不满意"是两种不同的交互模式。前者是**纠错**（corrective），后者是**否决**（veto）。纠错可以精细到具体步骤，否决往往意味着整个方向要调整。

当前系统把这两种情况都当做自然语言处理——LLM 在对话中理解你的意图。但系统的架构没有区分它们：一个纠错信号和一个新问题，在 ChatEngine 看来都是"用户的新消息"。这就是计划可编辑性需要产品手段而非代码手段的原因——不是做不到，是系统没意识到用户是在纠错还是在提新需求。

> 📌 **交叉引用**：q3.10 讨论了系统"什么时候该问用户"；q3.13 讨论了用户中断后的上下文保留。三者共同定义了规划中的人机交互边界。

> 🟢 置信度: 0.80`,
    crossChapterConnections: [
      { questionId: "q1.10", type: "parallel", relationship: "消息角色（Ch1）定义了用户有最终决策权——可否决性是角色分工在规划阶段的具体体现" },
      { questionId: "q2.12", type: "application", relationship: "用户画像（Ch2）可个性化否决交互方式——技术用户接受「局部替换」的精细否决，普通用户更适合「整体重来」" },
      { questionId: "q5.3", type: "application", relationship: "否决后重规划消耗额外 token——局部否决比整体否决更节省成本，这是 Ch3↔Ch4 交互的决策维度" },
    ],
  },
  {
    id: "q3.15",
    question: '计划的"作者模型"：系统对自己能力的假设如果实际执行时发现做不到',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.88, l1: 0.85, l2: 0.82, l3: 0.78 },
    overallConfidence: 0.78,
    l0: '作者模型（author model）偏差是计划失败最常见的根因——系统在生成计划时隐含地假设了自己"能做某件事"，但实际执行时发现自己做不到（工具缺失、权限不足、知识盲区），反思的价值就在于持续校准这个偏差，让下次计划更接近真实能力边界。',
    l1: `想象你要搬家，搬家前你在脑子里列了一个计划："8:00 打包 → 9:00 搬箱子 → 10:00 开车 → 11:00 拆箱布置"。

这个计划背后隐含了一堆假设——你假设自己搬得动所有箱子（体力假设）、假设车能装下所有东西（容量假设）、假设 10 点路上不堵（环境假设）。如果其中一个假设错了——比如你搬不动那个装满书的箱子——整个计划就卡住了。但计划本身并没有"错"——错的是你对自己的假设。

这就是 AI 规划中的**作者模型偏差**（author model bias）——系统生成计划时，隐含地将自己的"能力画像"嵌入计划中。这个画像可能不准确：它可能高估了自己的知识覆盖面（以为知道某个 API 的细节，其实不知道）、低估了环境约束（以为有权限读某个文件，其实没有）、或者忽略了工具限制（以为能同时并行 10 个任务，但 API 并发限制是 5）。

### 四种典型偏差

GlassCortex 的 ReflectionEngine 在反思时会从四个角度检查：

1. **能力高估**：计划假定系统能做某件事，但实际工具/知识不支持。例如——计划说"分析用户历史行为"，但如果 Profile 数据没有加载，这一步就做不了。
2. **资源低估**：计划假定某项资源充足（Token 预算、API 调用次数、时间），但实际不够。例如——计划 8 个子任务，但 Token budget 经 L1 估算只够 4 个。
3. **环境变化**：计划基于生成时的上下文，但执行过程中上下文变了。例如——用户中途补充了新信息，原计划的假设前提不再成立。
4. **工具限制**：计划假定某个工具/API 有某种能力，但实际没有。例如——假定向量检索能按"新鲜度"过滤，但 FAISS 索引不带时间元数据。

### ReflectionEngine 如何检测？

ReflectionEngine（Batch 6 交付）在会话结束后运行，对比"计划生成时的假设"和"实际执行的结果"：

- L1 意图分类结果 → 检查"这个意图类型我是不是经常搞错？"
- PlanResult 的子任务完成度 → 计划了但没执行 = 可能高估了能力
- 对话摘要中用户的不满信号 → "这个不对"= 计划的假设有偏差

反思的关键不是"找出谁错了"，而是**校准下一次的作者模型**——让下次计划少做一些"以为自己能做但做不到"的假设。`,
    l2: `### 置信度校准：从"我觉得能做"到"我有 80% 把握能做"

作者模型偏差的工程解法是**置信度校准**（confidence calibration）——不只问"能不能做"，而是问"有多大把握能做"。

PlanGenerator 目前的 confidence 输出是一个整体值（0-1），但这是对"整个计划"的置信度。更细粒度的做法是**逐子任务置信度**——每个子任务独立评估可行度：

\`\`\`
任务 1: 分析用户消息 → confidence 0.98（已有成熟管线）
任务 2: 检索相关记忆 → confidence 0.92（FAISS 召回，已验证）
任务 3: 生成邮件正文 → confidence 0.75（LLM 生成，质量有波动）
任务 4: 自动发送邮件   → confidence 0.00（无邮件发送工具！）
\`\`\`

任务 4 的 confidence = 0.00 会触发"能力缺口检测"——要么降级（改成"生成后提示用户手动发送"），要么标记为"需人工介入"。

### 计划质量评分的构成

ReflectionEngine 的 \`plan_quality_score\` 不是拍脑袋给的——它由三个信号加权得出：

| 信号 | 权重 | 来源 |
|------|:----:|------|
| 意图-计划匹配度 | 0.4 | L1 意图类别 vs 计划粒度是否合理 |
| 执行完成度 | 0.35 | 计划的子任务中有多少在对话中实际执行了 |
| 用户满意度 | 0.25 | 对话摘要中的情感信号（正面/负面/中性词汇比例） |

这个评分持续记录后，就能形成"规划-执行-反思"的反馈回路：如果某个意图类型（如"指令"类）的计划质量评分持续偏低，说明系统在这个领域的作者模型偏差大，需要调整 PlanGenerator 的 prompt 或约束。

### 与 RLHF 的关系

作者模型校准本质上是一种**弱 RLHF 信号**——它没有人类标注的"正确答案"，但通过反思过程自动生成"这个计划好/不好"的弱标签。多次反思积累的评分数据可以用于：
- 调整 PlanGenerator 的 few-shot example 选择
- 识别系统的能力盲区（哪些子任务类型 confidence 始终低）
- 提供给用户"这个计划可靠吗"的透明度信息`,
    l3: `### 前沿：可校准概率预测（Conformal Prediction）

当前 ReflectionEngine 的 confidence 是 LLM 自报的——这个数字本身就有作者模型偏差（LLM 倾向于高估自己的置信度）。一个更严格的方案是**保形预测**（conformal prediction）：不是给一个点估计（"80% 把握"），而是给一个区间——"在历史相似场景下，这个计划 90% 的情况下至少完成了 60% 的子任务"。

保形预测的好处是**统计保证**而非模型自觉——它不依赖于 LLM 是否"诚实"，而是基于历史数据给出有概率边界的预测。

### 多智能体自评估

另一个前沿方向是让**另一个 Agent**（而非同一个 Agent）评估计划的可行性。同体反思容易陷入盲区——就像你自己很难发现自己逻辑中的漏洞。但让一个独立的"评审 Agent"来审计划，就像代码 review 一样，能发现生成者看不见的问题。

评审 Agent 不需要比规划 Agent 更强——它只需要有不同的"视角"（prompt 强调批判性而非建设性）。

### 人类介入的校准时机

最难的问题不是"怎么校准"，而是"什么时候该问人"。如果系统对所有计划都问"这个计划行不行？"，用户会烦死。但如果完全自主校准，偏差可能越滚越大。

一个好的校准触发策略是**置信度阈值 + 影响面**：
- confidence > 0.9 且只影响信息展示 → 自主执行
- confidence 0.7-0.9 且涉及数据修改 → 展示计划，让用户确认
- confidence < 0.7 → 诚实告知"这个我不太确定，你觉得呢？"

这本质上是把作者模型的不确定性**透明化**给用户——不是假装有信心，而是让用户看到系统对自己的认知边界。这也是 Phase 37 旅程的核心目标。

> 置信度：0.78`,
    labLinks: [{ tab: "context", label: "意图测试面板" }],
    crossChapterConnections: [
      { questionId: "q2.20", type: "extension", relationship: "反思与自我修正（Ch3）是对抗记忆污染（Ch2）的重要手段——发现「计划不可行」的反思结果写入记忆后，可防止类似错误记忆污染未来规划" },
      { questionId: "q2.26", type: "parallel", relationship: "记忆免疫系统（Ch2）与作者模型校准（Ch3）都是系统的「质量自检」机制——一个过滤坏记忆，一个过滤坏计划" },
      { questionId: "q5.2", type: "extension", relationship: "反思结果写入记忆形成「执行→反思→记忆→规划」闭环——这是 Ch2↔Ch3 交互的终极形态，让系统从每次交互中学习" },
    ],
  },
  {
    id: "q3.16",
    question: '元规划：不是规划"怎么完成用户任务"，而是规划"什么时候该做规划"',
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P3",
    confidence: { l0: 0.90, l1: 0.87, l2: 0.83, l3: 0.79 },
    overallConfidence: 0.79,
    l0: '元规划（meta-planning）解决的问题不是"怎么规划"，而是"要不要规划"和"规划到什么粒度"——它是一层更高级的判断逻辑，决定在什么情况下值得付出规划成本、什么情况下直接执行更高效，从而避免过度规划（over-planning）和规划不足（under-planning）两种失败模式。',
    l1: `出门前你会判断"需不需要列一个清单"——去楼下便利店不需要，但搬家一定需要。这个"判断是否需要列清单"的思考，就是元规划。

AI 系统同样面临这个选择：对"你好"回复"你好"不需要任何规划——直接执行。但如果用户说"帮我整理上周所有会议纪要，提取关键决策，写一份给老板的周报"——就需要先停下来规划一下。

### 四种决策因素

PlanGenerator 在生成计划前，通过元规划逻辑判断"值不值得做"：

1. **任务复杂度**：用户消息的长度、涉及的步骤数、是否跨领域。一条 200 字的复杂指令 → 规划。一条 5 字的"继续" → 不规划，直接沿用上次上下文。
2. **用户意图**：L1 意图分类结果直接决定是否触发规划——"指令"和"探索"类触发，"闲聊"和"澄清"类跳过。但如果意图分类的 confidence < 0.6——系统自己都不确定用户想干嘛——这时候不是不做规划，而是做一个"最简规划"（1-2 步），然后快速暴露给用户确认。
3. **历史经验**：如果系统之前处理过类似的问题（embedding 相似度 > 0.95），且上次的计划质量评分 > 0.8，可以复用缓存计划，跳过重新规划。但如果上次类似计划的评分 < 0.5——说明这个类型的任务系统做不好，需要更谨慎地规划。
4. **成本收益**：PlanGenerator 本身消耗 ~200-500 token（包括 system prompt + LLM 调用）。对于一条只需要 50 token 回答的简单问题，规划的 token 成本可能超过执行成本——这就是过度规划。

### PlanGenerator 的启用判断

GlassCortex 目前通过 \`plan_generation_enabled\` 开关控制是否启用规划——这是一个粗粒度的二进制判断。更智能的元规划应该根据上述四个因素**动态决定**是否启动 PlanGenerator，以及规划到多深（2 步子任务 vs 8 步子任务）。

### 类比：军师 vs 将军

元规划和执行规划的关系，就像军师和将军的分工——军师判断"这场仗该不该打、大方向是什么"（元规划），将军负责"具体怎么打、兵分几路"（执行规划）。好的军师不会每场小遭遇战都做个全面战略分析——他只在关键战役时才调用自己的规划能力。`,
    l2: `### 复杂度阈值函数

元规划可以形式化为一个 **复杂度阈值函数**：

\`\`\`
should_plan(msg, intent, history) → {plan: bool, depth: int}

其中 depth ∈ {0, 1, 2, 3}:
  0 = 不规划（闲聊/简单澄清）
  1 = 最简规划 1-2 步（低置信度意图）
  2 = 标准规划 3-5 步（指令/提问）
  3 = 深度规划 6-8 步（探索/复杂指令）
\`\`\`

阈值的设定不是拍脑袋——它可以从历史数据中学习。一个简单的学习规则：

- 如果过去 N 次 depth=0 的对话中，用户追加了澄清/补充的比例 > 30% → depth 应该至少为 1（说明系统经常低估任务复杂度）
- 如果过去 N 次 depth=3 的规划中，实际只执行了 ≤3 步的比例 > 50% → depth 应该降到 2（说明系统在过度规划）

### 意图 → 规划粒度映射

| 意图类别 | 默认 depth | 逻辑 |
|---------|:---------:|------|
| 闲聊 | 0 | 不需要规划，直接生成回复 |
| 澄清 | 0 | 追问用户即可，不需要分解 |
| 提问 | 1-2 | 检索 → 综合 → 回答，1-3 步 |
| 指令 | 2-3 | 需要多步骤执行，3-6 步 |
| 探索 | 2-3 | 多角度分析，可能涉及多次检索 |

### 与 L1 意图分类的协作

元规划和 L1 意图分类是**两阶段决策**：
1. L1 分类器：用户想干什么？（What）
2. 元规划：这个意图要不要规划？（Whether）+ 规划到什么粒度？（How deep）

但如果 L1 分类器自身 uncertainty 高（confidence < 0.6），元规划不应该简单地说"不规划"——而是做一个最简规划，把"我不确定你是不是这个意思"透明化给用户。

### 自适应策略

理想的元规划不是静态规则，而是**自适应的**：
- 新用户（无历史交互）→ 倾向略高估复杂度（depth +1），因为还没学会用户的表达习惯
- 老用户（>50 轮交互）→ 可以更激进地降低 depth，因为系统已经熟悉用户的表述模式
- 高 Token 预算压力时 → 降低 depth，优先保证核心回复质量`,
    l3: `### 学习型元规划：从历史中学习"什么时候该规划"

静态的元规划规则（"闲聊不规划，指令才规划"）只能处理浅层判断。更深层的需求是**从每次规划的结果中学习**——当系统的计划被实际执行击穿后，元规划应该更新自己的判断逻辑。

具体来说：如果系统连续 5 次在"提问"意图上做了 depth=2 的规划，但每次用户都追加了追问（说明回答不够深入），元规划应该学会——"以后这个类型的提问，depth 应该至少 3"。

这个学习不需要 RL——简单的统计计数（成功率/用户追加率/计划完成率）就能提供反馈信号。

### 用户偏好学习

每个用户的"规划容忍度"不同。技术用户可能对详细计划有耐心（看到 DAG 图觉得有价值），而普通用户面对"我帮你拆解一下..."可能觉得啰嗦。元规划的终极形态是**学习每个用户的规划偏好**——类似于广告推荐系统学习用户的广告容忍度。

这个信息可以从用户行为中提取：
- 用户是否展开了 ProcessDrawer 中的 DAG 图？（展开了 = 对规划细节感兴趣）
- 用户是否在计划展示后说"不用那么复杂"或"直接做"？（= 过度规划了）
- 用户是否在回复中说"还有一点..."？(= 规划不足，漏了步骤)

### 多级规划：L1/L2/L3 不同深度

宏观来看，元规划决定的不只是"depth 0-3"，而是**哪个 Level 的 Planner 应该介入**：

| Level | 做什么 | 触发条件 |
|-------|--------|---------|
| L1 意图分类 | 判断意图类别 | 每条消息都触发 |
| L2 PlanGenerator | 生成执行计划 | 元规划判断需要 depth ≥ 1 |
| L3 ReflectionEngine | 事后反思 | 会话结束或用户触发 |

元规划是 L1 和 L2 之间的"闸门"——L1 说"用户想发指令"，元规划判断"值不值得为此生成一个计划"。

### 开放问题

- **冷启动**：新系统没有历史数据，初始的元规划阈值怎么设？默认保守（宁可多规划，不错过复杂任务）还是默认激进（省 token）？
- **过度规划的定义**：PlanGenerator 消耗的 token 数怎么和执行节省的 token 数比较？如果规划花了 500 token 但帮执行省了 200 token——这算过度规划还是必要开销？
- **元规划的元规划**：判断"什么时候该做规划"这件事本身——也需要规划吗？如果每判断一次都消耗 token，那判断的判断的成本会不会超过收益？这里的边际递减需要仔细建模。

> 置信度：0.79`,
    labLinks: [{ tab: "context", label: "意图测试面板" }],
    crossChapterConnections: [
      { questionId: "q4.2", type: "parallel", relationship: "元规划的核心判断「规划成本 vs 规划收益」与上下文窗口经济学（Ch4）的「token 成本 vs 回复质量」是同一类权衡逻辑" },
      { questionId: "q1.8", type: "prerequisite", relationship: "元规划的输入信号（任务复杂度、用户意图 confidence）来自上下文组装——上下文策略决定了 LLM 能否做出正确的「要不要规划」判断" },
      { questionId: "q5.1", type: "extension", relationship: "元规划是 Ch1↔Ch3 交互的「智能闸门」——L1 意图分类决定「用户想干什么」，元规划决定「值得为此消耗多少 token 做规划」" },
    ],
  },
  {
    id: "q3.17",
    question: "Plan 的存储与检索：AI 生成的执行计划如何持久化？PlanStore 的 Schema 设计、查询 API 和版本管理策略是什么？",
    chapter: "ch3",
    chapterTitle: "第 3 章：任务规划",
    priority: "P1",
    confidence: { l0: 0.95, l1: 0.92, l2: 0.90, l3: 0.82 },
    overallConfidence: 0.82,
    l0: "Plan 不是生成即丢弃的一次性产物——PlanStore 将 PlanGenerator 的输出持久化到两张 SQLite 表（plan_runs + plan_subtasks），支撑跨会话历史查询、成功/失败模式学习和用户干预。API 提供列表、详情和 PATCH 逐步骤修正三条通路，feature flag 门控确保默认零影响。",
    l1: `PlanGenerator 生成的任务 DAG 在 Phase 37 就已经交付，但有一个盲区：每次生成的计划用完后就被丢弃了。上一轮对话中 LLM 精心拆解的 5 步子任务、用户在第 3 步说"不要这个"的否决——这些信息在下一轮对话中完全不存在。

Phase 53 的 Plan 持久化填补的就是这个缺口。核心思路很简单——把每次 Plan 生成当作一条数据库记录存下来。

### 数据模型：两张表

\`\`\`sql
-- src/memory/schema.sql — plan_runs 表（一次规划 = 一条记录）
CREATE TABLE plan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_msg TEXT NOT NULL,          -- 触发规划的用户消息原文
    intent_category TEXT NOT NULL,   -- L1 意图分类结果
    rationale TEXT NOT NULL,         -- LLM 给出的规划理由
    confidence REAL NOT NULL,        -- 规划置信度 [0, 1]
    subtask_count INTEGER NOT NULL,  -- 子任务数量（冗余，方便列表排序）
    dag_edges_json TEXT NOT NULL,    -- DAG 边列表的 JSON 序列化
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- plan_subtasks 表（每条子任务 = 一条记录）
CREATE TABLE plan_subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
    subtask_id TEXT NOT NULL,        -- 子任务标识（如 "task_1"）
    description TEXT NOT NULL,       -- 子任务描述
    depends_on_json TEXT NOT NULL,   -- 前置依赖的 JSON 序列化
    sort_order INTEGER NOT NULL,     -- 拓扑排序位置
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|running|success|failed|skipped
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);
\`\`\`

设计上有几个有意的选择：

1. **subtask_count 冗余**：plan_runs 存储子任务计数，避免列表查询时需要 JOIN subtasks 表。这是一个"空间换查询效率"的经典取舍——列表页只需要计数，详情页才需要展开 subtasks。

2. **dag_edges_json 而非外键**：DAG 边列表序列化为 JSON 存储在 plan_runs 行中，而非通过 subtasks 间的外键关系推导。理由：PlanGenerator 输出的边可能有语义信息（如"这一步依赖上一步的 output"），JSON 可以携带任意注释；而且边列表的消费方式（前端 DAG 渲染）和存储格式一致——存 JSON，取 JSON，渲染 JSON。

3. **ON DELETE CASCADE**：删除 plan_run 自动级联删除其 subtasks——避免孤儿记录。

### Store 方法层

\`\`\`python
# src/memory/store.py:578-707 — 四个 Plan 持久化方法
def insert_plan(
    self, session_id, user_msg, intent_category, plan_result: PlanResult
) -> int:
    """事务性写入：plan_run + N 条 plan_subtasks。BEGIN/COMMIT/ROLLBACK 包裹。"""

def get_plan(self, plan_run_id: int) -> dict:
    """获取单次规划详情——plan_run 行 + 内联 subtasks 列表。"""

def list_plans(self, session_id=None, limit=20) -> list[dict]:
    """列出最近规划（不含 subtasks）——按 created_at 倒序。"""

def get_latest_plan(self, session_id=None) -> dict | None:
    """最近一次规划（含内联 subtasks）。无记录返回 None。"""
\`\`\`

关键设计：\`get_plan()\` 返回的字典直接内联了 \`"subtasks"\` 键——一次查询组装好完整数据结构，API 层不需要二次查询。这遵循了"Store 返回业务对象，不返回裸 SQL 行"的分层原则。

### API 端点

\`\`\`python
# api/routers/planner.py — Plan 查询端点
GET  /planner/plans?session_id=xxx&limit=20
     → list[PlanRunOut]  # 列表不含 subtasks，字段来自 plan_runs 行

GET  /planner/plans/{plan_id}
     → PlanDetailOut  # plan_run + 内联 list[PlanSubtaskOut]

# api/schemas.py:557-596 — Pydantic 模型
PlanRunOut:  id, session_id, user_msg, intent_category, rationale,
             confidence, subtask_count, dag_edges_json, created_at
PlanSubtaskOut:  id, plan_run_id, subtask_id, description,
                 depends_on_json, sort_order, status, created_at
PlanDetailOut:  PlanRunOut 全部字段 + subtasks: list[PlanSubtaskOut]
\`\`\`

列表 vs 详情的区分很重要：列表返回 \`subtask_count\` 而不内联 subtasks（一次会话可能有几十条 subtask 记录），详情才展开完整子任务数组。这避免了"加载列表顺便把全部 subtasks 都拉出来"的 N+1 陷阱。

### Phase 57 B3 用户干预接口

PATCH 端点允许用户逐步骤干预计划执行：

\`\`\`python
PATCH /planner/plans/{plan_id}
Body: {
    "overrides": [
        {"step_id": "task_2", "action": "reject"},
        {"step_id": "task_3", "action": "accept"}
    ]
}
→ PlanOverrideResponse  # plan_id + applied/rejected 计数 + 更新后的 PlanDetailOut
\`\`\`

支持五种干预动作：\`skip\`（跳过）/ \`retry\`（重试）/ \`modify\`（修改描述后重执行）/ \`accept\`（接受）/ \`reject\`（拒绝）。API 层对已 success/failed 的 subtask 做终态保护——不接受覆盖，避免破坏已完成的执行结果。\`modify\` 动作需附带 \`new_description\` 字段提供新的步骤描述。

### Feature Flag 门控

\`\`\`python
# src/config.py:93
plan_storage_enabled: bool = False  # 默认关闭
\`\`\`

所有 Plan 持久化操作通过此 flag 门控——默认 False 意味着现有系统行为完全不变。开启后，PlanGenerator.generate() 的调用点在生成 PlanResult 之后追加 \`store.insert_plan()\` 调用。

> 📌 **交叉引用**：Plan 持久化是 Phase 60（记忆引导规划）的前置条件——历史 PlanRun 数据是成败模式学习的训练集。动态重规划的 StepStatus 状态机（Phase 57 B1）通过 \`update_subtask()\` 方法写回 subtasks 表的 status 字段——详见 [q3.9 执行监控与动态重规划]。

> 🟢 置信度: 0.92`,
    l2: `### Schema 迁移

\`\`\`python
# src/memory/store.py:125-155 — _migrate() 中的 Plan 表创建
tables = self._db.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
).fetchall()
existing = {row["name"] for row in tables}

if "plan_runs" not in existing:
    self._db.execute("CREATE TABLE plan_runs (...)")
    self._db.execute("CREATE TABLE plan_subtasks (...)")
    self._db.execute(
        "CREATE INDEX idx_plan_runs_session "
        "ON plan_runs(session_id, created_at)"
    )
    self._db.execute(
        "CREATE INDEX idx_plan_subtasks_run "
        "ON plan_subtasks(plan_run_id, sort_order)"
    )
\`\`\`

两个索引的选择：\`idx_plan_runs_session\` 支撑 \`list_plans(session_id=...)\` 的 WHERE + ORDER BY 组合查询；\`idx_plan_subtasks_run\` 支撑 \`get_plan()\` 的 JOIN + ORDER BY 查询。

### insert_plan 的事务保护

\`\`\`python
# src/memory/store.py:599-640
self._db.execute("BEGIN")
try:
    cursor = self._db.execute(
        "INSERT INTO plan_runs (...) VALUES (...)", (...)
    )
    plan_run_id = cursor.lastrowid
    assert plan_run_id is not None

    for idx, subtask in enumerate(subtasks):
        self._db.execute(
            "INSERT INTO plan_subtasks (...) VALUES (...)", (...)
        )
    self._db.commit()
except Exception:
    self._db.execute("ROLLBACK")
    raise
\`\`\`

手动事务管理（而非 executor 上下文管理器）允许在异常时显式 ROLLBACK。\`assert plan_run_id is not None\` 是防御性编程——SQLite 的 \`lastrowid\` 理论上在 INSERT 后不为 None，但 mypy 的类型推断是 Optional，assert 在运行时同时满足类型窄化和安全校验。

### list_plans 的分支逻辑

\`\`\`python
# src/memory/store.py:664-685
def list_plans(self, session_id=None, limit=20):
    if session_id is not None:
        rows = self._db.execute(
            "SELECT * FROM plan_runs WHERE session_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
    else:
        rows = self._db.execute(
            "SELECT * FROM plan_runs "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]
\`\`\`

同一个方法两个查询——session_id 过滤 vs 全局列表。为什么不拆成两个方法？因为两者的语义都是"最近 N 条计划"，区别只在一个带过滤条件。拆成两个方法会导致 API 端点需要额外的路由判断，不如一个参数化方法干净。

### update_subtask — 执行反馈闭环

\`\`\`python
# src/memory/store.py:711-741 — Phase 57 B3 新增
def update_subtask(
    self,
    plan_run_id: int,
    subtask_id: str,
    status: str,
    new_description: str | None = None,
) -> bool:
    """更新单条子任务状态和可选描述——用户干预接口的存储层。

    Returns:
        True 表示成功更新至少一行，False 表示目标子任务不存在。
    """
    if new_description is not None:
        cursor = self._db.execute(
            "UPDATE plan_subtasks SET status = ?, description = ? "
            "WHERE plan_run_id = ? AND subtask_id = ?",
            (status, new_description, plan_run_id, subtask_id),
        )
    else:
        cursor = self._db.execute(
            "UPDATE plan_subtasks SET status = ? "
            "WHERE plan_run_id = ? AND subtask_id = ?",
            (status, plan_run_id, subtask_id),
        )
    self._db.commit()
    return cursor.rowcount > 0
\`\`\`

两个关键设计：(1) \`subtask_id\` 是字符串类型（对应 PlanResult.subtasks 中的 id），而非数据库自增 id——这允许 Store 层按业务标识而非物理行号定位子任务；(2) \`new_description\` 仅在 \`action=modify\` 时传入，为 None 时只更新 status——避免不必要的 description 覆写。终态保护由 API 层（PATCH 端点）负责，Store 层不做业务校验——职责单向，Store 只管写。

### API 端点的响应组装

\`\`\`python
# api/routers/planner.py — GET /planner/plans
@router.get("/plans", response_model=list[PlanRunOut])
def list_plans(
    session_id: str | None = None,
    limit: int = 20,
) -> list[PlanRunOut]:
    store = get_store()
    rows = store.list_plans(session_id=session_id, limit=limit)
    return [PlanRunOut(**row) for row in rows]

@router.get("/plans/{plan_id}", response_model=PlanDetailOut)
def get_plan(plan_id: int) -> PlanDetailOut:
    store = get_store()
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    subtasks = [
        PlanSubtaskOut(**st) for st in plan.pop("subtasks", [])
    ]
    return PlanDetailOut(**plan, subtasks=subtasks)
\`\`\`

\`plan.pop("subtasks", [])\` 是关键——Store 返回的 dict 内联了 subtasks 列表，但 PlanDetailOut 的构造需要把 subtasks 作为独立字段传入（PlanRunOut 字段不含 subtasks，PlanDetailOut 继承并添加 subtasks 字段）。pop 分离后各入各参。

> 🟢 置信度: 0.90`,
    l3: `### 当前局限

1. **无 Plan 版本链**：同一会话中多次对"同一问题"的规划（如用户说"重做第三步"后重新生成计划）存储为独立 plan_run 行，没有外键关联它们。如果用户在同一次对话中修正了计划 3 次，3 条 plan_run 各自独立——无法追溯到"第 3 次规划是从第 1 次的 task_2 拒绝后衍生出来的"。这限制了 Phase 60（成败模式学习）可以从历史中学到的深度。

2. **subtasks JSON 无 Schema 校验**：PlanGenerator 输出的 subtasks 是自由格式的 dict 列表——系统不校验 subtask_id 的唯一性、depends_on 引用的有效性（虽然在 Python 层有 \`_derive_dag_edges()\` 的验证）、description 的长度限制。垃圾进垃圾出——如果 LLM 生成了格式怪异的数据，Store 层会照单全收。

3. **无 TTL / 自动清理**：plan_runs 表会无限增长。一个活跃用户每天几十次对话，每次都可能触发 PlanGenerator，几个月后就有上千条 plan_run + 上万条 subtasks。目前没有自动清理策略——既没有按时间 TTL（如 90 天后删除），也没有按数量上限（如只保留最近 500 条）。

4. **无 plan 执行轨迹的完整记录**：虽然 Phase 57 B1 的 StepRecord 追踪了步骤执行，但这些运行时轨迹（monitor_step 产生的 StepRecord 序列）写回 subtasks 表的只有最终的 status 字符串——中间的 RUNNING→FAILED 状态转换、失败时的 error message、重试次数——全部丢失。plan_runs 表中没有一个 \`execution_trace_json\` 字段来存储完整的执行轨迹。

### 未来方向

**Plan 版本链**：在 plan_runs 表中加 \`parent_plan_id INTEGER NULL\` 列。当 PartialReplanResult 生成新计划时，新 plan_run 的 parent_plan_id 指向被替换的原计划。这创建了一条可追溯的修订链——Phase 60 可以沿着这条链分析"什么样的修正路径最终成功了"。

**自动清理策略**：按时间（90 天 TTL）或按会话（每个 session 保留最近 5 条 plan_run）+ plan_storage_max_per_session 配置项。清理使用 SQLite 的 \`DELETE ... WHERE ... LIMIT\` 批量删除，避免大事务阻塞。

**执行轨迹持久化**：在 StepRecord 生成时同步写入数据库——新增 \`step_records\` 表或 plan_runs 的 \`execution_trace_json\` 列。这为 Phase 61 的事后反思（post_mortem）提供完整数据——不只是"task_3 失败了"，而是"task_3 在运行 2.3 秒后因 API 超时失败，已重试 1 次"。

**与 PlanHistoryRetriever 的联动**：Phase 60 的 PlanHistoryRetriever 已直接消费这些持久化的 plan_run 行——基于 intent_category + entities 检索相似历史计划，检索结果注入 PlanGenerator.generate_plan() 的 \`plan_history\` 参数。持久化质量（JSON 字段的规范化程度、subtasks 描述的粒度）直接影响检索召回质量。

> 置信度：0.82`,
    crossChapterConnections: [
      { questionId: "q3.4", type: "prerequisite", relationship: "q3.4 讨论的 PlanGenerator 的输出就是 PlanStore 的输入——PlanResult 的 subtasks + dag_edges + rationale 直接映射到 plan_runs + plan_subtasks 表" },
      { questionId: "q3.11", type: "prerequisite", relationship: "q3.11 讨论的「计划用什么形式表达」（JSON/DAG/自然语言）直接决定了 PlanStore 的 Schema——dag_edges_json 和 depends_on_json 的存储格式" },
      { questionId: "q3.9", type: "extension", relationship: "Phase 57 B1 StepRecord 的执行状态通过 update_subtask() 写回 subtasks 表——Plan 持久化是执行监控的数据基础" },
      { questionId: "q3.14", type: "extension", relationship: "q3.14 讨论的「用户可不可以否决第三步」在 Phase 57 B3 通过 PATCH /planner/plans/{id} 实现——最终写回 plan_subtasks 的 status 字段" },
    ],
  },
];