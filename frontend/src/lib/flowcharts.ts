/**
 * 流程图数据层。
 *
 * 为 MermaidDiagram 组件提供统一的流程图定义。
 * 三张图覆盖 GlassCortex 核心架构：记忆管线（端到端）、上下文分区（四区模型）、
 * 遗忘曲线（艾宾浩斯衰减循环）。
 *
 * 设计原则：
 * - `chart` 为原始 Mermaid 语法字符串，由 MermaidDiagram 渲染
 * - `category` 支持 accordion 分组展示（对标 glossary.ts 的 GlossaryCategory）
 * - 数据写死在前端（架构不频繁变动），与 API 解耦
 */

/** 流程图分类 */
export type FlowchartCategory = "记忆管线" | "上下文工程" | "记忆科学";

/** 单个流程图定义 */
export interface FlowchartDef {
  /** 唯一标识，用于 React key 和 getFlowchart 查询 */
  id: string;
  /** 中文标题，显示在 accordion 展开区 */
  title: string;
  /** 简短描述（1-2 句），显示在流程图下方 */
  description: string;
  /** 所属分类 */
  category: FlowchartCategory;
  /** 原始 Mermaid 图定义字符串 */
  chart: string;
  /** 默认渲染高度（px），溢出滚动 */
  defaultHeight: number;
}

/** 全量流程图注册表 */
export const FLOWCHARTS: Record<string, FlowchartDef> = {
  "memory-pipeline": {
    id: "memory-pipeline",
    title: "端到端记忆管线",
    description:
      "从用户输入到 AI 回复的完整 8 阶段流程——意图分类、遗忘衰减、记忆召回、溢出模拟、提示词构建、LLM 调用、回复存储与事实提取。",
    category: "记忆管线",
    chart: `graph LR
    A["💬 用户输入"] --> B["🧭 意图分类<br/>Planner"]
    B --> C["📉 遗忘衰减<br/>ForgettingEngine"]
    C --> D["🔍 记忆召回<br/>RecallEngine"]
    D --> E["🪟 溢出模拟<br/>OverflowSim"]
    E --> F["📝 提示词构建<br/>SystemPrompt"]
    F --> G["🤖 LLM 调用<br/>DeepSeek"]
    G --> H["💾 回复存储<br/>+ 事实提取"]

    style A fill:#4f46e5,stroke:#4338ca,color:#fff
    style B fill:#6366f1,stroke:#4f46e5,color:#fff
    style C fill:#818cf8,stroke:#6366f1,color:#fff
    style D fill:#a5b4fc,stroke:#818cf8,color:#111
    style E fill:#c7d2fe,stroke:#a5b4fc,color:#111
    style F fill:#a5b4fc,stroke:#818cf8,color:#111
    style G fill:#818cf8,stroke:#6366f1,color:#fff
    style H fill:#4f46e5,stroke:#4338ca,color:#fff`,
    defaultHeight: 200,
  },

  "context-partition": {
    id: "context-partition",
    title: "上下文分区模型",
    description:
      "上下文窗口被划分为四个功能区域——系统提示词、记忆召回、对话历史、工具定义。溢出时触发三种策略之一：守门员（FIFO）、策展人（低分先丢）、口述史家（压缩摘要）。",
    category: "上下文工程",
    chart: `graph TD
    ROOT["🪟 上下文窗口<br/>容量: 128K tokens"] --> SYS["⚙️ 系统提示词<br/>base_tokens"]
    ROOT --> MEM["🧠 记忆召回<br/>recalled tokens"]
    ROOT --> HIST["💬 对话历史<br/>user tokens"]
    ROOT --> TOOLS["🔧 工具定义<br/>0 tokens"]

    ROOT --> OVERFLOW{"⚠️ 溢出?<br/>total > window"}
    OVERFLOW -->|"FIFO"| T1["🗑️ 守门员<br/>Truncate<br/>最旧先出"]
    OVERFLOW -->|"低分先丢"| T2["🎯 策展人<br/>Prioritize<br/>保留高分"]
    OVERFLOW -->|"压缩"| T3["📜 口述史家<br/>Summarize<br/>摘要留存"]

    style ROOT fill:#4f46e5,stroke:#4338ca,color:#fff
    style SYS fill:#94a3b8,stroke:#64748b,color:#fff
    style MEM fill:#34d399,stroke:#059669,color:#111
    style HIST fill:#818cf8,stroke:#4f46e5,color:#fff
    style TOOLS fill:#64748b,stroke:#475569,color:#fff
    style OVERFLOW fill:#f59e0b,stroke:#d97706,color:#111
    style T1 fill:#ef4444,stroke:#dc2626,color:#fff
    style T2 fill:#f59e0b,stroke:#d97706,color:#111
    style T3 fill:#3b82f6,stroke:#2563eb,color:#fff`,
    defaultHeight: 450,
  },

  "forgetting-curve": {
    id: "forgetting-curve",
    title: "艾宾浩斯遗忘曲线",
    description:
      "记忆随时间指数衰减——新记忆强度 1.0，随时间衰减（s × e^(-λt)）。被召回时增强 +0.3（上限 1.0），重新进入衰减循环。长期未召回的记忆降至阈值以下后不再被检索。",
    category: "记忆科学",
    chart: `graph TD
    A["🆕 新记忆编码<br/>强度 s = 1.0<br/>λ = 0.1/hour"] --> B["📉 被动衰减<br/>s(t) = s₀ × e^(-λt)"]
    B --> C{"🔍 是否被<br/>召回?"}
    C -->|"是"| D["💪 强度增强<br/>s += 0.3<br/>上限 1.0"]
    D --> B
    C -->|"否"| E["📊 持续衰减<br/>s → 0"]
    E --> F["🗑️ 低于阈值<br/>不再召回<br/>（数据保留）"]

    style A fill:#4f46e5,stroke:#4338ca,color:#fff
    style B fill:#818cf8,stroke:#6366f1,color:#fff
    style C fill:#f59e0b,stroke:#d97706,color:#111
    style D fill:#34d399,stroke:#059669,color:#fff
    style E fill:#94a3b8,stroke:#64748b,color:#fff
    style F fill:#ef4444,stroke:#dc2626,color:#fff`,
    defaultHeight: 420,
  },
};

/** 按 id 获取流程图（未找到返回 undefined） */
export function getFlowchart(id: string): FlowchartDef | undefined {
  return FLOWCHARTS[id];
}

/** 按分类分组获取全部流程图 */
export function getFlowchartsGrouped(): Record<
  FlowchartCategory,
  FlowchartDef[]
> {
  const groups: Record<FlowchartCategory, FlowchartDef[]> = {
    记忆管线: [],
    上下文工程: [],
    记忆科学: [],
  };
  for (const fc of Object.values(FLOWCHARTS)) {
    groups[fc.category].push(fc);
  }
  return groups;
}

/** 分类显示标签映射 */
export const FLOWCHART_CATEGORY_LABELS: Record<FlowchartCategory, string> = {
  记忆管线: "🔀 记忆管线",
  上下文工程: "📐 上下文工程",
  记忆科学: "🧪 记忆科学",
};
