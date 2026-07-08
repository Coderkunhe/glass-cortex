/**
 * 中央术语注册表。
 *
 * 为 ExplainTooltip 提供统一的术语定义数据层。
 * 词条从 Python 源码提取，写死在前端（项目术语不频繁变动），与 API 解耦。
 *
 * 设计原则：
 * - `shortDef` 用于 hover tooltip（1-2 行，秒懂）
 * - `longDef` 用于详情展示（多段落，深入理解）
 * - `relatedTerms` 交叉链接，形成知识网络
 * - `category` 支持分组展示
 */

/** 术语分类（对齐四支柱 + 架构） */
export type GlossaryCategory = "记忆" | "上下文" | "Token" | "规划" | "架构";

/** 单个术语定义 */
export interface GlossaryTerm {
  /** 唯一标识，用于 ExplainTooltip 的 termId prop */
  id: string;
  /** 中文术语名 */
  term: string;
  /** 简短定义（1-2 句），hover tooltip 显示 */
  shortDef: string;
  /** 详细解释（多段落，\n\n 分隔），popover 显示 */
  longDef: string;
  /** 所属分类 */
  category: GlossaryCategory;
  /** 相关术语 id 列表，popover 底部显示为可点击 pills */
  relatedTerms: string[];
  /** remixicon class（可选），popover 标题前显示图标 */
  icon?: string;
}

