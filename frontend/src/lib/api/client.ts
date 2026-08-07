import type {
  ChatRequest,
  ChatResponse,
  HealthResponse,
  ApiError,
  TokenSummary,
  StepSummary,
  TraceItem,
  TraceCountResponse,
  DeleteTracesRequest,
  DeleteTracesResponse,
  EpisodeOut,
  FactOut,
  RecallRequest,
  RecallResponse,
  DecayRequest,
  DecayResponse,
  SimulateOverflowRequest,
  OverflowSimResponse,
  CompareStrategiesRequest,
  CompareStrategiesResponse,
  ProfileInfo,
  ProfileListResponse,
  ProfileSwitchRequest,
  ProfileSwitchResponse,
  TagSummaryItem,
  TagDetailResponse,
  LogQueryParams,
  LogResponse,
  LogDetailResponse,
  CompressionStatsResponse,
  WipeResponse,
  TierDistributionResponse,
  SessionForgetRequest,
  SessionForgetResponse,
  PlannerClassifyRequest,
  PlannerClassifyResponse,
  ReflectionRequest,
  ReflectionResponse,
  PlanRun,
  PlanDetail,
  PlanOverrideRequest,
  PlanOverrideResponse,
  CacheStatsResponse,
  CacheEntriesResponse,
  EmbeddingCoordsResponse,
  DecayDistributionResponse,
  KnowledgeGraphResponse,
  ExperimentPresetsResponse,
  ExperimentRunRequest,
  ExperimentRunResponse,
  StrategyPersonasResponse,
  FactConfidenceUpdateRequest,
  FactConfidenceUpdateResponse,
  CostWaterfallResponse,
  AdminHealthResponse,
  DocListItem,
  DocContentResponse,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Default request timeout (30s). Long-running endpoints (chat, experiment-run)
 *  may need longer; callers can override via { signal: AbortSignal.timeout(n) }. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum number of automatic retries for transient failures. */
const MAX_RETRIES = 2;
/** Exponential backoff delays for retry attempts (1s, 2s). */
const RETRY_DELAYS = [1_000, 2_000];

/** Return true if the error is worth retrying (transient).
 *  Only network-level failures (TypeError from fetch) are retried —
 *  they happen before any HTTP response and are always safe to retry.
 *  HTTP errors (even 5xx) are NOT retried because the request may have
 *  partially succeeded on the server side. */
function isRetryable(err: unknown, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  // Never retry user-initiated aborts
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // Network errors (fetch throws TypeError on connection failure)
  if (err instanceof TypeError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public apiError: ApiError,
  ) {
    super(apiError.detail || apiError.error);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Merge caller-provided signal with default timeout so every request
    // has a deadline.  If the caller passed its own signal, we race against
    // it; otherwise we use the 30 s default.
    const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
        signal,
      });

      if (!res.ok) {
        let body: ApiError;
        try {
          body = await res.json();
        } catch {
          body = { error: "unknown", detail: res.statusText };
        }
        throw new ApiClientError(res.status, body);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err, attempt)) throw err;
      // Wait before retrying (exponential backoff)
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  // All retries exhausted — re-throw the last error
  throw lastError;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return "";
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `?${qs}`;
}

