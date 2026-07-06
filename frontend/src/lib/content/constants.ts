/** 意图类别 → Tailwind 颜色映射（单一真相源）。
 *
 * 所有需要按意图类别渲染颜色的组件必须从此处导入，不得本地定义副本。
 * 消费者：IntentPill · ReplanComparePanel
 *
 * 结构：{ bg, text, border } — 分别对应背景色、文字色、边框色。
 * dark: 变体用于暗色模式下覆盖文字色以保持对比度。
 */
export const INTENT_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  闲聊: {
    bg: "bg-slate-500/10",
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-500/20",
  },
  提问: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/20",
  },
  指令: {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/20",
  },
  探索: {
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    border: "border-violet-500/20",
  },
  澄清: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-600 dark:text-cyan-400",
    border: "border-cyan-500/20",
  },
};

/** 默认意图颜色（未知/无分类时回退）。 */
export const DEFAULT_INTENT_COLORS = {
  bg: "bg-slate-500/10",
  text: "text-slate-500",
  border: "border-slate-500/20",
};
