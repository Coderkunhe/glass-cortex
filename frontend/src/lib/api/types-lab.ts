/** Lab 实验 + 分析 + 策略人格 + 成本瀑布领域类型 */

/** GET /lab/cache-stats — 单个缓存的命中率统计 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  total_requests: number;
  hit_rate_pct: number;
}

/** GET /lab/cache-stats 响应 — 嵌入缓存 + 事实缓存统计 */
export interface CacheStatsResponse {
  embedding: CacheStats;
  fact: CacheStats | null;
}

/** GET /lab/cache-entries — 单个缓存条目摘要 */
export interface CacheEntryItem {
  key: string;
  preview: string;
  tokens_est: number;
  kind: string;
}

/** GET /lab/cache-entries 响应 — 指定缓存的实际条目内容 */
export interface CacheEntriesResponse {
  cache_type: string;
  entries: CacheEntryItem[];
  total_entries: number;
  hits: number;
  misses: number;
  hit_rate_pct: number;
}

/** GET /lab/embedding-coords — 单个向量的 PCA 坐标 + 元数据 */
export interface EmbeddingCoord {
  id: number;
  x: number;
  y: number;
  z: number;
  label: string;
  kind: string;
  color: string;
}

/** GET /lab/embedding-coords 响应 — PCA 降维后的 3D 坐标集合 */
export interface EmbeddingCoordsResponse {
  coords: EmbeddingCoord[];
  total_vectors: number;
  pca_variance_explained: number[];
}

/** GET /lab/memory-decay-distribution — 强度区间桶 */
export interface DecayBin {
  bin_label: string;
  count: number;
  avg_strength: number;
}

/** GET /lab/memory-decay-distribution 响应 — Ebbinghaus 衰减分布 */
export interface DecayDistributionResponse {
  bins: DecayBin[];
  total_episodes: number;
  decay_lambda: number;
}

/** GET /lab/knowledge-graph — 知识图谱节点 */
export interface GraphNode {
  id: string;
  label: string;
  group: string;
  weight: number;
}

/** GET /lab/knowledge-graph — 知识图谱边 */
export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  confidence: number;
}

/** GET /lab/knowledge-graph 响应 — 三元组图数据 */
export interface KnowledgeGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_facts: number;
}

// ── Lab: A/B Experiment ──────────────────────────────────────────────

/** GET /lab/experiment-presets — 单个 A/B 实验预设 */
export interface ExperimentPreset {
  id: string;
  label_a: string;
  label_b: string;
  settings_a: Record<string, unknown>;
  settings_b: Record<string, unknown>;
  description: string;
}

/** GET /lab/experiment-presets 响应 — 全部可用预设 */
export interface ExperimentPresetsResponse {
  presets: ExperimentPreset[];
}

/** POST /lab/experiment-run 请求体 */
export interface ExperimentRunRequest {
  user_input: string;
  preset_id?: string | null;
  settings_a?: Record<string, unknown> | null;
  settings_b?: Record<string, unknown> | null;
  label_a?: string | null;
  label_b?: string | null;
}

/** POST /lab/experiment-run — 单次实验运行结果快照 */
export interface ExperimentResultSchema {
  label: string;
  settings: Record<string, unknown>;
  recalled_count: number;
  response_text: string;
  response_length: number;
  chat_prompt_tokens: number;
  chat_completion_tokens: number;
  chat_total_tokens: number;
  fact_prompt_tokens: number;
  fact_completion_tokens: number;
  fact_total_tokens: number;
  facts_extracted: number;
  fact_contents: string[];
  db_path: string;
}

/** POST /lab/experiment-run — 单维度 A/B 差异对比 */
export interface ExperimentDiffSchema {
  dimension: string;
  label_a: string;
  label_b: string;
  value_a: unknown;
  value_b: unknown;
  delta: string;
  direction: string;
  detail: string | null;
}

/** POST /lab/experiment-run 响应 — A/B 结果 + 差异 */
export interface ExperimentRunResponse {
  result_a: ExperimentResultSchema;
  result_b: ExperimentResultSchema;
  diffs: ExperimentDiffSchema[];
  elapsed_ms: number;
}

/** Client-side run history entry (B95 E1 prep — B96 will use this) */
export interface ExperimentHistoryEntry {
  id: number;
  timestamp: number;
  presetId: string;
  presetLabel: string;
  userInput: string;
  result: ExperimentRunResponse;
}

// ── Lab: Strategy Personas ───────────────────────────────────────────

/** GET /lab/strategy-personas — 单条策略人格 */
export interface StrategyPersona {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  description: string;
  color: string;
}

/** GET /lab/strategy-personas 响应 — 三种策略人格 */
export interface StrategyPersonasResponse {
  personas: StrategyPersona[];
}

// ── Lab: Cost Waterfall ──────────────────────────────────────────────

/** GET /lab/cost-waterfall — 瀑布图单步 */
export interface CostWaterfallStep {
  label: string;
  tokens: number;
  kind: "gross" | "savings" | "net" | "call_point";
  color: string;
}

/** GET /lab/cost-waterfall 响应 — Token 消耗瀑布流 */
export interface CostWaterfallResponse {
  steps: CostWaterfallStep[];
  gross_tokens: number;
  cache_savings: number;
  compression_savings: number;
  net_tokens: number;
}
