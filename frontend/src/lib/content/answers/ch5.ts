import type { Answer } from "../types";

/** 第 5 章：层间交互 答案列表 */
export const CH5_ANSWERS: Answer[] = [
  // ── q5.1 — 召回错了上下文层能感知吗 ──
  {
    id: "q5.1",
    question: "记忆召回的结果直接决定上下文的内容——如果召回错了，上下文层能不能感知？",
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P3",
    confidence: { l0: 0.88, l1: 0.85, l2: 0.82, l3: 0.78 },
    overallConfidence: 0.78,
    l0: '上下文层能感知的是**记忆召回的"量"问题**（溢出、截断、去重排除），不能感知的是**"质"问题**（召回结果语义不相关、事实错误）。具体来说：`OverflowSimResult.dropped_items`（溢出模拟）和 `RegretAnalysis`（召回遗憾分析）告诉上下文层「什么东西被扔掉了」，但不告诉它「扔掉的应该留下、留下的其实是错的」。上下文层不是一个质量审查者——它是一个空间管理员。',
    l1: `你去一家餐厅点了一份"干锅牛蛙"。后厨的配菜员（记忆层）从冷库里翻出食材，交给炒锅师傅（上下文层）。炒锅师傅只看"东西够不够放"——如果案板太小（上下文窗口），他会把一些食材退回冷柜。但他**不会**尝一口牛肉是不是变质了，也不会检查拿来的到底是牛蛙还是田鸡。

这就是上下文层对召回结果的感知能力——**它是容量警察，不是质检员。**

### 上下文层能做什么

\`ChatEngine._build_system_prompt()\`（[engine.py:76](/src/chat/engine.py)）是上下文层的入口。它接收 \`recalled: list[dict[str, object]]\`——这是记忆层递过来的原始食材。接着它调用 \`simulate_overflow()\`（[overflow_sim.py:90](/src/context/overflow_sim.py)），输出的 \`OverflowSimResult\` 包含：

\`\`\`
我：
  overflow_triggered: bool     → 食材太多放不下了吗？
  dropped_count: int           → 扔掉了多少？
  dropped_items: list[str]     → 具体扔掉的是什么？
  usage_pct: float             → 案板用了百分之多少？
\`\`\`

这些信息被塞进 \`ContextMeta\` 的字段（[schemas.py:62](/api/schemas.py)），带回给调用方。所以上下文层能回答：「东西太多了，我扔掉了 3 条记忆」。这很有用——但这是"量"的信号，不是"质"的信号。

### 记忆层自己还藏着一份"遗憾报告"

\`RecallEngine.recall()\`（[recall.py:42](/src/memory/recall.py)）在退出前会记录一份 \`RegretAnalysis\`（[recall.py:131](/src/memory/recall.py)），放在 \`self.last_regret\`：

\`\`\`
RegretAnalysis:
  deduped: list[dict]      → 语义去重移除的候选
  mmr_dropped: list[dict]  → MMR 多样性重排丢弃的
  truncated: list[dict]    → 分数阈值截断丢弃的
\`\`\`

这份报告说「我本来还考虑过哪些东西，但最终没选它们」。这是一个**半透明信号**：它告诉外界「排除过 X 和 Y」，但没有量化的置信度——没有「选出来的可能只有 60% 相关」这样的信号。

### 上下文层不能做什么

两件关键的事上下文层做不了：

1. **感知召回缺失**：如果相关的记忆存在于数据库中但 FAISS 没搜到（embedding 偏差、top_k 太小），上下文中根本不会有它的痕迹——没有"缺席证据"。
2. **感知召回噪音**：如果召回回来的 5 条记忆有 3 条与当前话题无关（FAISS 语义接近但实际无关），上下文层照单全收——因为它只看数量，不看每一条是否真的"属于这里"。

\`\`\`mermaid
%% title: 图：上下文层能感知 vs 不能感知的召回问题
graph LR
    subgraph 感知不到的["❌ 上下文层感知不到的"]
        MISSING["召回缺失<br/>数据库有但 FAISS 没搜到"]
        NOISE["召回噪音<br/>搜到的内容其实不相关"]
        WRONG["事实错误<br/>记忆内容本身是错的"]
    end
    subgraph 能感知的["✅ 上下文层能感知的"]
        TRUNCATE["溢出截断<br/>太多放不下"]
        DEDUP["去重排除<br/>两条太相似的被合并"]
        REGRET["MMR 丢弃<br/>多样性排重掉了"]
    end
    MEMORY["记忆层 RecallEngine.recall()"] --> RECALLED["recalled: list[dict]"]
    RECALLED --> OVERFLOW{"simulate_overflow()<br/>空间够吗？"}
    OVERFLOW -->|"能感知: 量"| CONTEXT_OK["上下文层知道丢了多少"]
    CONTEXT_OK --> BUILDER["_build_system_prompt()<br/>组装最终 Prompt"]
    MEMORY -.->|"半透明<br/>last_regret"| REGRET_SIGNAL["遗憾报告：曾考虑过但没选"]
    MISSING -.->|"无信号"| SILENCE["静默——系统不知道"]
    style MEMORY fill:#e2e8f0,stroke:#64748b
    style CONTEXT_OK fill:#bbf7d0,stroke:#16a34a
    style MISSING fill:#fecaca,stroke:#dc2626
    style NOISE fill:#fecaca,stroke:#dc2626
    style WRONG fill:#fecaca,stroke:#dc2626
    style TRUNCATE fill:#bbf7d0,stroke:#16a34a
    style DEDUP fill:#bbf7d0,stroke:#16a34a
    style REGRET fill:#fef9c3,stroke:#ca8a04
\`\`\`

> 置信度：0.85`,
    l2: `### 逐层拆解：信号在哪，缺口在哪

#### 信号 1：溢出模拟（最强信号）

\`simulate_overflow()\`（[overflow_sim.py:108](/src/context/overflow_sim.py)）是上下文层最强的情报源。它的输入是 \`recalled\` 列表和窗口大小，输出是 \`OverflowSimResult\`：

\`\`\`python
@dataclass
class OverflowSimResult:
    strategy: str
    window_size: int
    memories_before: int       # 召回了几条
    memories_token_before: int  # 预计占多少 token
    memories_after: int         # 溢出处理后剩几条
    dropped_count: int          # 丢了几条
    dropped_items: list[str]   # 丢的是什么（内容摘要）
    overflow_triggered: bool    # 触发了溢出吗？
    usage_pct: float            # 窗口用了百分之多少
\`\`\`

当 \`overflow_triggered = True\`，上下文层确切地知道「因为空间不够，我放弃了一些记忆」。\`dropped_items\` 甚至列出了放弃的内容。这是一个**精确的容量感知信号**——上下文层知道「量」出问题了。

但注意：\`dropped_count > 0\` **不代表召回错了**——它只代表召回的结果超出了窗口容量。这可能意味着记忆层做对了（召回了很多相关记忆），只是窗口太小了。

#### 信号 2：遗憾分析（半透明信号）

\`RecallEngine.recall()\` 在返回结果前调用 \`analyze_regret()\`（[recall.py:215](/src/memory/recall.py)）：

\`\`\`python
def analyze_regret(
    deduped: list[dict],      # 语义去重移除的
    mmr_dropped: list[dict],  # MMR 多样性丢弃的
    truncated: list[dict],    # 分数阈值截断的
) -> RegretAnalysis:
\`\`\`

这个函数合并三种排除来源。注意它**不是**在上下文层中调用的——它属于记忆层。遗憾报告存在 \`RecallEngine.last_regret\` 中，但上下文层（\`_build_system_prompt()\`）**并不读取它**。两者之间没有打通。

这意味着：
- 记忆层知道「我排除了 X，因为 Y」——但上下文层不知道
- 上下文层知道「我丢掉了 Z，因为空间不够」——但不知道丢的 Z 和记忆层排除的 X 是不是同一回事
- 两个"排除"发生在不同阶段，各自独立记录，彼此不通信

| 排除类型 | 发生在哪 | 谁会知道 | 传递到上下文层？ |
|---------|---------|---------|:--------------:|
| 语义去重剔除 | RecallEngine.recall() 内 | recall.last_dedup_result | ❌ |
| MMR 多样性丢弃 | RecallEngine.recall() 内 | recall.last_regret | ❌ |
| 分数阈值截断 | apply_truncation() | recall.last_regret.truncated | ❌ |
| 溢出丢弃 | simulate_overflow() | OverflowSimResult.dropped_items | ✅ 通过 ContextMeta |

**这就是层间通信的缺口**：记忆层有情报，上下文层有行动，但情报和行动之间没有打通。

#### 信号 3：无信号时长的静默失败（最大缺口）

最危险的场景不是上面的任何一种，而是**召回返回空结果**时的行为：

\`\`\`python
# recall.py:53-56
if not candidates:
    self.last_dedup_result = DedupResult()
    self.last_regret = RegretAnalysis()
    return []   # ← 返回空列表
\`\`\`

\`recall()\` 返回空列表。这个空列表被送到 \`_build_system_prompt()\`：

\`\`\`python
# engine.py:98-115
if not recalled:   # ← 走了这个分支
    prompt = f"{base_header}你正在和一个真实用户对话。..."
    return prompt, {
        "memories_before": 0,
        "memories_after": 0,
        ...
    }
\`\`\`

上下文层看到 \`memories_before = 0\`，不做任何特殊处理——直接返回一个"没有记忆的基础 prompt"。**调用方（\`POST /chat\` 端点）不知道这是"正常（用户首次对话）"还是"异常（FAISS 搜索全空）"**。

如果你的知识库里已经存了 500 条记忆，但因为你问的问题 embedding 偏了导致 FAISS 返回 0 条——系统就像失忆了一样，而且不会告诉你「我刚才失忆了」。

#### 信号 4：API 层面的硬错误

有一个场景上下文层会直接罢工：召回本身抛异常（如 FAISS 索引损坏、数据库连接失败）。这时 \`POST /chat\` 步骤 2（[chat.py:66](/api/routers/chat.py)）直接报 HTTP 500：

\`\`\`python
except Exception as exc:
    raise HTTPException(status_code=500, detail=f"Recall failed: {exc}")
\`\`\`

这是最粗暴的检测——系统崩溃了，你不可能不知道。但请注意这是"API 层"检测到的，不是"上下文层"检测到的。上下文层根本就没有收到数据的机会。

### 小结：三个感知层次

| 感知层次 | 检测能力 | 信号载体 | 当前状态 |
|---------|---------|---------|:-------:|
| 第一层：溢出感知 | 知道记忆太多放不下 | OverflowSimResult → ContextMeta | ✅ 已实现 |
| 第二层：遗憾感知 | 知道排除过哪些候选 | RegretAnalysis（存于记忆层） | 🟡 存在但未跨层传递 |
| 第三层：质量感知 | 知道召回的结果对不对 | ❌ 不存在 | ❌ 未实现 |

> 置信度：0.82`,
    l3: `### 当前行业实践

**RAGAS 评估框架**是当前最成熟的召回质量评估开源工具。它定义了三个核心指标：

- **Context Precision**：召回的结果中有多少是真正相关的（精确率）
- **Context Recall**：所有相关的结果中有多少被召回了（召回率）
- **Faithfulness**：生成回复是否忠实于召回结果（避免幻觉）

这三个指标需要**人工标注或 LLM-as-Judge** 来评估——不能自动、实时地在生产管线中运行。所以目前 RAG 系统的"召回质量感知"几乎都是离线评估的，做不到在线自检。

**TruLens**（TruEra）走得更远：它给每条 pipeline 生成一个"反馈分数"——用另一个 LLM 来评估召回结果的 relevance。但这引入了一个新问题：**谁能保证评估 LLM 的召回是对的？** 这是一个无穷递归。

**Google 的 ReAR（Re-ranker with Attributable Responsibility）** 尝试在检索阶段就做可归因的质量控制：每个召回项不仅要打分，还要给出"这个结果为什么相关"的可解释归因链。这至少让上下文层可以检查归因的合理性——不是盲信分数。

### GlassCortex 的缺口与路径

当前系统的缺口不在于「能不能感知」，而在于**感知结果没有数据通路传给可能做决策的系统**。

具体地：
- \`RegretAnalysis\` 存在但只有 \`RecallEngine.last_regret\` 这个属性——上层没有直接读取的 API
- \`OverflowSimResult\` 通过 \`ContextMeta\` 传上去了，但它只包含"溢出丢弃"信号，不包括"去重/MMR/截断排除"信号
- 两个排除信号（记忆层的"因"、上下文层的"果"）从来没有合并过

一个实用的改进路径：
1. 把 \`RegretAnalysis\` 序列化后附加到 \`ContextMeta\` 中（用 extra="allow" 即可）
2. 在 \`ContextMeta\` 增加 \`recall_raw_count\`（FAISS 原始返回数）和 \`recall_used_count\`（最终进入 Prompt 的数）——当比值显著大于 1 时，可能是召回质量出问题了
3. 在上下文层统计连续"空召回"次数——如果之前 10 轮对话每轮都有记忆，突然连续 3 轮都说"没记起什么"，触发告警

这不会让上下文层变成质检员。但它会让上下文层从「只知道数量」变成「知道数量和变化趋势」——后者是感知质量的起点。

### 更深的追问

如果上下文层真的能感知「召回错了」——它应该做什么？中断回复？告警？重新召回？目前整个系统都没有"重试"机制：\`recall()\` 走一次，好的坏的都用到底。如果上下文层感知到质量下降，它的语义应该是「请求记忆层重新搜索一次」，而不是「默默把次品塞进 Prompt」。

这是层间交互的反向通路——不是记忆层→上下文层的单向数据流，而是上下文层→记忆层的反馈请求。目前这个反馈通路不存在。

> 置信度：0.78`,
  },
  // ── q5.2 — 子对话记忆管理 ──
  {
    id: "q5.2",
    question: "子对话的记忆怎么管理？是作为独立 episode 还是附属于父任务？",
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P3",
    confidence: { l0: 0.88, l1: 0.85, l2: 0.80, l3: 0.75 },
    overallConfidence: 0.75,
    l0: 'GlassCortex 没有子对话概念——所有对话在平坦的 event loop 中运行，episode 存储没有层级结构（`episodes` 表不含 `parent_id` 字段），Planner 生成的子任务（`SubTaskSchema`）执行完成后产生的记忆不会标记"属于哪个父任务"。当前系统采用**隐式软关联**策略：同一 `session_id` 下产生的 episode 天然"共享一个对话空间"，但没有显式的父子关系。如果要支持子对话，推荐**独立 episode + 父指针**模式——子对话有自己的 episode ID，通过 `parent_id` 链接回父任务。',
    l1: `你在图书馆做课题研究。你在桌上摊开三本书（三个子任务）——每本书里你都夹了便签（子任务的记忆）。问题来了：这些便签是该留在对应的书里（附属于父任务），还是统一贴到你的笔记本上（独立记录但标注来源）？

GlassCortex 当前的做法是：**不管你看的什么书，所有便签都贴在同一本笔记本上**——顺序排列，一本接一本，没有书签告诉你哪条笔记是从哪本书摘出来的。

### 为什么子对话的记忆是个问题

当前 \`MemoryStore.add_episode()\`（[store.py:122](/src/memory/store.py)）的签名：

\`\`\`python
def add_episode(
    self,
    content: str,
    importance: float = settings.default_importance,
    decay_lambda: float = settings.default_decay_lambda,
    faiss_id: int | None = None,
) -> int:
\`\`\`

没有 \`parent_id\`、没有 \`session_id\`、没有 \`task_id\`。episode 记录自己的内容（\`content\`）、重要性（\`importance\`）、衰减率（\`lambda\`），但**不记录自己属于哪个上下文**。调用方 \`ChatEngine._store_episode()\`（[engine.py](/src/chat/engine.py)）在每次用户交互后调用它——新 episode 追加到列表末尾，没有任何层级关系。

### Planner 产生子任务，但记忆不跟随

Planner 的 \`POST /planner/generate-plan\`（[planner.py](/api/routers/planner.py)）可以生成一个结构化的任务计划：

\`\`\`python
class PlanGenerateResponse(BaseModel):
    subtasks: list[SubTaskSchema]      # [{"id": "1", "description": "...", "depends_on": []}, ...]
    dag_edges: list[list[str]]         # [["1", "2"], ...]  依赖关系
    rationale: str
    confidence: float
\`\`\`

\`SubTaskSchema\`（[schemas.py:453](/api/schemas.py)）包含子任务的 id、描述、前置依赖列表。这个计划会被返回给前端展示，但后续的对话（子任务的执行过程）产生的 episode 不会带上 \`subtask_id\` 或 \`parent_task_id\`。Planner 的记忆层和 ChatEngine 的记忆层之间没有任何结构性链接——它们共享同一个 \`episodes\` 表，但看不出哪些 episode 属于"哪个任务上下文"。

### 三条可能的路径

| 策略 | 做法 | 当前状态 | 代价 |
|------|------|:--------:|:----:|
| 平坦存储（无归属） | 所有 episode 混在一起，通过语义搜索定位 | ✅ 当前实现 | 无法按任务维度过滤/查询 |
| 隐式归属（session_id 软关联） | episode 不显式标记，但同一 session 内的天然归为一组 | 🟡 部分（pipeline_trace 有 session_id，episode 没有） | session 可能跨越多个任务 |
| 显式归属（parent_id） | episode 增加 parent_id 字段，子任务记忆可追溯 | ❌ 未实现 | 字段开销 + 查询复杂度 |

> 置信度：0.85`,
    l2: `### 深入分析：三种层级的记忆归属

#### 层级 0：无归属（当前状态）

\`episodes\` 表的列定义：

\`\`\`
id | content | importance | lambda | faiss_id | timestamp
\`\`\`

没有 \`session_id\`、\`task_id\`、\`parent_id\`。每次 \`add_episode()\` 追加一行——你无法回答"这条记忆是哪个子任务的产出"。

影响面：
- \`RecallEngine.recall()\`（[recall.py:42](/src/memory/recall.py)）用 query embedding 做 FAISS 搜索——搜到的 episode 按分数排序。如果用户同时进行两个子任务（A 和 B），任务 A 的查询可能会搜到任务 B 产生的记忆，因为两者在向量空间中接近
- 没有过滤条件，召回结果可能混入不属于当前任务上下文的 episode
- 用户说"忘了刚才那个子任务的事吧"——系统无法"选择性遗忘"某个子任务的记忆

#### 层级 1：隐式归属（session_id 软关联）

\`pipeline_trace\` 表已经有 \`session_id\`：

\`\`\`sql
CREATE TABLE pipeline_trace (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    elapsed_ms REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);
\`\`\`

如果 \`episodes\` 表也增加 \`session_id\`，就可以做到：
- 按 session 过滤记忆召回
- 同一 session 内的 episode 天然组合
- 新 session 开始时"清空"上一 session 的干扰

但 \`session_id\` 的粒度太粗——单次对话 session 可能包含多个子任务。用户可能在一个 session 中先后"查资料"、"写总结"、"翻译段落"——这三个子任务混在同一个 session_id 下，依然无法区分。

#### 层级 2：显式归属（parent_id / task_id）

这是最灵活的方案 —— 在 \`episodes\` 表中增加一个可空字段：

\`\`\`python
# 当前 add_episode() 签名
def add_episode(self, content, importance, lambda, faiss_id) -> int:

# 理想签名
def add_episode(
    self,
    content: str,
    importance: float,
    decay_lambda: float,
    faiss_id: int | None = None,
    task_id: str | None = None,       # ← 新增：Planner 的子任务 ID
    parent_id: int | None = None,     # ← 新增：父 episode ID（子对话引用）
) -> int:
\`\`\`

两个新增字段用途不同：
- \`task_id\`：映射到 \`SubTaskSchema.id\`。用于查询"执行这个子任务产生了哪些记忆"。
- \`parent_id\`：指向父 episode ID。用于子对话场景——子对话产生的 episode 通过 \`parent_id\` 链接到触发子对话的那条消息的 episode。

\`\`\`mermaid
%% title: 图：平坦存储 vs 层级存储对比
flowchart LR
    subgraph 当前["❌ 当前：平坦存储"]
        E1["episode: 用户说 '查天气'"]
        E2["episode: 子任务1 查北京天气"]
        E3["episode: 子任务1 返回结果"]
        E4["episode: 用户说 '再查上海'"]
        E5["episode: 子任务2 查上海天气"]
        E1 --- E2 --- E3 --- E4 --- E5
    end
    subgraph 理想["✅ 理想：层级存储"]
        P1["episode: 用户说 '查天气'"] -->|"children"| T1["子任务1：查北京"]
        P1 -->|"children"| T2["子任务2：查上海"]
        T1 --> E1_1["episode: FAISS 搜索北京"]
        T1 --> E1_2["episode: LLM 组装回复"]
        T2 --> E2_1["episode: FAISS 搜索上海"]
        T2 --> E2_2["episode: LLM 组装回复"]
    end
    style E1 fill:#fecaca,stroke:#dc2626
    style E2 fill:#fecaca,stroke:#dc2626
    style E3 fill:#fecaca,stroke:#dc2626
    style P1 fill:#bbf7d0,stroke:#16a34a
    style T1 fill:#fef9c3,stroke:#ca8a04
    style T2 fill:#fef9c3,stroke:#ca8a04
\`\`\`

### 一个隐性问题：召回时的层级感知

即使增加了层级字段，另一个问题随之而来：**召回时，子任务的记忆应该只搜子任务的、还是包括父任务的？**

假设用户正在执行子任务 A（查北京天气），FAISS 搜索 query 是"北京天气"。如果系统搜到了另一条 episode——用户上周在同一 session 里查上海天气的记录（子任务 B 的记忆）——应该返回吗？

- 如果严格按 \`task_id\` 过滤，可能错过相关背景
- 如果不按 \`task_id\` 过滤，不同子任务的记忆混杂

没有一个绝对正确的答案——取决于用户意图。这就回到了 q5.1 的问题：上下文层不知道"召回的跨任务记忆是有意的还是意外的"。层级归属提供了**结构化过滤的能力**，但不解决**语义相关性判断**的问题。

> 置信度：0.80`,
    l3: `### 当前行业实践

**OpenAI 的 Threads（Assistants API）** 是目前最成熟的子对话记忆管理方案。每个 Thread 是一个独立的对话上下文，消息属于某个 Thread，Thread 可以通过 \`tool_call\` 触发子 Thread（Function Calling 的嵌套调用）。每个 Thread 的记忆是**完全隔离的**——子 Thread 看不到父 Thread 的历史，父 Thread 也看不到子 Thread 的内部步骤。这是"独立 episode"模式的极端版本：不仅隔离存储，还隔离上下文窗口。

**LangGraph** 提供了更灵活的层级管理：节点（Node）是计算单元，边（Edge）定义状态流向。每个节点可以有自己的"记忆状态"，通过 \`StateGraph\` 的 \`state\` 参数传递。节点结束后，其状态可以选择"合并到全局状态"或"丢弃"。这相当于给了开发者选择"独立 episode（不合并）"还是"附属于父任务（合并）"的能力。

**Anthropic's Contextual Retrieval** 采取了另一种思路：不为记忆建立层级结构，而是在每条记忆写入时用 LLM 生成一段"为什么这条记忆会被需要"的上下文说明（Provenance）。召回时靠这段说明来判断记忆是否属于当前上下文——而不是靠字段过滤。这是从"结构解决"转向"语义解决"。

### GlassCortex 的改进方向

一个务实的演进路径（不破坏现有平坦结构）：

1. **第一步：episodes 表增加 \`session_id\`**。最小的侵入改动——复用已有的 session 生命周期。代价最低，收益可见：召回时可以按 session 过滤减少干扰。
2. **第二步：增加 \`task_id\` 字段**。待 Planner 的子任务能力稳定后（当前 \`generate-plan\` 只返回计划但不跟踪执行），在 episode 写入时通过 \`ChatEngine._store_episode()\` 传递当前活跃子任务的 ID。
3. **第三步：增加 \`parent_id\` 支持子对话**。只在显式创建子对话的场景下使用——比如用户说"帮我查一下具体细节"触发子对话时。子对话的起始 episode 带上 \`parent_id\`。

三步都是向后兼容的——现有 episode 的 \`session_id\`/ \`task_id\`/ \`parent_id\` 为 NULL，不影响已存储数据的读取和召回。

但一个更深的思考：**记忆归属问题本质上不是存储问题，是召回策略问题**。存储上标记了父子关系，但如果召回时不利用这个标记（或者错误地利用），有和无没有区别。真正需要的是一个"分层召回"策略：

\`\`\`python
# 分层召回策略伪代码
class HierarchicalRecallStrategy:
    def recall(
        self,
        query: str,
        task_id: str | None = None,
        include_parent_context: bool = True,  # 是否包含父任务的记忆
        include_sibling_context: bool = False, # 是否包含兄弟子任务的记忆
    ) -> list[dict]:
        candidates = self.faiss_search(query)
        if task_id and not include_sibling_context:
            candidates = [c for c in candidates if c.task_id == task_id or c.task_id is None]
        if not include_parent_context:
            candidates = [c for c in candidates if c.parent_id is None]
        return candidates
\`\`\`

这个策略的价值在于：**每个子任务可以独立决定自己的"记忆视野"**。翻译任务不需要参考"查天气"的记忆——但如果不小心搜到了，也不应该有信息泄露。分层召回策略在存储之上提供了一个业务语义层——这可能是比 raw 层级存储更重要的工程决策。

> 置信度：0.75`,
  },
  // ── q5.3 — Token 预算全局约束谁决策 ──
  {
    id: "q5.3",
    question: "Token 预算是全局约束，四层都要抢。预算分配应该由谁集中决策？",
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P3",
    confidence: { l0: 0.90, l1: 0.88, l2: 0.85, l3: 0.80 },
    overallConfidence: 0.80,
    l0: 'GlassCortex 没有集中的 Token 预算分配器。预算是一行配置 \`Settings.context_window_size = 4096\`（[config.py:61](/src/config.py)），四层（system/recalled/history/tools）在同一个窗口里**隐式竞争**，溢出处理作为唯一的"公平机制"。\`TokenLedger\` 按 \`call_point\`（chat/intent/fact_extraction）独立记账但**不参与决策**。结论：Token 预算目前是**"先到先得 + 溢出清理"的被动模型**，不是集中分配模型。缺少的是一个真正读过各层需求后做预算分配的仲裁层。',
    l1: `去吧台点了一杯酒。调酒师（预算分配者）问你想喝什么——你说"随便"。调酒师看着吧台上的四个酒瓶（四层），从第一个瓶倒了八成满（system），又拿第二个瓶倒了五成（recalled），发现杯子快满了，第三个和第四个瓶子各只倒了一点点（history/tools）。

这个"随便"就是 GlassCortex 的默认配置——\`Settings.context_window_size = 4096\`。系统没有问各层"你需要多少"就开工了。谁来倒？谁来分？答案是**没人主动分**——靠的是溢出后的后处理。

### 四层如何竞争

四区定义在 \`partition.py\` 的 \`_ZONE_DEFS\`（[partition.py:9](/src/context/partition.py)）：

| 分区 | 填充来源 | 分配方式 |
|------|---------|:-------:|
| system（⚙️） | system prompt 固定开销 | 硬编码 base_header (base_tokens) |
| recalled（🧠） | 记忆召回 + 事实 (FAISS → SQLite → scored) | 溢出处理后取剩 |
| history（💬） | 当前用户输入 | 固定 = user_message_tokens |
| tools（🛠️） | 工具定义 | 始终为 0（无工具） |

**关键调度逻辑**在 \`compute_partitions()\`（[partition.py:47](/src/context/partition.py)）：

\`\`\`python
recalled_tokens = max(0, total - base - user)
\`\`\`

不是"各层上报需求然后仲裁"，而是**总用量减去 system 和 history 后剩下的全给 recalled**。如果总用量超过 \`window_size\`，由 \`simulate_overflow()\` 从 recalled 里面往外扔。这不是分配——这是**剩多少吃多少**。

### 强制执行者

真正的"预算警察"是 \`simulate_overflow()\`（[overflow_sim.py:108](/src/context/overflow_sim.py)）。它有三种策略（truncate / prioritize / summarize），通过 \`Settings.context_overflow_strategy\` 设定，默认 "prioritize"。当 \`total_mem_tokens > available\` 时，调用 \`_apply_overflow()\`：

\`\`\`python
# overflow_sim.py: 核心逻辑
if strategy == "truncate":
    ...  # 按 FIFO 截断
elif strategy == "prioritize":
    ...  # 按相关度保留最高分
elif strategy == "summarize":
    ...  # 低相关度压缩为一句话摘要
\`\`\`

但这个警察只在**事后**执法——它不能在事前阻止各层过量消费。各层根本不知道预算上限在哪里就填数据了。

### TokenLedger：记账员不参与决策

\`TokenLedger\`（[token_ledger.py:34](/src/token_ledger.py)）通过 setter 注入到各引擎，记录了四个 \`call_point\` 的 token 消耗：

- \`"chat"\`（ChatEngine.generate 主回复）
- \`"intent"\`（Planner 意图分类）
- \`"fact_extraction"\`（FactExtractor 事实抽取）
- \`"compression_savings"\`（消息压缩节省）

\`\`\`mermaid
%% title: 图：Token 预算的四层竞争与实际分配路径
flowchart LR
    CFG["Config<br/>context_window_size=4096"] -->|"硬上限"| WINDOW["上下文窗口"]
    subgraph 四层["四层填数据（无协调）"]
        SYS["system<br/>base_header ~50 tokens"]
        REC["recalled<br/>FAISS top_k up to 5 items"]
        HIST["history<br/>用户输入 ~10-200 tokens"]
        TOOL["tools<br/>= 0"]
    end
    SYS --> WINDOW
    REC --> WINDOW
    HIST --> WINDOW
    WINDOW -->|"超出→溢出处理器"| OVERFLOW["simulate_overflow()<br/>三种策略"]
    OVERFLOW -->|"处理后"| FINAL["最终 Prompt"]
    LEDGER["TokenLedger<br/>记账（不决策）"] -.->|"只管记录"| FINAL
    style CFG fill:#fef9c3,stroke:#ca8a04
    style OVERFLOW fill:#fca5a5,stroke:#dc2626
    style LEDGER fill:#e2e8f0,stroke:#64748b
\`\`\`

> 置信度：0.88`,
    l2: `### 如果要有集中决策——它需要什么？

当前模型是"无协调竞争"。如果要升级为"集中预算分配"，需要引入三个新组件：

#### 组件 1：需求预申报

每层在填数据前先向仲裁者申报预期用量：

\`\`\`python
# 伪代码：理想分配流程
class BudgetAllocator:
    def request(self, layer: str, estimated_tokens: int) -> BudgetAllocation:
        """层向仲裁者申报需求，仲裁者返回批准量"""
        ...

    def allocate(self, requests: dict[str, int]) -> dict[str, int]:
        """根据优先级和上限计算每个层的最终分配"""
        ...
\`\`\`

当前哪一步能做到？哪一步做不到？

| 功能 | 当前能力 | 差距 |
|------|---------|:----:|
| 系统统一知道窗口大小 | ✅ \`Settings.context_window_size\` | — |
| 各层申报需求 | ❌ 无 API | 需要 \`estimate_requirement()\` 函数 |
| 仲裁者计算分配 | ❌ 不存在 | 需要 \`BudgetAllocator\` 类 |
| 层按配额执行 | ❌ 无约束 | 需要 \`enforce_quota()\` 包装器 |

#### 组件 2：优先级协商

不是所有层的 Token 需求同等重要。一个合理的优先级顺序是：

1. **system**（最高）——必须完整，否则模型不知道自己的角色
2. **recalled**（高）——没了它就失忆了，但可以丢掉部分
3. **history**（中）——当前用户消息必须保留
4. **tools**（低）——当前未启用

但当前系统把优先级**硬编码在溢出策略里**而不是分配逻辑中。"prioritize" 策略是按相关度排序记忆而不是按层排序——意味着一条低相关的 fact 可能比一条重要的 episode 更容易被丢弃，而不管它来自哪个层。

#### 组件 3：预算利用率反馈

集中分配的前提是知道各层实际用了多少。\`TokenLedger.summary()\` 提供了这个数据——但只在 API /metrics 端点被读取，没有引擎内部的反馈回路：

\`\`\`python
# token_ledger.py:99-129 - summary() 输出
{
    "chat": {"count": 1, "prompt_tokens": 320, "completion_tokens": 150, "total_tokens": 470},
    "intent": {"count": 1, "prompt_tokens": 85, "completion_tokens": 25, "total_tokens": 110},
    "fact_extraction": {"count": 1, "prompt_tokens": 520, "completion_tokens": 180, "total_tokens": 700},
    "total": {"count": 3, "prompt_tokens": 925, "completion_tokens": 355, "total_tokens": 1280}
}
\`\`\`

注意 \`summary()\` 统计的是**LLM 调用的 token**，不是**上下文窗口各区的 token**。这是两个不同的维度：前者是成本（花出去的钱），后者是容量（装多少东西）。当前架构把这两个概念混在一起——\`TokenLedger\` 管成本，\`ContextPartitions\` 管容量，两者没有交叉验证。

### 真正的约束在哪

\`Settings.context_window_size\` 是**输出约束**（LLM 能看多少），不是**预算约束**（系统能花多少）。这意味着：

| 维度 | 当前上限 | 值 | 谁定 |
|------|---------|:--:|:----:|
| 输出约束（context） | Settings.context_window_size | 4096 | 配置文件 |
| 成本约束（token cost） | 无 | 无上限 | — |
| 时间约束（latency） | 无（等待 LLM 回复自然完成） | 无上限 | — |

**最需要集中决策的不是 context 预算——因为它的上限已经写在配置里了。最需要的是"Token 总成本预算"和"延迟预算"的集中决策。** 当前两个维度都是无上限的：\`generate()\` 不会因为这一轮已经花了 2000 token 就压缩回复长度。

> 置信度：0.85`,
    l3: `### 当前行业实践

**Anthropic 的 Prompt Caching** 是一种间接的预算决策机制：缓存命中的部分不计入 prompt token 计费。系统倾向使用更多的缓存内容（减少成本）而不是更多的实时推理。缓存策略**隐式地**影响了预算分配——但对缓存命中的定义是模型厂商决定的，系统自身没有仲裁权。

**OpenAI 的 max_tokens 参数**是当前最直接的"预算输出控制"：设定后 LLM 强制在此上限内结束回复。但它只控制输出（completion）不控制输入（prompt）。四层竞争的是输入预算，不是输出预算。

**Google Gemini 的 Context Caching** 类似 Anthropic——固定部分的 system prompt 和角色定义进入缓存区。缓存区的大小和超时由 API 调用者设定，模型厂商不做仲裁。

**LangChain 的 RunnableWithFallbacks** 是一个简单的熔断式预算分配：主 runnable 超时或失败后切换到备用 runnable（通常便宜/更快）。这相当于给每个层配置了"降级预算"。

### GlassCortex 的改进方向

一个务实的中间方案：不引入全局 BudgetAllocator（大改动），而是在 \`Settings\` 中增加各层独立的 \`max_tokens\` 限制：

\`\`\`python
# 在 config.py 中新增
context_budget_system: int = 200     # system prompt 上限
context_budget_recalled: int = 2000  # 记忆召回上限
context_budget_history: int = 500    # 对话历史上限
\`\`\`

各层在填充前检查自己的配额，超出即截断。这样保留了"每层自主执行"的灵活性，同时给了运维人员一个"旋钮"而不是一把"剪刀"。

更深层的问题：**Token 预算应该按 token 数量分配，还是按"重要性"分配？** 如果 100 token 的重要事实比 300 token 的普通对话更有价值，那按 token 数分配的公平性本身就是错的。这可能指向一个"价值分配"模型——每层申报的不仅是预期 token 数，还有预期信息增益/重要性。

> 置信度：0.80`,
  },
  // ── q5.4 — 一层错误传播到其他层？ ──
  {
    id: "q5.4",
    question: "一个层的错误如何传播到其他层？有没有熔断机制？",
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P3",
    confidence: { l0: 0.87, l1: 0.85, l2: 0.82, l3: 0.76 },
    overallConfidence: 0.76,
    l0: 'GlassCortex 没有正式的熔断器或断路器模式。错误传播遵循**"层级弹性"**模式：意图分类（Planner）和 L2 任务规划是**尽力而为（非阻塞）**——失败不阻止后续步骤；记忆召回和 LLM 生成是**硬依赖（阻塞）**——失败直接 HTTP 5xx。压缩有静默回退（截断）。全局 ASGI 中间件作为兜底。结论：系统的容错是**各层自扫门前雪**——没有跨层的错误计数、熔断阈值、或级联降级策略。',
    l1: "一座工厂有四条流水线：分拣线（意图分类）、仓库线（记忆召回）、组装线（LLM 生成）、质检线（规划）。分拣线出了故障——零件分类错了。但组装线完全不知道分拣线出错了，继续按错分类的零件加工。仓库线电闸跳了——整个工厂停了，因为组装线没零件可加工。质检线出了bug——它只是\"尽量做\"，做不出来也无所谓。\n\n这就是 GlassCortex 的错误传播模式——**没有统一的错误控制面板**。\n\n### 逐层错误处理一览\n\n`POST /chat` 端点（[chat.py:27](/api/routers/chat.py)）的完整管线分四个步骤，错误的严重程度完全不同：\n\n| 步骤 | 层 | try/except 行为 | 失败后 | 阻断后续？ |\n|------|----|---------------|--------|:---------:|\n| 1 | 意图分类（Planner） | 静默 catch，logging warning | intent_result = None | ❌ 继续 |\n| 2 | 记忆召回（RecallEngine） | 抛出 HTTPException(500) | 中断请求 | ✅ 阻断 |\n| 3 | LLM 生成（ChatEngine） | 抛出 HTTPException(503) | 中断请求 | ✅ 阻断 |\n| 4 | L2 任务规划（Planner） | 静默 catch，logging warning | 不注入 plan 信息 | ❌ 继续 |\n\n### 三个弹性级别的设计逻辑\n\n**非阻塞层：意图分类和 L2 规划**\nLLM 意图分类不是管线必需的——`intent_result = None` 时，后端使用默认分类（`plan_cat = \"提问\"`）。L2 规划失败时，回复照常返回，只是少了 \"subtasks\" 信息。这两步的失败本质上等于\"降级到基础聊天模式\"——用户可能不会注意到差异。\n\n**硬阻断层：记忆召回和 LLM 生成**\n记忆中 FAISS 搜索或 SQLite 查询失败意味着整个上下文不可靠——继续生成会输出幻觉。LLM 生成失败意味着根本没有回复可返回。这两个失败是**不可降级的**——没有\"猜一个回复\"的备用方案。\n\n**静默回退层：消息压缩**\n`ChatEngine.compress_message()`（[engine.py:235](/src/chat/engine.py)）是唯一有**优雅降级**的组件：\n\n```python\ntry:\n    compressed = self._client.chat.completions.create(...)\n    return compressed.choices[0].message.content, ...\nexcept (APIError, RuntimeError):\n    # 静默回退到截断\n    return content[:200] + \"...\", {}\n```\n\n压缩失败不会报错、不会告警——安静地退回前 200 字符。用户看到的是截断的文本，不知道后台出了错。\n\n### 熔断器的缺失\n\n熔断器（Circuit Breaker）的核心功能是：**当失败率达到阈值时，主动停止发送请求，避免雪崩**。GlassCortex 没有一个层实现了这个模式：\n\n- `chat.py` 的步骤 2 和 3 使用裸 `try/except`——每次失败都抛出 HTTPException，不做计数\n- `generate()` 连续失败 10 次和第 1 次的行为完全一致——不会降级、不会等待重试、不会切换到备用模型\n- 没有超时兜底——`client.chat.completions.create()` 使用 SDK 默认超时，没有应用层的超时哨兵\n\n> 置信度：0.85",
    l2: "### 深入分析：错误传播的四个场景\n\n#### 场景 A：意图分类失败（非阻塞传播）\n\n`POST /chat` 步骤 1（[chat.py:44-57](/api/routers/chat.py)）：\n\n```python\ntry:\n    intent_data, planner_trace = planner.classify_intent(body.user_input)\n    intent_result = IntentResult(...)\nexcept Exception as exc:\n    logging.getLogger(...).warning(\n        \"Intent classification failed, continuing pipeline: %s\", exc\n    )\n```\n\n这里的异常直接吞掉，`intent_result` 保持 `None`。下游步骤 2（记忆召回）和步骤 3（LLM 生成）完全不依赖意图分类结果。步骤 4（L2 规划）检测到 `intent_result is None` 时用 `\"提问\"` 作为默认分类。\n\n**关键观察**：意图分类的失败是**完全隔离的**——后面的层甚至感知不到前面出了问题。但这也意味着：如果意图分类连续失败，没有任何机制检测到这个\"持续失败\"的模式。每轮都是\"尽力而为 → 静默跳过\"。\n\n#### 场景 B：记忆召回失败（硬阻断传播）\n\n步骤 2（[chat.py:60-67](/api/routers/chat.py)）：\n\n```python\ntry:\n    recalled = recall.recall(query=body.user_input, top_k=5, strengthen=True)\nexcept Exception as exc:\n    raise HTTPException(status_code=500, detail=f\"Recall failed: {exc}\")\n```\n\n这里直接把 `Exception` 转为 `HTTPException(500)`。错误传递路径：\n\n```\nRecallEngine.recall() → Exception\n  → POST /chat catch → raise HTTPException(500)\n    → FastAPI 异常处理器 → 返回 {\"error\": \"Recall failed: ...\"} 给前端\n```\n\n注意这里**没有尝试重新召回**、没有回退到简化查询、没有检查 FAISS 索引状态。一次硬件故障、一次数据库连接超时——都直接结束本轮对话。\n\n#### 场景 C：LLM 生成失败（硬阻断 + 结构化错误）\n\n步骤 3（[chat.py:70-89](/api/routers/chat.py)）：\n\n```python\nexcept Exception as exc:\n    raise HTTPException(\n        status_code=503,\n        detail=ChatError(\n            error=\"llm_unavailable\",\n            detail=str(exc),\n            response_text=\"\",\n            recovery_hint=\"请在 .env 中设置 LLM API Key 并检查网络连接\",\n        ).model_dump(),\n    )\n```\n\n这是错误信息最丰富的失败路径——`ChatError`（[schemas.py:127](/api/schemas.py)）包含 `error`（机器可读码）、`detail`（人类可读描述）、`recovery_hint`（可操作建议）。但本质上这和 Scenario B 一样是硬阻断——只是返回体更友好了。\n\n#### 场景 D：全局兜底\n\n`api/main.py` 中的 `catch_all_exceptions` 中间件（[main.py:175](/api/main.py)）：\n\n```python\n@app.middleware(\"http\")\nasync def catch_all_exceptions(request: Request, call_next):\n    try:\n        return await call_next(request)\n    except Exception as exc:\n        logger.error(\"Unhandled exception: %s\", exc)\n        return JSONResponse(\n            status_code=500,\n            content=ErrorResponse(\n                error=\"internal_error\",\n                detail=\"服务器内部错误\",\n                error_code=ErrorCode.INTERNAL_ERROR,\n            ).model_dump(),\n        )\n```\n\n这是最后一道防线——上面四个步骤都没 catch 住的异常会在这里被兜底。注意它**不区分**是哪一层的错误——所有未处理错误统一返回 `INTERNAL_ERROR`。前端收到 `500` 时无法判断是记忆层崩溃还是 LLM 超时。\n\n### 错误传播路径全景\n\n```mermaid\n%% title: 图：GlassCortex 管线错误传播路径\ngraph TD\n    REQ[\"HTTP Request\"] --> INTENT[\"① 意图分类\"]\n    INTENT -->|\"✅ 成功\"| INTENT_OK[\"intent_result 就绪\"]\n    INTENT -->|\"❌ 失败\"| INTENT_FALLBACK[\"logging warning<br/>intent_result = None\"]\n    INTENT_OK --> RECALL[\"② 记忆召回\"]\n    INTENT_FALLBACK --> RECALL\n    RECALL -->|\"✅ 成功\"| RECALL_OK[\"recalled 就绪\"]\n    RECALL -->|\"❌ 失败\"| RECALL_ERR[\"HTTP 500<br/>硬阻断\"]\n    RECALL_OK --> GEN[\"③ LLM 生成\"]\n    GEN -->|\"✅ 成功\"| GEN_OK[\"回复 + 事实 + 存储\"]\n    GEN -->|\"❌ 失败\"| GEN_ERR[\"HTTP 503<br/>ChatError 结构化\"]\n    GEN_OK --> PLAN[\"④ L2 规划\"]\n    PLAN -->|\"✅ 成功\"| PLAN_OK[\"subtasks 就绪\"]\n    PLAN -->|\"❌ 失败\"| PLAN_FALLBACK[\"logging warning<br/>无 subtasks\"]\n    PLAN_OK --> RESP[\"HTTP 200\"]\n    PLAN_FALLBACK --> RESP\n    RECALL_ERR -->|\"内部未处理\"| CATCHALL[\"catch_all_exceptions<br/>INTERNAL_ERROR 500\"]\n    GEN_ERR --> CATCHALL\n    INTENT_FALLBACK -.->|\"✓ 不触发全局\"| CATCHALL\n    PLAN_FALLBACK -.->|\"✓ 不触发全局\"| CATCHALL\n    style INTENT fill:#fef9c3,stroke:#ca8a04\n    style RECALL fill:#fca5a5,stroke:#dc2626\n    style GEN fill:#fca5a5,stroke:#dc2626\n    style PLAN fill:#fef9c3,stroke:#ca8a04\n    style CATCHALL fill:#f3e8ff,stroke:#9333ea\n```\n\n### 错误不是只有异常\n\n当前对\"错误\"的定义太窄——只把 `raise Exception` 算作错误。更隐蔽的错误传播路径包括：\n\n1. **数据质量下降**：记忆层返回了低相关的召回结果（不是异常，但语义上\"错了\"）。上下文层不知情地使用低质量数据。这是最危险的路径——**没有异常就没有感知**。\n2. **静默退化的累积**：压缩层连续回退到截断——每次都\"安静地成功了\"——但用户看到的消息越来越短。没有告警说\"compress_message() 在过去 10 次调用中失败了 7 次\"。\n3. **空结果的无声传播**：如上问 q5.1 所述，`recall()` 返回空列表时无特殊信号。调用方收到 `memories_before = 0`，无法区分\"新用户无记忆\"和\"老用户 FAISS 搜不到\"。\n\n> 置信度：0.82",
    l3: '### 当前行业实践\n\n**Netflix Hystrix**（断路器模式经典实现）：每个依赖调用包裹在 HystrixCommand 中，跟踪最近 N 次调用的失败率。当失败率 > 阈值（默认 50%），断路器跳闸——后续请求直接走 fallback 路径，不发起真正调用。经过冷却时间（默认 5 秒）后，半开状态允许单个探测请求通过，成功则闭合断路器。\n\n**Resilience4j**（Java 轻量级熔断库）：支持滑动窗口（计数 / 时间）的失败率统计，且区分**业务异常**和**系统异常**——业务异常（如"用户不存在"）不计入熔断阈值，系统异常（如"数据库连接超时"）计入。\n\n**LangChain 的 Retry 和 Fallback**：Runnable 支持 `.with_retry()`（最多重试 N 次，退避策略）和 `.with_fallbacks()`（主 Runnable 失败后切换到备选 Runnable）。后者最接近 GlassCortex 需要的模式——比如 FAISS 召回失败后 fallback 到简单的 SQLite 全量搜索。\n\n### GlassCortex 的三大缺口\n\n**缺口 1：没有跨层失败计数**\n每一层的失败是独立的——意图分类失败 10 次和 LLM 生成失败 1 次之间没有任何关联。而实践中，意图分类频繁失败可能是 embedding 模型退化，LLM 生成失败可能是 API 配额耗尽——它们需要不同的恢复策略。建议在 `TokenLedger` 中增加 `record_failure(layer, error_type)`，让失败数据和各层的 token 消耗在同一个视图中。\n\n**缺口 2：没有熔断阈值**\n即使某个层连续失败，行为也不会改变。一个最小实现：在 `Settings` 中增加：\n\n```python\n# circuit_breaker 配置\ncb_recall_max_retries: int = 2      # 召回失败最多重试次数\ncb_recall_window_sec: int = 60      # 统计窗口\ncb_recall_threshold: float = 0.5    # 窗口内失败率 > 50% 跳闸\ncb_recall_cooldown_sec: int = 30    # 跳闸后冷却时间\ncb_recall_fallback: str = "sqlite"  # 跳闸后降级到 SQLite 全量搜索\n```\n\n当熔断器跳闸时，`recall()` 自动走 fallback 路径（不做 FAISS 搜索，直接查数据库），并在冷却后尝试恢复。\n\n**缺口 3：没有级联降级策略**\n当 LLM 生成失败时，当前行为是直接 503。更好的做法是**自动降级到更小的模型**（如果配置了两个模型）或**缓存检索**（如果之前有相似问题的成功回复）。级联降级需要各层互相知道彼此的"备用方案"——这回到 q5.5 的问题：层间需要共享一个"服务降级状态"，而不是各行其是。\n\n**错误 vs 异常的哲学区分**\nGlassCortex 当前把"错误"和"异常"混为一谈。实际上应该区分三类：\n\n| 类别 | 特征 | 例子 | 应该怎么做 |\n|------|------|------|-----------|\n| 预期错误 | 已知可能性，有处理预案 | LLM 超时、FAISS 空结果 | 优雅降级 + 计数 |\n| 非预期异常 | 未知原因，无预案 | 段错误、内存溢出 | 快速失败 + 告警 |\n| 静默退化 | 功能"正常"但质量下降 | 召回不相关、压缩变截断 | 质量监控 + 趋势告警 |\n\n当前系统对第一类（预期错误）做了部分处理（try/except 回退），对第二类（非预期异常）依赖全局兜底，对第三类（静默退化）完全没有感知。而后者可能是对用户体验伤害最大的——用户不会看到错误消息，但会发现"AI 好像变笨了"。\n\n> 置信度：0.76',
  },
  {
    id: "q5.5",
    question: '层间通信的"语言"：认知层之间传递的是什么数据结构？',
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P2",
    confidence: { l0: 0.92, l1: 0.90, l2: 0.88, l3: 0.82 },
    overallConfidence: 0.82,
    l0: '四层之间没有统一的"通信协议"。数据通过混合的数据结构传递——记忆层返回 \`list[dict[str, object]]\`（约定键名的字典列表），上下文层通过 \`ContextMeta\`（[schemas.py:62](/api/schemas.py)）传递元数据，\`ChatEngine.generate()\` 返回 \`tuple[str, dict, dict]\` 三元组，API 边界用 Pydantic 模型输出 \`ChatResponse\`。整体上是**内聚的 dict 通路 + 边界处 Pydantic 定型**。这层"胶水"越靠近内核越松散、越靠近 API 边界越严谨。',
    l1: `想象一家公司有三个部门：档案室（记忆层）、文案组（上下文层）、对外发言人（API 层）。档案室递出来的文件用**铅笔写在活页纸上**——格式灵活但容易被涂改（\`list[dict]\`）。文案组收到后转录成**内部备忘录**（\`tuple[str, dict, dict]\`）——每个部门都按自己的习惯写。最后对外发言人把备忘录整理成**正式公函**（Pydantic 模型）才发出去。

这就是 GlassCortex 层间通信的现状——越靠近"大脑"越随意，越靠近"出口"越规整。

### 核心数据结构全景

四条认知层之间传递的数据结构可以分为三类：

| 类别 | 典型结构 | 定义位置 | 严格程度 |
|------|---------|---------|:-------:|
| 内部传递 | \`list[dict[str, object]]\` | 调用约定（无显式定义） | ⚪ 松散 |
| 层间元数据 | \`ContextMeta\` / \`OverflowSimResult\` / \`RegretAnalysis\` | schemas.py / overflow_sim.py / recall.py | 🟡 半结构 |
| 边界模型 | \`ChatResponse\` / \`IntentResult\` / \`RecallItem\` / \`TraceItem\` | schemas.py | 🔵 严格 |

### 内部传递：\`list[dict]\`

记忆层 \`RecallEngine.recall()\`（[recall.py:42](/src/memory/recall.py)）的输出是这个形状：

\`\`\`python
# 返回类型签名
def recall(...) -> list[dict[str, object]]:
    ...

# 每个 dict 的约定键名
{
    "content": "用户上次说...",
    "faiss_id": 42,
    "initial_strength": 1.0,
    "importance": 0.8,
    "composite_score": 0.73,
    "confidence": 0.9,
    "_row_type": "episode",    # 或 "fact"
    "_mmr_selected": True,     # MMR 选中标记（可选）
}
\`\`\`

这是整个链条上最松散的一环。没有 Pydantic 校验，没有 Union 类型——全凭调用方知道"应该有哪些 key"。如果记忆层改了一个键名（比如 \`composite_score\` → \`score\`），上下文层会在运行时静默拿到 \`None\`。

### 层间元数据：三份"智能包裹"

上下文层 \`_build_system_prompt()\`（[engine.py:76](/src/chat/engine.py)）生成两份结构化的元数据，外加记忆层保留一份：

- **\`OverflowSimResult\`**（[overflow_sim.py:64](/src/context/overflow_sim.py)）——溢出模拟的完整输出。纯数据类，包含数量/触发状态/丢弃内容。传给 \`_build_system_prompt()\` 后映射为 \`ContextMeta\` 字典。
- **\`ContextMeta\`**（[schemas.py:62](/api/schemas.py)）——Pydantic 模型，\`extra="allow"\` 意味着引擎可以附加额外字段而不丢失数据。这是三份中最"官方"的一份——因为它要序列化成 JSON 通过 API 传给前端。
- **\`RegretAnalysis\`**（[recall.py:131](/src/memory/recall.py)）——数据类，存在 \`RecallEngine.last_regret\` 中。目前是"闭环"——不跨层传递。

### 边界模型：严格定型

到了 API 边界，所有数据都进入 Pydantic 模型：

- **\`ChatResponse\`**（[schemas.py:112](/api/schemas.py)）——最终响应体，包含 \`response_text\`、\`context_meta\`（ContextMeta）、\`api_trace\`（ApiTrace）、\`recall_items\`（list[RecallItem]）、\`intent\`（IntentResult）
- **\`RecallItem\`**（[schemas.py:171](/api/schemas.py)）——召回单条记录的 Pydantic 模型，是 \`recall()\` 返回的松散 dict 的**正式定型版**
- **\`TokenUsage\`** 和 **\`StepRecord\`**（[token_ledger.py:10:24](/src/token_ledger.py)）——数据类，用于会计统计
- **\`ContextPartitions\`** 和 **\`ZonePartition\`**（[partition.py:18:34](/src/context/partition.py)）——数据类，用于前端可视化渲染

\`\`\`mermaid
%% title: 图：层间数据结构流转与定型层级
flowchart LR
    subgraph 记忆层["🧠 记忆层"]
        RECALL["RecallEngine.recall()"]
        REGRET["RegretAnalysis<br/>deduped/mmr_dropped/truncated"]
    end
    subgraph 上下文层["📋 上下文层"]
        OVERFLOW["simulate_overflow()"]
        CMETA["ContextMeta<br/>Pydantic extra=allow"]
        PARTITION["ContextPartitions<br/>四区ZonePartition"]
    end
    subgraph 引擎出口["⚙️ ChatEngine"]
        GEN["generate() returns<br/>tuple[str, dict, dict]"]
    end
    subgraph API 边界["🚪 API（Pydantic 定型）"]
        CRESP["ChatResponse"]
        RITEM["RecallItem"]
        TRACE["ApiTrace"]
        INTENT["IntentResult"]
    end
    subgraph 记账层["💰 TokenLedger"]
        TUSAGE["TokenUsage<br/>call_point/tokens"]
        SREC["StepRecord<br/>step_name/elapsed_ms"]
    end
    RECALL -->|"list[dict]<br/>松散约定"| OVERFLOW
    OVERFLOW -->|"OverflowSimResult"| CMETA
    CMETA -->|"ContextMeta<br/>dict[str,object]"| GEN
    RECALL -.->|"不跨层"| REGRET
    GEN -->|"tuple[str,dict,dict]"| CRESP
    RECALL -->|"list[dict] → RecallItem"| RITEM
    CMETA -->|"dict → ContextMeta"| CRESP
    GEN -->|"dict → ApiTrace"| TRACE
    PARTITION -.->|"可视化<br/>不参与推理"| CRESP
    style RECALL fill:#e2e8f0,stroke:#64748b
    style REGRET fill:#fef9c3,stroke:#ca8a04
    style OVERFLOW fill:#e2e8f0,stroke:#64748b
    style CMETA fill:#bbf7d0,stroke:#16a34a
    style CRESP fill:#bfdbfe,stroke:#3b82f6
    style RITEM fill:#bfdbfe,stroke:#3b82f6
    style TUSAGE fill:#f3e8ff,stroke:#9333ea
\`\`\`

> 置信度：0.90`,
    l2: `### 深度对比：三个关键数据结构的异同

\`OverflowSimResult\`（上下文引擎内部）、\`ContextMeta\`（跨层传递）、\`ContextPartitions\`（前端渲染）三个结构**描述的是同一个东西**——上下文窗口的组成——但服务于不同的目的，规格也不同。

| 属性 | OverflowSimResult | ContextMeta | ContextPartitions |
|------|------------------|-------------|-------------------|
| **定义位置** | overflow_sim.py:64 | schemas.py:62 | partition.py:34 |
| **类型** | Python dataclass | Pydantic BaseModel | Python dataclass |
| **"extra" 容忍** | ❌ 无 | ✅ extra="allow" | ❌ 无 |
| **序列化** | 无（引擎内部） | .model_dump() → JSON → API | 无（前端渲染用） |
| **包含溢出详情？** | ✅ 完整 | ✅ 完整（但有损：缺少 kept_items） | ✅ 完整 |
| **包含用户消息？** | ❌ | ✅ user_message_tokens | ❌ |
| **谁读取它** | \`_build_system_prompt()\` | \`POST /chat\` 端点组装 Response | AnswerCard 前端组件 |
| **生命周期** | 引擎单次调用 | API 响应 → 前端可观测面板 | 前端渲染时即时计算 |

**关键差异**：\`OverflowSimResult\` 有 \`kept_items: list[dict]\`（保留了哪些条目），但 \`ContextMeta\` 映射时只取了 \`dropped_count\` 和 \`dropped_items\`，**没有保留"保留了哪些"的信息**。前端拿到 \`ContextMeta\` 后无法恢复出"溢出前后对比"视图——只能看到丢了多少，看不到最初有多少。

这是"越往外传信息越少"的典型例子——每经过一层接口，结构更稳定了，但信息更稀疏了。

### 层间接口的演进史

当前架构是一个中间状态，可以看到三条不同的设计哲学共存：

**1. 早期阶段：纯 dict 传参（记忆层 → 上下文层）**
\`recall()\` 返回 \`list[dict]\` 是最早的接口风格。优点是灵活——添加新字段不需要修改任何类型定义。缺点是——调用方必须"知道"该读哪些键，任何键名变更都是静默运行时错误。

**2. 中期阶段：Pydantic 边界定型（上下文层 → API）**
\`ContextMeta\` 和 \`ChatResponse\` 是后来引入的。Pydantic 提供了字段校验、默认值、文档字符串——但用了 \`extra="allow"\` 保留了后门，因为引擎产出的 dict 总是比模型定义的字段多。

**3. 当前阶段：数据类分化（独立模块各自定义）**
\`OverflowSimResult\`、\`RegretAnalysis\`、\`TokenUsage\`、\`ContextPartitions\` 是各模块自己定义的小型数据类。它们同类但不兼容——比如描述类似的"丢弃项"概念，\`OverflowSimResult\` 用 \`list[str]\`（内容摘要），\`RegretAnalysis\` 用 \`list[dict]\`（完整元数据），\`ContextMeta\` 用 \`list[dict]\`（但映射时丢失了部分字段）。

### TokenLedger 的"监控层"角色

\`TokenLedger\`（[token_ledger.py:34](/src/token_ledger.py)）是一个有意思的例外——它不是某个层自己的数据结构，而是一个**跨层的记账员**。它通过 setter 注入（\`chat_engine.set_ledger(ledger)\`）被各层共享，每个层调用 \`ledger.record()\` 记录自己的 token 消耗。

\`\`\`python
# TokenLedger.record() 签名
def record(self, call_point: str, prompt_tokens: int, completion_tokens: int) -> None:
\`\`\`

\`call_point\` 来自哪个层？（[chat.py:96-116](/api/routers/chat.py)）：
- \`"chat"\`（ChatEngine）
- \`"intent"\`（Planner）
- \`"fact_extraction"\`（FactExtractor）

这是唯一一个"所有层都往同一个结构里写"的数据通路。但它是单向的——只写不读。没有层的代码会去读 \`ledger.summary()\` 来调整自己的行为。TokenLedger 目前是一个**审计日志**，不是一个**控制信号**。

> 置信度：0.88`,
    l3: `### 当前行业实践

**Google Pathways Architecture** 是层间通信的标杆设计：每一层输出的是一个"切片+元数据"的统一格式——层与层之间不传递原始的 tensor 或 text，而是传递一个结构化的 "Borg 消息"，内含数据、来源、置信度、延迟。层间接口是**强制类型化**的：添加一个新层必须通过接口评审。

**OpenAI 的 Function Calling** 是一种特殊的层间协议：基模和工具层之间通过 JSON Schema 通信。基模输出 JSON，工具层解析并执行，结果回到基模。消息格式是固定的（role: tool + content + tool_call_id）。**这是边界定型的最佳实践**——接口严格但内容灵活。

**LangChain 的 Runnable** 接口定义了一个统一契约：\`Runnable[Input, Output]\`。每一层（retriever、prompt template、LLM、output parser）都实现 \`invoke(input) → output\`，通过管道符 \`|\` 串联。输入输出类型在编译期已知（尽管 Python 下是运行时检查）。这解决了"层级间契约隐含"的问题——每个 Runnable 明确声明自己吃进和吐出什么。

### GlassCortex 的缺陷与改进方向

当前层间通信有四个具体问题：

**问题 1：\`list[dict]\` 无类型保障**
记忆层返回的 dict 的键名是约定而非契约。一个简单改进是用 TypedDict 替代 \`dict[str, object]\`：

\`\`\`python
class RecallItem(TypedDict):
    content: str
    faiss_id: int
    composite_score: float
    _row_type: NotRequired[str]
\`\`\`

TypedDict 提供 IDE 补全和 mypy 检查，但不增加运行时开销。当前 \`Pydantic RecallItem\`（[schemas.py:171](/api/schemas.py)）只在 API 边界使用——同样的结构应该下沉到 \`recall()\` 的返回类型。

**问题 2：ContextMeta 的 extra="allow" 是设计债**
\`extra="allow"\` 让引擎可以随意附加字段而不触发 Pydantic 校验错误。这导致 \`ContextMeta\` 的实际内容和定义字段不一致——前端和 API 消费者不知道哪些字段是"保证存在"的，哪些是"可能有的"。改进：定义多个精确的子模型（如 \`ContextMetaBase\` + \`ContextMetaWithTrace\`），在引擎中按需选择。

**问题 3：三种"丢弃"记录格式不统一**
\`OverflowSimResult.dropped_items: list[str]\`（内容摘要）
\`RegretAnalysis.deduped: list[dict]\`（完整元数据）
\`ContextMeta.dropped_items: list[dict]\`（混合格式）

同一个概念（"排除了什么"）有三种不同的表示。一个统一的数据类（如 \`DroppedItem\`，含 \`content\`、\`reason\`、\`source_layer\`、\`composite_score\`）可以合并这三种实现，让链路追踪能一致地理解"数据在哪里被过滤了"。

**问题 4：没有"结构化上下文"传递**
当前 \`_build_system_prompt()\` 把结构数据串化成纯文本（system prompt 字符串），丢失了结构化信息。\`ContextMeta\` 虽然并行传递了结构化元数据，但 prompt 本身是纯文本——这意味着 LLM 接收的是"展平后的记忆"而不是"带有元数据的记忆条目"。如果上下文层想让 LLM 知道"这条记忆置信度较低"——做不到，因为信心分数已经融进了文本里。

**一个实验性的方向**：把 system prompt 改成多段结构——每一段以 \`<!-- meta: {"source": "recall", "confidence": 0.65} -->\` 这样的 HTML 注释开头。LLM 训练数据里包含大量 HTML 注释，它理解注释中的元数据。这样上下文层可以在保留结构化信息的同时兼容纯文本 prompt 格式。

> 置信度：0.82`,
  },
  // ── q5.6 — 全链路追踪统一视图 ──
  {
    id: "q5.6",
    question: "全链路追踪统一视图：不是四张独立的图，是一条时间线上所有层的事件",
    chapter: "ch5",
    chapterTitle: "第 5 章：层间交互",
    priority: "P2",
    confidence: { l0: 0.87, l1: 0.84, l2: 0.80, l3: 0.75 },
    overallConfidence: 0.75,
    l0: 'GlassCortex 没有统一的"全链路追踪视图"。Trace 数据分散在四个独立的记录系统中：（1）\`pipeline_trace\` 表记录每步的耗时和状态（按 \`step_name\` 分区），（2）\`ApiTrace\` 模型记录每次 LLM API 调用的输入输出详情，（3）\`TokenLedger\` 记录各 \`call_point\` 的 token 消耗，（4）前端 ContextPanel 单独渲染上下文分区信息。四者共享 \`session_id\` 作为隐式关联键——但不存在一条"时间线"能同时展示"意图分类花了 85ms → 记忆召回 5 条 → LLM 生成了 320 token → 事实抽取 700 token"的完整事件序列。',
    l1: `一个航班有四个独立仪表盘：一个显示引擎转速、一个显示航向、一个显示油量、一个显示高度变化趋势。四个表都正常工作——但空难调查员问："在引擎出故障前 5 秒，高度和油量同时发生了什么变化？"没有一个仪表盘能回答。你必须手动对齐四个读数的拍照时间。

这就是 GlassCortex 当前全链路追踪的现状——每个层有自己的一块"仪表盘"，但没有"黑匣子"。

### 四个独立的记录系统

**系统 1：pipeline_trace**（[store.py:111](/src/memory/store.py)）

\`\`\`sql
CREATE TABLE pipeline_trace (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,      -- 会话关联键
    step_name TEXT NOT NULL,       -- "intent" / "recall" / "generate" / "plan"
    elapsed_ms REAL NOT NULL,      -- 耗时
    status TEXT NOT NULL,          -- "ok" / "error"
    metrics_json TEXT,             -- 各步骤自定义指标
    created_at REAL NOT NULL       -- 时间戳
);
\`\`\`

这是最接近"统一追踪"的表——但它记录的是**每步的汇总数据**，不是**每步的内部细节**。\`metrics_json\` 可以包含步骤特定的信息（如召回条数、token 数），但字段是 JSON 字符串——无法做结构化查询。

**系统 2：ApiTrace**（[schemas.py:86](/api/schemas.py)）

\`\`\`python
class ApiTrace(BaseModel):
    caller: str            # "chat" / "intent" / "fact_extraction"
    model: str             # 使用的模型
    temperature: float
    max_tokens: int
    elapsed_ms: float      # LLM API 调用耗时
    prompt_tokens: int
    completion_tokens: int
\`\`\`

每次 LLM API 调用产生一条 ApiTrace。它提供了**LLM 级别的细节**——但只记录了"调用了 LLM"的步骤，不包含非 LLM 步骤（如 embedding 搜索、数据库查询）的信息。

**系统 3：TokenLedger**（[token_ledger.py:34](/src/token_ledger.py)）

\`\`\`python
# 按 call_point 累计
TokenLedger.record(call_point="chat", prompt_tokens=320, completion_tokens=150)
TokenLedger.record(call_point="intent", prompt_tokens=85, completion_tokens=25)
TokenLedger.record(call_point="fact_extraction", prompt_tokens=520, completion_tokens=180)
\`\`\`

TokenLedger 不记录时间戳——它只提供**累计值**。你能知道"这次对话花了多少 token"，但不能在时间线上定位"某条 prompt 是在什么时候发送的"。

**系统 4：ContextPartitions**（前端内计算）

ContextPartitions（[partition.py:34](/src/context/partition.py)）在前端渲染时从 prompt 内容即时计算，不写入任何持久化存储。

\`\`\`mermaid
%% title: 图：四个独立记录系统——彼此知道但无法合并
flowchart LR
    subgraph 记录["四个记录系统"]
        PT["pipeline_trace<br/>step_name / elapsed_ms / status<br/>SELECT by session_id"]
        AT["ApiTrace<br/>caller / model / tokens<br/>在 ChatResponse 中返回"]
        TL["TokenLedger<br/>call_point / cumulated tokens<br/>GET /metrics"]
        CP["ContextPartitions<br/>四区 ZonePartition<br/>前端即时计算"]
    end
    subgraph 共享["共享键"]
        SID["session_id"]
    end
    PT --- SID
    AT --- SID
    TL -.->|"无时间戳"| SID
    CP -.->|"纯前端<br/>不持久化"| SID
    style PT fill:#e2e8f0,stroke:#64748b
    style AT fill:#e2e8f0,stroke:#64748b
    style TL fill:#e2e8f0,stroke:#64748b
    style CP fill:#e2e8f0,stroke:#64748b
    style SID fill:#bbf7d0,stroke:#16a34a
\`\`\`

### 为什么需要统一视图

不是说四个系统不够用。每个系统在独立场景下都够用：你想看某次生成花了多少 token → \`ApiTrace\`。你想看管线中哪一步最慢 → \`pipeline_trace\`。你想看累计成本 → \`TokenLedger\`。

问题出现在**跨层诊断**时。两个典型场景：

1. **「生成很慢」的根因诊断**：LLM 生成耗时 2.3 秒。是模型慢（API 延迟）？还是输入太长（prompt token 过多）？还是前一步召回花了太长时间堵塞了管线？
   - 但四个系统中没有一个是同时记录了输入长度、API 延迟、前一步耗时的
   - 你需要手动把 \`pipeline_trace\` 的 generate 步骤耗时和 \`ApiTrace\` 的 prompt_tokens 拼在一起

2. **「答非所问」的溯源**：用户说回复不对。是意图分类错了？召回错了？还是 LLM 幻觉？
   - 意图分类结果存在 \`IntentResult\`（通过 ChatResponse.intent 返回给前端）
   - 召回结果存在 \`recall_items\`（ChatResponse.recall_items）
   - 但两者在不同的响应字段里——前端没有一个"逐层审查"的视图展示"意图说了什么 → 召回了什么 → LLM 看到了什么 → 回复了什么"

> 置信度：0.84`,
    l2: `### 统一追踪视图的设计要求

一个真正有用的全链路追踪视图需要满足三个条件：

#### 条件 1：统一的事件格式

当前四条记录路径有四套格式。统一视图需要一套**所有层共用的事件模型**：

\`\`\`python
@dataclass
class TraceEvent:
    timestamp: float            # 事件发生时间
    layer: str                  # "intent" / "recall" / "context" / "generate" / "fact"
    event_type: str             # "llm_call" / "db_query" / "embedding" / "overflow" / "compression"
    duration_ms: float          # 耗时（0 = 瞬间操作）
    input_summary: str          # 输入摘要（200 字以内）
    output_summary: str         # 输出摘要（200 字以内）
    token_count: int            # 涉及 token 数（LLM 调用时）
    status: str                 # "ok" / "error" / "degraded"
    trace_id: str               # 本次请求的追踪 ID（串联所有事件）
    parent_event_id: str | None # 父事件 ID（拆分子事件时使用）
\`\`\`

对比当前四套格式的差异：

| 维度 | pipeline_trace | ApiTrace | TokenLedger | ContextPartitions |
|------|:-------------:|:--------:|:-----------:|:-----------------:|
| 有时间戳？ | ✅ | ❌（在 ChatResponse 中） | 🟡（记录级有，summary 不暴露） | ❌ |
| 有 token 数？ | ❌ | ✅ | ✅ | ✅ |
| 有耗时？ | ✅ | ✅ | ❌ | ❌ |
| 有状态？ | ✅ | ❌（失败即无记录） | ❌ | ❌ |
| 持久化？ | ✅ | ❌（仅在 API 响应体） | ✅（内存中） | ❌（前端计算） |
| 统一 trace_id？ | ❌ | ❌ | ❌ | ❌ |

没有一个字段在所有四个系统中都存在——这说明统一事件格式不是"合并"现有格式，而是**新建一个覆盖所有维度的格式**。

#### 条件 2：串联 ID（trace_id）

不同层之间的事件通过什么关联？当前只有 \`session_id\`，但 session 的粒度是整个对话——太大。需要按**单次请求**分配的 trace_id：

\`\`\`
POST /chat 请求
  ├── trace_id = "req_abc123"
  ├── 意图分类 → TraceEvent(layer="intent", event_type="llm_call", trace_id="req_abc123")
  ├── 记忆召回 → TraceEvent(layer="recall", event_type="embedding", trace_id="req_abc123")
  │   ├── FAISS 搜索 → TraceEvent(layer="recall", event_type="db_query", trace_id="req_abc123", parent="...")
  │   └── 强度更新 → TraceEvent(layer="recall", event_type="db_query", trace_id="req_abc123", parent="...")
  ├── 上下文组装 → TraceEvent(layer="context", event_type="overflow", trace_id="req_abc123")
  ├── LLM 生成 → TraceEvent(layer="generate", event_type="llm_call", trace_id="req_abc123")
  └── 事实抽取 → TraceEvent(layer="fact", event_type="llm_call", trace_id="req_abc123")
\`\`\`

有了 trace_id，你可以问：在请求 \`req_abc123\` 中，哪一步最慢？哪一步消耗了最多 token？哪一步失败了？

两个关键规则：
- **trace_id 在请求入口生成**（\`POST /chat\` 端点），注入到所有步骤中
- **子事件用 parent_event_id 链接**——FAISS 搜索是记忆召回的一个子步骤，不另占一层

#### 条件 3：时间线渲染

前端需要一条呈现所有事件的时间线（而不是四个独立面板）。按时间轴排列的事件序列——每个事件可展开查看详情：

\`\`\`mermaid
%% title: 图：统一追踪时间线概念设计
gantt
    title 单次请求 req_abc123 全链路追踪
    dateFormat HH:mm:ss.SSS
    axisFormat %S.%L

    section 意图
    LLM 意图分类           :0, 200ms

    section 记忆
    FAISS embedding 搜索   :50, 120ms
    强度更新 SQLite        :170, 30ms

    section 上下文
    溢出检测               :200, 15ms

    section 生成
    LLM 生成回复           :215, 1800ms

    section 事实
    事实抽取 LLM 调用      :2015, 600ms
\`\`\`

这个设计的关键决策：**section 平行展示非阻塞步骤**。如果意图分类和记忆召回可以并行（它们当前是串行的，但未来可能独立），时间线应该展示两个并行的泳道。

### 当前距离统一视图有多远

把四个系统合并为一条时间线，需要的工作量：

| 组件 | 当前状态 | 改进路径 | 估计工作量 |
|------|---------|---------|:---------:|
| 事件采集 | API 层面已有注入点（chat.py 的管线步骤） | 在每个步骤注入 \`record_trace_event()\` | 小（~50 行注入代码 · 截至 Phase 61） |
| 统一事件表 | pipeline_trace 是最近似的结构 | 新建 \`trace_events\` 表，包含上述 \`TraceEvent\` 所有字段 | 中（~100 行 schema + migrate · 截至 Phase 61） |
| trace_id | 不存在 | 在 \`POST /chat\` 入口生成 UUID，通过 context 或参数传递 | 小（~10 行 · 截至 Phase 61） |
| 时间线前端 | 前端有 ContextPanel 和 TracePanel | 新增 Timeline 组件，复用已有的 DataState 三态模式 | 中（2 个组件文件 · 截至 Phase 61） |

> 置信度：0.80`,
    l3: `### 当前行业实践

**OpenAI 的 Trace API** 是当前最直接的全链路追踪参考。在 Assistants API 中，每个 Run 对象包含一个 \`thread_id\` 和 \`step_details\` 数组——每个 step 包含 \`type\`（"message_creation" / "tool_calls"）、\`started_at\`、\`completed_at\`、\`elapsed\`。这是 GPT 系统内部各步骤的统一追踪格式：所有步骤共享同一个 Run ID，按时间顺序排列，前端通过 \`listRunSteps\` 获取。但这个追踪仅限于 OpenAI 内部的步骤——外部工具调用和 RAG 检索的细节不在其中。

**LangSmith**（LangChain 的可观测性平台）是目前最成熟的第三方全链路追踪方案。它定义了一个 \`Run\` 对象——每个 Run 包含 \`id\`、\`name\`、\`run_type\`（"llm" / "chain" / "tool" / "retriever"）、\`inputs\`、\`outputs\`、\`start_time\`、\`end_time\`、\`parent_run_id\`。子 Run 通过 \`parent_run_id\` 形成树状结构。LangSmith 的 Web UI 提供了树视图和时间线视图两种模式——时间线视图正是 GlassCortex 需要的。

**OpenTelemetry Traces** 是业界标准。基本概念：Trace（一次完整请求）由多个 Span 组成。Span 包含 trace_id、span_id、parent_span_id、start_time、end_time、attributes、events。多个 Span 通过 trace_id 关联，通过 parent_span_id 形成层级。OpenTelemetry 的 Span 模型几乎就是前面设计的 \`TraceEvent\`——时间戳、层标识、父子关系——的不同命名版本。OTel 的优点是生态成熟：有 SDK（Python + TypeScript）、有可视化工具（Jaeger / Zipkin）、有存储后端（Elasticsearch / ClickHouse）。

### GlassCortex 的路径

**短期（最小可行方案）**：不引入新存储，在 API 响应体中增加一个 \`trace_events: list[dict]\` 字段。\`POST /chat\` 端点在每个步骤前后调用 \`record_event()\` 追加到列表。前端新增 Timeline 组件按时间渲染。数据仅在内存中——刷新即消失，适合调试和可观测性面板。这利用了已有的 \`ChatResponse.api_trace\` 扩展机制（\`extra="allow"\`）。

**中期**：新建 \`trace_events\` 表，每个事件持久化。通过 \`session_id\` 和 \`trace_id\` 索引。前端 Timeline 组件支持历史查询（"显示上一轮请求的 trace"）。此时可以回答"上次生成慢的具体原因分析"这类跨轮诊断问题。

**长期**：用 OpenTelemetry 的 Span 模型替换自建事件模型。通过 OTel SDK 采集所有层的 Span，导出到 Jaeger UI。此时 GlassCortex 的全链路追踪变成了"一个 Jaeger 查询"——不需要自研可视化。代价是引入了 OTel SDK 的依赖和运维复杂度。

### 一个更深的问题

统一追踪能回答"发生了什么"，但不能直接回答"为什么"。即使你看到时间线上意图分类花了 300ms、召回花 200ms、生成花了 2s——你仍然不知道"能不能把生成从 2s 降到 1s"。

**追踪是诊断的起点，不是终点。** 统一视图的价值是把"发生了什么"的认知成本降到最低——把四个手动对齐的仪表盘变成一个同步时间线——为后续的 "为什么发生"（profiling）和 "如何优化"（benchmarking）铺路。没有统一视图的诊断就像让消防员看四个监控摄像头的回放去找起火点——能做到，但浪费了宝贵的反应时间。

> 置信度：0.75`,
  },
];
