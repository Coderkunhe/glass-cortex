import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api/client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api client", () => {
  it("ping() returns service identity", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ service: "glasscortex", version: "1.0", status: "ok" }),
    });

    const result = await api.ping();
    expect(result.service).toBe("glasscortex");
  });

  it("chat() sends correct POST body and returns typed response", async () => {
    const mockResponse = {
      response_text: "你好！",
      episode_id: 1,
      intent: { category: "chat", confidence: 0.9, rationale: "用户打招呼" },
      context_meta: {
        window_size: 4096,
        base_tokens: 100,
        memories_before: 5,
        memories_token_before: 500,
        memories_after: 3,
        overflow_applied: false,
        strategy: "prioritize",
        dropped_count: 0,
        dropped_items: [],
        user_message_tokens: 10,
        total_estimated_tokens: 150,
      },
      api_trace: {
        caller: "chat",
        model: "deepseek-v4-flash",
        temperature: 0.7,
        max_tokens: 1024,
        elapsed_ms: 500,
        prompt_tokens: 100,
        completion_tokens: 50,
      },
      recall_items: [],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await api.chat({ user_input: "你好", session_id: "" });
    expect(result.response_text).toBe("你好！");
    expect(result.episode_id).toBe(1);
    expect(result.intent?.category).toBe("chat");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/chat"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_input: "你好", session_id: "" }),
      }),
    );
  });

  it("chat() throws ApiClientError on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({ error: "llm_unavailable", detail: "LLM 不可用" }),
    });

    await expect(api.chat({ user_input: "test", session_id: "" })).rejects.toThrow("LLM 不可用");
  });

  it("health() returns health data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          service: "glasscortex",
          overall_status: "ok",
          components: {},
          recovery_suggestions: [],
        }),
    });

    const result = await api.health();
    expect(result.overall_status).toBe("ok");
  });

  // ── Metrics ──────────────────────────────────────────────────────────

  it("getTokens() returns typed token summary", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
          },
          total_prompt_tokens: 500,
          total_completion_tokens: 200,
          total_tokens: 700,
        }),
    });

    const result = await api.getTokens();
    expect(result.total_tokens).toBe(700);
    expect(result.by_call_point.chat_engine.prompt_tokens).toBe(500);
  });

  it("getSteps() returns typed step summary", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          steps: {
            intent_classify: { count: 3, total_ms: 450, avg_ms: 150, min_ms: 120, max_ms: 180 },
          },
        }),
    });

    const result = await api.getSteps();
    expect(result.steps.intent_classify.count).toBe(3);
    expect(result.steps.intent_classify.avg_ms).toBe(150);
  });

  // ── Traces ──────────────────────────────────────────────────────────

  it("getTraces() fetches with optional session_id filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 1, session_id: "s1", step_name: "chat", elapsed_ms: 120, status: "ok", metrics: {}, created_at: 1719000000 },
        ]),
    });

    const result = await api.getTraces("s1", 20);
    expect(result).toHaveLength(1);
    expect(result[0].step_name).toBe("chat");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=s1"),
      expect.anything(),
    );
  });

  it("getTracesByStep() fetches with required step_name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await api.getTracesByStep("compression", 100);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("step_name=compression"),
      expect.anything(),
    );
  });

  it("getTraceCount() returns count with optional session", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ count: 42, session_id: "s1" }),
    });

    const result = await api.getTraceCount("s1");
    expect(result.count).toBe(42);
  });

  // ── Memory ──────────────────────────────────────────────────────────

  it("getEpisodes() fetches with optional since filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 1, content: "test", importance: 0.8, initial_strength: 1.0, lambda: 0.1, timestamp: 1719000000, faiss_id: null, access_count: 0, last_recall: null },
        ]),
    });

    const result = await api.getEpisodes(10);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("test");
  });

  it("getFacts() fetches with optional subject filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 1, content: "猫是哺乳动物", confidence: 0.95, source_episode_id: 2, faiss_id: null, subject: "猫", relation: "是", object: "哺乳动物", timestamp: 1719000000 },
        ]),
    });

    const result = await api.getFacts(50);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("猫");
  });

  it("recallMemories() sends correct POST body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ query: "猫", items: [], count: 0 }),
    });

    await api.recallMemories({ query: "猫", top_k: 10, threshold: 0.2 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/memory/recall"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "猫", top_k: 10, threshold: 0.2 }),
      }),
    );
  });

  it("triggerDecay() sends POST with optional lambda override", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ items_decayed: 5, deltas: [] }),
    });

    const result = await api.triggerDecay({ lambda_override: 0.05 });
    expect(result.items_decayed).toBe(5);
  });

  // ── Context ─────────────────────────────────────────────────────────

  it("simulateOverflow() posts simulation params and returns result", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          strategy: "prioritize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 10,
          memories_token_before: 1200,
          memories_after: 6,
          memories_token_after: 700,
          dropped_count: 4,
          dropped_items: ["old memory 1", "old memory 2"],
          kept_items: [],
          overflow_triggered: true,
          total_estimated_tokens: 1550,
          usage_pct: 37.8,
          wasted_tokens: 500,
          available_tokens: 2546,
          summary_line: "10 条记忆→保留 6 条",
          strategy_label: "优先级 (prioritize)",
        }),
    });

    const result = await api.simulateOverflow({
      recalled: [{ id: 1, content: "test" }],
      strategy: "prioritize",
      window_size: 4096,
    });
    expect(result.strategy).toBe("prioritize");
    expect(result.overflow_triggered).toBe(true);
    expect(result.dropped_count).toBe(4);
  });

  it("compareStrategies() returns all three strategy results", async () => {
    const mockResult = {
      strategy: "truncate",
      window_size: 4096,
      base_tokens: 800,
      user_tokens: 50,
      memories_before: 10,
      memories_token_before: 1200,
      memories_after: 4,
      memories_token_after: 500,
      dropped_count: 6,
      dropped_items: [],
      kept_items: [],
      overflow_triggered: true,
      total_estimated_tokens: 1350,
      usage_pct: 33.0,
      wasted_tokens: 700,
      available_tokens: 2746,
      summary_line: "summary",
      strategy_label: "删减 (truncate)",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          truncate: mockResult,
          prioritize: { ...mockResult, strategy: "prioritize", strategy_label: "优先级 (prioritize)" },
          summarize: { ...mockResult, strategy: "summarize", strategy_label: "摘要 (summarize)" },
        }),
    });

    const result = await api.compareStrategies({ window_size: 4096 });
    expect(result.truncate.strategy).toBe("truncate");
    expect(result.prioritize.strategy).toBe("prioritize");
    expect(result.summarize.strategy).toBe("summarize");
  });

  // ── Profiles ────────────────────────────────────────────────────────

  it("listProfiles() returns profile list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: [{ name: "default", db_size_bytes: 1024, has_index: true, episode_count: 10, fact_count: 5, index_vectors: 15 }],
          current: "default",
        }),
    });

    const result = await api.listProfiles();
    expect(result.current).toBe("default");
    expect(result.profiles).toHaveLength(1);
  });

  // ── Logs ────────────────────────────────────────────────────────────

  it("getLogs() fetches with query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          entries: [{ timestamp: "2026-01-01T00:00:00", level: "INFO", logger: "test", message: "hello", raw: "hello" }],
          total_lines: 100,
          file_size_bytes: 2048,
          page: 1,
          page_size: 20,
        }),
    });

    const result = await api.getLogs({ tail_n: 50, level: "INFO" });
    expect(result.entries).toHaveLength(1);
    expect(result.total_lines).toBe(100);
  });

  // ── Session ──────────────────────────────────────────────────────

  it("resetSession() sends POST to /session/reset and returns WipeResponse", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "wiped",
          profile: "default",
          detail: "所有数据已清空，引擎已重新初始化。",
        }),
    });

    const result = await api.resetSession();
    expect(result.status).toBe("wiped");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/session/reset"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ── Lab: Experiment & Analytics ─────────────────────────────────────

  it("getCacheStats() returns embedding and fact cache stats", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          embedding: { hits: 100, misses: 20, size: 1000, total_requests: 120, hit_rate_pct: 83.3 },
          fact: { hits: 50, misses: 10, size: 64, total_requests: 60, hit_rate_pct: 83.3 },
        }),
    });

    const result = await api.getCacheStats();
    expect(result.embedding.hits).toBe(100);
    expect(result.embedding.hit_rate_pct).toBe(83.3);
    expect(result.fact?.misses).toBe(10);
  });

  it("getEmbeddingCoords() fetches PCA coordinates with optional max_vectors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          coords: [{ id: 1, x: 0.5, y: -0.3, z: 0.1, label: "test memory", kind: "episode", color: "#4f6ef7" }],
          total_vectors: 42,
          pca_variance_explained: [0.45, 0.30, 0.15],
        }),
    });

    const result = await api.getEmbeddingCoords(100);
    expect(result.coords).toHaveLength(1);
    expect(result.coords[0].kind).toBe("episode");
    expect(result.total_vectors).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("max_vectors=100"),
      expect.anything(),
    );
  });

  it("getEmbeddingCoords() works without optional max_vectors param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          coords: [],
          total_vectors: 0,
          pca_variance_explained: [],
        }),
    });

    const result = await api.getEmbeddingCoords();
    expect(result.coords).toHaveLength(0);
    expect(result.total_vectors).toBe(0);
  });

  it("getDecayDistribution() returns histogram bins", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          bins: [
            { bin_label: "0.0-0.1", count: 3, avg_strength: 0.05 },
            { bin_label: "0.9-1.0", count: 7, avg_strength: 0.95 },
          ],
          total_episodes: 10,
          decay_lambda: 0.1,
        }),
    });

    const result = await api.getDecayDistribution();
    expect(result.bins).toHaveLength(2);
    expect(result.total_episodes).toBe(10);
    expect(result.decay_lambda).toBe(0.1);
  });

  it("getKnowledgeGraph() returns nodes and edges", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          nodes: [{ id: "猫", label: "猫", group: "subject", weight: 5 }],
          edges: [{ source: "猫", target: "哺乳动物", label: "是", confidence: 0.95 }],
          total_facts: 8,
        }),
    });

    const result = await api.getKnowledgeGraph();
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0].weight).toBe(5);
    expect(result.total_facts).toBe(8);
  });

  it("getExperimentPresets() returns all presets", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          presets: [
            {
              id: "recall_top_k_3_vs_7",
              label_a: "top_k=3 (保守)",
              label_b: "top_k=7 (激进)",
              settings_a: { recall_top_k: 3 },
              settings_b: { recall_top_k: 7 },
              description: "对比保守 vs 激进的 top-k 召回设置",
            },
          ],
        }),
    });

    const result = await api.getExperimentPresets();
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].id).toBe("recall_top_k_3_vs_7");
  });

  it("getStrategyPersonas() returns three strategy personas", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          personas: [
            {
              id: "truncate",
              name: "守门员",
              subtitle: "严格先到先出",
              icon: "ri-door-line",
              description: "FIFO 策略：最旧的记忆最先丢弃。",
              color: "var(--gm-warning)",
            },
            {
              id: "prioritize",
              name: "策展人",
              subtitle: "按相关性排序",
              icon: "ri-stack-line",
              description: "按 recall score 排序，低分优先丢弃。",
              color: "var(--gm-brand)",
            },
            {
              id: "summarize",
              name: "口述史家",
              subtitle: "旧记忆压缩为摘要",
              icon: "ri-file-text-line",
              description: "旧消息压缩为一句话摘要保留。",
              color: "var(--gm-success)",
            },
          ],
        }),
    });

    const result = await api.getStrategyPersonas();
    expect(result.personas).toHaveLength(3);
    expect(result.personas[0].id).toBe("truncate");
    expect(result.personas[1].name).toBe("策展人");
  });

  it("runExperiment() sends POST with user input and returns A/B results", async () => {
    const mockResult = {
      label: "A",
      settings: {},
      recalled_count: 5,
      response_text: "hello",
      response_length: 5,
      chat_prompt_tokens: 100,
      chat_completion_tokens: 50,
      chat_total_tokens: 150,
      fact_prompt_tokens: 80,
      fact_completion_tokens: 40,
      fact_total_tokens: 120,
      facts_extracted: 2,
      fact_contents: ["猫是哺乳动物"],
      db_path: "/tmp/exp_a",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          result_a: { ...mockResult, label: "top_k=3" },
          result_b: { ...mockResult, label: "top_k=7", recalled_count: 7 },
          diffs: [
            {
              dimension: "recalled_count",
              label_a: "top_k=3",
              label_b: "top_k=7",
              value_a: 5,
              value_b: 7,
              delta: "+2",
              direction: "b_better",
              detail: "B 组多召回 2 条记忆",
            },
          ],
          elapsed_ms: 1234.5,
        }),
    });

    const result = await api.runExperiment({
      user_input: "猫是什么",
      preset_id: "recall_top_k_3_vs_7",
    });

    expect(result.result_a.label).toBe("top_k=3");
    expect(result.result_b.recalled_count).toBe(7);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].direction).toBe("b_better");
    expect(result.elapsed_ms).toBe(1234.5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/lab/experiment-run"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_input: "猫是什么", preset_id: "recall_top_k_3_vs_7" }),
      }),
    );
  });

  it("runExperiment() throws ApiClientError on server error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({ error: "bad_request", detail: "必须提供 preset_id 或 settings_a/settings_b" }),
    });

    await expect(
      api.runExperiment({ user_input: "test" }),
    ).rejects.toThrow("必须提供 preset_id 或 settings_a/settings_b");
  });

  // ── Error handling for new endpoints ───────────────────────────────

  it("getTokens() throws ApiClientError on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ error: "internal", detail: "服务内部错误" }),
    });

    await expect(api.getTokens()).rejects.toThrow("服务内部错误");
  });

  // ── Planner ─────────────────────────────────────────────────────────

  it("classifyIntent() posts user_msg and returns classification", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          category: "指令",
          confidence: 0.85,
          rationale: "用户请求执行操作",
          trace: {
            system_prompt: "你是一个意图分类器...",
            raw_response: '{"category": "指令", "confidence": 0.85}',
            token_usage: { prompt_tokens: 200, completion_tokens: 30 },
          },
        }),
    });

    const result = await api.classifyIntent({
      user_msg: "帮我写一段代码",
    });

    expect(result.category).toBe("指令");
    expect(result.confidence).toBe(0.85);
    expect(result.rationale).toBe("用户请求执行操作");
    expect(result.trace.token_usage).toBeDefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/planner/classify"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_msg: "帮我写一段代码" }),
      }),
    );
  });

  it("classifyIntent() throws ApiClientError on non-ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({ error: "planner_unavailable", detail: "Planner 不可用" }),
    });

    await expect(
      api.classifyIntent({ user_msg: "test" }),
    ).rejects.toThrow("Planner 不可用");
  });

  // ── Plan Storage (Phase 53 Batch 2) ──────────────────────────────────

  it("getPlans() fetches recent plans without subtasks", async () => {
    const mockPlans = [
      { id: 1, session_id: "s1", user_msg: "消息1", intent_category: "提问",
        rationale: "r1", confidence: 0.8, subtask_count: 2,
        dag_edges_json: '[["1","2"]]', created_at: 1719700000 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlans),
    });

    const result = await api.getPlans();
    expect(result).toEqual(mockPlans);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/planner/plans?limit=20"),
      expect.anything(),
    );
  });

  it("getPlans() accepts optional session_id filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await api.getPlans("sess-A", 10);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("session_id=sess-A");
    expect(url).toContain("limit=10");
  });

  it("getPlan() fetches single plan with inline subtasks", async () => {
    const mockDetail = {
      id: 42, session_id: "s1", user_msg: "测试", intent_category: "指令",
      rationale: "理由", confidence: 0.9, subtask_count: 2,
      dag_edges_json: '[["1","2"]]', created_at: 1719700000,
      subtasks: [
        { id: 1, plan_run_id: 42, subtask_id: "1", description: "任务A",
          depends_on_json: "[]", sort_order: 0, status: "pending", created_at: 1719700000 },
        { id: 2, plan_run_id: 42, subtask_id: "2", description: "任务B",
          depends_on_json: '["1"]', sort_order: 1, status: "pending", created_at: 1719700000 },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    const result = await api.getPlan(42);
    expect(result).toEqual(mockDetail);
    expect(result.subtasks).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/planner/plans/42"),
      expect.anything(),
    );
  });

  it("getPlan() throws ApiClientError on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () =>
        Promise.resolve({ error: "not_found", detail: "Plan run 9999 不存在" }),
    });

    await expect(api.getPlan(9999)).rejects.toThrow("Plan run 9999 不存在");
  });

  // ── Retry behaviour ──────────────────────────────────────────────────
  // Network errors (TypeError from fetch) are retried up to 2 times.
  // HTTP errors (4xx, 5xx) are NOT retried — the request may have
  // partially succeeded on the server.

  describe("retry on network errors", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on network error (TypeError) and succeeds on second attempt", async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ service: "glasscortex", version: "1.0", status: "ok" }),
        });

      const promise = api.ping();
      await vi.advanceTimersByTimeAsync(1_100); // skip first sleep(1000)
      const result = await promise;

      expect(result.service).toBe("glasscortex");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries on network error and succeeds on third attempt", async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ service: "glasscortex", version: "1.0", status: "ok" }),
        });

      const promise = api.ping();
      await vi.advanceTimersByTimeAsync(1_100); // skip first sleep(1000)
      await vi.advanceTimersByTimeAsync(2_100); // skip second sleep(2000)
      const result = await promise;

      expect(result.service).toBe("glasscortex");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry on HTTP errors (e.g. 503)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "service_unavailable", detail: "down" }),
      });

      await expect(api.ping()).rejects.toThrow("down");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on 4xx client errors (e.g. 404)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not_found", detail: "gone" }),
      });

      await expect(api.ping()).rejects.toThrow("gone");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on AbortError (user cancelled)", async () => {
      const abortErr = new DOMException("The operation was aborted", "AbortError");
      mockFetch.mockRejectedValue(abortErr);

      await expect(api.ping()).rejects.toThrow("aborted");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
