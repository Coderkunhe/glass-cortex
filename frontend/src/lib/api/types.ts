/** TypeScript 接口 — 镜射 api/schemas.py Pydantic 模型
 *
 *  领域拆分 (Phase 35 Batch 4):
 *    types-chat.ts    — 聊天 / Planner / Health / Context 溢出模拟
 *    types-memory.ts  — 记忆 CRUD / 标签 / Session 管理
 *    types-lab.ts     — Lab 实验 / 分析 / 策略人格 / 成本瀑布
 *    types-profiles.ts — Profile 管理
 *    types-traces.ts  — 追踪 / 指标 / 日志
 */

export type {
  ChatRequest,
  IntentCategory,
  IntentResult,
  ContextMeta,
  ApiTrace,
  RecallItem,
  EpisodeRecallItem,
  FactRecallItem,
  RoutingInfo,
  ChatResponse,
  PlannerClassifyRequest,
  PlannerClassifyResponse,
  ReflectionRequest,
  ReflectionResponse,
  PlanSubtask,
  PlanRun,
  PlanDetail,
  PlanOverride,
  PlanOverrideAction,
  PlanOverrideRequest,
  PlanOverrideResponse,
  HealthComponent,
  HealthResponse,
  ApiError,
  FetchState,
  SimulateOverflowRequest,
  OverflowSimResponse,
  CompareStrategiesRequest,
  CompareStrategiesResponse,
} from "./types-chat";

export type {
  EpisodeOut,
  FactOut,
  RecallRequest,
  RecallResponse,
  DecayRequest,
  DecayDelta,
  DecayResponse,
  TagSummaryItem,
  FactConfidenceLogItem,
  TagFactItem,
  TagDetailResponse,
  FactConfidenceUpdateRequest,
  FactConfidenceUpdateResponse,
  WipeResponse,
  TierDistributionResponse,
  SessionForgetRequest,
  SessionForgetResponse,
} from "./types-memory";

export type {
  CacheStats,
  CacheStatsResponse,
  CacheEntryItem,
  CacheEntriesResponse,
  EmbeddingCoord,
  EmbeddingCoordsResponse,
  DecayBin,
  DecayDistributionResponse,
  GraphNode,
  GraphEdge,
  KnowledgeGraphResponse,
  ExperimentPreset,
  ExperimentPresetsResponse,
  ExperimentRunRequest,
  ExperimentResultSchema,
  ExperimentDiffSchema,
  ExperimentRunResponse,
  ExperimentHistoryEntry,
  StrategyPersona,
  StrategyPersonasResponse,
  CostWaterfallStep,
  CostWaterfallResponse,
} from "./types-lab";

export type {
  ProfileInfo,
  ProfileListResponse,
  ProfileSwitchRequest,
  ProfileSwitchResponse,
} from "./types-profiles";

export type {
  TokenSummary,
  StepSummary,
  TraceItem,
  TraceCountResponse,
  DeleteTracesRequest,
  DeleteTracesResponse,
  LogQueryParams,
  LogEntry,
  LogResponse,
  LogDetailResponse,
  CompressionStatsResponse,
} from "./types-traces";
