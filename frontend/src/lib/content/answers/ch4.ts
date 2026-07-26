import type { Answer } from "../types";

/** 第 4 章：Token 效率 答案列表 */
export const CH4_ANSWERS: Answer[] = [
  {
    id: "q4.1",
    question: '如何计算/估算 token 的使用量？不同模型的 tokenizer 差异如何处理？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.9 },
    overallConfidence: 0.9,
    l0: 'Token 的计算有三种精度级别：API 返回的精确计数（最准但只能在调用后拿到）、模型原生 tokenizer 预计算（调用前可用但每个模型不同）、字符级启发式估算（最快但误差 10-20%）——工程上三层混用：预计算做预算、精确值做结算、启发式做快速模拟。',
    l1: `你去加油站加油。油枪跳了，显示屏告诉你加了多少升、多少钱——这是**事后精确结算**。加油之前你瞟了一眼油箱表，心里估了个大概——这是**事前估算**。两个数字不会完全一样，但估算够你判断「要不要现在就加」。

AI 的 [token](https://baike.baidu.com/item/Token) 计量也是一样。你需要知道两件事：**调用前**「这段文本大概多少 token」（做预算、判断是否会溢出）、**调用后**「这次调用实际消耗了多少 token」（做结算、归因成本）。

### 三层精度模型

**第一层：API 精确计数（Ground Truth）**

LLM API 在每次调用后的 response 中返回 \`usage.prompt_tokens\` 和 \`usage.completion_tokens\`。这是模型的**原生 tokenizer 对发送和接收的文本做的精确计数**——不是估算，是模型自己数的。GlassCortex 的 \`src/token_ledger.py\` 中，\`TokenLedger.record()\` 方法在每个 LLM 调用点（planner / chat / fact_extraction / compression）从 API response 中提取这两个数字并累积记入账本。

- **优点**：最准确。不是「大概」，是精确到个位数的真实消耗。
- **局限**：只能在调用后拿到。你不能在发请求之前用这个数字做决策。

**第二层：模型原生 tokenizer 预计算**

在调用之前，用目标模型的 tokenizer 库对文本做编码，得到精确的 token 数。比如 OpenAI 的 \`tiktoken\` 库、HuggingFace 的 \`AutoTokenizer\`。

- **优点**：调用前就能拿到精确数字。可以做预算管理——「这段 system prompt 占了 1200 token，还剩 2896 给召回和对话历史」。
- **缺点**：每个模型有自己的 tokenizer，**token 数不通用**。同样一句话「我喜欢猫」，DeepSeek 的 tokenizer 可能数出来 5 个 token，Claude 的可能数出来 4 个——因为两个模型的分词粒度不同。没有「通用 token 数」这个概念。而且项目中如果用的是第三方 API（如 DeepSeek 兼容协议），tokenizer 库可能不完全匹配——DeepSeek 没有公开 tokenizer，用 tiktoken 做近似会有偏差。

**第三层：字符级启发式估算**

完全不依赖 tokenizer，用简单的字符统计规则估算：「中文约每 4 个字符 = 1 个 token，英文约每 3 个字符 = 1 个 token」[^token-est]。

[^token-est]: 这个规则来自 GlassCortex 项目 \`src/context/overflow_sim.py\` 的 \`_estimate_tokens()\` 函数。它不是随便拍脑袋的——中文 UTF-8 编码每个字 3 字节，加上 LLM 常用的 BPE tokenizer 倾向于把常见中文字单独编码，所以 ~4 字符/token 是一个合理的启发式。英文单词平均 4-5 个字母，BPE 把常见词根拆成子词，~3 字符/token 也是合理的。

\`\`\`python
def _estimate_tokens(text: str) -> int:
    cjk = sum(1 for c in text if "一" <= c <= "鿿")  # 统计中文字符数
    other = len(text) - cjk                            # 非中文字符数
    tokens = math.ceil(cjk / 4) + math.ceil(other / 3)
    return max(1, tokens)
\`\`\`

- **优点**：最快、零依赖。不需要调 API、不需要加载 tokenizer 模型。可以在完全不联网的情况下跑。适合做溢出模拟（Lab 页沙箱）和快速预算估算。
- **缺点**：误差 10-20%。这个规则对纯文本效果还行，但对代码、JSON、特殊符号的估算偏差较大。而且**它不区分模型**——DeepSeek 和 Claude 拿到的是同一个估算值，但实际 token 数可能不同。

### TokenLedger：结算层的设计

在 GlassCortex 中，\`src/token_ledger.py\` 的 \`TokenLedger\` 类是结算层的核心。它像一个账本——记录每一笔 token 消耗的来源（谁花的）、数量（多少 token）、时间（什么时候）。\`summary()\` 方法按调用方分组统计，输出：

\`\`\`
planner:       3 次调用,  1,200 prompt + 150 completion = 1,350 token
chat:          5 次调用, 12,000 prompt + 3,500 completion = 15,500 token
fact_extraction: 4 次调用, 3,200 prompt + 400 completion = 3,600 token
embedding:    2 次缓存命中, 800 prompt + 0 completion = 800 token
compression_savings: 1 次压缩节省, 390 prompt + 0 completion = 390 token
─────────────────────────────────────────────────────────
total:        15 次操作, 消耗 20,390 token (含节省 1,190)
\`\`\`

除了直接消耗，TokenLedger 还记录两类「节省」——\`record_cache_hit()\` 和 \`record_compression_savings()\`。节省的 token 用正数记录在 prompt_tokens 字段，在瀑布图中展示为绿色节省条。这让用户不仅看到「花了多少」，还能看到「省了多少」——对于评估缓存和压缩策略的效果至关重要。

### 不同模型的 tokenizer 差异

这是工程上最头疼的问题。几个典型情况：

| 场景 | 做法 | 准确度 |
|------|------|--------|
| API 调用后 | 从 response.usage 读取精确值 | 100% |
| 调用前（OpenAI 模型） | 用 tiktoken 预计算 | ~99% |
| 调用前（DeepSeek） | 无公开 tokenizer → 用 tiktoken cl100k_base 近似 | ~95-98% |
| 调用前（Claude） | 无公开 tokenizer → 用字符启发式估算 | ~80-90% |
| 溢出模拟（任何模型） | 字符启发式估算 | ~80-90% |

对于 GlassCortex 使用的 DeepSeek 模型，因为 DeepSeek 没有公开 tokenizer，项目采用了折中方案——API 调用后用 \`response.usage\` 做精确结算，调用前和模拟场景用 \`_estimate_tokens()\` 做启发式估算。两者的偏差通常在 15% 以内，对于「判断是否会溢出上下文窗口」这个使用场景来说够用[^precision]。

[^precision]: 假如真实 token 数是 4000，估算误差 15% 意味着估算范围 3400-4600。如果你设置的上下文窗口是 4096，这个误差确实可能导致误判（实际 4000 < 4096，但估算成了 4500 > 4096）。实际工程中通常加一个安全余量——估算超过窗口 80% 就触发预警，而不是等到 100%。

\`\`\`mermaid
%% title: 图：Token 三层精度模型
graph TD
    NEED["📏 需要 Token 计数"]
    NEED --> Q{"什么时候需要？"}
    Q -->|"调用后"| L1["📊 API 精确计数<br/>response.usage<br/>准确度 100%"]
    Q -->|"调用前<br/>OpenAI 模型"| L2["🔧 tiktoken 预计算<br/>准确度 ~99%"]
    Q -->|"调用前<br/>DeepSeek/Claude 等"| L3["🧮 字符启发式估算<br/>中文 ~4 字符/token<br/>英文 ~3 字符/token<br/>准确度 80-90%"]
    Q -->|"溢出模拟"| L3
    L1 --> LEDGER["📒 TokenLedger<br/>内存账本 · 会话级"]
    L2 --> LEDGER
    L3 --> LEDGER
    LEDGER --> S1["📋 侧边栏<br/>会话统计"]
    LEDGER --> S2["📊 成本瀑布图<br/>按调用方分组"]
    LEDGER --> S3["🎴 六镜头旅程<br/>花费卡片"]
    style NEED fill:#4f46e5,stroke:#4338ca,color:#fff
    style L1 fill:#34d399,stroke:#059669,color:#111
    style L3 fill:#fbbf24,stroke:#d97706,color:#111
    style LEDGER fill:#818cf8,stroke:#6366f1,color:#fff
    style S1 fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
    style S2 fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
    style S3 fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
\`\`\`

> 置信度：0.95`,
    l2: `### TokenLedger 的完整数据模型

\`\`\`python
@dataclass
class TokenUsage:                      # 单次 LLM 调用记录
    call_point: str                    # 主调用点: "planner"|"chat"|"fact_extraction"|"compression"
    prompt_tokens: int                 # 输入消耗
    completion_tokens: int             # 输出消耗
    timestamp: float

@dataclass
class StepRecord:                      # 非 LLM 的管道步骤计时
    step_name: str                     # "decay" | "faiss_search" | "embed" | ...
    elapsed_ms: float
    status: str                        # "ok" | "error"
    metrics: dict[str, object]         # 步骤特定指标
\`\`\`

TokenLedger 的设计有几个关键决策：

1. **内存记账，会话级生命周期**——不持久化到 SQLite。每次刷新页面/重启会话，账本清零。这是刻意的：Token 计量是实时监控工具，不是审计日志。持久化 Trace 在 \`pipeline_trace\` 表中单独管理。

2. **通过 setter 注入**——和 FactExtractor 的注入模式一致。\`PlannerEngine.set_ledger()\`、\`FactExtractor.set_ledger()\`、\`ChatEngine.set_ledger()\` 各自接收同一个 TokenLedger 实例。各引擎只负责「调 API → 记录消耗」，不负责统计——关注点分离。

3. **节省也记账**——\`record_cache_hit()\` 和 \`record_compression_savings()\` 用正数记录节省量。在瀑布图渲染时，调用方 \`call_point\` 识别为节省类型 → 渲染为绿色条而非红色条。

### Token 归因的消费端

TokenLedger 的数据在三个地方消费：

- **侧边栏会话统计**：即时展示本会话累计 token 消耗
- **成本瀑布图**（\`analytics.py\` \`render_cost_waterfall()\`）：按调用方分组的堆叠条形图，节省项用绿色高亮
- **六镜头旅程「花费」卡片**（\`chat.py\`）：从 \`token_ledger.summary()\` 取数，展示「本次对话花了多少 token / 省了多少」

> 置信度：0.93`,
    l3: `### 当前行业实践

- **OpenAI Tokenizer Page**：提供了一个在线的 tokenizer 可视化工具（platform.openai.com/tokenizer），可以粘贴文本实时看 token 数和分词边界。这是目前最好的 token 教育工具——但它只管 OpenAI 自己的模型。
- **Anthropic Token Counting**：Claude API 在 response 中返回 \`usage.input_tokens\` 和 \`usage.output_tokens\`，并提供了 \`token_count\` 工具让用户在不调用模型的情况下预计算。这基本消除了「调用前 vs 调用后」的信息差——前提是你只用 Anthropic 的模型。
- **LiteLLM**：开源的多模型代理，统一了不同提供商的 API 和 token 计数方式。在一定程度上解决了「每个模型 tokenizer 不同」的问题——你不需要关心背后是什么模型，LiteLLM 帮你数。

### 未解决的问题

1. **未公开模型的 tokenizer**：DeepSeek、Moonshot、智谱等国产模型没有公开 tokenizer。只能用近似方案（tiktoken 或字符估算），但偏差从 5% 到 20% 不等。对于 token 预算精确管理（如「确保 system prompt 不超过 2000 token」），20% 的偏差可能意味着实际用了 2400 token。

2. **多模态 token 计数**：如果未来对话中包含图片（GPT-4V / Gemini）或音频，token 怎么数？一张图片可能消耗 85-1000+ token（取决于分辨率和模型），但没有简单的「图片→token」换算公式——你只能调 API，看它返回的 usage。

3. **Token 的「性价比」度量**：花了 5000 token 生成了一段 2000 字的回答——这段回答值 5000 token 吗？目前只能事后凭感觉判断。是否可以用「用户追问次数 / 用户满意度信号 / 信息密度」做 proxy 指标来评估 token 效率？

4. **预算超支的实时干预**：假设你设了 4000 token 预算，但系统在实际组装上下文时估算偏了——等你发现已经超了，但请求已经发出去了。是否能在请求发出前做「最后一公里检查」，超预算 → 自动触发最后一次截断？

### GlassCortex 后续方向

Phase 29 的 Token 预算机制（四区动态配比）已将 \`_estimate_tokens()\` 从独立的估算函数升级为预算管理系统的核心——不是「估算一下大概多少」，而是「system 区还有 300 token 预算，这条召回记忆 180 token——塞进去还是丢掉？」\`compute_partitions()\` 在每次上下文组装时动态推导各分区 token 占用。

> 置信度：0.90`,
  },
  {
    id: "q4.2",
    question: '如何高效而不失质量节省 token 使用？有哪些手段？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.88 },
    overallConfidence: 0.88,
    l0: 'Token节省是一个五层金字塔——从无损的缓存复用（嵌入/事实抽取命中即省）、到低损的消息压缩（LLM摘要替代原文）、到有损的溢出策略（FIFO/相关度优先/压缩摘要三选一）、到Prompt工程（精简系统提示词）、到模型路由（简单任务用小模型）——上一层用尽才动下一层，因为越往下越伤质量。',
    l1: `你去超市买东西。钱包里有张购物卡——上次充的值还没花完，先用它。冰箱里还有昨天剩的菜，热一热就能吃——不用重新做。这两样都没了，才开始精打细算：买当季的、不买进口的、去批发市场而不是便利店。

AI 省 Token 的逻辑完全一样。省 Token 不是「少说话」——那样质量就崩了。省 Token 是**优先用已经付过钱的东西，实在不行再降级**。下面是五层金字塔，从最无损到最有损：

### 第一层：缓存复用（零增量成本）

最理想的节省——**已经算过的东西不算第二遍**。

在 GlassCortex 中，\`EmbeddingCache\` 用 FAISS 索引缓存文本的嵌入向量。用户说「我喜欢猫」，第一次调用嵌入 API 算出向量存下来。第二天用户又说「我喜欢猫」——直接从 FAISS 索引中取，一次 API 调用都不花。\`FactExtractor\` 同样缓存事实抽取结果——同一条消息不抽两次三元组。

\`\`\`python
# src/cache.py — EmbeddingCache.get() 命中时记录节省
if self._ledger is not None:
    self._ledger.record_cache_hit("embedding", tokens_saved)
\`\`\`

缓存命中时，\`TokenLedger.record_cache_hit()\` 记一笔节省。它不是「不花 token」——它是告诉账本「这笔本来要花 200 token 的调用，我们 0 token 就搞定了」。在成本瀑布图中，这条记录显示为绿色节省条。

> **关键指标**：嵌入缓存的命中率直接影响成本。如果用户反复讨论同一批概念（比如连续 10 轮对话都在聊「Python」），嵌入缓存的命中率可能高达 70% 以上。但如果每轮话题都在跳（一会儿聊 Python、一会儿聊做饭、一会儿聊历史），缓存基本没用。

### 第二层：消息压缩（低损）

当对话历史太长时，**用 LLM 把长篇大论压缩成一句话摘要**，丢弃原文，保留信息骨架。

\`\`\`python
# src/chat/engine.py — compress_message() 流程（简化）
original_tokens = _estimate_tokens(content)         # 压缩前 token 数
response = self.client.chat.completions.create(      # 同步调用 LLM 生成摘要
    model=self.model,
    messages=[{"role": "user", "content": compression_prompt}],
    max_tokens=256,
)
summary = response.choices[0].message.content
compressed_tokens = _estimate_tokens(summary)        # 压缩后 token 数

# 压缩调用本身的 token 消耗也记账
self._ledger.record("compression",
    prompt_tokens=response.usage.prompt_tokens,
    completion_tokens=response.usage.completion_tokens,
)
# 净节省 = 原文 - 摘要（扣除压缩成本前）
saved = max(0, original_tokens - compressed_tokens)
self._ledger.record_compression_savings(saved)       # 记账
\`\`\`

压缩的本质是**用少量 token（调用压缩 LLM 的消耗 + 摘要本身的 token）换取大量 token 的节省（原文不再占用上下文窗口）**。净收益取决于原文长度——原文 500 token 压缩成 30 token 摘要，即使压缩调用花了 80 token，净省 390 token。

> **权衡**：压缩调用本身也花 token（system prompt + 原文 + 输出）。如果原文只有 100 token，压缩调用的开销可能比省下来的还多。这就是为什么压缩只对**长消息**触发——GlassCortex 的 \`compress_message()\` 有一个隐式阈值：消息太短不值得压。

### 第三层：溢出策略（有损，但可控）

当上下文窗口满了，必须丢东西。**丢什么、怎么丢，就是溢出策略**。

GlassCortex 的 \`src/context/overflow_sim.py\` 实现了三种策略：

| 策略 | 人格 | 逻辑 | 优点 | 缺点 |
|------|------|------|------|------|
| **截断 (FIFO)** | 守门员 | 先进入窗口的先被丢弃 | 简单、公平 | 重要的旧记忆可能被不重要的新记忆挤掉 |
| **相关度优先** | 策展人 | 只保留与当前话题最相关的记忆 | 质量高 | 可能丢失多样性 |
| **压缩摘要** | 口述史家 | 高相关保留原文 + 低相关压缩成一句话 | 尽力保留信息 | 压缩可能丢失细节 |

三种策略在 Lab 页的溢出沙箱中可以实时对比——输入一段对话历史 + 话题，三列并排展示每种策略的「丢了什么、保留了什么、省了多少 token」。这不是学术概念——用户能看到自己的对话在每种策略下会变成什么样。

> **核心洞察**：「省 Token」不是数学优化问题，是信息取舍问题。守门员说「先来后到，最公平」，策展人说「只留最好的」，口述史家说「都留着，但有些只留骨架」。没有绝对最优——取决于用户更在乎「不丢失重要信息」还是「严格省 Token」。

### 第四层：Prompt 精简（主动控制）

前三层是**事后补救**——内容已经生成了，想办法少存/少传。第四层是**事前控制**——从源头减少 Token 消耗。

- **System Prompt 瘦身**：每条 system prompt 都占用上下文窗口。GlassCortex 的 system prompt 设计遵循「说清楚任务，不啰嗦背景」——每个 Planner 分类的 prompt 控制在 200-400 token，不塞「你是友好的 AI 助手」这类废话。
- **结构化输出约束精简**：要求 LLM 输出 JSON 时，只描述必要字段，不写长篇 schema 文档。
- **Few-shot 示例最小化**：每个示例都花 token。2 个精心挑选的示例比 8 个随便塞的示例效果好、成本低。

### 第五层：模型路由（降级）

最底层——**简单任务调便宜模型，复杂任务调贵模型**。比如「今天天气怎么样」用 cheaper model，复杂分析用 more capable model，省下的 token 单价差可能达到 5-10 倍。

GlassCortex 的 ModelRouter（Phase 55）已实现基础模型路由——\`decide()\` 方法基于意图分类结果（闲聊/澄清 → simple_model，提问/指令/探索 → complex_model），\`execute_with_fallback()\` 在主模型失败时自动回退到备用模型。通过 \`routing_enabled\` 配置开关启用（默认关闭）。路由决策作为 \`RoutingInfo\` 字段返回在 ChatResponse 中，前端 ModelRoutingCard 展示。更精细的成本-质量帕累托优化和 CPU 指标仪表盘为远期方向。

### 五层决策框架

\`\`\`
需要省 Token？
├─ 第一层：有缓存命中吗？ → 用缓存（无损）
├─ 第二层：消息太长？ → 压缩摘要（低损）
├─ 第三层：窗口满了？ → 选溢出策略（有损，可控）
├─ 第四层：Prompt 能精简吗？ → 删废话（无损，但需要人工审视）
└─ 第五层：能用便宜模型吗？ → 模型路由（降级）
\`\`\`

> **核心原则**：**上一层用尽才动下一层**。缓存没命中 → 才考虑压缩。消息不长 → 不压缩。窗口没满 → 不丢东西。Prompt 还可以 → 不动。把省 Token 当作一个递进决策树，而不是一上来就「少说话」——那是把质量和成本一起砍了。

\`\`\`mermaid
%% title: 图：Token 节省五层金字塔
graph TD
    SUB["💰 需要省 Token"]
    SUB --> L1["🔵 第一层：缓存复用<br/>EmbeddingCache + FactExtractor<br/>零增量成本 · 无损"]
    L1 --> Q1{"缓存命中了吗？"}
    Q1 -->|"是"| DONE["✅ 省了"]
    Q1 -->|"否"| L2["🟢 第二层：消息压缩<br/>compress_message()<br/>LLM 摘要替代原文 · 低损"]
    L2 --> Q2{"消息够长吗？"}
    Q2 -->|"是"| DONE
    Q2 -->|"否"| L3["🟡 第三层：溢出策略<br/>truncate / prioritize / summarize<br/>三选一 · 有损可控"]
    L3 --> Q3{"窗口满了吗？"}
    Q3 -->|"是"| DONE
    Q3 -->|"否"| L4["🟠 第四层：Prompt 精简<br/>System Prompt 瘦身<br/>主动控制 · 近乎无损"]
    L4 --> Q4{"Prompt 还能删吗？"}
    Q4 -->|"是"| DONE
    Q4 -->|"否"| L5["🔴 第五层：模型路由<br/>简单任务用小模型<br/>降级 · 已交付（feature flag 门控）"]
    L5 --> DONE
    style SUB fill:#4f46e5,stroke:#4338ca,color:#fff
    style L1 fill:#3b82f6,stroke:#2563eb,color:#fff
    style L2 fill:#34d399,stroke:#059669,color:#111
    style L3 fill:#fbbf24,stroke:#d97706,color:#111
    style L4 fill:#f97316,stroke:#ea580c,color:#fff
    style L5 fill:#ef4444,stroke:#dc2626,color:#fff
    style DONE fill:#818cf8,stroke:#6366f1,color:#fff
\`\`\`

> 置信度：0.95
`,
    l2: `### 缓存层的完整数据流

GlassCortex 的缓存不是「一个缓存」，是两层独立缓存：

**嵌入缓存 (\`EmbeddingCache\`)**

\`\`\`python
# src/cache.py
class EmbeddingCache:
    _store: OrderedDict[str, np.ndarray]  # 精确文本匹配缓存
    _ledger: TokenLedger | None            # 注入的账本实例

    def get(self, text: str) -> np.ndarray | None:
        """查询缓存。用文本原文做精确键匹配 →
        命中返回缓存向量，未命中返回 None 触发 API 调用。"""
        if text in self._store:
            tokens_saved = self._estimate_tokens(text)
            if self._ledger is not None:
                self._ledger.record_cache_hit("embedding", tokens_saved)
            return self._store[text]
        return None
\`\`\`

- **存储结构**：\`OrderedDict[str, np.ndarray]\`——**精确文本匹配**，不是 FAISS 语义近似。这简化了实现（零第三方索引依赖），但降低了命中率：输入「我喜欢猫」和「我很喜欢猫」虽然意思一样，但键不同，第二次不会命中。
- **命中条件**：用户输入文本**完全相同**才命中。没有模糊阈值——这是刻意的，因为嵌入缓存的核心定位是"不花钱的捷径"，而不是"近似匹配"。近似匹配的召回由 FAISS 索引在召回管线中承担。
- **生命周期**：会话级。每次新会话 OrderedDict 从零开始积累。

**事实抽取缓存 (\`FactExtractor\`)**

FactExtractor 内部维护一个简单的 dict 缓存：\`{message_hash: extracted_facts}\`。同一条消息不抽两次三元组——第二次直接返回缓存结果。

两层缓存各自独立记账——\`record_cache_hit("embedding", N)\` 和 \`record_cache_hit("fact_extraction", N)\` 区分来源。在成本瀑布图中，两条缓存节省分别显示为独立的绿色条。

### 压缩的工程权衡

\`compress_message()\` 的完整工程决策链：

1. **什么时候触发**：当前由调用方（ChatEngine）判断。只在上下文窗口压力大时（估计使用率 > 80%）才压缩。
2. **压缩 Prompt 设计**：一句话摘要 prompt——「将以下内容压缩为一句话，保留关键信息」。不要求 LLM 做复杂推理——压缩本身应该是轻量操作。
3. **压缩失败的降级**：如果 LLM 调用失败（网络超时 / API 报错），不崩——取原文前 200 字符 + "..." 作为降级摘要。
4. **节省量记账**：\`original_tokens - compressed_tokens\`，用 \`_estimate_tokens()\` 估算（不是 API 精确值——因为原文可能没调过 API）。压缩 LLM 调用本身的消耗在 \`record("compression", ...)\` 中单独记一笔。

> **未解决问题**：当前压缩是「全有或全无」——要么整条消息压缩，要么不压。更精细的做法是「分段压缩」——消息的前 200 token 保留原文（因为开头通常包含关键上下文），剩余部分压缩。这需要额外的分段逻辑和多次 LLM 调用，性价比待评估。

### 溢出策略的纯函数设计

\`overflow_sim.py\` 是一个纯函数模块——不碰 ChatEngine 的生产管线，独立运行。输入：对话历史 + 话题 + 策略名 → 输出：\`OverflowSimResult\`（丢了什么、保留了什么、省了多少 token）。

这个设计让 Lab 页可以**安全地做「如果」实验**——「如果我用策展人策略而不是守门员，会发生什么？」——而不影响实际聊天。三个策略可以用同一组输入对比，用户看到差异后决定「下次聊天用哪个策略」。

### TokenLedger 的节省追踪

所有节省操作统一走 \`TokenLedger\`：

\`\`\`
# summary() 输出示例
planner:             3 次,  1,200 + 150 = 1,350 token
chat:                5 次, 12,000 + 3,500 = 15,500 token
fact_extraction:     4 次,  3,200 + 400 = 3,600 token
compression:         1 次,    150 + 30 = 180 token
embedding:           2 次缓存命中,  800 prompt + 0 completion = 800 token    ← 绿色
compression_savings: 1 次,  节省 390 token         ← 绿色
─────────────────────────────────────────────────
total:              16 次操作, 消耗 20,630 token (含节省 1,190)
\`\`\`

关键设计：**节省不是负数**——\`record_cache_hit()\` 和 \`record_compression_savings()\` 用正数记录节省。统计时消耗和节省分开展示，不混在一起。用户看到的不是「净消耗 19,440」，而是「消耗 20,630，其中省了 1,190」——更透明。

> 置信度：0.93
`,
    l3: `### 当前行业实践

- **Anthropic Prompt Caching**：Claude API 支持对 system prompt 和长篇上下文做服务端缓存。重复发送相同的 system prompt 时，Claude 自动检测并只收 10% 的 input token 费用。这基本上是「缓存复用」的云服务版本——用户不需要自己维护 FAISS 索引。
- **OpenAI Predicted Outputs**：对于已知输出的场景（如代码补全、翻译），可以预先发送预期的输出，如果匹配，output token 按折扣计价。这是「如果你猜对了，我给你打折」的模式。
- **Gemini Context Caching**：Google 的 Gemini API 支持对上下文做显式缓存——你告诉 API「这部分内容缓存起来」，后续请求引用缓存 ID 即可，按缓存存储时间计费而非按 token。这比 Anthropic 的隐式缓存在控制粒度上更灵活。

### 学术前沿

- **Speculative Decoding（推测解码）**：用小模型快速生成候选 token，大模型并行验证。如果小模型猜对了，大模型一次前向传播确认多个 token——在不改变输出质量的前提下，推理速度提升 2-3 倍。但 Token 消耗不变（大模型仍然要处理所有 token），所以它省的是时间而非 Token——但时间 = 钱（更快的响应意味着同样的 GPU 时间能服务更多请求）。
- **Token 级别的自适应压缩**：LLMLingua 系列（微软）——用小模型对 prompt 做 token 级别的压缩，移除「对输出影响最小的 token」。和 GlassCortex 的 \`compress_message()\` 不同——LLMLingua 删的是 token，不是句子。实验表明可以压缩 2-5 倍而保持 >95% 的任务性能。但只对某些任务有效（QA、摘要），对代码生成等结构化任务效果较差。
- **动态 Prompt 预算**：不是「压到多少 token」，而是「给定当前预算，哪些内容值得塞进去」。本质上是信息检索中的「预算感知排序」问题——每条候选内容有一个 value（对任务有多重要）和一个 cost（多少 token），在总 cost ≤ 预算的约束下最大化总 value。这是背包问题在 Token 工程中的直接应用。

### 未解决的问题

1. **压缩质量的自动评估**：\`compress_message()\` 生成的摘要「好不好」——目前靠人看。能不能用 LLM-as-judge 自动打分——「原文表达了 A/B/C 三点，摘要中保留了几点」？但这又引入了额外的 Token 消耗（打分本身要调 LLM），性价比待评估。

2. **缓存失效的条件**：嵌入缓存用相似度 0.95 做命中判据。但如果用户的上下文变了——「Python」在讨论编程语言时和下一条讨论「Python（蛇）」时——同样的文本「Python」在不同上下文中含义不同，缓存的向量可能不准确。目前的纯文本匹配没法感知上下文。

3. **节省的「后悔」**：压缩或截断后，发现下一轮用户问的问题恰好需要被压缩掉的那条信息——此时压缩从「聪明的节省」变成了「愚蠢的丢失」。能否在压缩时保留一个「压缩索引」——只丢弃原文但保留关键词向量，方便后续检测「用户问的问题是否与被丢弃的内容相关」？

4. **多模态的 Token 节省**：如果对话中包含图片，token 消耗模式完全不同。一张 1024×1024 的图片在 GPT-4V 中消耗约 765 token（无论图片内容是什么）。但「这张图片对回答有多重要」和图片的 token 成本完全不成比例——一张关键图表和一张装饰性图片花一样的 token。如何判断多模态内容的信息价值？

> 置信度：0.88
`,
  },
  {
    id: "q4.3",
    question: 'Token 预算的动态分配模型：各上下文分区的预算如何按需调配？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P1",
    confidence: { l0: 0.93, l1: 0.92, l2: 0.9, l3: 0.85 },
    overallConfidence: 0.85,
    l0: 'Token 预算不是「平均分」给每个分区，而是按地位定基线、按压力动态调配——系统提示和当前用户消息是「刚需」（不可压缩）、记忆召回是「弹性区」（满了可丢可压）、对话历史是「缓冲区」（最老的最先丢）。核心是把窗口当成一个固定大小的容器，让重要内容占住位置，不重要内容被挤出去，而不是给每区画一个死框。',
    l1: `你搬进一个 40 平米的小公寓。床、书桌、衣柜——这几样是刚需，必须放下。剩下的空间给一个书架和一张椅子，但书架挤一挤能换成小的，椅子实在放不下就不放。

Token 预算的分配完全一样。上下文窗口就是那个 40 平米——固定大小。你往里塞四样东西，地位不同：

### 四区模型：地位决定优先级

GlassCortex 的 \`src/context/partition.py\` 把上下文窗口切成**四个分区**（\`_ZONE_DEFS\`）：

| 分区 | emoji | 地位 | 可压缩性 |
|------|-------|------|---------|
| **系统提示** (system) | ⚙️ | 刚需 | 几乎不可压——它是任务定义，压了就乱 |
| **记忆召回** (recalled) | 🧠 | 弹性区 | 最弹——少了哪条记忆，回答差一点但不崩 |
| **对话历史** (history) | 💬 | 缓冲区 | 次弹——老的对话先丢，新的保留 |
| **工具定义** (tools) | 🛠️ | 固定 | 当前为 0（未接 MCP） |

地位不同，所以分配策略不是「四区各占 25%」。真实分配是动态的：

\`\`\`
窗口 4096 token
├─ 系统 prompt:    800   ← 刚需，每次都在
├─ 当前用户消息:   200   ← 刚需，本次提问
├─ ── 上面两项是固定开销，剩 3096 给弹性区 ──
├─ 对话历史:      1500   ← 老的两轮已丢，留最近三轮
└─ 记忆召回:      1596   ← 把窗口填满，召回塞到上限
\`\`\`

### 关键：分区是「推导」出来的，不是「拍脑袋」给的

\`compute_partitions()\` 不让每个分区自己报 token 数（那样会扯皮），而是用一个**减法推导**：

\`\`\`python
# src/context/partition.py — compute_partitions() 的核心推导
base = context_meta["base_tokens"]        # 系统 prompt 开销（ChatEngine 给）
user = context_meta["user_message_tokens"] # 当前用户消息
total = context_meta["total_estimated_tokens"]
window = context_meta["window_size"]      # 4096

# 召回 = 总量 − 系统 − 用户（剩下的都算召回区）
recalled_tokens = max(0, total - base - user)
\`\`\`

为什么这么算？因为系统 prompt 和用户消息是**组装 prompt 时就确定的**——它们占多少，账本清清楚楚。而召回区是「最后塞进去的填充物」——它的大小由「窗口还剩多少」反向决定。你不需要给召回区定预算，它自动吃掉所有剩余空间。

### 弹性区怎么「动态调配」

固定开销（system + user）占住位置后，剩下的空间在「对话历史」和「记忆召回」之间分。分的原则是**优先级 + 溢出策略**：

1. **优先级**：召回记忆 > 老对话历史。如果用户问的问题需要某条历史记忆，那条召回必须留住；前两轮无关的对话可以先丢。
2. **溢出触发**：当 \`usage_pct > 100%\`（\`overflow_occurred = True\`），溢出引擎介入——按策略丢老历史或压长消息。
3. **压缩前后留痕**：\`recalled_tokens_before\` 字段记下溢出处理前的 recalled token 数。这样 UI 能展示「召回区本来有 2800 token，溢出处理后压到 1596」——你看到的不只是结果，还有「省了多少」。

### 为什么不给每区定死预算

有人会想：给系统 prompt 定 30%、历史定 40%、召回定 30%，严格按比例。**这是错的**。原因：

- **系统 prompt 是不可控的**——它由任务复杂度决定，不是你想省就能省。强行压到 30% 可能让 Planner 乱分类。
- **召回质量不与 token 数成正比**——召回 1500 token 的高相关记忆，比召回 3000 token 的低相关记忆更有用。预算该给「相关的那条」，不是「平均分」。
- **死预算无法应对长对话**——聊到第 10 轮，历史天然膨胀。死框 40% 历史会挤掉召回。

正确的姿势是：**固定开销吃掉刚需，弹性区按「价值/成本」排序填满剩余窗口**。这正是信息检索里的「预算感知排序」——每条候选内容有 value（相关性）和 cost（token 数），在总 cost ≤ 窗口的约束下最大化总 value。GlassCortex 当前用相关度排序近似了这个思路，更精细的背包式分配是远期方向。

\`\`\`mermaid
%% title: 图：Token 预算四区动态分配
graph TD
    WIN["🪟 上下文窗口 4096 token<br/>固定容器"]
    WIN --> FIXED["🔒 固定开销（刚需）<br/>system + user_message"]
    WIN --> ELASTIC["🔀 弹性区（按价值填充）<br/>recalled + history"]

    FIXED --> S["⚙️ system: base_tokens<br/>不可压"]
    FIXED --> U["💬 user: 当前消息<br/>不可压"]

    ELASTIC --> DERIVE["📐 召回 = total − base − user<br/>减法推导，非预设预算"]
    DERIVE --> R["🧠 recalled_zone<br/>相关度排序填充<br/>recalled_tokens_before 留压缩前快照"]
    DERIVE --> H["💬 history_zone<br/>老历史优先丢<br/>溢出策略介入"]

    OVERFLOW{"usage_pct > 100%?"}
    R --> OVERFLOW
    OVERFLOW -->|是| STRAT["策略三选一<br/>截断 / 相关度 / 压缩摘要"]
    OVERFLOW -->|否| OK["✅ 填满窗口"]
    STRAT --> AFTER["recalled_tokens_before → recalled<br/>展示省了多少"]

    style WIN fill:#4f46e5,stroke:#4338ca,color:#fff
    style FIXED fill:#f97316,stroke:#ea580c,color:#fff
    style ELASTIC fill:#3b82f6,stroke:#2563eb,color:#fff
    style S fill:#fbbf24,stroke:#d97706,color:#111
    style U fill:#fbbf24,stroke:#d97706,color:#111
    style R fill:#34d399,stroke:#059669,color:#111
    style H fill:#818cf8,stroke:#6366f1,color:#fff
    style STRAT fill:#f87171,stroke:#ef4444,color:#7f1d1d
    style OK fill:#a7f3d0,stroke:#10b981,color:#064e3b
\`\`\`

> 置信度：0.92`,
    l2: `### compute_partitions() 的完整契约

\`src/context/partition.py\` 是分区预算的单一真相源。它的输入是 ChatEngine 产出的 \`context_meta\` 字典，输出是结构化的 \`ContextPartitions\`：

\`\`\`python
@dataclass
class ZonePartition:
    zone_key: str          # "system" | "recalled" | "history" | "tools"
    label: str             # "系统提示" | "记忆召回" | ...
    tokens: int            # 该分区 token 数
    percentage: float      # 占窗口比例
    color: str             # UI 配色（CSS 变量）
    emoji: str             # UI 图标
    items: list[dict]      # 分区内的明细条目（如召回记忆逐条）

@dataclass
class ContextPartitions:
    zones: list[ZonePartition]
    total_tokens: int
    window_size: int
    usage_pct: float              # 占用率 = total / window
    overflow_occurred: bool       # 是否触发溢出
    overflow_details: str
    is_empty: bool
    recalled_tokens_before: int   # 优化前 recalled token 数（压缩/截断前）
\`\`\`

### 分区预算的数据通路

\`compute_partitions()\` 消费的 \`context_meta\` 字段（来自 ChatEngine 组装 prompt 时写入）：

| context_meta 字段 | 含义 | 映射到分区 |
|---|---|---|
| \`base_tokens\` | 系统 prompt 开销 | system zone |
| \`user_message_tokens\` | 当前用户消息 | history zone（当前轮） |
| \`total_estimated_tokens\` | 组装后总 token | 驱动 recalled 推导 |
| \`window_size\` | 上下文窗口（默认 4096） | usage_pct 分母 |
| \`recalled_items\` | 召回记忆逐条 | recalled zone 明细 |

注意**分区 token 与调用点 token 是两个维度**——这正是 [q4.5](#q4.5) 区分的「调用点级归因」vs「分区级归因」。\`token_ledger.py\` 按「谁调了 API」记账（planner/chat/fact_extraction），\`partition.py\` 按「这段 token 在 prompt 哪一段」拆解（system/recalled/history/tools）。两者正交：一次 chat 调用的 15000 prompt token，可以同时被分区拆成「system 800 + recalled 1200 + history 10000 + user 3000」。

### 动态调配的两个真实开关

预算不是静态比例，是两个机制驱动的：

1. **溢出阈值 → 策略选择**：\`overflow_occurred = (usage_pct > 100)\`。一旦溢出，\`overflow_sim.py\` 的三种策略（截断/相关度/压缩摘要）决定弹性区怎么腾空间。策略选择 = 弹性区的预算再分配方式。

2. **压缩前快照 \`recalled_tokens_before\`**：溢出处理前，记下 recalled 原本要占多少；处理后实际占 \`recalled_tokens\`。差值就是「这次溢出在召回区省了多少」。这让分区预算的变化可追溯——不是黑盒「窗口满了就丢」，而是「压缩前 2800 → 压缩后 1596，省 1204」。

### 为什么分区预算当前是「被动」的

当前架构里，分区预算是**事后可视化**（\`compute_partitions\` 算出来给 UI 看），不是**事前约束**（组装 prompt 时按预算截断）。也就是说：系统先把 prompt 组装好，再算各分区占多少，溢出了再事后处理。

更主动的设计是**事前预算感知组装**：组装前先定「system 800、召回上限 2000、历史上限 1500」，组装时逐段塞入并在超限时立即截断，而非组完再溢出处理。\`TokenLedger.record()\` 当前的签名（call_point / prompt / completion）不支持分区维度——要做主动分区预算，需要扩 \`partition_breakdown: dict[str, int]\` 参数，这是 GlassCortex 的明确下一步（见 [q4.5](#q4.5) 远期方向）。

> 置信度：0.90`,
    l3: `### 当前行业实践

- **Anthropic Context Editing（2025）**：Claude API 引入了对长上下文的「编辑」能力——系统可以主动标注 prompt 的哪些段在后续轮次可被丢弃，模型内部维护一个滑动窗口。这把「分区预算」从应用层下沉到模型层——你不需要自己写溢出策略，模型自己决定哪段历史不再加载。
- **OpenAI Context Window 管理**：GPT 的上下文窗口是固定上限，应用层负责截断。但 Assistants API 引入了「Threads」——对话历史自动持久化、自动滚动截断，应用层不直接管理历史 token。预算调配被平台托管。
- **LangChain Stuff / Map-Reduce / Refine**：三种经典的 prompt 组装策略对应三种预算调配哲学。Stuff（全塞进去，超了才换策略）、Map-Reduce（分块独立处理再合并，每块预算固定）、Refine（增量追加，动态扩展）。本质都是「分区预算」在不同粒度上的实例。

### 学术前沿

- **预算感知检索（Budget-Constrained Retrieval）**：信息检索领域的成熟方向。给定预算 B，从候选集里选子集最大化总相关性，约束是子集 token 总和 ≤ B。这是 0/1 背包问题的变体——NP-hard，但贪心（按 value/cost 比排序）在实践中接近最优。GlassCortex 的 recalled zone 用相关度排序近似了这个贪心解，但没显式做「cost 约束下的 value 最大化」——召回到窗口填满为止，而非「价值低于阈值的就不召」。
- **自适应上下文压缩（Adaptive Context Compression）**：研究显示，prompt 不同段对输出的贡献度差异巨大——system prompt 和最近几轮对话贡献最大，中间的历史贡献最低。ACELoss 等方法用注意力分析动态决定哪段压缩、哪段保留，比静态分区更精细。但需要模型暴露注意力权重，闭源 API 不支持。
- **K-V Cache 的分区复用**：推理引擎层（vLLM / SGLang）的 K-V cache 管理本质也是一种「分区预算」——哪些前缀的 K-V 留在显存复用（Anthropic Prompt Caching 的底层机制），哪些淘汰。这是把分区预算下沉到显存管理，对应用透明。

### 未解决的问题

1. **分区边界的 tokenizer 依赖**：要精确算「system 占 800 token」，需要模型原生 tokenizer。DeepSeek 未公开 tokenizer，\`compute_partitions\` 依赖 ChatEngine 用 \`_estimate_tokens()\` 算的 \`base_tokens\`——这是字符启发式估算，误差 10-20%。分区预算的「边界」因此是近似的，对「判断溢出」够用，对「精确到个位的预算卡控」不够。
2. **多轮预算的连续性**：当前每轮独立计算分区。但理想情况是「第 3 轮 system 已占 800，第 4 轮 system 不变就不该重复计」——跨轮的分区预算复用（类似 K-V cache 的前缀复用）能省。但需要追踪「哪些分区跨轮稳定」，应用层目前没这个状态。
3. **预算与质量的量化关系**：召回区给 1500 token 还是 2000 token，回答质量差多少？当前没有这个映射函数。没有它，「动态调配」就缺一个量化的优化目标——调配成什么样算「最优」？这需要离线评估：固定问题集，扫不同 recalled 预算，测回答质量曲线，找拐点。
4. **工具定义区的预算**：当前 tools 分区恒为 0（未接 MCP）。一旦接入工具，工具 schema 会占据可观 token（一个 MCP server 的 schema 可能 500-2000 token）。多工具场景下「工具描述本身」会变成预算大户——需要工具描述的精简策略（只列调用到的工具 schema）。

> 置信度：0.85`,
  },
  {
    id: "q4.4",
    question: '跨模型成本优化：什么任务用什么模型，怎么量化成本 vs 质量损失？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P3",
    confidence: { l0: 0.91, l1: 0.9, l2: 0.88, l3: 0.82 },
    overallConfidence: 0.82,
    l0: "跨模型成本优化的核心不是「省 token」，而是「省 cost-per-quality-unit」——用质量分归一化后的单位成本做选择。具体做法：将任务按复杂度分档（简单/中等/复杂），每档匹配合适模型（小模型/标准模型/旗舰模型），用 `(input_tokens × input_price + output_tokens × output_price) / quality_score` 量化每一分钱买到多少「有用输出」。这个指标让你能跨模型对比性价比——而不是只看谁的 token 单价便宜。",
    l1: `你去开一家物流公司。仓库里有三种车：

**五菱宏光**：便宜耐造，百公里油耗 ¥50——最适合拉快递、送外卖。
**宝马 5 系**：舒适安全，百公里油耗 ¥100——适合接送客户、老板出行。
**保时捷 911**：性能拉满，百公里油耗 ¥200——周末赛道日或品牌活动专用。

你不可能用保时捷送快递（太贵），也不可能用五菱宏光接贵宾（掉面）。每辆车有它「够用就好」的场景——按任务选车，而不是按「我平时开什么车就什么车都用它」。

AI 模型的选择逻辑完全一样。一个 Token 体系中的常见模型分层：

| 层级 | 代表模型 | 成本 (input/output per 1M) | 适合任务 |
|------|---------|:-------------------------:|---------|
| 小模型 | DeepSeek-Chat | ¥1 / ¥2 | 事实抽取、意图分类、关键词提取 |
| 标准模型 | GPT-4o-mini | ¥0.15 / ¥0.6 | 日常对话、文档摘要、代码补全 |
| 旗舰模型 | DeepSeek-Reasoner / o3 | ¥4 / ¥16 | 复杂推理、规划生成、数学证明 |

问题的关键在于：如果一个简单任务（「提取这句话里的人名」）用了旗舰模型，你得到了 100% 的质量——但可能有 **80% 的质量溢价是浪费的**。因为小模型也能做到 95% 的质量，而成本只有 1/8。

> **跨模型优化的本质：识别哪些任务可以从旗舰模型降级而不显著损失质量。**`,
    l2: `### Model Router 的四组件架构

一个完整的模型路由系统由四个组件构成——每一件都是必要的，缺一个就无法闭环：

#### ① 任务复杂度分类器（Task Classifier）

在 LLM 调用前判断任务的复杂度。三种方案：

- **基于规则**：消息长度 < 50 token → 简单；包含「为什么/如何/分析/推理」→ 复杂
- **基于小型分类模型**：用 BERT 级模型将任务分到 3-5 个档位，推理成本几乎为零
- **基于现有信号复用**：GlassCortex 的 Planner 输出了五类意图（\`chat/recall/plan/extract/copy\`），这天然是复杂度信号——\`plan\` 最重，\`extract\` 最轻

#### ② 路由策略（Routing Policy）

决定「X 类任务 → Y 模型」。三种主流策略：

| 策略 | 逻辑 | 优点 | 缺点 |
|------|------|------|------|
| **静态映射** | 意图 A → 模型 A，意图 B → 模型 B | 简单、可预测、零延迟 | 不够灵活，无法处理边缘情况 |
| **阈值路由** | 复杂度分 > 0.7 → 旗舰模型 | 在成本和准确度间平衡 | 阈值需要调试 |
| **级联路由** | 先用小模型 → 置信度不够 → 标准模型 → 还低 → 旗舰 | 不浪费低成本尝试 | 延迟随级数累积 |

#### ③ 模型分发器（Model Dispatcher）

实际的 API 调用的入口。关键设计约束：

- **统一接口**：不同模型返回相同 Schema。上层组件（ChatPanel、Planner）完全不关心背后是哪个模型
- **Fallback 链**：旗舰模型超时或返回错误 → 自动降级到标准模型（保证可用性不依赖单一模型）
- **重试策略**：不同模型不同重试间隔——便宜的模型可以多试几次，贵的模型一次失败就降级

#### ④ 成本记录器（Cost Recorder）

记录每次调用的模型名称、token 消耗、延迟、质量分。这是优化的「反馈闭环」——没有数据支撑的路由只是拍脑袋。在 GlassCortex 中，\`src/token_ledger.py\` 的 \`TokenLedger\` 已经记录了每次调用的 token 数和调用方，但缺少「用了哪个模型」字段。

### 量化的数学框架

核心指标只有一个——**Cost-per-Quality-Unit**：

$$\\text{CPU} = \\frac{\\text{input_tokens} \\times \\text{input_price} + \\text{output_tokens} \\times \\text{output_price}}{\\text{quality_score}}$$

**例子**：一个事实抽取任务，两个模型的表现：

| 模型 | Input Tokens | Output Tokens | Input Price/1M | Output Price/1M | 成本 | 质量分 | CPU |
|------|:-----------:|:------------:|:--------------:|:---------------:|:----:|:-----:|:---:|
| deepseek-v4-flash | 500 | 200 | ¥1 | ¥2 | ¥0.0009 | 0.85 | **¥0.00106** |
| deepseek-v4-pro | 300 | 150 | ¥4 | ¥16 | ¥0.0036 | 0.97 | ¥0.00371 |

deepseek-v4-flash 的 CPU 只有 v4-pro 的 **28%**——对于这个事实抽取任务，用贵模型多花的钱买到的质量提升并不值。CPU 归一化指标让这种对比变成数学问题而非感觉问题（[^quality-score]）。

[^quality-score]: quality_score 怎么来？实践中用 proxy 指标：任务特定基准测试通过率、用户满意度评分、追问率（追问低 = 一次答对 = 质量高）、或 LLM-as-judge 打分。没有完美的单指标，但有多 proxy 加权后的实用方案。

> **关键洞察：CPU 不是单调递减的。** 更多 token 和更贵的模型 ≠ 更好质量。简单任务上杀鸡用牛刀，高质量边际收益抵不过 token 单价翻 4-8 倍带来的成本飙升。

### GlassCortex 现状

当前项目中模型路由的情况：

- \`src/config.py\` 定义了 \`available_models = ("deepseek-v4-flash", "deepseek-v4-pro")\`，但**没有路由逻辑**——所有请求统一走 deepseek-v4-flash
- 定价配置就绪：\`llm_input_price_per_1m\` / \`llm_output_price_per_1m\`
- \`TokenLedger.record()\` 缺少 \`model_name\` 参数——即使将来有了路由，也无法在账本中回溯「这笔 token 是哪个模型花的」

一个可行的入口点：Planner 的意图输出（chat / plan / extract / recall / copy）天然可作为复杂度信号——\`plan\` 类任务走 deepseek-v4-pro，\`extract\` 和 \`copy\` 走 deepseek-v4-flash。实现只需要一个配置映射层 + API dispatcher + TokenLedger model_name 扩展——不算大规模架构变更。

\`\`\`mermaid
%% title: 图：GlassCortex 模型路由示意（设计方案）
graph TD
    TASK["📝 用户请求"] --> PLAN["🧠 Planner 意图分类"]
    PLAN -->|"extract / copy"| CHEAP["💨 DeepSeek V4 Flash<br/>¥1/¥2 per 1M<br/>质量余量 ★★★"]
    PLAN -->|"chat / recall"| STANDARD["⚖️ DeepSeek V4 Flash<br/>(当前默认)<br/>质量余量 ★★★"]
    PLAN -->|"plan"| EXPENSIVE["🧠 DeepSeek V4 Pro<br/>¥4/¥16 per 1M<br/>质量余量 ★★★★★"]
    CHEAP --> RECORD["📒 TokenLedger v2<br/>+ model_name 记录"]
    STANDARD --> RECORD
    EXPENSIVE --> RECORD
    RECORD --> CPU["📊 CPU 计算<br/>Cost per Quality Unit"]
    CPU --> OPTIMIZE["🔄 路由策略调优<br/>（Phase 38+）"]
    style TASK fill:#4f46e5,stroke:#4338ca,color:#fff
    style PLAN fill:#f59e0b,stroke:#d97706,color:#111
    style CHEAP fill:#34d399,stroke:#059669,color:#111
    style STANDARD fill:#60a5fa,stroke:#2563eb,color:#fff
    style EXPENSIVE fill:#ef4444,stroke:#dc2626,color:#fff
    style RECORD fill:#818cf8,stroke:#6366f1,color:#fff
    style CPU fill:#f472b6,stroke:#ec4899,color:#fff
    style OPTIMIZE fill:#a78bfa,stroke:#7c3aed,color:#fff
\`\`\`

> 置信度：0.88`,
    l3: `### 前沿研究

**FrugalGPT** (Stanford, 2023)：提出级联路由的正式框架。在 QA 基准上，级联策略在保持 98% 的 GPT-4 质量的同时将成本降低了约 70%。关键发现：大多数查询（~60-70%）可以用小模型以足够置信度回答——路由不是「偶尔省点钱」，而是大多数时候都在省钱。

**RouterBench**：一个专门评估路由策略的基准。核心结论：没有一种策略在所有场景下最优。最佳策略取决于任务分布（简单 vs 复杂比例）、模型间的质量差距（差距越大路由价值越大）、和延迟预算（级联路由增加延迟）。

### 当前最佳实践

**OpenRouter** / **LiteLLM** 是当前最成熟的路由工具。它们提供统一 API 抽象层——上层应用只需指定 "model: auto"，由平台决定路由到哪个模型。LiteLLM 的 \`router\` 模块还实现了基于延迟和失败率的自适应路由，以及预算上限管理。

### 终极挑战：用 LLM 路由 LLM

这是模型路由的递归困境：如果你用一个 LLM 来判断「这个任务该用哪个 LLM」——那么这个分类器本身的 token 成本也要计入成本分析。如果分类器每判断一次消耗 200 token（约 ¥0.0002），每年处理 1000 万次请求的决策成本就是 ¥2000——这笔钱本身可能超过路由节省的金额。

**好路由策略必须是轻量级的。** 要么用基于规则的启发式（MessagePack header 标记复杂/简单），要么用蒸馏到 BERT 级别的分类器（推理成本趋近于零），而不是再用一个 LLM 做路由。

### GlassCortex 后续方向

项目中 Planner 的意图输出天然可作为路由信号。演进路径：

1. **Phase α**：\`TokenLedger.record()\` 加 \`model_name\` 参数 → 账本记录模型信息（✅ 已交付——ModelRouter（Phase 55）在 routing-enabled 模式下通过 \`RoutingInfo\` 记录了模型切换数据）
2. **Phase β**（✅ 已交付）：ModelRouter（Phase 55）— 意图 → 模型映射路由表，\`src/config.py\` 的 \`simple_model\`/\`complex_model\` 为配置源，\`routing_enabled\` feature flag 门控
3. **Phase γ**：CPU 指标仪表盘——在 Lab 页展示各模型的 cost-per-quality-unit，为调优提供数据（远期）

> 基础模型路由已交付，但缺少"质量分"的可靠 proxy 指标。一旦有可靠的 proxy（用户满意度、追问率、任务完成率），路由的自然收益就具备了数据支撑，可进一步调优。

> 置信度：0.82`,
  },
  {
    id: "q4.5",
    question: 'Token 消耗的归因粒度：不是"这次调用了 5000 token"而是逐分区归因',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P0",
    confidence: { l0: 0.97, l1: 0.95, l2: 0.93, l3: 0.9 },
    overallConfidence: 0.9,
    l0: 'Token归因有三个粒度层级——会话级总计（「这次对话花了2万token」）只能让你焦虑、调用点级归因（「planner 300 + chat 15000 + fact_extraction 2000」）能帮你找到大头在哪、分区级归因（「system prompt 800 + 召回记忆 1200 + 对话历史 3000」）能帮你精准优化——粒度越细，越能找到节省的抓手。',
    l1: `你月底收到信用卡账单，上面写着「本月消费：¥5,000」。你知道花了五千，但你不知道花在哪了——是吃饭太多？打车太多？还是那个自动续费的会员忘了关？你只能焦虑地划掉一些消费，但不知道划哪里最有效。

下个月，银行给你发了分类账单：「餐饮 ¥2,000 · 交通 ¥500 · 购物 ¥1,500 · 娱乐 ¥1,000」。你一看——餐饮是大头，娱乐可以砍。分类账单让你从「模糊焦虑」变成「精准行动」。

Token 归因粒度完全一样。不同层级告诉你不同的事：

| 归因粒度 | 你能知道什么 | 你能做什么 |
|---------|------------|-----------|
| **会话级** | 「这次对话花了 2 万 token」 | 只知道贵，不知道贵在哪 |
| **调用点级** | 「planner 300 + chat 15000 + fact_extraction 2000 + compression 省了 800」 | 知道 chat 是大头——该压缩对话历史了 |
| **分区级** | 「chat 的 15000 中：system 800 + 召回 1200 + 历史 10000 + 当前 3000」 | 知道对话历史占了三分之二——清一下历史？ |

### 为什么归因粒度是「节省的前提」

你不可能优化你看不见的东西。这是工程管理的第一性原理：

- 会话级总账 → 你只知道「贵」→ 你只能砍总量 → 你会砍掉不该砍的东西（比如把 system prompt 砍了导致 Planner 乱分类）
- 调用点级归因 → 你知道「chat 花了 75%」→ 你针对 chat 做优化（压缩长消息、限制历史轮数）
- 分区级归因 → 你知道「chat 的 15000 token 中有 10000 是前 5 轮对话历史」→ 你只保留最近 3 轮，精准省下 6000 token 而不影响 system prompt 和召回质量

**归因粒度决定了你优化时切多细的刀。刀越细，切掉的脂肪越多、保留的肌肉越多。**

### GlassCortex 的归因体系

项目中 Token 归因的核心是 \`src/token_ledger.py\` 的 \`TokenLedger\` 类。它像一个财务账本——每笔 token 消耗都带有「来源」标签：

\`\`\`python
# 每次 LLM 调用后
ledger.record(
    call_point="chat",            # ← 这是归因标签
    prompt_tokens=1200,
    completion_tokens=350,
)
\`\`\`

\`call_point\` 是归因的最小单位——当前记账体系覆盖 6 种来源：4 个 LLM 调用点（\`planner\` 意图分类、\`chat\` 主对话、\`fact_extraction\` 事实抽取、\`compression\` 消息压缩）+ 2 个节省类型（\`compression_savings\` 压缩节省、\`cache_hit\` 缓存命中节省，以来源组件名为 call_point 记入）。

\`summary()\` 方法按调用点分组统计，输出类似银行分类账单的结构。在 Phase 38 中，这套数据通过 \`api/routers/chat.py\` 的 \`token_breakdown\` 字段透传到前端，\`TokenCostBadge\` 组件在每条助理消息旁展示本轮的 token 花费和成本。

### Per-Turn 归因：从「会话级」到「轮次级」

Phase 38 Batch 1 的关键升级是 **per-turn token breakdown**——不只是「整个会话花了多少」，而是「这一轮对话花了多少，分别花在哪个调用点」：

\`\`\`python
# api/routers/chat.py — 每轮响应注入 token_breakdown
token_breakdown = {
    "chat": {
        "prompt_tokens": api_trace.get("prompt_tokens", 0),
        "completion_tokens": api_trace.get("completion_tokens", 0),
    },
    "intent": planner_trace["token_usage"],        # 意图分类消耗
    "fact_extraction": {                            # 事实抽取消耗
        "prompt_tokens": fact_trace.get("prompt_tokens", 0),
        "completion_tokens": fact_trace.get("completion_tokens", 0),
    },
    "pricing": {                                    # 定价（用于前端折算成本）
        "input_per_1m": settings.llm_input_price_per_1m,
        "output_per_1m": settings.llm_output_price_per_1m,
    },
}
api_trace["token_breakdown"] = token_breakdown
\`\`\`

这样每条消息都携带了自己的 token 账单。用户展开 \`TokenCostBadge\` 可以看到：「本轮花了 ≈¥0.03 · 850 token（chat 600 + planner 150 + fact_extraction 100）」。

### 为什么不是分区级归因（目前）

调用点（\`call_point\`）和分区（\`partition\`）不是同一层概念：

- **调用点** = 谁调了 LLM API（planner/chat/fact_extraction/compression）
- **分区** = 这条 token 在 prompt 的哪一段（system prompt / 召回记忆 / 对话历史 / 用户消息 / 指令）

调用点级归因只能告诉你「chat 花了 15000 token」，但不能告诉你这 15000 里有多少是 system prompt、有多少是前 5 轮对话历史。分区级归因需要更精细的 tokenizer 介入——在组装 prompt 时，逐段调用 tokenizer 预计算各分区的 token 数。

这是 GlassCortex 的下一步方向。当前 \`TokenLedger.record()\` 的签名为 \`record(call_point, prompt_tokens, completion_tokens)\`，暂不支持分区维度的 \`partition_breakdown: dict[str, int]\` 参数。扩充分区归因接口是明确的扩展点。

\`\`\`mermaid
%% title: 图：Token 归因粒度三级跳
graph TD
    RAW["📊 原始数据：每次 LLM API 调用<br/>response.usage.prompt_tokens<br/>response.usage.completion_tokens"]
    RAW --> L1["🔴 第一级：会话级总计<br/>「本次对话 2 万 token」<br/>只能焦虑，无法行动"]
    RAW --> L2["🟡 第二级：调用点归因<br/>TokenLedger.call_point<br/>planner / chat / fact_extraction / compression<br/>知道大头在哪 — 定向优化"]
    RAW --> L3["🟢 第三级：分区归因（远期）<br/>partition_breakdown<br/>system / memory / history / user / instruction<br/>精准到段 — 手术刀级优化"]
    L1 --> METER1["侧边栏<br/>会话统计"]
    L2 --> METER2["成本瀑布图<br/>TokenCostBadge<br/>per-turn breakdown"]
    L3 --> METER3["分区预算面板<br/>（待实现）"]
    style RAW fill:#4f46e5,stroke:#4338ca,color:#fff
    style L1 fill:#ef4444,stroke:#dc2626,color:#fff
    style L2 fill:#fbbf24,stroke:#d97706,color:#111
    style L3 fill:#34d399,stroke:#059669,color:#111
    style METER1 fill:#fecaca,stroke:#f87171,color:#7f1d1d
    style METER2 fill:#fef3c7,stroke:#f59e0b,color:#78350f
    style METER3 fill:#d1fae5,stroke:#10b981,color:#064e3b
\`\`\`

> 置信度：0.95
`,
    l2: `### TokenLedger 的归因数据模型

\`\`\`python
# src/token_ledger.py
@dataclass
class TokenUsage:
    call_point: str        # ← 归因标签：「谁花的」
    prompt_tokens: int
    completion_tokens: int
    timestamp: float       # ← 时间维度：「什么时候花的」

class TokenLedger:
    def record(self, call_point: str, prompt_tokens: int,
               completion_tokens: int) -> None:
        """记录一笔 LLM 调用消耗。call_point 是归因键。"""
        ...

    def record_cache_hit(self, call_point: str, tokens_saved: int) -> None:
        """记录一次缓存命中节省。call_point 标注是哪个组件的缓存。"""
        ...

    def record_compression_savings(self, tokens_saved: int) -> None:
        """记录压缩节省。这个没有 call_point 参数——
        因为压缩节省总是来自 compression 调用点。"""
        ...

    def record_count(self) -> int:
        """返回已记录的 TokenUsage 条数（不含节省记录）。
        Phase 38 新增——为 per-turn 差分提供基础。"""
        ...

    def get_range(self, start: int, end: int) -> list[TokenUsage]:
        """按索引范围取记录。Phase 38 新增——
        支持「取出本轮对话的 token 消耗」。"""
        ...

    def summary(self) -> dict:
        """按 call_point 分组统计，返回分类账单。
        消耗和节省分开列出——节省不在消耗里做减法。"""
        ...
\`\`\`

### 归因的两条数据通路

**通路一：TokenLedger（内存账本，会话级）**

ChatEngine / PlannerEngine / FactExtractor 各自注入同一个 TokenLedger 实例。各引擎在每次 LLM 调用后调用 \`ledger.record()\`。\`summary()\` 提供会话累计的按调用点分组统计。

**通路二：api_trace.token_breakdown（HTTP 响应，轮次级）**

\`api/routers/chat.py\` 在每轮响应组装时，从多个来源拼装 \`token_breakdown\`：
- \`api_trace["prompt_tokens"]\` / \`api_trace["completion_tokens"]\` → chat 调用点
- \`planner_trace["token_usage"]\` → intent 调用点
- \`context_meta["fact_extraction_trace"]\` → fact_extraction 调用点
- \`settings.llm_input_price_per_1m\` / \`settings.llm_output_price_per_1m\` → 定价

两条通路的分工：
- TokenLedger → 开发调试 / 侧边栏统计 / 成本瀑布图（会话累计视角）
- api_trace.token_breakdown → 每条消息的 \`TokenCostBadge\`（单轮视角）

### 归因为什么需要时间维度

\`timestamp\` 字段让归因不只是「谁花的」，还能回答「什么时候花的」。这在诊断 Token 异常时至关重要：

- 「第 3 轮 chat 突然花了 8000 token，前两轮都只花 2000」→ 查第 3 轮的对话历史——是不是前两轮的召回记忆都堆在了上下文里？
- 「Planner 在第 5 轮花了 500 token，之前都在 150 左右」→ 用户的消息变复杂了？还是 Planner 的 system prompt 被污染了？

时间维度的归因 = 时序异常的早期预警。

### TokenCostBadge：归因的前端落地

\`TokenCostBadge\` 组件（Phase 38 Batch 2）是归因体系的前端触点：

1. 从 \`api_trace.token_breakdown\` 取数
2. 聚合 chat + intent + fact_extraction 三个调用点的 token
3. 用定价折算成本：\`cost = (input_tokens/1M × input_price) + (output_tokens/1M × output_price)\`
4. 以内联 pill 展示：「≈¥0.03 · 850 token」
5. 无 breakdown 时静默不渲染（兼容旧响应格式）

用户不需要打开仪表盘——每条消息旁边就能看到「这一轮花了多少」。这才是归因的正确姿态：**不是「事后审计」，而是「即时可见」**。

> 置信度：0.93
`,
    l3: `### 当前行业实践

- **Anthropic Token Counting API**：Claude 提供了 \`messages.count_tokens()\` 方法——在调用前传入完整的 messages 列表，返回精确的 input token 数。关键是它按 message role 分段计数：每个 system/user/assistant/tool 消息各自多少 token。这天然支持分区级归因——「system prompt 800 token + user message 200 token + conversation history 3000 token」。
- **LangSmith Tracing**：LangChain 的可观测平台。对每次 LLM 调用打 tag，按 tag 分组统计 token 消耗。本质上就是 \`call_point\` 的工业化版本——你可以打任意粒度的标签（"retrieval_chain" / "summarization_step_3" / "final_answer"）。
- **OpenTelemetry for LLMs**：新兴的 OpenLLMetry 项目将 LLM 调用建模为 OpenTelemetry span。token 消耗作为 span attribute 自动记录。配合 Jaeger/Zipkin 等分布式追踪后端，可以实现跨服务的 token 归因（「用户请求 → API Gateway → Chat Service → LLM → 响应」全链路 token 追踪）。

### 学术与工程前沿

- **Token 级别的溯源（Provenance）**：不是「这条消息花了 500 token」，而是「输出中的第 127 个 token 主要受 system prompt 第 3 段和召回记忆第 2 条的影响」。这需要注意力权重分析——检查 LLM 在生成每个 output token 时对 input token 的注意力分布。一篇名为「Towards Token-Level Provenance for LLM Outputs」的 workshop paper 原型实现了这个思路，但计算开销巨大（需要完整的前向传播记录，不能只用 KV cache）。
- **成本归因与用户定价挂钩**：对于面向 C 端用户的 AI 产品，token 归因直接关联到商业模式——「这个免费用户每次对话平均花 0.05 元，付费用户花 0.20 元」。归因粒度从技术需求变成了商业需求——财务部门需要知道「每个 API endpoint 的 token 成本是多少」来做产品定价。

### 未解决的问题

1. **分区归因的 tokenizer 依赖**：要做到精确的分区级归因，需要调用模型原生的 tokenizer。但 DeepSeek 没有公开 tokenizer，只能用 tiktoken 近似或字符启发式估算。这意味着分区级归因的「分区边界」可能是 ±15% 的近似值——对于「system prompt 有没有超过 2000 token 预算」来说可能够用，但对于「每个分区精确到个位数」来说不够。

2. **归因与隐私的张力**：要做逐分区、逐 token 的细粒度归因，系统需要记录「这 500 token 的具体文本内容是什么」。但用户可能不希望自己的对话历史被逐条打 tag、做成本分析——「你在看我的聊天记录？」。归因日志的保留策略（保留多久、保留到什么粒度、谁可以访问）需要在工程一开始就设计好。

3. **跨会话归因**：当前 TokenLedger 是会话级生命周期——刷新页面就清零。如果要追踪「过去 7 天的 token 消耗趋势」或「每个功能模块的月度 token 账单」，需要将会话级归因数据持久化并跨会话聚合。这又回到了「日志保留多久」的问题。

4. **归因的「可行动」阈值**：看到「planner 花了 300 token」之后，你做什么？如果 300 token 是正常水平，这条信息就没有行动价值。归因系统的最终价值不是「展示数据」，而是「告诉你该做什么」——当某个调用点的 token 消耗超出正常范围时，自动触发建议：「你的 chat token 比历史平均高 2.3 倍，建议压缩最近 3 轮对话历史」。

> 置信度：0.90
`,
  },
  {
    id: "q4.6",
    question: '缓存命中率 vs Token 节省的量化关系',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P1",
    confidence: { l0: 0.92, l1: 0.91, l2: 0.89, l3: 0.84 },
    overallConfidence: 0.84,
    l0: '这两个指标经常被混为一谈，但不是一回事——命中率是「请求中有多少次命中缓存」（频率），节省量是「命中那次省了多少 token」（幅度）。命中率 90% 不见得省得多（每次只省 10 token），命中率 20% 也可能省得猛（每次省 2000 token）。真正该盯的是「期望节省 = 命中率 × 平均节省幅度」——一个把频率和幅度合成一个钱的单一数字。',
    l1: `你开了一家咖啡店，办了会员卡——常客刷卡进店不收费（「缓存命中」），新顾客要收门票。月底盘点时会看两个数：

- **进店命中率**：这个月有多少比例是刷卡的常客？（频率）
- **省了多少门票钱**：常客本来该买多少门票，全免了，省了多少？（幅度）

光看命中率会骗人。如果常客占 90% 但门票才 5 块，省的有限；如果常客只占 20% 但常客本来要买 200 块的年票，省的可能更多。**真正决定你「赚没赚到」的是两者相乘——期望节省**。

### 两个指标，两个维度

| 指标 | 量纲 | 回答的问题 | 单独看的坑 |
|------|------|-----------|-----------|
| **命中率** | 无量纲（0-1） | 「请求中多少次走了缓存？」 | 命中率高但每次省得少 → 看起来漂亮，省钱有限 |
| **节省量** | token | 「命中那次省了多少 token？」 | 节省量大但命中率低 → 单次猛但很少触发 |
| **期望节省** | token | 「平均每次请求省多少 token？」 | —— 这才是该盯的合成指标 |

期望节省 = 命中率 × 平均单次节省幅度。它把「频率」和「幅度」压成一个数——直接等于「平均每次请求少花多少 token」。

### GlassCortex 的缓存节省怎么记账

这是最容易踩坑的地方。缓存命中「省 token」，但 GlassCortex 的 \`TokenLedger\` **没有专门的「节省」字段**——节省是被「塞进」\`call_point\` 维度里记账的。

\`\`\`python
# src/cache.py — EmbeddingCache 命中时
if self._ledger is not None:
    self._ledger.record_cache_hit("embedding", tokens_saved)

# src/token_ledger.py — record_cache_hit()
def record_cache_hit(self, call_point: str, tokens_saved: int) -> None:
    """tokens_saved 存在 prompt_tokens 字段，completion_tokens=0，
    call_point 保留来源组件名（如 "embedding"）便于归因。"""
    self.record(call_point, prompt_tokens=tokens_saved, completion_tokens=0)
\`\`\`

关键设计：**节省量当成一次「消耗」记进同一个 \`call_point\`**，prompt_tokens 存的就是省下的 token 数。也就是说，\`embedding\` 这个 call_point 的记录里，会混着两类数据——真正调嵌入 API 花掉的 token，和缓存命中省下的 token。\`summary()\` 按 call_point 分组统计时，它们被加在一起，**不会自动分离成「消耗」和「节省」两列**。

这带来一个直接后果：**你不能光看 \`summary()["embedding"]["prompt_tokens"]\` 来判断省了多少**——那个数字是消耗和节省的混合。要算节省量，需要另一条数据通路。

### 命中率怎么算

命中率公式简单：\`命中次数 / (命中次数 + 未命中次数)\`。但 GlassCortex 当前**没显式记未命中次数**——\`record()\` 只在命中时记（\`record_cache_hit\`），未命中时调真正的 API（记的是消耗，不带「这是未命中」的标记）。

所以命中率当前算不准。要精确算，需要：

1. 每次查询 \`EmbeddingCache.get()\` 都记一笔（命中 or 未命中都记），区分两类——这是命中率的基础数据。
2. 或者，从 \`count\` 字段反推：\`summary()["embedding"]["count"]\` 是 embedding 这个 call_point 的总记录数；如果其中一部分是 \`record_cache_hit\` 写入的（prompt_tokens 是节省量、completion_tokens=0），可以用「completion_tokens=0 且 prompt_tokens>0」启发式分离。但这不严谨——真正调 API 的也可能 completion_tokens=0（嵌入通常无 completion）。

> **现状**：节省量能看（\`record_cache_hit\` 记了），命中率不能直接看（未命中没单独记）。这是一个待补的观测缺口。

### 节省量怎么展示更诚实

既然 \`summary()\` 不分离节省，前端要展示「省了多少」就得做一层加工。一个诚实的展示分两栏：

\`\`\`
Embedding 调用
├─ 消耗：       5 次,  1,500 token   ← 真正调 API 花的
├─ 缓存节省：   8 次命中,  省 1,200 token  ← 本来要花，缓存兜住了
└─ 期望节省/请求：1,200 / 13 = 92 token   ← 合成指标
\`\`\`

这要求在记账时就区分「这是消耗」还是「这是节省」——\`record_cache_hit\` 已经记了节省，但缺少一个显式的 \`record_miss\`（或 \`count\` 维度的命中/未命中区分）来支撑命中率。补上它，命中率 × 节省幅度的合成指标就能落地。

### 为什么这个区分重要

把命中率和节省量分开，直接影响优化决策：

- **命中率低、节省幅度大** → 缓存策略对（大价值查询命中），但覆盖太窄 → 该扩缓存阈值，让更多查询命中。
- **命中率高、节省幅度小** → 缓存太宽松（几乎啥都命中），但每次省得少 → 该收紧阈值，把缓存容量留给真正贵的查询。

如果只看一个混合数「省了 1200 token」，你不知道是「少数大查询省的」（该扩覆盖）还是「多数小查询省的」（该收紧）——两个优化方向完全相反。\`EmbeddingCache\` 的命中阈值 \`0.95\` 就是这个权衡的旋钮：调高 → 命中更准但更少；调低 → 命中更多但可能用不准的向量。

\`\`\`mermaid
%% title: 图：命中率 × 节省幅度 = 期望节省
graph TD
    REQ["📨 一次缓存查询"]
    REQ --> DECIDE{"命中？"}
    DECIDE -->|"是 (命中率 h)"| HIT["✅ 缓存命中<br/>省 tokens_saved (幅度 m)"]
    DECIDE -->|"否 (1−h)"| MISS["❌ 未命中<br/>调 API, 花真实 token"]

    HIT --> LEDGER_HIT["📒 record_cache_hit(cp, saved)<br/>saved 存进 prompt_tokens<br/>与消耗混在同一 call_point"]
    MISS --> LEDGER_MISS["📒 record(cp, prompt, completion)<br/>记真实消耗<br/>⚠ 未命中次数无独立标记"]

    LEDGER_HIT --> GAP["⚠ summary() 不分离节省<br/>命中率算不准（缺未命中计数）"]
    LEDGER_MISS --> GAP

    GAP --> FIX["🔧 待补：record_miss 或 count 维度<br/>区分命中/未命中"]
    FIX --> METRIC["📐 期望节省 = h × m<br/>命中率 × 平均节省幅度<br/>= 平均每次请求省多少 token"]

    style REQ fill:#4f46e5,stroke:#4338ca,color:#fff
    style DECIDE fill:#818cf8,stroke:#6366f1,color:#fff
    style HIT fill:#34d399,stroke:#059669,color:#111
    style MISS fill:#f87171,stroke:#ef4444,color:#7f1d1d
    style LEDGER_HIT fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
    style LEDGER_MISS fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b
    style GAP fill:#fbbf24,stroke:#d97706,color:#111
    style FIX fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style METRIC fill:#22d3ee,stroke:#0891b2,color:#083344
\`\`\`

> 置信度：0.91`,
    l2: `### 缓存节省的记账真相

要写正确的缓存量化代码，必须先搞清 \`TokenLedger\` 的记账约束。这点容易被忽略，导致算出来的「节省」是错的。

**约束 1：节省量存在 \`prompt_tokens\` 字段，和真实消耗混在同一 call_point。**

\`\`\`python
# src/token_ledger.py
def record_cache_hit(self, call_point: str, tokens_saved: int) -> None:
    """tokens_saved 记录在 prompt_tokens 字段，completion_tokens=0，
    call_point 保留来源组件名便于归因。"""
    # 实际是 record(call_point, prompt_tokens=tokens_saved, completion_tokens=0)
\`\`\`

源组件是 \`"embedding"\`（\`src/cache.py:41\`）和 \`"fact_extraction"\`（\`src/memory/fact.py:90\`）。注意：**没有 \`"cache_hit"\` 这个 call_point**——节省记录挂到来源组件名下，而不是单独的「节省桶」。

**约束 2：\`summary()\` 不分消耗/节省。**

\`\`\`python
summary() 返回结构（按 call_point 分组）:
{
  "embedding": {"count": 13, "prompt_tokens": 2700, "completion_tokens": 0, "total_tokens": 2700},
  ...
  "total": {...}
}
\`\`\`

这里的 \`prompt_tokens=2700\` 是「真正调 API 的消耗 + 缓存命中的节省」之和。你**不能**直接说「embedding 省了 2700」——里面混着真实消耗。

**约束 3：\`record_compression_savings(saved)\` 是另一个机制**——它硬编码 call_point 为 \`"compression_savings"\`（不是来源组件名）。所以压缩节省是单独成桶的，而缓存节省挂在来源组件下。两个节省机制的 call_point 命名策略不一致：压缩走独立桶，缓存走来源桶。这是当前实现的一个不对称。

### 命中率算不准的根因与修法

\`\`\`python
# 当前只能命中时记账
class EmbeddingCache:
    def get(self, text, threshold=0.95):
        cached = self._search_faiss(text, threshold)
        if cached is not None:
            if self._ledger:
                self._ledger.record_cache_hit("embedding", tokens_saved)
            return cached
        return None  # ← 未命中：没有记账！命中率分母丢失
\`\`\`

修法（待实现）：加 \`record_cache_miss(call_point)\` 或在 \`TokenLedger\` 维护 \`{call_point: {hits: int, misses: int}}\` 计数器。\`record_count\` / \`get_range\`（Phase 38 新增方法）提供了快照/差分能力，可以支撑「本轮命中率」的计算——先快照计数，调 cache，再 diff。但当前 chat.py 的 \`token_breakdown\` **不消费 ledger 的 record_count/get_range**（它从 api_trace / planner_trace / context_meta 直接拼），所以 per-turn 命中率当前完全没通路到前端。

### 期望节省的工程公式

把上面的约束综合，期望节省的工程实现：

\`\`\`
单次期望节省 = P(命中) × E[命中时省的 token]

会话累计期望节省 = Σ 命中次数 × 平均节省幅度
                 = hits × (Σ savings_i / hits)
                 = Σ savings_i        ← 这恰好 = record_cache_hit 累计的 prompt_tokens

单次平均 = Σ savings_i / (hits + misses)   ← misses 当前缺失，无法精确
\`\`\`

好消息：**累计节省量能精确算**（就是 \`record_cache_hit\` 写入的 prompt_tokens 之和，可通过区分 completion=0 的记录近似提取）。坏消息：**命中率分母缺失**，所以「单次平均节省」只能用 hits 做分母（= 平均每次命中的节省，而非平均每次请求的节省）。

### 前端 \`TokenCostBadge\` 当前展示了什么

\`TokenCostBadge\`（Phase 38 Batch 2）聚合的是 \`token_breakdown\` 的 \`chat / intent / fact_extraction\` 三个调用点的 **prompt_tokens + completion_tokens**，折算成成本。注意：

- 它聚合的是**消耗**，**不展示节省**——缓存节省（\`record_cache_hit\` 写入）不走 \`token_breakdown\`，所以 badge 上看不到「省了多少」。
- \`token_breakdown\` 只带 3 个调用点（chat/intent/fact_extraction），\`embedding\`、\`compression_savings\` 等不在其中。

也就是说，当前前端的 per-turn 视图是**纯消耗视图**，节省量（缓存/压缩）只在会话级 \`TokenLedger.summary()\` 口径里。要把 q4.6 的「期望节省」搬到前端，需要扩 \`token_breakdown\` 携带 savings 维度，或在 sidebar 会话级统计里展示。这是明确的下一步触点。

> 置信度：0.89`,
    l3: `### 当前行业实践

- **Anthropic Prompt Caching（2024）**：Claude 支持显式缓存标记——用 \`cache_control\` 标注 prompt 的哪段可缓存，后续请求复用时 input token 按 **10% 计费**（省 90%）。关键：它**精确量化了节省**——账单直接分「cache hit input tokens」（按 0.1×）和「regular input tokens」（按 1×）两栏。这正是 GlassCortex 缺的「显式分离消耗/节省」——但 Anthropic 是平台层帮你分好了，应用层直接读账单即可。
- **OpenAI Cached Tokens**：GPT-4o 等模型对重复的 input prefix 自动缓存，cached input tokens 按半价。同样在 usage 里分 \`cached_tokens\` 和普通 input——命中率分母和节省幅度都精确。
- **向量数据库的命中率指标**：Pinecone / Weaviate 等 向量库提供 \`cache_hit_rate\` 指标面板——直接暴露命中次数 / 查询次数。但「命中省了多少」需要应用层自己算（向量库不知道「省了一次 embedding API 调用」值多少钱）。

### 学术前沿

- **语义缓存（Semantic Caching）**：不止精确文本匹配，而是「语义相似就返回缓存」。GPTCache 是代表项目——用嵌入相似度做缓存键，阈值控制命中率 vs 准确率。这和 GlassCortex 的 \`EmbeddingCache\`（threshold=0.95）是同一思路。研究焦点在「相似度阈值如何随查询类型自适应」——简单查询用高阈值（宁缺毋滥），复杂查询用低阈值（容忍不精确换命中率）。这把「命中率 × 节省幅度」的权衡从静态阈值变成函数。
- **缓存对回答质量的影响**：用不准的缓存向量（相似度 0.95 但其实是不同语境的「Python」）会污染召回。研究显示，缓存相似度阈值从 0.95 降到 0.85，命中率可能翻倍但下游任务准确率下降 5-15%。「省 token」和「保质量」在这里直接对冲——省下的 embedding token 可能换来一次质量更差的召回，用户多问一轮反而花更多。**真正的优化目标不是最大化节省，而是最大化「节省 − 质量损失引发的额外成本」**。

### 未解决的问题

1. **未命中计数缺口**：如前述，\`record_cache_hit\` 只记命中，未命中不记。命中率分母缺失。要补的是 \`record_miss\` 或 \`count\` 维度的命中/未命中区分——这是 q4.6 落地的前置。
2. **节省幅度的归因**：缓存命中省下的 token，是「省了 embedding 调用的 input token」。但「省一次 embedding」对不同长度文本幅度不同——短文本省 50 token，长文档省 2000。当前 \`tokens_saved\` 是命中时按文本长度估算的，准确性取决于估算函数（\`_estimate_tokens\`，误差 10-20%）。节省量本身是个估算值，不是 API 精确值——这点常被忽略。
3. **缓存失效的成本**：缓存存的是旧向量。如果 embedding 模型升级了，旧缓存全部失效——重算成本是「一次性大消耗」。缓存命中率面板看着漂亮，但换模型那天瞬间清零。缓存系统需要\"版本戳\"——模型变了自动失效旧缓存，并在指标上区分「有效命中」和「过期命中」。
4. **期望节省的动态阈值**：理想的缓存阈值不是固定 0.95，而应随「节省幅度 × 命中概率」动态调整。如果一段时间内查询都在聊新话题（命中率天然低），调低阈值多省点；如果在反复聊同一主题（命中率高），调高阈值保质量。这是个在线学习问题——当前的静态阈值是最简实现，远期可探索。

> 置信度：0.84`,
  },
  {
    id: "q4.7",
    question: 'Token 估算的模型差异：不同模型的 tokenizer 下 token 数不同',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P1",
    confidence: { l0: 0.91, l1: 0.9, l2: 0.88, l3: 0.83 },
    overallConfidence: 0.83,
    l0: '同一段文本在不同模型的 tokenizer 下数出来的 token 数不一样——分词算法（BPE/WordPiece/Unigram）、词表大小、训练语料三者都不同。但工程上你很少需要"跨模型精确换算 token"：调用后读 response.usage（模型自己数的，100% 准），调用前用字符启发式估算（不区分模型，误差 10-20%，加安全余量够用）。真正的坑不是"数不准"，而是"拿 A 模型的 token 数去卡 B 模型的预算"——token 数不通用，跨模型只有"占窗口比例"可比较。',
    l1: `你拎一筐苹果去三个市场摆摊。A 市场按"个"卖，数出来 30 个；B 市场按"斤"称，12 斤；C 市场按"箱"装，3 箱。同一筐苹果，三个数字完全不同——因为计量单位不同。

[token](https://baike.baidu.com/item/Token) 也是一样。每个模型的 tokenizer 就是它自带的"计量单位"。同一段话「我喜欢猫」，DeepSeek 的 tokenizer 数出来可能是 5 个 token，Claude 的可能 4 个，GPT 的可能 6 个——**没有"这段话等于 5 个 token"这种绝对值，只有"在 X 模型下是 5 个 token"**。

### 为什么 token 数不通用

三个因素决定一个模型的 tokenizer 怎么切文本：

1. **分词算法**：BPE（Byte Pair Encoding，按频率合并字节对）、WordPiece（按字组合概率）、Unigram（按子词打分裁剪）。算法不同，切分边界就不同。
2. **词表大小**：GPT-4 的 cl100k_base 词表约 10 万；DeepSeek 词表不同；Claude 未公开。词表越大，常见词越可能整词收录（1 词 = 1 token），词表越小越要拆子词。
3. **训练语料**：中文语料多的模型会把常见汉字单独编码；英文为主的模型可能把汉字拆成多字节子词。所以同样一句中文，中文友好的模型数出来 token 更少。

> [q4.1](#q4.1) 已经讲了三层精度模型（API 精确 / tokenizer 预计算 / 字符启发式）。这里只回答一个延伸问题：**模型之间的 tokenizer 差异，工程上到底怎么处理？**

### GlassCortex 的真实选择：不区分模型

看 \`src/context/overflow_sim.py:53\` 的 \`_estimate_tokens()\`：

\`\`\`python
def _estimate_tokens(text: str) -> int:
    """字符级启发式 token 估算，与 ChatEngine._estimate_tokens 同算法。"""
    if not text:
        return 1
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    other = len(text) - cjk
    tokens = math.ceil(cjk / 4) + math.ceil(other / 3)
    return max(1, tokens)
\`\`\`

注意这个函数**根本不接收 model 参数**——一个公式打天下。中文按 4 字符/token、非中文按 3 字符/token。这是刻意的工程决策，不是偷懒：

- DeepSeek 没有公开 tokenizer。用 OpenAI 的 tiktoken 去"预计算"DeepSeek 的 token，本身就是一个带偏差的近似——cl100k_base 是 GPT-4 的词表，和 DeepSeek 的词表不同。
- 与其引入一个重依赖（tiktoken）去做一个"精确但错了"的估算，不如用一个明确标注"误差 10-20%"的启发式。至少启发式的误差是可预期的——加 15% 安全余量就能兜住。
- ChatEngine 也通过 \`from src.context.overflow_sim import _estimate_tokens\` 直接复用这个函数——单一真相源，全项目一个估算口径。

### 调用前 vs 调用后：差异在哪消失

模型差异问题在两个时间点有完全不同的解法：

| 时机 | 怎么数 | 模型差异问题 |
|------|--------|-------------|
| **调用后** | 读 \`response.usage.prompt_tokens\` | ✅ 消失——模型自己用原生 tokenizer 数好了，100% 准 |
| **调用前** | \`_estimate_tokens()\` 启发式 | ⚠️ 存在——但不区分模型，所有模型同一估算值，加余量兜底 |
| **跨模型比较** | 不换算 token，换算"占窗口比例" | ✅ 规避——4096 窗口下"占了 80%"在哪个模型都成立 |

关键洞察：**调用后根本不存在"模型差异"问题**——因为 API 返回的就是该模型原生 tokenizer 的精确计数。差异问题只在"调用前预算"和"跨模型比较"两个场景出现，而这两个场景用启发式 + 占比口径就能绕过去。

### 真正的坑：跨预算挪用

工程上最容易踩的坑不是"数不准"，而是**拿错模型的 token 数去卡另一个模型的预算**。比如你用 tiktoken（GPT-4 口径）数出来一段 system prompt 是 1200 token，然后拿这个数字去卡 DeepSeek 的 4096 窗口预算——但 DeepSeek 的原生 tokenizer 数出来可能是 1400。你以为还有 2896 给召回，实际只剩 2696。

GlassCortex 的做法回避了这个坑：调用前用 \`_estimate_tokens()\` 统一口径估算（不假装精确），调用后用 \`response.usage\` 精确结算（\`TokenLedger.record()\` 记账）。两者偏差 15% 以内，对"判断会不会溢出"够用——因为溢出判断用的是 80% 预警线，不是 100% 精确卡线[^precision]。

[^precision]: 见 [q4.1](#q4.1) 的脚注：估算误差 15% 时，安全余量是必要的。GlassCortex 用 80% 预警线而非 100%，正是为了吸收这层模型差异不确定性。

\`\`\`mermaid
%% title: 图：模型 tokenizer 差异的工程处理
graph TD
    TEXT["📝 同一段文本<br/>「我喜欢猫」"]
    TEXT --> TOK_A["🐳 DeepSeek tokenizer<br/>5 token"]
    TEXT --> TOK_B["🐅 Claude tokenizer<br/>4 token"]
    TEXT --> TOK_C["🟢 GPT tokenizer<br/>6 token"]
    TOK_A --> NONFUNG["⚠ token 数不通用<br/>不能说「这段话=5 token」<br/>只能说「在 DeepSeek 下=5」"]
    TOK_B --> NONFUNG
    TOK_C --> NONFUNG

    NONFUNG --> Q{"什么时候需要处理差异？"}
    Q -->|"调用后"| AFTER["📊 response.usage<br/>模型自己数 · 100% 准<br/>差异消失"]
    Q -->|"调用前预算"| BEFORE["🧮 _estimate_tokens()<br/>不区分模型 · 误差 10-20%<br/>+15% 安全余量兜底"]
    Q -->|"跨模型比较"| RATIO["📐 换算占窗口比例<br/>「80% 占用」通用<br/>不换算 token 绝对值"]

    style TEXT fill:#4f46e5,stroke:#4338ca,color:#fff
    style TOK_A fill:#3b82f6,stroke:#2563eb,color:#fff
    style TOK_B fill:#818cf8,stroke:#6366f1,color:#fff
    style TOK_C fill:#22d3ee,stroke:#0891b2,color:#083344
    style NONFUNG fill:#f87171,stroke:#ef4444,color:#7f1d1d
    style Q fill:#fbbf24,stroke:#d97706,color:#111
    style AFTER fill:#34d399,stroke:#059669,color:#111
    style BEFORE fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style RATIO fill:#a7f3d0,stroke:#10b981,color:#064e3b
\`\`\`

> 置信度：0.90`,
    l2: `### 为什么是 4 字符/token 和 3 字符/token

\`_estimate_tokens()\` 的 4/3 不是拍脑袋。背后有两条编码学的事实：

**中文 4 字符/token**：中文 UTF-8 编码每个字 3 字节。但 LLM 的 tokenizer 不是按字节切的——它用 BPE，倾向于把**高频常见字**单独编码成一个 token（因为训练语料里这些字出现太多，BPE 合并它们收益最大）。结果是常见中文字 ≈ 1 字/token，生僻字被拆成多字节子词 ≈ 2-3 字/token。平均下来约 4 字符/token 是个稳健的中心估计。

**英文 3 字符/token**：英文单词平均 4-5 个字母。BPE 把常见词根（"ing"/"tion"/"pre"）拆成子词，常见整词（"the"/"and"）单独成 token。平均约 3 字符/token。

这个估计对**纯文本**很准，对**代码和 JSON** 偏差大——因为代码里大量是 \`{}\`/\`()\`/\`->\` 这类符号，BPE 对符号的切分和自然语言不同。GlassCortex 的 system prompt 里有结构化标记（\`## 对话记忆\`），估算会略偏高，但偏高的方向是保守的（多估 → 更早触发溢出预警 → 宁可错杀）。

### 单一真相源：所有调用点复用一个函数

grep 全项目，\`_estimate_tokens\` 在多个位置被调用，全部 import 自同一个 \`src/context/overflow_sim.py\`：

\`\`\`
src/cache.py:11           from src.context.overflow_sim import _estimate_tokens
src/chat/engine.py:16     _estimate_tokens,  (import)
src/context/overflow_sim.py:53   def _estimate_tokens(...)  ← 定义点
\`\`\`

ChatEngine 用它估 user_input 和压缩前后 token，EmbeddingCache 用它估缓存命中的节省量，overflow_sim 自己用它估固定开销和每条记忆。**全项目一个估算口径**——这意味着所有 token 数在同一基准下可比。如果哪天要换成"按模型分别估算"，只需要改一个函数（加 model 参数），所有调用点同步升级。

### 为什么不引入 tiktoken

tiktoken 是 OpenAI 开源的 GPT 系列 tokenizer 库，精度 ~99%。引入它能拿到更准的"调用前"估算。GlassCortex 没有引入，理由：

1. **DeepSeek 没公开 tokenizer**——tiktoken 的 cl100k_base 是 GPT-4 词表，对 DeepSeek 本身就是近似（偏差 5-15%）。引入 tiktoken 只是把"启发式 15% 误差"换成"tiktoken 5-15% 误差"，精度提升有限。
2. **重依赖**——tiktoken 需要 wheel 和词表数据文件，增加安装体积和启动时间。
3. **收益场景窄**——调用后已有 \`response.usage\` 精确值（这才是结算口径）；调用前估算只用于溢出预警，80% 阈值线本就吸收了 20% 的误差。

如果未来 GlassCortex 接入 OpenAI 模型（模型路由，见 [q4.2](#q4.2) 第五层），那时 tiktoken 就值得引入——因为对 OpenAI 模型它是 ~99% 准的，不是近似。**工具选择跟着模型走**，而不是"一刀切上 tiktoken"。

### 跨模型 token 表的不可交换性

这是设计跨模型系统时最容易忽略的点。假设你做一个"模型路由器"，简单任务给小模型、复杂任务给大模型。你不能用"这段 prompt 在小模型下 500 token"去判断"换到大模型还是 500 token"——可能是 450，也可能是 600。

正确的跨模型预算管理是**按比例而非按绝对值**：
- 用启发式算出"占窗口 X%"
- 每个模型的窗口大小已知（4096 / 8192 / 128k）
- 用"占比 × 目标模型窗口"反推该模型下的预算

这避开了"token 数不通用"的坑。GlassCortex 当前单模型，这个问题不显现——但 \`TokenLedger.call_point\` 的设计已经为多模型留了扩展点（\`record()\` 可加 \`model\` 字段）。

> 置信度：0.88`,
    l3: `### 当前行业实践

- **OpenAI tiktoken（唯一公开）**：OpenAI 是唯一开源了官方 tokenizer 的大厂。tiktoken 库支持 cl100k_base（GPT-4 / GPT-3.5）、o200k_base（GPT-4o）等。开发者可以在调用前精确预计算 token 数——这是 OpenAI 生态的独家优势。
- **Anthropic token counting API**：Claude 没公开 tokenizer 库，但提供了 \`messages.count_tokens()\` 接口——传入完整 messages 列表，返回精确 input token 数。这绕开了"tokenizer 不公开"的问题：你不自己数，让 Anthropic 帮你数，免费且精确。
- **国产模型的困境**：DeepSeek、Moonshot、智谱等都没有公开 tokenizer。只能用 tiktoken 近似或字符启发式。Moonshot 曾在文档里给过"1 中文字 ≈ 1.3 token"的经验值，但这不是官方 tokenizer，精度有限。
- **LiteLLM 统一抽象**：开源多模型代理 LiteLLM 在内部封装了各家的 token 计数方式，对外暴露统一接口。但它本质上是"对你屏蔽差异"——底层还是各算各的，跨模型 token 数仍然不通用。

### 学术与工程前沿

- **多模态 token 的不可换算**：一张 1024×1024 图片在 GPT-4V 里约 765 token，在 Gemini 里按"切片"算（每 256×256 一片）。图片 token 和文本 token 的"换算"完全由模型决定，没有公式——你只能调 API 看 usage。这让"跨模态预算管理"几乎不可能精确。
- **Tokenizer 蒸馏**：有研究尝试用一个"通用 tokenizer"近似多个模型的 tokenizer——输入文本，输出"在大多数模型下的平均 token 数"。这种近似对"会不会溢出"够用，但对"精确卡预算"不够。本质是把 GlassCortex 的 \`_estimate_tokens\` 思路做到更精细。
- **统一 token 标准的不可能**：业界曾讨论过"定义一个标准 token 单位"，但失败了——因为 token 本质是"某个模型 BPE 词表的一个条目"，脱离模型谈 token 没有意义。这就像"定义一个标准货币"而不挂钩任何国家经济——不可能。工程上的共识是：**token 只在模型上下文中有意义，跨模型用占比口径**。

### 未解决的问题

1. **DeepSeek tokenizer 的反推**：能不能通过大量 API 调用采样（发已知文本，看返回的 usage），反推 DeepSeek 的 BPE 词表？理论上是可能的——这正是 OpenAI tokenizer 早期被社区"挖出来"的方式。但需要大量调用成本，且厂商随时可能改词表（版本漂移）。性价比存疑。
2. **估算误差的动态校准**：\`_estimate_tokens\` 的 4/3 是静态常数。能不能根据"本会话已调用的 response.usage vs 估算值"动态校准系数？比如发现 DeepSeek 实际中文是 3.5 字符/token，就把 4 调成 3.5。这是在线学习问题——当前没实现。
3. **代码/JSON 的专门估算**：4/3 对自然语言准，对代码偏差大。能不能对代码文本用一套不同的系数（比如 2.5 字符/token，因为代码符号多、BPE 切分更碎）？需要分文本类型估算，增加复杂度。
4. **多模型并存时的预算一致性**：当 GlassCortex 接入多个模型（模型路由），同一个会话里前半段用小模型、后半段用大模型，token 账本怎么记？按"原模型 token"记则不可加，按"启发式估算"记则丢失精确性。这是多模型架构下 token 归因的新难题（见 [q4.5](#q4.5) 分区归因的远期方向）。

> 置信度：0.83`,
  },
  {
    id: "q4.8",
    question: 'Token 浪费模式自动检测：能不能自动识别"这笔 token 花了但没产生价值"？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P2",
    confidence: { l0: 0.89, l1: 0.88, l2: 0.85, l3: 0.8 },
    overallConfidence: 0.8,
    l0: '能，但"浪费"是事后判断——得先给"价值"定一个可测的 proxy（召回的记忆有没有被回答引用、删掉这段上下文回答会不会变差、用户有没有追问）。三类常见浪费：重复上下文（同一信息塞了多份）、无效召回（召回了模型没用上）、固定开销虚高（system prompt 占比过大）。GlassCortex 其实已有一个 wasted_tokens 字段，但它量的是"溢出丢弃 + 窗口闲置"这种结构性浪费，不是"塞进去了但没产生价值"这种语义浪费——后者才是真正难、也真正值得检测的。',
    l1: `你去吃自助餐，花了 198。账单只告诉你"花了 198"。但你真正想知道的是"浪费了多少"——哪些菜上了桌一口没动、哪些重复点了、哪些是固定锅底费占了大头。要回答"浪费了多少"，光有账单不够，得事后**盘点哪些 token 上了桌但没被吃**。

Token 浪费检测就是这件事。[q4.5](#q4.5) 的归因告诉你"花了多少、花在哪"，但它不告诉你"花得值不值"。从"花了多少"到"浪费了多少"，中间缺的就是一个**价值判断**。

### 三类典型浪费模式

| 浪费模式 | 症状 | 为什么是浪费 |
|---------|------|-------------|
| **重复上下文** | 同一信息在 system prompt + recalled + history 出现多次 | 同样的信息塞了两三份 token，模型只需要一份 |
| **无效召回** | recalled zone 塞了 5 条记忆，模型回答只用了 1 条 | 另外 4 条的 token 白花——塞了但没被引用 |
| **固定开销虚高** | system prompt（base_tokens）占窗口 30%+ | 每轮都花一遍固定大头，挤压了真正有用的召回和历史 |

### GlassCortex 已经有的"浪费"字段——和它量的不是一回事

这是最容易混淆的点。\`src/context/overflow_sim.py:81\` 里**确实有一个 \`wasted_tokens\` 字段**：

\`\`\`python
# src/context/overflow_sim.py — OverflowSimResult.__post_init__
self.wasted_tokens = (self.memories_token_before - self.memories_token_after) + max(
    0, self.window_size - self.total_estimated_tokens
)
\`\`\`

拆开看这个公式：

- \`memories_token_before - memories_token_after\` = **被溢出策略丢掉的 recalled token**（召回了但窗口装不下，丢了）
- \`max(0, window_size - total_estimated_tokens)\` = **窗口闲置量**（窗口没装满，空着的那部分）

这两个加起来是**结构性浪费**——"丢掉的 + 没装满的"。它**不包含**本问题问的"塞进去了但没产生价值"那种**语义浪费**。一条召回记忆被塞进了 prompt、模型却没引用——它没被丢、也没让窗口闲置，\`wasted_tokens\` 看不见它，但它确实是浪费。

> **关键区分**：结构性浪费 = 物理/容量层面的浪费（丢、空）。语义浪费 = 信息层面的浪费（塞了没用）。前者好算（公式即可），后者难算（要判断"有没有用"）。GlassCortex 当前只有前者。

### 语义浪费怎么检测：三个层级

| 层级 | 方法 | 检测能力 | 成本 |
|------|------|---------|------|
| **L1 静态规则** | 跨分区文本去重、prompt 长度阈值 | 重复上下文 + 固定开销虚高 | 零额外 token |
| **L2 运行时信号** | 召回条目关键词是否出现在 completion、用户是否追问 | 无效召回（代理信号） | 零或极少 token |
| **L3 事后评估** | 删掉某段上下文重跑（ablation）或 LLM-as-judge 打分 | 精确的"贡献度" | 高（要重跑/调 LLM） |

**L1 重复上下文检测**在 GlassCortex 里其实有现成基础设施——\`EmbeddingCache\`（[q4.6](#q4.6)）的 FAISS 索引和余弦相似度就能做"跨分区文本去重"。但 \`compute_partitions()\`（\`src/context/partition.py\`）当前只算各分区的 token 数，**不跨分区比对内容重复**。这是一个明确的扩展点。

**L2 无效召回检测**最难。最直接的信号是"召回条目的内容有没有出现在模型的回答里"——但这是代理信号，不严谨：模型可能隐式用了某条记忆（影响了措辞）却没有逐字引用。真正精确的检测需要**注意力权重**（看模型生成时关注了 input 的哪些 token），但闭源 API 不暴露注意力。退而求其次是 LLM-as-judge——再调一次 LLM 问"这条召回对回答贡献多大"，但这本身又花 token（检测成本 vs 节省的悖论）。

**L3 固定开销虚高**最简单——\`base_tokens / window_size\` 算个比例，超过 30% 预警。这呼应 [q4.3](#q4.3) 的"固定开销吃掉刚需"。

### GlassCortex 当前缺什么数据通路

要把语义浪费检测落地，当前架构缺两块数据：

1. **partition_breakdown 维度**——[q4.5](#q4.5) 远期方向提到的。\`TokenLedger.record()\` 当前只记 call_point（谁调的），不记 partition（这段 token 在 prompt 哪段）。没有分区粒度，"重复上下文"和"固定开销占比"都算不准。
2. **recall_usage 标记**——\`partition.py\` 的 \`_build_recalled_detail()\` 已经追踪每条召回的 \`kept\`（没被丢、没被截断），但**不追踪"kept 的有没有被模型用上"**。要补这个，需要在生成后回填：分析 completion 是否引用了各召回条目。

换句话说：归因（[q4.5](#q4.5)）是浪费检测的**前置**——你得先知道"花在哪"，才能判断"哪部分是浪费"。GlassCortex 当前在调用点级归因（已交付），分区级归因（远期），语义浪费检测（更远）。

\`\`\`mermaid
%% title: 图：Token 浪费的两类三层
graph TD
    SPENT["💵 Token 花了<br/>TokenLedger.record()"]
    SPENT --> STRUCT["🏗️ 结构性浪费<br/>wasted_tokens 字段（已有）"]
    SPENT --> SEMAN["🧠 语义浪费<br/>塞了没用（本问）"]

    STRUCT --> S1["丢掉的 recalled<br/>before − after"]
    STRUCT --> S2["窗口闲置<br/>window − total"]
    S1 --> SOK["✅ 公式可算 · 已落地"]
    S2 --> SOK

    SEMAN --> M1["重复上下文<br/>跨分区去重<br/>EmbeddingCache 可复用"]
    SEMAN --> M2["无效召回<br/>注意力/LLM-as-judge<br/>代理信号兜底"]
    SEMAN --> M3["固定开销虚高<br/>base/window 比例<br/>最简单"]
    M1 --> GAP["⚠ 缺 partition_breakdown"]
    M2 --> GAP2["⚠ 缺 recall_usage 标记"]
    M3 --> OK["✅ 现在就能算"]

    style SPENT fill:#4f46e5,stroke:#4338ca,color:#fff
    style STRUCT fill:#3b82f6,stroke:#2563eb,color:#fff
    style SEMAN fill:#818cf8,stroke:#6366f1,color:#fff
    style SOK fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style OK fill:#a7f3d0,stroke:#10b981,color:#064e3b
    style GAP fill:#fbbf24,stroke:#d97706,color:#111
    style GAP2 fill:#fbbf24,stroke:#d97706,color:#111
\`\`\`

> 置信度：0.88`,
    l2: `### wasted_tokens 公式的精确剖析

\`\`\`python
# src/context/overflow_sim.py:95-97
self.wasted_tokens = (self.memories_token_before - self.memories_token_after) + max(
    0, self.window_size - self.total_estimated_tokens
)
\`\`\`

第一项 \`before − after\` 是"召回了但被溢出策略丢掉"的 token。注意它只在溢出发生时有意义——没溢出时 before == after，这一项为 0。第二项 \`max(0, window − total)\` 是"窗口没装满"的闲置量。两项都为 0 时 \`wasted_tokens = 0\`，但**这并不代表没有语义浪费**——可能窗口装满了、也没丢东西，但塞进去的 5 条召回有 4 条模型没用。这就是为什么这个字段不能回答本问题。

\`wasted_tokens\` 的设计意图是给溢出沙箱（Lab 页）一个"这个策略浪费了多少"的直观数字——它服务于"策略对比"（[q4.2](#q4.2) 第三层溢出策略），不服务于"语义价值审计"。把它误用成"浪费检测"会得出错误的结论。

### 三类语义浪费的检测算法

**重复上下文（跨分区去重）**

system prompt 里的"你是 AI 助手"、recalled 里的某条记忆、history 里用户刚说的话——三处可能包含相同信息。检测：对每个分区的文本做嵌入，跨分区算余弦相似度，>0.9 的标记为重复。GlassCortex 的 \`EmbeddingCache\`（\`src/cache.py\`，threshold 0.95）已有 FAISS + 嵌入基础设施，复用它做跨分区比对是低成本扩展。但 \`compute_partitions()\` 当前不接收"其他分区文本"作为输入——要加重复检测，需在分区计算时跨 zone 比对 \`items\` 字段。

**无效召回（贡献度追溯）**

最精确的方法是注意力归因——看模型生成 completion 时对 recalled zone 各条记忆的注意力权重。但 DeepSeek/Claude 等闭源 API 不返回注意力。退而求其次的三种代理：

1. **关键词重叠**：召回条目的关键词是否出现在 completion 中。简单但漏报高（隐式引用测不到）。
2. **ablation**：删掉某条召回重跑，看 completion 变多少。精确但成本翻倍（每条召回都要重跑一次）。
3. **LLM-as-judge**：调一次 LLM 问"这条召回对回答贡献多大"。中等成本，中等精度。

\`partition.py\` 的 \`_build_recalled_detail()\` 已经给每条召回维护了 \`kept\` 字段（\`not is_dropped and not is_truncated\`）。要加"是否被引用"，需要在该函数返回后、生成 completion 后回填一个 \`referenced\` 字段——这是数据通路层面的最小改动。

**固定开销虚高（比例阈值）**

\`base_tokens / window_size\`。GlassCortex 的 \`compute_partitions()\` 已经算出 system zone 的 \`percentage\` 字段——直接拿来做阈值判断即可，零额外开发。固定开销 >30% 就该审视 system prompt 能不能瘦身（[q4.2](#q4.2) 第四层 Prompt 精简）。

### 价值 proxy 的根本难题

"浪费"的定义依赖"价值"，但"价值"没有客观度量。所有 proxy 都有偏差：

| Proxy | 偏差方向 |
|-------|---------|
| 召回是否被逐字引用 | 漏报：隐式影响测不到 |
| 用户是否追问 | 误报：追问可能因为回答差，不是因为召回无效 |
| ablation 后回答变化 | 最准但成本不可承受 |
| LLM-as-judge 打分 | 引入另一个 LLM 的偏差 |

这意味着**浪费检测本质上是概率性的**——你能给出"这条召回 80% 概率是浪费"，但给不出"这条绝对浪费"。工程上这够用（标记可疑项供人工复核），但要诚实承认它的不确定性。

> 置信度：0.85`,
    l3: `### 当前行业实践

- **LangSmith Token Efficiency**：LangChain 的可观测平台开始提供"token efficiency"评分——不只是消耗统计，还结合"该次调用是否被下游引用"做效率打分。本质是 L2 运行时信号思路的产品化，但依赖整个链路都在 LangChain 生态内。
- **OpenTelemetry LLM attributes**：OpenLLMetry 给 LLM 调用打 span，token 消耗作为 attribute。但当前标准只记"消耗"，没有"价值"维度——浪费检测留给应用层自己做。
- **向量库的召回质量面板**：Pinecone / Weaviate 提供"召回命中率"和"召回 N 条中实际被用几条"的指标。但"被用几条"需要应用层回传——向量库自己不知道你用了哪条。

### 学术与工程前沿

- **Token-level Provenance（注意力归因）**：一篇 workshop paper「Towards Token-Level Provenance for LLM Outputs」原型实现了"输出第 N 个 token 主要受 input 哪段影响"的追溯。它需要完整的前向传播记录（不能用 KV cache 加速），计算开销巨大。但这是语义浪费检测的**理论终极解**——能精确说出"这条 recalled 记忆对 completion 贡献了 3 个 token"。
- **Context Ablation 评估**：研究中的标准评估方法——逐段删 prompt，看回答质量曲线，找出"删了不影响质量"的段就是浪费段。代价是每段一次重跑，只适合离线评估，无法在线实时检测。
- **Anthropic Context Editing（2025）**：Claude 引入了模型层的"上下文编辑"——系统标注哪些段后续可丢，模型内部维护滑动窗口。这把"浪费检测 + 丢弃"下沉到模型层，应用层不用自己检测。但只对 Claude 生态有效，且模型自己决定丢什么，对应用不透明。

### 未解决的问题

1. **检测成本 vs 节省的悖论**：L3 的 ablation / LLM-as-judge 检测本身要花 token。如果检测一条浪费要花 100 token、而它省下来只有 50 token，检测就是亏的。浪费检测的性价比边界在哪？只有"高浪费 + 高频出现"的模式才值得检测成本。
2. **价值的时间维度**：一条召回这次没用，但下一轮用户追问时恰好需要——它是"本次浪费"还是"预热投资"？浪费判断不能只看单轮，需要跨轮追踪。GlassCortex 当前是单轮分区计算（[q4.3](#q4.3) 未解决问题 2），跨轮价值追踪更远。
3. **重复的语义判定**：跨分区文本"相似"≠"重复"。system prompt 的"你是 AI 助手"和 recalled 里的"用户认为 AI 是助手"——文本相似但语义角色不同，去重会误杀。需要语义级去重而非文本级，成本更高。
4. **浪费检测的闭合回路**：检测出浪费后做什么？自动删？标记供人工审？删错了（其实是隐式有用的）反而降低质量。检测系统需要"删了观察质量、质量降了就恢复"的反馈回路——这已经是自适应上下文管理的范畴，远超当前架构。

> 置信度：0.80`,
  },
  {
    id: "q4.9",
    question: 'Token 与延迟的权衡：压缩消息省了 token 但增加了延迟——值不值？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P2",
    confidence: { l0: 0.9, l1: 0.89, l2: 0.86, l3: 0.83 },
    overallConfidence: 0.83,
    l0: "压缩的净收益需要同时扣减压缩本身的 token 消耗和延迟成本。完整公式：`net_savings = (original_tokens - compressed_tokens) - compression_cost_tokens`。net_savings > 0 说明 token 上赚了，但还不够——如果压缩增加的时间让用户觉得「卡了」，那省下的 ¥0.0015 不值得用 1 秒体验损失换。结论：长消息 + 非实时场景 → 压缩净赚；短消息或实时对话 → 压缩净亏。",
    l1: `你去打包快递。原包装的箱子太大，运费贵——但直接拿去寄，5 分钟搞定。如果你拆开重新打包成小箱——能省运费，但打包花了 15 分钟。问题不是「小箱省了多少运费」，而是「省下的运费值不值你 15 分钟的人工成本」。

AI 消息压缩完全一样：

| 策略 | 做法 | Token 成本 | 延迟 | 适合场景 |
|------|------|:----------:|:----:|---------|
| **不压缩** | 原文直接塞上下文 | 高（原文占窗口） | 低（零额外步骤） | 实时聊天、短消息 |
| **压缩** | LLM 生成摘要替代原文 | 低（摘要占窗口） + 压缩调用成本 | 中（多一个 LLM 调用） | 非实时后台、长历史 |

关键数字：假设原文 1000 token。压缩调用（prompt 150 + 输出 50 = 200 tok）换来 50 tok 摘要——净省 750 tok（约 ¥0.0015），延迟增加 ~1-3 秒。如果是一次后台事实抽取任务，净赚。如果是用户正在盯着屏幕等回复——省下的 ¥0.0015 远不值得让用户觉得「卡了」。`,
    l2: `### 压缩的真实成本结构

GlassCortex 的消息压缩由 \`src/chat/engine.py\` 的 \`compress_message()\` 实现。源码在记录 \`compression_savings\` 的同时已经记录了压缩调用本身的消耗：

\`\`\`python
original_tokens = _estimate_tokens(content)
response = self.client.chat.completions.create(...)  # ← 此处花了 token + 延迟
summary = response.choices[0].message.content
compressed_tokens = _estimate_tokens(summary)

# 两笔记账：一笔压缩调用消耗 + 一笔节省
self._ledger.record("compression",                   # 记压缩消耗
    prompt_tokens=response.usage.prompt_tokens,
    completion_tokens=response.usage.completion_tokens,
)
saved = max(0, original_tokens - compressed_tokens)
self._ledger.record_compression_savings(saved)       # 记毛收益
\`\`\`

这段代码做了两个重要的事：一是用 \`self.client.chat.completions.create()\` 同步调用 LLM 做压缩（压缩在 store_response() 阶段执行，在流式响应开始发送后运行），二是**同时记两笔账**——压缩调用本身的 token 消耗（\`record("compression", ...)\`）和压缩节省的毛收益（\`record_compression_savings\`）。两者在 \`summary()\` 中分开展示，用户可以看到"压缩花了多少"和"压缩省了多少"两个数字。

但两笔账是分开的——账本没有自动计算净收益。完整公式需要用户自行结合两者：

$$\\text{net_savings} = (\\text{original} - \\text{compressed}) - (\\text{compression_prompt} + \\text{compression_output})$$

$$\\text{latency_cost} = \\text{compression_latency} + \\text{extra_ttfb_impact}$$

### 三场景试算

| 场景 | 原文 (tok) | 压缩 prompt | 摘要 (tok) | gross_savings | compression_cost | net_savings | 延迟 | 结论 |
|------|:---------:|:----------:|:---------:|:-------------:|:---------------:|:----------:|:----:|:----:|
| 长消息后台 | 800 | 150+50=200 | 80 | 720 | 200 | **+520 tok** | ~2s | ✅ 值得 |
| 中等聊天 | 400 | 150+50=200 | 60 | 340 | 200 | **+140 tok** | ~2s | ⚠️ TTFB 增加 |
| 短消息硬压 | 120 | 150+50=200 | 40 | 80 | 200 | **-120 tok** | ~2s | ❌ 净亏 |

短消息压缩的 net_savings 是负数——压缩比自己消耗还多。这就是为什么 \`compress_message()\` 有一个隐式阈值：原文太短不压。但即使长消息 net_savings = +520，如果压缩发生在用户等待回复的实时对话中，~2s 的额外延迟直接增加了首 token 到达时间（TTFB）。

### 压缩在管线中的位置——为什么延迟影响格外大

\`compress_message()\` 在聊天管线的哪个阶段执行？在 \`ChatEngine\` 组装 prompt 之后、调用 \`call_llm()\` 之前执行。这意味着压缩延迟**直接推后了用户看到第一个回复字符的时间**（TTFB）——这是用户体验中最敏感的指标之一。

对于流式输出，TTFB 每增加 1 秒，用户感知的「卡顿感」显著上升（[^latency-study]）。1 秒额外延迟 ≈ 30% 用户满意度下降——远高于 ¥0.0015 的 token 节省。

[^latency-study]: 参考 Google 和 Amazon 的研究：搜索延迟每增加 100ms，转化率下降 ~1%。对话 AI 的 TTFB 敏感度更高——用户在等响应时是「零反馈等待」，没有 spinner 以外的任何进度指示。

### 改进方向：动态压缩决策

当前 \`compress_message()\` 没有可配置的延迟容忍参数。一个简单的启发式：

\`\`\`python
def should_compress(content: str, latency_budget_ms: int = 1000) -> bool:
    """判断压缩是否值得。原文太短或延迟预算不足 → 跳过压缩"""
    raw_tokens = _estimate_tokens(content)
    if raw_tokens < 200:          # 短消息：净收益为负
        return False
    # 粗略估算压缩延迟（与原文 token 数正相关）
    estimated_latency_ms = raw_tokens / 100 * 300
    return estimated_latency_ms < latency_budget_ms
\`\`\`

用户可选「极速模式」→ latency_budget_ms = 100 → 几乎跳过所有压缩。「省钱模式」→ latency_budget_ms = 3000 → 长消息随便压。

> 置信度：0.86`,
    l3: `### 自适应压缩策略

**FrugalGPT** 的级联思想同样适用于压缩——不是所有消息都压缩，做有选择性的智能决策：

1. **基于角色**：用户的原始输入 ≈ 高价值 → 尽量不压缩；系统内部推理结果（事实抽取、意图分类）≈ 低价值 → 优先压缩
2. **基于时间位置**：最近 N 轮对话 ≈ 高价值 → 保持原文；早期轮次 ≈ 低价值 → 优先压缩。时间越远的内容，被后续对话「需要」的概率越低
3. **基于内容类型**：含代码/数字/JSON/配置的对话 ≈ 摘要易丢精准信息 → 不压缩或低压缩率；纯叙事/闲聊 ≈ 可大胆压缩

### 压缩的「后悔」困境

这是压缩最深层的问题：**压缩后，下一轮对话恰好需要被压缩掉的那条信息怎么办？**

假设用户第三轮说「这个函数的参数表发我」，第五轮说「那把最大并发数改 32 吧」——第五轮的上下文里，第三轮的「参数表」已经被压缩丢了。模型从摘要里找不到数字，只能猜，可能给了错误的默认值。

当前 GlassCortex 没有处理这个问题——压缩不可逆，原文在压缩后丢失。一个可行的改进是**压缩索引**：

- 压缩时不只保留摘要，还保留原文的关键词向量（而非原文全文）
- 后续检索时，先检查「用户当前问的内容是否涉及被压缩的关键词」
- 如果相关 → 从 SQLite 的对话历史中重新取原文，替换摘要
- 这本质上是**可逆压缩**——不把压缩当作一次性的数据丢失，而是可恢复的临时精简

### 压缩收益可视化

当前压缩的节省通过 \`TokenLedger.record_compression_savings()\` 记录，在成本瀑布图中显示为绿色节省条。但用户看不到**净收益**——不知道压缩本身花了多少 token、省了多少、净赚多少。

一个简单改进：在 \`TokenCostBadge\`（[q4.5](#q4.5)）旁加一个小标签「压缩 ⇄ +520 tok / -2s」——让用户看到「我选择了压缩，换来了 520 token 节省，代价是 2 秒延迟」。透明化的关键不是展示「最优决策」，而是展示**决策的权衡本身**——让用户自己判断值不值。

### GlassCortex 远期方向

- \`compress_message()\` 的隐式阈值 → 可配置的动态压缩策略（角色/时序/内容三信号）
- 压缩延迟预算 → 接入 \`session_params\` 用户偏好
- 压缩索引 → 可恢复压缩（与 SQLite 对话历史联动）
- 收益可视化 → TokenCostBadge 展示净收益而非毛收益

> 置信度：0.83`,
  },
  {
    id: "q4.10",
    question: '输出 token 的"后悔成本"：生成到一半发现方向错了，有没有早期检测机制？',
    chapter: "ch4",
    chapterTitle: "第 4 章：Token 效率",
    priority: "P3",
    confidence: { l0: 0.85, l1: 0.83, l2: 0.78, l3: 0.72 },
    overallConfidence: 0.72,
    l0: '输出 token 的"后悔成本"指模型生成了一段内容后发现方向错了——这段 token 成了沉没成本。早期检测在不增加额外 LLM 调用的前提下，靠对生成 token 流的实时信号分析（logit 幅度骤降、注意力分布偏移、输出分类器实时打分）来做"要不要掐停"的决定。核心困局：全量生成后再检查 → 后悔成本已形成；逐 token 检查 → 检测本身增加了延迟和 token 消耗。解决方案不在模型层（闭源 API 不提供内部状态）而在架构层——级联生成（小模型先出草稿，大模型验证时发现方向不对就提前终止）是目前最实用的工程方案。',
    l1: `你给老板写周报。写到第二段突然意识到——不对，老板这周最关心的是项目进度，你却在写技术选型细节。但你已经写了 500 字了。删掉重写？那 500 字就是沉没成本。不删？那老板读到的第一屏全是废话。

AI 生成回复完全一样。模型开始输出 token，一个接一个地写。写到第 200 个 token 时发现——方向偏了，用户问的是"怎么配置缓存"，模型在回答"缓存的原理"。前面 200 token 就是**后悔成本**：它们是语法正确、语义自洽的，但对用户当前的问题没有价值。

### 后悔成本的构成

后悔成本不是「模型错了」——通常模型生成的内容本身不错，只是**用错了地方**。

\`\`\`
用户问：「这个函数的参数表怎么配？」
模型输出（前 200 token）：
  "缓存是提升系统性能的关键手段。常见的缓存策略包括
   LRU、LFU、FIFO…缓存的核心思想是以空间换时间…"
                         ── 解释缓存的原理（跑题了）

用户想要的答案（应该输出）：
  "Config 接口的参数如下：cache_ttl（默认 300s）、
   max_entries（默认 1000）、eviction_policy…"
                         ── 直接给参数表（用户要的）
\`\`\`

前 200 token 没有语法错误、没有逻辑错误——但它不是用户需要的。用户读到第一行就知道跑题了，但模型要到输出结束时才知道自己跑了多远。

### 后悔成本的三种来源

| 来源 | 描述 | 谁的责任 |
|------|------|---------|
| **意图误判** | Planner 把"配置参数"分类成"解释原理" | 前置意图分类器的精度不够 |
| **检索偏差** | 召回记忆里最相关的文档是原理说明而非配置表 | 检索器的排序策略问题 |
| **生成漂移** | 模型从正确的方向开始生成，写到中间自我发挥跑偏了 | 模型自身的注意力衰减 |

前两种是**生成前**的问题——意图分类和召回做对了，输出就不会跑偏。第三种是**生成过程中**的问题——即使前置工作全对，模型在长文本生成的中后段仍可能偏离方向。

### 当前没有"后悔药"

这是最诚实的部分：**对于闭源 LLM API，没有工程层面的早期检测机制**。你无法在模型生成过程中读取 logit 分布、注意力权重、或 hidden state——API 只给你最终的输出字符串。你能做的全部事情就是：

1. **等它生成完** → 检查是否符合预期 → 不符合就重来（但之前的 token 全浪费了）
2. **在 Prompt 里约束** → 更精确的 system prompt + few-shot 示例 → 降低跑偏概率（这是事前预防，不是事中检测）
3. **缩短生成长度** → max_tokens 设小 → 跑偏的绝对 token 数更少（一刀切，也切了正确的输出）

三种方案没有一种是在"生成过程中发现问题并即时止损"——因为闭源 API 没有暴露这个接口。

\`\`\`mermaid
%% title: 图：输出后悔成本的困境
graph TD
    START["🤖 开始生成"]
    START --> T1["Token 1: 正确方向"]
    T1 --> T2["Token 10: 还在正轨"]
    T2 --> TN["..."]
    TN --> DEV{"方向偏了吗？"}
    DEV -->|"不知道<br/>API 没告诉你"| CONTINUE["继续生成：代价积累"]
    DEV -->|"只能等生成完"| FINISH["生成结束<br/>检查发现偏了"]
    FINISH --> REGRET["😖 后悔成本：全文浪费<br/>重新生成 → 成本 ×2"]
    CONTINUE --> TN

    COST["💰 后悔成本 = 偏离后生成的 token 数<br/>无法提前止损（闭源 API）"]
    REGRET --> COST

    style START fill:#4f46e5,stroke:#4338ca,color:#fff
    style DEV fill:#fbbf24,stroke:#d97706,color:#111
    style CONTINUE fill:#f87171,stroke:#ef4444,color:#7f1d1d
    style FINISH fill:#ef4444,stroke:#dc2626,color:#fff
    style REGRET fill:#991b1b,stroke:#7f1d1d,color:#fca5a5
    style COST fill:#7c3aed,stroke:#6d28d9,color:#e9d5ff
\`\`\`

> 置信度：0.83`,
    l2: `### 早期检测的五条技术路线

虽然闭源 API 不暴露内部状态，但工程层面仍有几条可行的路线。每条路线有自己的成本结构——不存在免费午餐。

#### 路线一：级联生成（Cascade Generation）

最实用的工程方案。**不修改模型的行为，而是修改生成流程的架构**：

1. 小模型（如 DeepSeek-Chat 或本地 7B 模型）先快速生成一段草稿输出
2. 大模型（如 DeepSeek-Reasoner）不重新生成，而是**验证草稿并对齐方向**
3. 如果大模型在验证时发现草稿偏了——不继续验证，立即触发小模型重新生成

\`\`\`python
class CascadeGenerator:
    """级联生成器：小模型草稿 → 大模型验证"""

    async def generate(self, prompt: str) -> str:
        # 阶段 1：小模型快速出草稿（低延迟、低成本）
        draft = await self.fast_model.generate(prompt, max_tokens=128)

        # 阶段 2：大模型验证草稿方向是否正确
        # 只用少量 token 就发现"方向偏了"
        verdict = await self.powerful_model.verify(prompt, draft)

        if verdict.is_aligned:
            # 方向一致 → 继续用大模型完成生成（基于草稿继续）
            return await self.powerful_model.complete(prompt, draft)
        else:
            # 方向偏了 → 在浪费少量 token 时就止损
            # 代价：128 tok（草稿）+ ~100 tok（验证）= ~228 tok
            # 对比：直接生成 2000 tok 全浪费
            return await self.regenerate(prompt, verdict.correction_hint)
\`\`\`

**成本对比**：级联方案中，方向偏了的"后悔成本"固定在小模型草稿长度（如 128 token），远小于直接生成 2000 token 后发现偏了的全部浪费。级联的额外代价是"验证"本身消耗的 token——每次生成都多一次小规模验证调用，即使方向完全正确。

#### 路线二：输出流分类器（Stream Classifier）

专用于实时对话。在生成过程中，把已输出的内容分段喂给一个**轻量分类器**做实时判断："当前生成的这段是否偏离了用户的原始问题？"

\`\`\`
每生成 ~50 token 触发一次分类判断：
  用户问题: "如何配置缓存参数"
  已生成长度: 150 token
  当前片段: "缓存策略包括 LRU（最近最少使用）、
            LFU（最不经常使用）…"
  分类结果: 🟢 高度相关（正在介绍相关概念）
  动作: 继续生成

--- 50 token 后 ---
  当前片段: "布隆过滤器的原理是使用多个哈希函数…"
  分类结果: 🟡 中度相关（从缓存延伸到过滤器，略有偏离）
  动作: 发出方向提醒（注入到 system prompt）

--- 又 50 token 后 ---
  当前片段: "数据库索引的 B+ 树结构…"
  分类结果: 🔴 偏离（从缓存跳到数据库索引，远了）
  动作: 掐停当前生成，触发重新生成指令
\`\`\`

**分类器的 token 成本**：假设每次分类调用消耗 30 token（用简单模型打分），每 50 token 触一次——如果生成总共 1000 token，分类附加成本 = 20 次 × 30 tok = 600 token，占总 token 的 60%。如果模型大部分时候方向正确（不触发重生成），这 600 token 就是纯额外开销——比后悔成本本身还大。

#### 路线三：Logit 置信度监测（仅限本地/开源模型）

如果你能访问模型的 logit 输出（本地部署或开源模型），可以实时监测生成 token 的置信度曲线：

- **正常方向**：每个生成 token 的 logit 概率分布集中，最高概率 token 的置信度相对稳定
- **方向漂移信号**：logit 分布突然变平（最高概率 token 的置信度骤降）→ 模型在多个方向间犹豫 → 可能是生成的"岔路口"
- **重复信号**：logit 中高概率 token 开始出现重复模式 → 模型陷入循环或已经偏离了原始上下文

这个方法**对闭源 API 不适用**——OpenAI、Anthropic、DeepSeek 的 API 都不返回生成过程中的 logits。但如果在本地部署 LLaMA/Mistral/Qwen 等模型，这是一个有效的早期预警信号。

#### 路线四：自一致性检查（Self-Consistency）

不实时检测，而是**并行生成多个候选回复，选择最自洽的一个**：

1. 对同一个 prompt，调用 N 次（N=3~5），每次 temperature > 0，得到 N 个候选回复
2. 计算候选回复之间的语义相似度（cosine similarity on embeddings）
3. 相似度高的簇 → 模型对方向有共识 → 大概率方向正确
4. 离群回复 → 模型的一次"跑偏"尝试 → 丢弃

**成本结构**：N=3 意味着 3 倍的生成 token 消耗。这不是"节省 token"的方案——它是"用 token 换准确度"的方案。适用于高 precision 场景（如法律/医疗回复），不适用于日常聊天。

#### 路线五：压缩的前向验证

结合 [q4.9](#q4.9) 的压缩机制——方向偏了的生成内容被压缩后，对比用户的问题做相关度打分，如果相关度低于阈值则触发重生成。

这是 GlassCortex 的 TokenLedger 体系中**唯一可以零额外代码注入的早期检测方案**——因为压缩和记账机制已经存在，只需要加一个"压缩后的摘要与用户问题的相关度阈值检查"。

\`\`\`
生成结束 → compress_message() 压缩 → 压缩摘要 × user_question → 语义相似度
  相似度 > 0.6 → ✅ 方向正确，保留
  相似度 0.3 ~ 0.6 → ⚠️ 可能偏了，标记为"低置信度回复"
  相似度 < 0.3 → 🔴 确定偏了，触发重新生成
\`\`\`

但注意，这个方案是**事后检测**——生成已经完成，token 已经花了。它只在"触发重生成"时起作用——下一次生成的方向可能更准，但这次已生成的 token 已经成了后悔成本。

### 三种策略的成本对比

| 策略 | 检测时机 | 后悔成本 | 检测附加成本 | 适合场景 |
|------|---------|:--------:|:-----------:|---------|
| 级联生成 | 草稿后 | 小模型草稿长度 | 小模型草稿 + 验证调用 | 大部分场景，平衡性最好 |
| 输出流分类器 | 实时（每 N token） | 低（5-50 token） | 高（每 N tok 一次分类） | 实时对话，对方向敏感 |
| Logit 监测 | 逐 token | 极低（1 token） | 零（本地信号读取） | 开源/本地模型 |
| 自一致性 | 生成后 | 高（一次完整生成） | 极高（N 倍消耗） | 高 precision 场景 |
| 压缩验证 | 生成后 | 高（一次完整生成） | 低（复用已有压缩） | GlassCortex 当前可做 |

> 关键结论：**对于闭源 API 用户，目前没有真正的"早期检测机制"**。所有方案要么在"检测"发生之前已经有大量的 token 被生成（后悔成本已形成），要么检测本身的 token 开销超过了后悔成本本身。级联生成是目前最务实的折中——小模型的草稿 token 虽也浪费，但远小于大模型直接跑偏的代价。

> 置信度：0.78`,
    l3: `### 当前行业实践

**Speculative Decoding（推测解码）**是目前最接近"早期检测"的主流技术。小模型生成候选 token 序列，大模型并行验证。如果大模型发现候选序列中有错（拒绝 token），序列从这里截断，小模型从这个位置重新生成。Google 的 Medusa 和 DeepMind 的 Blockwise Decoding 都基于此原理。

关键联系：**推测解码的"拒绝"信号本质上就是早期检测**——大模型在验证候选序列的前几个 token 时发现方向不对，立即拒绝整个草稿。但推测解码的设计目标是**加速**（并行验证替代串行生成），"方向检测"只是它的副产品。

**Cascade LLM**（Self-Refine / Reflexion 等）实现了一种更粗粒度的早期检测：生成完整回复后，LLM 对回复做自我批评（self-critique），检测到方向偏差后重新生成。这不是 token 级的早期检测，但它是**不依赖模型内部状态、仅用 LLM 自身能力的实用方案**。

**Anthropic 的 Citation Grounding（2025）**：Claude 在回答中标注"这段话的依据是用户提供的第 X 段内容"。如果模型在生成中发现无法引用到可靠的来源来支持当前的方向——这本身就是一个"方向偏离"的隐式信号。虽然不是早期检测接口，但它是**答案可溯源性的副产品**——可追问性越好，方向偏离越容易被发现（不仅是模型发现，用户也能发现）。

### 为什么大模型厂商不提供早期检测接口

这是个值得思考的问题。如果 API 提供一个 \`stream_logits: true\` 参数，让用户实时看到每个输出 token 的 logit 分布——这不是可以自己做"方向偏离检测"了吗？

几个原因：

1. **商业原因**：API 的产品粒度是"文本"，不是"模型状态"。暴露 logits 意味着暴露模型的内部分布，可能被用于模型窃取（通过 logit 分布反推知识蒸馏的数据）。
2. **技术原因**：logit 分布的数据量巨大——词表 128K 个 token 的 logit 向量，每个 token 返回一次，生成 1000 token 就要传 128K × 1000 个浮点数。带宽和延迟成本远超过"早期检测"节省的 token。
3. **归因困难**：logit 分布能告诉你"模型在犹豫"，但不能告诉你"方向偏了"。方向偏离是一个**语义层面的判断**，不是概率层面的信号。概率低可能是模型知识不足（正常），也可能是方向偏了（异常）——区分两者需要额外的语义分析层，这回到了"分类器也要花 token"的困境。

### 学术前沿

**Early Exit in LLMs**：Transformer 模型的某些层已经具备了决策能力。研究表明，对于简单推理（如实体识别），模型在前几层就能得到正确答案——不需要跑完所有层。Early Exit 架构在模型出口处部署分类器，判断"当前层的输出是否足够好"，如果是则提前终止生成，节省后续层的计算量。这是 token 效率的一个独立方向——省的是推理计算 token 而非 API token——但对于本地部署的场景有直接的 token 节省意义。

**Stop-and-Refine**：一个简单的两阶段框架——模型每生成 $\Delta$ token 后暂停，对已生成的片段做一次快速语义检查。如果发现偏离立即修正（回滚到分歧点），否则继续。这与 GlassCortex 的 \`compress_message()\` 有异曲同工之处——都是把"实时检查"嵌入到生成管线中。区别在于 Stop-and-Refine 是模型本身来检查（需要本地部署或高性能 API），而 GlassCortex 可以做轻量级分类器来做（依赖已嵌入的压缩/记忆召回管道）。

**Contrastive Decoding**：用两个模型（大模型 + 小模型）同时生成，取 logit 差异作为最终输出。差异大 = 小模型不确定但大模型确定 → "难但正确的方向"；差异小且 logit 绝对置信度低 → "两个模型都不确定 → 方向可能偏了"。这本质上是用双模型结构替代了单一的"置信度"信号——不需要暴露单个模型的内部状态，只需要两个模型的不一致性。

### GlassCortex 远期方向

对于 GlassCortex 当前使用的 DeepSeek API（闭源，无 streaming logit 支持）：

1. **当前无任何早期检测机制**——这是诚实的现状。项目使用 \`max_tokens\` 做硬上限防止无限输出，用意图分类（Planner）降低方向偏离的概率，但生成过程中没有检测。
2. **可做的第一步——事后后悔成本量化**：在 \`TokenLedger\` 中增加一个 "regret" 字段，记录那些被用户追问"不对，你答错了"后重新生成所浪费的 token。先量化后悔成本有多大，再决定值得投入多少工程资源去做早期检测。
3. **可做的第二步——级联生成**：利用现有的 Planner 意图信号（chat/plan/extract/copy），对高 precision 要求的任务（plan/extract）优先使用小模型草稿 + 大模型验证的级联模式。
4. **远期——可逆生成**：最理想的方案不是"检测到偏离就掐停"，而是"检测到偏离，回滚到分歧点，从那里继续"。这需要保存生成过程中的关键中间状态（类似 K-V cache 的 checkpoint），目前没有已知的闭源 API 实现。

> 后悔成本的终极解法不是"早期检测"，而是"不后悔"——如果模型从一开始就更准确地理解用户的意图、更精确地遵循输出格式、更一致地保持回答方向。这些是 Prompt 工程、RAG 质量和模型选择的问题，不是 token 效率的问题。**后悔成本只是症状，病因在生成之前的环节。** 归因到正确的环节再去优化，比在输出管线里兜底更高效。

> 置信度：0.72`,
  },
];