/** 全量术语注册表（Record<id, GlossaryTerm>） */
export const GLOSSARY: Record<string, GlossaryTerm> = {
  "intent-recognition": {
    id: "intent-recognition",
    term: "意图识别",
    shortDef:
      "AI 在回复前先判断你想做什么——是提问、指令、闲聊还是探索？不同的意图走不同的处理管线。",
    longDef:
      "意图识别是 GlassCortex Planner 的第一步。每次你发送消息，Planner 会调用 LLM 将消息归入五个类别之一：" +
      "提问（需要事实性回答）、指令（需要执行操作）、闲聊（轻松对话）、探索（开放性问题）、" +
      "修正（对上一轮回复的反馈）。\n\n" +
      "分类结果决定了后续处理管线——提问会触发更强的记忆召回，指令会跳过不必要的 LLM 调用，" +
      "修正会调整上一轮的记忆权重。意图分类本身只消耗约 100-200 token（系统提示词 + 用户消息），" +
      "是一个轻量级的预处理步骤。\n\n" +
      "你可以在聊天页看到每条消息旁的彩色意图标签（IntentPill），" +
      "也可以在实验室页的「意图分类测试」面板中输入任意文本测试分类结果。",
    category: "规划",
    relatedTerms: ["planner", "context-window"],
    icon: "ri-focus-3-line",
  },

  "context-window": {
    id: "context-window",
    term: "上下文窗口",
    shortDef:
      "AI 能同时「看到」的最大文本量，以 token 计。超出窗口的内容会被遗忘或压缩——就像你的工作记忆只能同时记住 7±2 件事。",
    longDef:
      "上下文窗口是 LLM 的「工作记忆」——模型一次能处理的最大 token 数。" +
      "DeepSeek Chat 的窗口是 128K token（约 9 万个中文字），但这不代表应该塞满它。" +
      "越接近窗口上限，模型对中间信息的注意力越弱（Lost-in-the-Middle 效应）。\n\n" +
      "GlassCortex 的上下文由四个区域组成：系统提示词（定义 AI 的性格和规则）、记忆召回（从长期记忆中检索的相关内容）、" +
      "对话历史（当前会话的消息记录）、工具定义（MCP 工具的函数签名）。" +
      "当四个区域的总 token 数接近窗口上限时，溢出策略决定哪些内容被舍弃或压缩。\n\n" +
      "你可以在聊天页的 ContextBar 看到实时的四区 token 分布，在侧边栏调整窗口大小和溢出策略。",
    category: "上下文",
    relatedTerms: [
      "context-partition",
      "overflow-strategy",
      "token-budget",
      "system-prompt",
    ],
    icon: "ri-layout-masonry-line",
  },

  "memory-recall": {
    id: "memory-recall",
    term: "记忆召回",
    shortDef:
      "从 AI 的长期记忆中检索与当前对话相关的过去内容。语义相似度 + 衰减强度 + 重要性三者综合排序。",
    longDef:
      "记忆召回是 GlassCortex 记忆系统的核心——每次你发送消息，RecallEngine 会同时查询两个来源：" +
      "Episodes（完整对话片段，FAISS 向量索引）和 Facts（抽取的三元组知识）。\n\n" +
      "召回不是简单的「找最像的」。每条记忆有三个维度的得分：语义相似度（和当前消息有多相关）、" +
      "衰减强度（艾宾浩斯遗忘曲线计算出的当前强度）、重要性（原始标记的重要性权重）。" +
      "三者加权得到 composite score，top_k 条注入上下文窗口。\n\n" +
      "低于召回阈值（recall_threshold）的记忆不会进入上下文；低于截断阈值（truncation_threshold）的记忆" +
      "虽然被召回但会被截断——在召回叙事面板中以虚线分隔显示。",
    category: "记忆",
    relatedTerms: [
      "ebbinghaus-decay",
      "faiss-index",
      "embedding",
      "context-partition",
    ],
    icon: "ri-brain-line",
  },

  "token-budget": {
    id: "token-budget",
    term: "Token 预算",
    shortDef:
      "把上下文窗口的 token 像预算一样分配到四个区域（系统/记忆/历史/工具），确保每一 token 花在刀刃上。",
    longDef:
      "Token 预算是对上下文窗口的主动管理策略——不是被动等待溢出，而是主动规划每个区域的 token 配额。" +
      "核心思想：上下文窗口是稀缺资源，应该像财务预算一样分配。\n\n" +
      "典型分配策略：系统提示词占用 10-15%（固定开销），记忆召回 30-40%（核心价值），" +
      "对话历史 40-50%（对话连续性），工具定义 5-10%（按需加载）。" +
      "当对话变长，历史区占比增长时，预算机制会自动降低召回数量或启用消息压缩。\n\n" +
      "你可以在成本瀑布图中看到每个管线步骤的 token 消耗明细，在侧边栏调整窗口参数。",
    category: "Token",
    relatedTerms: ["context-window", "overflow-strategy", "context-partition"],
    icon: "ri-funds-line",
  },

  "overflow-strategy": {
    id: "overflow-strategy",
    term: "溢出策略",
    shortDef:
      "当上下文超出窗口上限时的处理方式——守门员（FIFO，最旧先出）、策展人（低分先丢）或口述史家（压缩旧消息为摘要）。",
    longDef:
      "当系统提示词 + 记忆召回 + 对话历史 + 工具定义的总 token 数超过窗口上限时，" +
      "溢出策略决定哪些内容被移除。GlassCortex 有三种策略人格：\n\n" +
      "守门员（Truncate / FIFO）：先进先出，最旧的消息先被丢弃。简单粗暴，不会丢失重要信息——因为最旧的往往最不相关。" +
      "适合短对话或快速问答。\n\n" +
      "策展人（Prioritize）：按 composite score（强度 × 相似度 × 重要性）排序，低分先丢。" +
      "智能但有计算开销，适合需要保留关键上下文的深度对话。\n\n" +
      "口述史家（Summarize）：将旧消息调用 LLM 压缩为一句话摘要，保留信息但损失细节。" +
      "最省 token 但也有额外 LLM 调用成本，适合长时间会话。\n\n" +
      "你可以在实验室页的「上下文溢出模拟器」中对比不同策略的效果。",
    category: "上下文",
    relatedTerms: ["context-window", "token-budget", "context-partition"],
    icon: "ri-filter-3-line",
  },

  "ebbinghaus-decay": {
    id: "ebbinghaus-decay",
    term: "艾宾浩斯衰减",
    shortDef:
      "AI 记忆随时间指数衰减——刚记住的事记得牢，越久越模糊。λ 参数控制衰减速度。",
    longDef:
      "GlassCortex 使用艾宾浩斯遗忘曲线（指数衰减公式）模拟人类记忆的自然遗忘过程。" +
      "每条记忆存储时初始强度为 1.0（或由重要性加权后的值），随时间按指数衰减：" +
      "新强度 = 原强度 × e^(-λ × 天数)。\n\n" +
      "λ（lambda）是衰减率：λ=0.1 意味着一天后强度降到约 0.90，一周后约 0.50。" +
      "λ 越大忘得越快。记忆被召回时会「增强」——强度回升 0.1，模拟复习巩固效果。\n\n" +
      "衰减不是删除——遗忘引擎只降低强度，不删除数据。强度低于某个阈值时召回引擎会自然跳过它，" +
      "但原始对话记录始终保留。你可以在侧边栏调整 λ 滑块并预览衰减曲线，在实验室页的「衰减直方图」看全量记忆强度分布。",
    category: "记忆",
    relatedTerms: ["memory-recall", "confidence-score"],
    icon: "ri-line-chart-line",
  },

  "knowledge-graph": {
    id: "knowledge-graph",
    term: "知识图谱",
    shortDef:
      "AI 从对话中提取的三元组（主语-关系-宾语）形成的语义网络。每个节点是一个实体，边是它们之间的关系。",
    longDef:
      "知识图谱是 GlassCortex 事实层的可视化呈现。FactExtractor 从每轮对话中抽取三元组" +
      "（如「用户-拥有-布偶猫」），存入 Facts 表。所有三元组合在一起形成一张图——" +
      "节点是实体（人、物、概念），边是它们之间的关系。\n\n" +
      "图谱会自我演化：当新事实与旧事实冲突时（如「用户-拥有-布偶猫」vs「用户-拥有-英短」），" +
      "冲突检测机制会降低双方的置信度。被多次确认的事实置信度自动提升。\n\n" +
      "你可以在实验室页的「知识图谱」面板查看和拖拽交互式三元组图，在画像页的标签云中点击标签追溯来源对话。",
    category: "记忆",
    relatedTerms: ["fact-extraction", "confidence-score", "memory-recall"],
    icon: "ri-git-branch-line",
  },

  "system-prompt": {
    id: "system-prompt",
    term: "系统提示词",
    shortDef:
      "定义 AI 角色、行为规则和知识边界的预设指令。每次 API 调用都会携带，但不向用户展示。",
    longDef:
      "系统提示词是 LLM API 调用的第一条消息（role: system），在对话开始前注入。" +
      "它定义了 AI 的性格（友好、好奇、严谨）、行为约束（不要编造信息、主动说「我不知道」）、" +
      "和知识边界（你是一个帮助用户理解 AI 工作原理的教育工具）。\n\n" +
      "GlassCortex 的系统提示词还会动态注入当前召回的记忆和事实，让模型在回复时「知道」过去的对话内容。" +
      "这是记忆系统与对话生成之间的关键桥梁。\n\n" +
      "系统提示词目前是只读的——你可以在聊天页的 Ghost Prompt 视图（ProcessDrawer）中看到完整内容，" +
      "但暂时不能直接编辑。未来版本可能会开放模板自定义。",
    category: "上下文",
    relatedTerms: ["context-window", "context-partition", "planner"],
    icon: "ri-settings-3-line",
  },

  "fact-extraction": {
    id: "fact-extraction",
    term: "事实提取",
    shortDef:
      "从对话中自动抽取结构化知识——谁说了什么、有什么属性、和什么有关——存储为可查询的三元组。",
    longDef:
      "事实提取是 GlassCortex 知识积累的核心机制。每次你和 AI 对话后，" +
      "FactExtractor 会调用 LLM 从消息中抽取「主语-关系-宾语」三元组，" +
      "比如从「我有一只叫糯米的布偶猫」中抽取「用户-拥有-布偶猫（名字:糯米）」。\n\n" +
      "抽取后会经历三个步骤：实体归一化（「布偶猫」「布偶」「Ragdoll」统一为「布偶猫」）、" +
      "语义去重（与已有事实比较，重复则提升置信度）、冲突检测（同一关系不同宾语则降低双方置信度）。" +
      "这个过程每个会话只执行一次，且结果被缓存（相同的消息 + 事实状态不会重复调用 LLM）。\n\n" +
      "你可以在画像页看到从你的对话中提取的所有事实，在知识图谱中可视化它们的关系网络。",
    category: "记忆",
    relatedTerms: ["knowledge-graph", "confidence-score", "memory-recall"],
    icon: "ri-scissors-cut-line",
  },

  "confidence-score": {
    id: "confidence-score",
    term: "置信度评分",
    shortDef:
      "每一条事实都带有一个 0-1 的置信度——被反复确认的事实置信度高，冲突的事实置信度低。",
    longDef:
      "置信度是 GlassCortex 对所提取事实可靠性的量化评估。初始抽取时置信度由 LLM 自评（通常在 0.6-0.9 之间），" +
      "后续根据三种事件自动调整：\n\n" +
      "确认提升：同样的三元组再次出现 → 置信度 +0.05（有上限 0.98）\n" +
      "冲突惩罚：同一主语-关系出现不同宾语 → 双方置信度各 -0.2\n" +
      "人为修正：你可以手动标记事实为「错误」（置信度设为 0）或「加星」（冷冻结，不参与衰减）\n\n" +
      "置信度低于 0.3 的事实默认不在知识图谱和标签云中显示，但可以在画像页的筛选器中放宽阈值。",
    category: "记忆",
    relatedTerms: ["fact-extraction", "knowledge-graph", "ebbinghaus-decay"],
    icon: "ri-verified-badge-line",
  },

  "faiss-index": {
    id: "faiss-index",
    term: "FAISS 向量索引",
    shortDef:
      "Meta 开源的高性能向量相似度搜索引擎。GlassCortex 用它存储和检索对话的语义向量，是记忆召回的底层引擎。",
    longDef:
      "FAISS（Facebook AI Similarity Search）是一个专为稠密向量设计的高效相似度搜索库。" +
      "GlassCortex 将每条对话消息通过 Sentence Transformer 转换为 384 维语义向量，" +
      "存入 FAISS 索引（IndexIDMap 封装）。\n\n" +
      "每次记忆召回时，用户消息也被转换为向量，FAISS 在毫秒级内从数万条历史记忆中找出语义最相似的 top_k 条。" +
      "这比 SQL LIKE 搜索快几个数量级，而且能匹配「意思相近但措辞不同」的内容。\n\n" +
      "FAISS 索引存储在 `data/{profile}/index.faiss` 文件中，与 SQLite 数据库分离。" +
      "Profile 切换时会自动加载对应的索引文件。你可以在实验室页的「嵌入空间」面板看到向量在 2D/3D 空间的分布。",
    category: "架构",
    relatedTerms: ["memory-recall", "embedding"],
    icon: "ri-database-2-line",
  },

  planner: {
    id: "planner",
    term: "规划器",
    shortDef:
      "GlassCortex 的「前额叶」——在每次回复前做意图分类，决定后续处理管线的路径。",
    longDef:
      "Planner 是 GlassCortex 任务规划支柱的第一个组件。它的职责很简单但关键：在 AI 开始「思考」之前，" +
      "先判断用户想要什么类型的交互。这个判断结果驱动下游管线——\n\n" +
      "提问类 → 加强记忆召回，不做不必要的工具调用\n" +
      "指令类 → 跳过意图展示，直接执行操作\n" +
      "探索类 → 降低召回阈值，允许更发散的记忆检索\n" +
      "闲聊类 → 轻量级管线，最小 token 消耗\n" +
      "修正类 → 调整上一轮记忆权重，不新增事实\n\n" +
      "Planner 本身非常轻量（~150 token 系统提示词 + 单轮 LLM 调用），" +
      "且可配置关闭（planner_enabled=false），此时所有消息按默认管线处理。",
    category: "规划",
    relatedTerms: ["intent-recognition", "token-budget"],
    icon: "ri-compass-3-line",
  },

  "context-partition": {
    id: "context-partition",
    term: "上下文分区",
    shortDef:
      "把上下文窗口按功能分成四个区域（系统提示/记忆召回/对话历史/工具定义），每个区域独立计算和展示 token 占用。",
    longDef:
      "上下文分区是 GlassCortex 透明化上下文窗口的方式——不是显示一个总 token 数，" +
      "而是拆成四个颜色编码的分区条，让你一眼看到每一部分的占比。\n\n" +
      "系统提示词区（蓝灰色）：AI 的角色定义和行为规则，每次调用固定开销 ~500-800 token。\n" +
      "记忆召回区（绿色）：从长期记忆中检索的相关历史内容，数量由 top_k 和阈值控制。\n" +
      "对话历史区（品牌色）：当前会话的消息记录，随时间增长，通常是最大的分区。\n" +
      "工具定义区（灰色）：MCP 工具的函数签名，按需加载，通常 0 token（无工具调用时）。\n\n" +
      "你可以在聊天页的 ContextBar 点击任意分区展开内容列表，在实验室页体验分区计算和溢出模拟。",
    category: "上下文",
    relatedTerms: [
      "context-window",
      "overflow-strategy",
      "memory-recall",
      "system-prompt",
    ],
    icon: "ri-bar-chart-horizontal-line",
  },

  glasscortex: {
    id: "glasscortex",
    term: "GlassCortex",
    shortDef:
      "一个透明化 AI Robot 认知层的教育产品——让 AI 的记忆、上下文、Token 消费和任务规划变得可见、可理解、可交互。",
    longDef:
      "GlassCortex（玻璃皮层）是一个开源教育项目，目标是让 AI 应用的工作原理变得透明。" +
      "它不碰基模推理本身（那是黑盒），而是透明化包裹大模型的「皮层」——\n\n" +
      "记忆如何形成与遗忘：从对话中抽取结构化知识，模拟艾宾浩斯遗忘曲线\n" +
      "上下文如何组装与溢出：四区 token 分布可视化，三种溢出策略可选\n" +
      "Token 如何计量与节省：全链路计量 + 缓存命中 + 消息压缩，每一 token 可追溯\n" +
      "意图如何识别与任务如何规划：五类意图分类驱动差异化的处理管线\n\n" +
      "技术栈：Next.js 16 App Router（前端）+ FastAPI（中间层）+ Python 引擎（记忆/上下文/规划）。" +
      "所有 AI 交互都是可解剖的——每条 LLM 调用的完整请求/响应/耗时/token 都有存档，可从聊天页的「深度抽屉」查看。",
    category: "架构",
    relatedTerms: [
      "intent-recognition",
      "context-window",
      "memory-recall",
      "token-budget",
    ],
    icon: "ri-bard-line",
  },

  embedding: {
    id: "embedding",
    term: "嵌入向量",
    shortDef:
      "把文本转换成高维空间中的坐标——语义相近的文本在空间中距离近，不相近的距离远。记忆召回的核心技术。",
    longDef:
      "嵌入（Embedding）是自然语言处理的核心技术：用神经网络把一段文本压缩成一个固定长度的浮点数数组（向量），" +
      "使得语义相似的文本产生相近的向量。GlassCortex 使用 Sentence Transformer（all-MiniLM-L6-v2）" +
      "将每条消息转换为 384 维向量。\n\n" +
      "这些向量的妙处在于：向量空间中「距离近」= 语义上「相关」。" +
      "所以记忆召回就是「把当前消息转为向量，在 FAISS 索引中找最近的 k 个向量，返回对应的消息」。" +
      "整个过程在毫秒级完成，不需要关键词匹配。\n\n" +
      "Embedding 结果被缓存——相同的文本不会重复调用模型推理。" +
      "你可以在实验室页的「嵌入空间」面板看到记忆向量在 PCA 降维后的 2D/3D 散点图。",
    category: "架构",
    relatedTerms: ["faiss-index", "memory-recall"],
    icon: "ri-braces-line",
  },

  // ═══════════════════════════════════════════════════════════════
  // 新增术语 (Phase 1000 Batch 17 — 四支柱审计 9 概念补齐)
  // ═══════════════════════════════════════════════════════════════

  "tiered-storage": {
    id: "tiered-storage",
    term: "多层存储",
    shortDef:
      "记忆按热度自动分成热/温/冷三层——热记忆优先召回，冷记忆压缩存储。就像你把常用 App 放首屏、不用的归档到文件夹。",
    longDef:
      "多层存储是 GlassCortex 记忆系统的分级策略，将每条 episode 按热力评分（heat score）分为三层：\n\n" +
      "热层（hot）：高频访问 + 高重要性 + 最近被召回过的记忆。这些记忆在每次召回中优先进入候选池，不会被遗忘引擎衰减。\n" +
      "温层（warm）：中等热度的记忆，正常参与召回但排在热层之后。\n" +
      "冷层（cold）：长期未被访问的低热度旧记忆，默认不参与召回，仅保留压缩摘要用于历史追溯。\n\n" +
      "热力评分由三项加权计算：新鲜度（距上次召回的时间，指数衰减）、访问频率（单位时间内的召回次数）、" +
      "重要性（原始标记权重 + 当前衰减强度）。分级阈值可通过 Settings 配置调整，默认 feature flag 关闭（不影响现有管线）。\n\n" +
      "TierRebalancer 定期重算全量记忆的热力评分并更新分级标签，确保分级反映最新访问模式。",
    category: "记忆",
    relatedTerms: ["memory-recall", "ebbinghaus-decay", "memory-consolidation"],
    icon: "ri-stack-line",
  },

  "mmr-rerank": {
    id: "mmr-rerank",
    term: "MMR 召回重排",
    shortDef:
      "召回结果不止按相关性排序——MMR 算法在「相关」和「多样」之间取平衡，避免返回一堆意思相同的重复记忆。",
    longDef:
      "MMR（Maximal Marginal Relevance，最大边际相关性）是召回引擎的后处理步骤。" +
      "FAISS 粗筛返回的候选记忆按语义相似度排序后，可能前 k 条都在说同一件事（比如全是「布偶猫」相关），" +
      "导致上下文窗口中的记忆多样性不足。\n\n" +
      "MMR 公式：MMR = λ × 相关性得分 - (1-λ) × 与已选记忆的最大相似度。" +
      "贪心选择 top_k 条：首轮选最高分，后续每轮选 MMR 得分最高的——即既相关、又与已选条目不太像的。" +
      "λ 参数控制平衡点：λ=1.0 纯相关性（退化为普通排序），λ=0.0 纯多样性。\n\n" +
      "重排后剩余的候选项会进入遗憾分析（RegretAnalysis），评估被牺牲的记忆是否有价值。",
    category: "记忆",
    relatedTerms: ["memory-recall", "faiss-index", "embedding"],
    icon: "ri-sort-desc",
  },

  "memory-consolidation": {
    id: "memory-consolidation",
    term: "记忆固化",
    shortDef:
      "AI 的「睡眠复习」——定期对旧记忆做慢降温，越少被提起的记忆越模糊。但高频访问的记忆享受「用进效应」抵御衰减。",
    longDef:
      "记忆固化引擎（ConsolidationCore）模拟人脑在睡眠中的记忆重组过程——不是实时衰减，而是日终批量处理。" +
      "每次 consolidate 调用对所有超过 grace_period（自创建或上次召回起算）的 episode 做慢降温：" +
      "importance 乘以 (1 - cooldown_rate)，下限为 cooldown_min_importance。\n\n" +
      "用进效应（use-it-or-lose-it）：高频召回的记忆获得衰减豁免。" +
      "访问频率通过 tanh 归一化映射到 [0, 1)，频率越高则降温幅度越小——你经常提起的话题，AI 记得更牢。" +
      "这与艾宾浩斯衰减形成互补：艾宾浩斯是实时强度曲线（每次召回时计算），固化是批量重要性调整（定时触发）。\n\n" +
      "固化引擎采用机会主义触发模式（consolidate_if_stale），默认 24h 间隔，避免频繁扫描全量记忆。",
    category: "记忆",
    relatedTerms: ["ebbinghaus-decay", "tiered-storage", "memory-recall"],
    icon: "ri-moon-clear-line",
  },

  "on-demand-expansion": {
    id: "on-demand-expansion",
    term: "按需展开",
    shortDef:
      "上下文窗口的四个分区默认只显示概览——点击任意分区才展开详细内容列表，避免信息过载的同时保留深入探索的入口。",
    longDef:
      "按需展开是 GlassCortex 上下文面板的交互设计原则：ContextBar 默认展示四区 token 占比的彩色分区条，" +
      "点击任意分区后展开该区的详细内容——系统提示词显示完整文本、记忆召回显示每条记忆的来源和得分、" +
      "对话历史显示消息时间线、工具定义显示函数签名。\n\n" +
      "设计动机：上下文窗口可能包含数千 token 的内容，一次性全部展示会造成信息过载。" +
      "按需展开让用户先看到宏观结构（四个颜色条），再按兴趣深入到微观细节——这是信息架构中「渐进式披露」的具体应用。" +
      "展开的内容在 ProcessDrawer 中渲染，不阻塞聊天主界面。",
    category: "上下文",
    relatedTerms: ["context-partition", "context-window", "overflow-strategy"],
    icon: "ri-layout-right-line",
  },

  "cross-session-continuity": {
    id: "cross-session-continuity",
    term: "跨会话连续性",
    shortDef:
      "AI 不仅记住当前会话，还能在新会话中延续之前的对话脉络——通过会话摘要和计划历史让多轮跨天对话保持连贯。",
    longDef:
      "跨会话连续性是上下文工程的关键挑战：LLM 本身无状态，每次新会话从零开始。" +
      "GlassCortex 通过两层机制实现跨会话的「记忆传承」：\n\n" +
      "会话摘要（Session Summary）：每次会话结束时生成结构化摘要（话题、关键决策、未完成任务），" +
      "存入 MemoryStore。下次新会话启动时，相关摘要自动注入上下文窗口的系统提示词区——" +
      "AI 在「开口」之前就知道你们上次聊了什么。\n\n" +
      "计划历史（Plan History）：历史规划记录（PlanRun + subtasks）持久化存储，" +
      "PlanHistoryRetriever 在新任务规划时检索相似历史计划，将其成败模式作为参考。" +
      "这让 AI 不仅记得「聊过什么」，还记得「上次怎么帮你解决类似问题的」。\n\n" +
      "两项机制均为可选功能，通过 feature flag 控制开关。",
    category: "上下文",
    relatedTerms: ["context-window", "memory-recall", "planner", "memory-guided-planning"],
    icon: "ri-link-m",
  },

  "model-routing": {
    id: "model-routing",
    term: "模型路由",
    shortDef:
      "不同难度的问题用不同能力的模型——简单闲聊用轻量模型省 token，复杂推理用强模型保质量。主模型挂了自动回退到备用模型。",
    longDef:
      "模型路由引擎（ModelRouter）基于 L1 意图分类结果自动选择最优模型：\n\n" +
      "简单意图（闲聊/澄清）→ 轻量模型：这类交互不需要深度推理，用 cheaper 模型可大幅节省 token 成本，" +
      "同时保持响应速度。\n" +
      "复杂意图（提问/指令/探索）→ 强模型：需要事实准确性和推理能力的场景，路由到能力更强的模型。\n\n" +
      "路由决策（RoutingDecision）记录每次选择的模型、理由、意图类别和复杂度标签，在前端可查看。" +
      "失败回退机制：主模型调用失败（超时/4xx/5xx）时自动切换到备用模型，最多 1 次重试。" +
      "如果两个模型都失败，抛出 FallbackExhaustedError 并向前端返回分类报错信息。",
    category: "Token",
    relatedTerms: ["intent-recognition", "token-budget", "planner"],
    icon: "ri-shuffle-line",
  },

  "dynamic-replanning": {
    id: "dynamic-replanning",
    term: "动态重规划",
    shortDef:
      "当对话方向偏离原计划时，AI 自动检测意图漂移并生成修正计划——成功的子任务保留，失败或不再相关的替换掉。",
    longDef:
      "动态重规划（ReplanDetector）是 Planner 的 L2.5 层——在任务执行过程中监控进度，" +
      "检测到意图漂移时触发局部重规划，而非重新开始整个计划。\n\n" +
      "三步流程：\n" +
      "① 步骤监控（StepRecord）：B1 提供 PENDING→RUNNING→SUCCESS/FAILED/SKIPPED 状态枚举，" +
      "monitor_step() 钩子追踪每个子任务的执行生命周期。\n" +
      "② 意图漂移检测：对比当前用户消息与原始 PlanResult，判断是否出现了原计划未覆盖的新需求或方向变化。\n" +
      "③ 局部重规划（PartialReplanResult）：仅替换失败或未完成的步骤，保留已成功的步骤——" +
      "就像建筑工地的设计变更，已浇筑的地基不动，只调整上层结构。\n\n" +
      "重规划结果在 Lab ReplanComparePanel 中并排展示原计划与新计划，便于理解 AI 的「纠偏」过程。",
    category: "规划",
    relatedTerms: ["planner", "intent-recognition", "reflection-loop"],
    icon: "ri-rewind-line",
  },

  "memory-guided-planning": {
    id: "memory-guided-planning",
    term: "记忆引导规划",
    shortDef:
      "AI 制定新计划时「翻旧账」——检索历史上处理过类似问题的计划，借鉴成功模式、避开踩过的坑。",
    longDef:
      "记忆引导规划（PlanHistoryRetriever）是记忆系统与任务规划的桥梁——" +
      "在 PlanGenerator 生成新计划之前，从 PlanRun 历史中检索与当前用户消息最相似的过往计划。" +
      "这些历史计划作为额外上下文注入规划 LLM 调用，让 AI 站在「巨人的肩膀」上做决策。\n\n" +
      "检索算法：纯逻辑零 LLM 调用——使用 Jaccard 相似度（基于中文字符 n-gram + URL/文件路径/版本号等实体特征）" +
      "匹配历史 plan_runs 记录。匹配到的历史计划包含原始 rationale、子任务结构和执行结果，" +
      "帮助新计划避免重复错误（如「上次类似问题的分解太细导致执行失败」）。\n\n" +
      "PlanHistoryRetriever 通过 feature flag 门控，默认关闭以保持管线简洁。" +
      "开启后会自动向 PlanGenerator 的 generate_plan() 注入 plan_history 参数。",
    category: "规划",
    relatedTerms: ["planner", "memory-recall", "cross-session-continuity"],
    icon: "ri-history-line",
  },

  "reflection-loop": {
    id: "reflection-loop",
    term: "反思闭环",
    shortDef:
      "每次会话结束后 AI 反思自己的规划质量——哪里判断对了、哪里估计错了——生成的改进建议会在下次规划时自动注入。",
    longDef:
      "反思闭环（ReflectionEngine）是 Planner 的 L3 层——将反思从单次总结升级为持续学习循环。" +
      "每次会话结束后，ReflectionEngine 调用 LLM 对本次对话的 PlanRun 进行质量评估：" +
      "子任务分解是否合理、意图分类是否准确、哪些步骤走偏了、为什么。\n\n" +
      "反思结果（ReflectionResult）包含三个部分：\n" +
      "reflections：2-3 句规划反思文本，总结本次规划的核心得失。\n" +
      "improvement_suggestions：可操作的改进建议列表（如「复杂问题应该先分解再分类」）。\n" +
      "plan_quality_score：0-1 规划质量评分，用于长期趋势追踪。\n\n" +
      "反思不是一次性的——insights 持久化到 MemoryStore，" +
      "下次同类意图触发时自动注入规划提示词，形成「规划→执行→反思→改进→下次更好」的闭环。" +
      "前端 SidebarReflectionCard 展示最近的反思摘要，Lab ReflectionComparePanel 提供历史反思对比视图。",
    category: "规划",
    relatedTerms: ["planner", "dynamic-replanning", "memory-guided-planning", "intent-recognition"],
    icon: "ri-loop-left-line",
  },
};

