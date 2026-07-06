/** 优先级档位 */
export type PriorityTier = "P0" | "P1" | "P2" | "P3";

/** 章节标识符 */
export type ChapterId = "ch1" | "ch2" | "ch3" | "ch4" | "ch5" | "ch6" | "ch7" | "ch8";

/** 各层置信度 */
export interface LayerConfidence {
  l0: number;
  l1: number;
  l2: number;
  l3: number;
}

/** Lab 面板链接，打通 Learn→Lab 桥接 */
export interface LabLink {
  /** Lab 面板 tab key（对应 LabShell TABS 中的 key） */
  tab: string;
  /** 按钮文案，默认 "在实验室中探索" */
  label?: string;
}

/** 跨章关联类型 */
export type CrossChapterType =
  | "prerequisite"   // 前置知识 — 该问题帮助理解此问题
  | "extension"      // 深入扩展 — 此问题在此章中有进一步展开
  | "parallel"       // 平行对照 — 两章对同一概念的处理方式对比
  | "application"    // 应用场景 — 此处概念在彼章中有实际应用
  | "contrast";      // 对比 — 两章对同一问题的不同视角

/** 跨章关联：一条指向其他章节的关联链接 */
export interface CrossChapterConnection {
  /** 目标问题 ID，如 "q1.2" */
  questionId: string;
  /** 关联类型 */
  type: CrossChapterType;
  /** 关系描述，如 "解释上下文窗口溢出为何影响规划深度" */
  relationship: string;
  /** 目标问题文本（内容管线填充，渲染时优先使用；fallback 为 questionId） */
  targetQuestion?: string;
}

/** 单条 Q&A 答案 */
export interface Answer {
  /** 问题编号，如 "q1.1" */
  id: string;
  /** 问题文本 */
  question: string;
  /** 所属章节 ID */
  chapter: ChapterId;
  /** 章节中文标题 */
  chapterTitle: string;
  /** 优先级档位 */
  priority: PriorityTier;
  /** 各层置信度 */
  confidence: LayerConfidence;
  /** 综合置信度（各层最低值） */
  overallConfidence: number;
  /** L0 — 一句话结论 */
  l0: string;
  /** L1 — 核心解释 */
  l1: string;
  /** L2 — 深度探索（可为空） */
  l2: string;
  /** L3 — 前沿与未解（可为空） */
  l3: string;
  /** 关联 Lab 面板链接（可选） */
  labLinks?: LabLink[];
  /** 跨章关联（可选）— 链接到其他章节的相关问题 */
  crossChapterConnections?: CrossChapterConnection[];
}

/** 章节元数据 */
export interface Chapter {
  /** 章节 ID */
  id: ChapterId;
  /** 短标签，如 "Ch1" */
  shortLabel: string;
  /** 中文标题 */
  title: string;
  /** 英文标题 */
  englishTitle: string;
  /** 章节核心问题 */
  coreQuestion: string;
  /** 关联的 Remixicon 图标组件名 */
  icon: string;
  /** 本章问题总数 */
  questionCount: number;
  /** 已完成的答案数 */
  answeredCount: number;
}
