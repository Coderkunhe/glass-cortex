import type { Chapter } from "./types";

/**
 * 8 章元数据。
 * 每章对应 core_issues.md 中一个章节，
 * icon 为 @remixicon/react 组件名（由消费端按需导入）。
 */
export const CHAPTERS: Chapter[] = [
  {
    id: "ch1",
    shortLabel: "Ch1",
    title: "上下文工程",
    englishTitle: "Context Engineering",
    coreQuestion: "有限上下文窗口里塞什么、怎么塞、塞不下怎么办？",
    icon: "RiDashboardLine",
    questionCount: 17,
    answeredCount: 17,
  },
  {
    id: "ch2",
    shortLabel: "Ch2",
    title: "记忆系统",
    englishTitle: "Memory Systems",
    coreQuestion: "如何组织信息让系统在需要时找到对的东西？如何遗忘？",
    icon: "RiBrainLine",
    questionCount: 27,
    answeredCount: 27,
  },
  {
    id: "ch3",
    shortLabel: "Ch3",
    title: "任务规划",
    englishTitle: "Task Planning",
    coreQuestion: "复杂任务如何拆解、执行、纠偏？",
    icon: "RiTaskLine",
    questionCount: 17,
    answeredCount: 17,
  },
  {
    id: "ch4",
    shortLabel: "Ch4",
    title: "Token 效率",
    englishTitle: "Token Efficiency",
    coreQuestion: "每一分钱花在哪、值不值？",
    icon: "RiCoinsLine",
    questionCount: 10,
    answeredCount: 10,
  },
  {
    id: "ch5",
    shortLabel: "Ch5",
    title: "层间交互",
    englishTitle: "Inter-Layer Interaction",
    coreQuestion: "四大支柱之间的接口、时序、反馈循环如何建模？",
    icon: "RiGitMergeLine",
    questionCount: 6,
    answeredCount: 6,
  },
  {
    id: "ch6",
    shortLabel: "Ch6",
    title: "时间与节奏",
    englishTitle: "Time & Rhythm",
    coreQuestion: "记忆有衰减曲线，对话有节奏——时间维度如何建模？",
    icon: "RiTimerLine",
    questionCount: 6,
    answeredCount: 6,
  },
  {
    id: "ch7",
    shortLabel: "Ch7",
    title: "透明化设计",
    englishTitle: "Transparency Design",
    coreQuestion: "透明给谁看？不同观众需要看到的东西完全不同。",
    icon: "RiEyeLine",
    questionCount: 6,
    answeredCount: 6,
  },
  {
    id: "ch8",
    shortLabel: "Ch8",
    title: "元认知",
    englishTitle: "Metacognition",
    coreQuestion: "系统不仅做，还应该知道自己做得怎么样。",
    icon: "RiMentalHealthLine",
    questionCount: 6,
    answeredCount: 6,
  },
];