/** 按 id 获取术语（未找到返回 undefined） */
export function getTerm(id: string): GlossaryTerm | undefined {
  return GLOSSARY[id];
}

/** 按分类获取术语列表 */
export function getTermsByCategory(category: GlossaryCategory): GlossaryTerm[] {
  return Object.values(GLOSSARY).filter((t) => t.category === category);
}

/** 按分类分组获取全部术语 */
export function getTermsGrouped(): Record<GlossaryCategory, GlossaryTerm[]> {
  const groups: Record<GlossaryCategory, GlossaryTerm[]> = {
    记忆: [],
    上下文: [],
    Token: [],
    规划: [],
    架构: [],
  };
  for (const term of Object.values(GLOSSARY)) {
    groups[term.category].push(term);
  }
  return groups;
}

/** 按关键词搜索术语（匹配 term 名，不区分大小写的简单子串匹配） */
export function searchTerms(query: string): GlossaryTerm[] {
  const q = query.toLowerCase();
  return Object.values(GLOSSARY).filter(
    (t) =>
      t.term.toLowerCase().includes(q) ||
      t.shortDef.toLowerCase().includes(q),
  );
}

/** 分类显示标签映射 */
export const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  记忆: "🧠 记忆设计",
  上下文: "📐 上下文工程",
  Token: "💰 Token 效率",
  规划: "🧭 任务规划",
  架构: "🏗️ 系统架构",
};