export const api = {
  /** Service identity / ping */
  ping: () => request<{ service: string; version: string; status: string }>("/"),

  /** Health check — 5-component status */
  health: () => request<HealthResponse>("/health"),

  /** Send a chat message — full pipeline. Pass { signal } to enable abort.
   *  Timeout: 300s (aligned with nginx proxy_read_timeout, backend llm_timeout=120s). */
  chat: (body: ChatRequest, opts?: { signal?: AbortSignal }) =>
    request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify(body),
      signal: opts?.signal ?? AbortSignal.timeout(300_000),
    }),

  /** Phase 66 B135 — SSE 流式聊天。
   *
   *  始终发送 `stream: true`。后端在缓存命中时自动降级为非流式（返回 JSON），
   *  此方法检测 Content-Type 自适应处理两种响应。
   *
   *  @param body — 聊天请求体（stream 字段由此方法自动设为 true）
   *  @param onToken — 每收到一个 token delta 时回调
   *  @param opts.signal — 用于 abort 取消流
   *  @returns 完整的 ChatResponse（来自 done 事件或缓存命中 JSON） */
  chatStream: async (
    body: ChatRequest,
    onToken: (delta: string) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatResponse> => {
    const url = `${BASE_URL}/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
      signal: opts?.signal,
    });

    if (!res.ok) {
      let apiErr: ApiError;
      try {
        apiErr = await res.json();
      } catch {
        apiErr = { error: "unknown", detail: res.statusText };
      }
      throw new ApiClientError(res.status, apiErr);
    }

    const contentType = res.headers.get("Content-Type") || "";

    // ── 缓存命中：后端返回 JSON 而非 SSE ──
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as ChatResponse;
      // 一次性推送全部文本，模拟流式体验
      if (json.response_text) {
        onToken(json.response_text);
      }
      return json;
    }

    // ── SSE 流式解析 ──
    if (!res.body) {
      throw new Error("浏览器不支持 ReadableStream 流式读取");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    return new Promise<ChatResponse>((resolve, reject) => {
      const read = () => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              reject(new Error("SSE 流意外结束——未收到 done 事件"));
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // 按双换行切分完整 SSE 事件
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || ""; // 保留不完整的事件尾部

            for (const part of parts) {
              if (!part.trim()) continue;

              let eventType = "";
              let dataStr = "";

              for (const line of part.split("\n")) {
                if (line.startsWith("event: ")) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  dataStr = line.slice(6);
                }
              }

              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);

                if (eventType === "token") {
                  if (typeof data.delta === "string" && data.delta) {
                    onToken(data.delta);
                  }
                } else if (eventType === "done") {
                  resolve(data as ChatResponse);
                  return;
                } else if (eventType === "error") {
                  reject(
                    new ApiClientError(503, {
                      error: data.error || "stream_error",
                      detail: data.detail || "流式生成失败",
                    }),
                  );
                  return;
                }
              } catch {
                // JSON 解析失败——跳过此事件，继续读取
              }
            }

            read(); // 继续读取下一块
          })
          .catch((err) => {
            // AbortError → 静默返回（用户主动取消）
            if (err instanceof DOMException && err.name === "AbortError") {
              return;
            }
            reject(err);
          });
      };

      read();
    });
  },

  // ── Metrics ──────────────────────────────────────────────────────────

  /** Token usage by call point */
  getTokens: () => request<TokenSummary>("/metrics/tokens"),

  /** Step latency summary */
  getSteps: () => request<StepSummary>("/metrics/steps"),

  // ── Traces ──────────────────────────────────────────────────────────

  /** List traces, optionally filtered by session */
  getTraces: (sessionId?: string, limit = 50) =>
    request<TraceItem[]>(`/traces${buildQuery({ session_id: sessionId, limit })}`),

  /** List traces filtered by step name */
  getTracesByStep: (stepName: string, limit = 200) =>
    request<TraceItem[]>(`/traces/by-step${buildQuery({ step_name: stepName, limit })}`),

  /** Count traces, optionally by session and/or step name */
  getTraceCount: (sessionId?: string, stepName?: string) =>
    request<TraceCountResponse>(`/traces/count${buildQuery({ session_id: sessionId, step_name: stepName })}`),

  /** List distinct step names appearing in traces */
  getTraceSteps: () => request<string[]>("/traces/steps"),

  /** Delete oldest traces beyond retention limit */
  deleteOldTraces: (body: DeleteTracesRequest) =>
    request<DeleteTracesResponse>("/traces/delete-old", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Memory ──────────────────────────────────────────────────────────

  /** List episodes */
  getEpisodes: (limit = 50, since?: number) =>
    request<EpisodeOut[]>(`/memory/episodes${buildQuery({ limit, since })}`),

  /** List facts */
  getFacts: (limit = 50, subject?: string) =>
    request<FactOut[]>(`/memory/facts${buildQuery({ limit, subject })}`),

  /** Semantic recall */
  recallMemories: (body: RecallRequest) =>
    request<RecallResponse>("/memory/recall", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Trigger forgetting decay on all episodes */
  triggerDecay: (body?: DecayRequest) =>
    request<DecayResponse>("/memory/decay", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  /** Get memory tier distribution (hot/warm/cold) */
  getTiers: () => request<TierDistributionResponse>("/memory/tiers"),

  // ── Context ─────────────────────────────────────────────────────────

  /** Single-strategy overflow simulation */
  simulateOverflow: (body: SimulateOverflowRequest) =>
    request<OverflowSimResponse>("/context/simulate-overflow", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Compare all three overflow strategies side-by-side */
  compareStrategies: (body: CompareStrategiesRequest) =>
    request<CompareStrategiesResponse>("/context/compare-strategies", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Profiles ────────────────────────────────────────────────────────

  /** List all profiles */
  listProfiles: () => request<ProfileListResponse>("/profiles"),

  /** Get current active profile metadata (episode/fact counts, etc.) */
  getCurrentProfile: () => request<ProfileInfo>("/profiles/current"),

  /** Create a new profile (initializes DB + FAISS index) */
  createProfile: (name: string) =>
    request<ProfileInfo>(`/profiles/${encodeURIComponent(name)}`, {
      method: "POST",
    }),

  /** Delete a profile directory and all its data */
  deleteProfile: (name: string) =>
    request<void>(`/profiles/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  /** Switch active profile (saves current state, reinitializes engines) */
  switchProfile: (body: ProfileSwitchRequest) =>
    request<ProfileSwitchResponse>("/profiles/switch", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Tags ─────────────────────────────────────────────────────────────

  /** Get tag cloud summary for sidebar profile card */
  getTagSummary: (limit?: number) =>
    request<TagSummaryItem[]>(`/memory/tag-summary${limit ? `?limit=${limit}` : ""}`),

  /** Get full tag detail — source facts, episodes, confidence log */
  getTagDetail: (subject: string, relation: string) =>
    request<TagDetailResponse>(
      `/memory/tag-detail?subject=${encodeURIComponent(subject)}&relation=${encodeURIComponent(relation)}`
    ),

  /** 纠正或加星事实 — 调整置信度并写入审计日志 */
  updateFactConfidence: (factId: number, body: FactConfidenceUpdateRequest) =>
    request<FactConfidenceUpdateResponse>(
      `/memory/facts/${factId}/confidence`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ── Logs ────────────────────────────────────────────────────────────

  /** Read and query server logs */
  getLogs: (params?: LogQueryParams) =>
    request<LogResponse>(`/logs${buildQuery(params as Record<string, string | number | undefined> ?? {})}`),

  /** Get single log entry detail by line number */
  getLogById: (id: number) =>
    request<LogDetailResponse>(`/logs/${id}`),

  /** Compression token savings — session (ledger) + historical (pipeline_trace) */
  getCompressionStats: () =>
    request<CompressionStatsResponse>("/metrics/compression"),

  // ── Session ──────────────────────────────────────────────────────────

  /** One-click reset: wipe all data and reinitialize engines */
  resetSession: () =>
    request<WipeResponse>("/session/reset", { method: "POST" }),

  /** Phase 66 B21 — 按 session_id 定向遗忘对话记忆 */
  forgetSession: (body: SessionForgetRequest) =>
    request<SessionForgetResponse>("/session/forget", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Planner ─────────────────────────────────────────────────────────

  /** Standalone intent classification (no chat pipeline) */
  classifyIntent: (body: PlannerClassifyRequest) =>
    request<PlannerClassifyResponse>("/planner/classify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Reflect on completed planning — quality assessment + improvement suggestions */
  reflect: (body: ReflectionRequest) =>
    request<ReflectionResponse>("/planner/reflect", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Plan Storage (Phase 53 Batch 2) ──────────────────────────────────

  /** List recent plan runs (no subtasks) */
  getPlans: (sessionId?: string, limit = 20) =>
    request<PlanRun[]>(`/planner/plans${buildQuery({ session_id: sessionId, limit })}`),

  /** Get single plan run with inline subtasks */
  getPlan: (planId: number) =>
    request<PlanDetail>(`/planner/plans/${planId}`),

  /** Apply user overrides to plan subtasks (Phase 57 B3) */
  updatePlan: (planId: number, body: PlanOverrideRequest) =>
    request<PlanOverrideResponse>(`/planner/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Lab: Experiment & Analytics ─────────────────────────────────────

  /** Cache hit-rate stats for embedding + fact extraction caches */
  getCacheStats: () => request<CacheStatsResponse>("/lab/cache-stats"),

  /** Cache entry contents for a specific cache type */
  getCacheEntries: (cacheType: string, limit?: number) => {
    const params = new URLSearchParams({ cache_type: cacheType });
    if (limit !== undefined) params.set("limit", String(limit));
    return request<CacheEntriesResponse>(`/lab/cache-entries?${params}`);
  },

  /** PCA-reduced 3D embedding coordinates for visualization */
  getEmbeddingCoords: (maxVectors?: number) =>
    request<EmbeddingCoordsResponse>(
      `/lab/embedding-coords${buildQuery({ max_vectors: maxVectors })}`,
    ),

  /** Ebbinghaus decay distribution histogram */
  getDecayDistribution: () =>
    request<DecayDistributionResponse>("/lab/memory-decay-distribution"),

  /** Knowledge graph nodes + edges from fact triples */
  getKnowledgeGraph: () =>
    request<KnowledgeGraphResponse>("/lab/knowledge-graph"),

  /** All available A/B experiment presets */
  getExperimentPresets: () =>
    request<ExperimentPresetsResponse>("/lab/experiment-presets"),

  /** Run an A/B experiment with the given input */
  runExperiment: (body: ExperimentRunRequest) =>
    request<ExperimentRunResponse>("/lab/experiment-run", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Context overflow strategy persona descriptions */
  getStrategyPersonas: () =>
    request<StrategyPersonasResponse>("/lab/strategy-personas"),

  /** Token cost waterfall — gross → savings → net breakdown
   *  @param params.by — "call_point" for per-call_point grouping (B95 E3)
   *  @param params.since / params.until — epoch seconds time filter (B96 E4 prep) */
  getCostWaterfall: (params?: {
    by?: string;
    since?: number;
    until?: number;
  }) => {
    const qs = params
      ? buildQuery({
          by: params.by,
          since: params.since,
          until: params.until,
        })
      : "";
    return request<CostWaterfallResponse>(`/lab/cost-waterfall${qs}`);
  },

  // ── Admin (Phase 68 B3) ─────────────────────────────────────────────

  /** Admin 工程健康指标 — check-docs JSON 结构化数据 */
  getAdminHealth: () => request<AdminHealthResponse>("/admin/health"),

  /** Admin 文档清单 — docs/ 下所有 .md 文件元数据 */
  getDocs: () => request<DocListItem[]>("/admin/docs"),

  /** Admin 获取单个文档 Markdown 原始内容 */
  getDocContent: (name: string) =>
    request<DocContentResponse>(`/admin/docs/${encodeURIComponent(name)}`),
};
