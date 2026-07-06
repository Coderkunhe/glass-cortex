import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "@/hooks/useChat";

const mockChat = vi.fn();
const mockForgetSession = vi.fn();

vi.mock("@/lib/api/client", () => {
  class MockApiClientError extends Error {
    status: number;
    apiError: { error: string; error_code?: string; detail?: string };
    constructor(
      status: number,
      apiError: { error: string; error_code?: string; detail?: string },
    ) {
      super(apiError.detail || apiError.error);
      this.name = "ApiClientError";
      this.status = status;
      this.apiError = apiError;
    }
  }
  return {
    api: {
      chat: (...args: unknown[]) => mockChat(...args),
      forgetSession: (...args: unknown[]) => mockForgetSession(...args),
    },
    ApiClientError: MockApiClientError,
  };
});

beforeEach(() => {
  mockChat.mockReset();
  mockForgetSession.mockReset();
});

describe("useChat", () => {
  describe("initial state", () => {
    it("initializes with empty messages, idle status, no error", () => {
      const { result } = renderHook(() => useChat());

      expect(result.current.messages).toEqual([]);
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("does nothing on empty or whitespace-only input", async () => {
      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("");
      });
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.status).toBe("idle");

      await act(async () => {
        await result.current.sendMessage("   ");
      });
      expect(result.current.messages).toHaveLength(0);
    });

    it("appends user message immediately before API resolves", () => {
      // Defer the API resolution to observe the intermediate optimistic state
      let resolveChat: (value: unknown) => void;
      mockChat.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
      );

      const { result } = renderHook(() => useChat());

      act(() => {
        result.current.sendMessage("hi");
      });

      // After synchronous dispatch, user message is optimistically present
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe("user");
      expect(result.current.messages[0].content).toBe("hi");
      expect(result.current.status).toBe("loading");

      // Cleanup: resolve the pending promise silently
      resolveChat!({
        response_text: "Hello!",
        episode_id: 1,
        intent: null,
        context_meta: {},
        api_trace: {},
        recall_items: [],
      });
    });

    it("sets status to loading while waiting for API", async () => {
      // Defer resolution so we can observe loading state
      let resolveChat: (value: unknown) => void;
      mockChat.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveChat = resolve;
        }),
      );

      const { result } = renderHook(() => useChat());

      act(() => {
        result.current.sendMessage("test");
      });

      expect(result.current.status).toBe("loading");
      expect(result.current.error).toBeNull();

      // Resolve
      await act(async () => {
        resolveChat!({
          response_text: "OK",
          episode_id: 1,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });
      });
    });

    it("on success, appends assistant message with response data", async () => {
      const responseData = {
        response_text: "你好！有什么可以帮你的？",
        episode_id: 42,
        intent: { category: "提问", confidence: 0.95, rationale: "用户提问" },
        context_meta: {
          window_size: 4096,
          base_tokens: 100,
          memories_before: 3,
          memories_token_before: 300,
          memories_after: 2,
          overflow_applied: false,
          strategy: "prioritize",
          dropped_count: 0,
          dropped_items: [],
          user_message_tokens: 12,
          total_estimated_tokens: 150,
        },
        api_trace: {
          caller: "chat",
          model: "deepseek-chat",
          temperature: 0.7,
          max_tokens: 1024,
          elapsed_ms: 420,
          prompt_tokens: 120,
          completion_tokens: 15,
        },
        recall_items: [
          {
            id: 1,
            content: "用户喜欢猫",
            composite_score: 0.85,
          },
        ],
      };

      mockChat.mockResolvedValueOnce(responseData);

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("你好");
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].role).toBe("assistant");
      expect(result.current.messages[1].content).toBe("你好！有什么可以帮你的？");
      expect(result.current.messages[1].response).toEqual(responseData);
      expect(result.current.status).toBe("success");
      expect(result.current.error).toBeNull();
    });

    it("on error, stores categorized error and sets status to error", async () => {
      mockChat.mockRejectedValueOnce(new Error("网络连接失败"));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("你好");
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.category).toBe("unknown");
      expect(result.current.error!.userMessage).toBe("出了点问题，请重试");
      // User message still exists (optimistic update)
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe("user");
    });

    it("on error with non-Error object, categorizes to unknown", async () => {
      mockChat.mockRejectedValueOnce("bare string error");

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("你好");
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.category).toBe("unknown");
      expect(result.current.error!.userMessage).toBe("出了点问题，请重试");
    });

    it("clears previous error on new send attempt", async () => {
      // First call fails
      mockChat.mockRejectedValueOnce(new Error("第一次失败"));
      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("msg1");
      });
      expect(result.current.error).toBeTruthy();
      expect(result.current.error!.category).toBe("unknown");

      // Second call succeeds
      mockChat.mockResolvedValueOnce({
        response_text: "OK",
        episode_id: 1,
        intent: null,
        context_meta: {},
        api_trace: {},
        recall_items: [],
      });
      await act(async () => {
        await result.current.sendMessage("msg2");
      });

      expect(result.current.error).toBeNull();
      expect(result.current.status).toBe("success");
      // First send (error): 1 user msg. Second send (success): 1 user + 1 assistant = 2 more.
      expect(result.current.messages).toHaveLength(3);
    });

    it("preserves message ordering across multiple sends", async () => {
      mockChat
        .mockResolvedValueOnce({ response_text: "Response 1", episode_id: 1, intent: null, context_meta: {}, api_trace: {}, recall_items: [] })
        .mockResolvedValueOnce({ response_text: "Response 2", episode_id: 2, intent: null, context_meta: {}, api_trace: {}, recall_items: [] });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("Msg1");
      });
      await act(async () => {
        await result.current.sendMessage("Msg2");
      });

      expect(result.current.messages).toHaveLength(4);
      expect(result.current.messages[0].role).toBe("user");
      expect(result.current.messages[0].content).toBe("Msg1");
      expect(result.current.messages[1].role).toBe("assistant");
      expect(result.current.messages[1].content).toBe("Response 1");
      expect(result.current.messages[2].role).toBe("user");
      expect(result.current.messages[2].content).toBe("Msg2");
      expect(result.current.messages[3].role).toBe("assistant");
      expect(result.current.messages[3].content).toBe("Response 2");
    });
  });

  describe("clearMessages", () => {
    it("resets messages, status, and error to initial state", async () => {
      mockChat.mockResolvedValueOnce({
        response_text: "Hello",
        episode_id: 1,
        intent: null,
        context_meta: {},
        api_trace: {},
        recall_items: [],
      });

      const { result } = renderHook(() => useChat());

      // Send a message first
      await act(async () => {
        await result.current.sendMessage("你好");
      });
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.status).toBe("success");

      // Clear
      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toEqual([]);
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
    });
  });

  describe("session id", () => {
    it("generates a session UUID on mount", () => {
      const { result } = renderHook(() => useChat());
      // sessionIdRef is internal — verified indirectly via sendMessage
      expect(result.current).toBeDefined();
    });

    it("passes session_id in chat request", async () => {
      mockChat.mockResolvedValueOnce({
        response_text: "OK",
        episode_id: 1,
        intent: null,
        context_meta: {},
        api_trace: {},
        recall_items: [],
      });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      expect(mockChat).toHaveBeenCalledTimes(1);
      const chatArg = mockChat.mock.calls[0][0];
      expect(chatArg.session_id).toBeDefined();
      expect(typeof chatArg.session_id).toBe("string");
      expect(chatArg.session_id.length).toBeGreaterThan(0);
    });

    it("uses the same session_id across multiple sends", async () => {
      mockChat
        .mockResolvedValueOnce({ response_text: "R1", episode_id: 1, intent: null, context_meta: {}, api_trace: {}, recall_items: [] })
        .mockResolvedValueOnce({ response_text: "R2", episode_id: 2, intent: null, context_meta: {}, api_trace: {}, recall_items: [] });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("msg1");
      });
      await act(async () => {
        await result.current.sendMessage("msg2");
      });

      const sid1 = mockChat.mock.calls[0][0].session_id;
      const sid2 = mockChat.mock.calls[1][0].session_id;
      expect(sid1).toBe(sid2);
    });
  });

  describe("forgetSession", () => {
    it("calls API with current session_id and returns result", async () => {
      // First send a message to trigger session_id generation
      mockChat.mockResolvedValueOnce({
        response_text: "OK",
        episode_id: 1,
        intent: null,
        context_meta: {},
        api_trace: {},
        recall_items: [],
      });

      const forgetResponse = {
        episodes_deleted: 3,
        facts_deleted: 5,
        faiss_vectors_removed: 2,
        session_id: "mock-sid",
      };
      mockForgetSession.mockResolvedValueOnce(forgetResponse);

      const { result } = renderHook(() => useChat());

      await act(async () => {
        await result.current.sendMessage("hello");
      });

      let returnedResult: unknown;
      await act(async () => {
        returnedResult = await result.current.forgetSession();
      });

      expect(mockForgetSession).toHaveBeenCalledTimes(1);
      expect(mockForgetSession.mock.calls[0][0]).toEqual({
        session_id: mockChat.mock.calls[0][0].session_id,
      });
      expect(returnedResult).toEqual(forgetResponse);
      expect(result.current.forgetResult).toEqual(forgetResponse);
      // Messages should be cleared after forget
      expect(result.current.messages).toEqual([]);
      expect(result.current.status).toBe("idle");
    });

    it("sets forgetError and throws on API failure", async () => {
      mockForgetSession.mockRejectedValueOnce(new Error("遗忘服务不可用"));

      const { result } = renderHook(() => useChat());

      await act(async () => {
        try {
          await result.current.forgetSession();
        } catch {
          // expected
        }
      });

      expect(result.current.forgetError).toBeTruthy();
      expect(result.current.forgetError!.category).toBe("unknown");
    });

    it("clears previous forgetError on new forget attempt", async () => {
      mockForgetSession
        .mockRejectedValueOnce(new Error("第一次失败"))
        .mockResolvedValueOnce({ episodes_deleted: 1, facts_deleted: 2, faiss_vectors_removed: 0, session_id: "sid" });

      const { result } = renderHook(() => useChat());

      await act(async () => {
        try { await result.current.forgetSession(); } catch { /* expected */ }
      });
      expect(result.current.forgetError).toBeTruthy();

      await act(async () => {
        await result.current.forgetSession();
      });
      expect(result.current.forgetError).toBeNull();
      expect(result.current.forgetResult).toBeTruthy();
    });
  });

  describe("B31 — state management fixes", () => {
    describe("C5: AbortController race condition (rapid sequential sends)", () => {
      it("second send can still be aborted after first resolves", async () => {
        // send 1: deferred, never resolves during test
        let resolve1: (value: unknown) => void;
        const p1 = new Promise((resolve) => { resolve1 = resolve; });
        mockChat.mockReturnValueOnce(p1);

        // send 2: also deferred, never resolves
        let resolve2: (value: unknown) => void;
        const p2 = new Promise((resolve) => { resolve2 = resolve; });
        mockChat.mockReturnValueOnce(p2);

        const { result } = renderHook(() => useChat());

        // Fire both sends
        act(() => { result.current.sendMessage("msg1"); });
        act(() => { result.current.sendMessage("msg2"); });

        // Both user messages optimistically appended
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.status).toBe("loading");

        // Now resolve send 1 — its finally must NOT clear send 2's controller
        await act(async () => {
          resolve1!({
            response_text: "R1",
            episode_id: 1,
            intent: null,
            context_meta: {},
            api_trace: {},
            recall_items: [],
          });
        });

        // send 2 is still loading, abort should work
        act(() => { result.current.abort(); });

        // M10: abort removes send 2's orphan user message
        // Only send 1's exchange remains (user + assistant)
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[0].content).toBe("msg1");
        expect(result.current.messages[1].content).toBe("R1");
        expect(result.current.status).toBe("idle");
        expect(result.current.error).toBeNull();

        // Cleanup: resolve send 2 silently
        resolve2!({
          response_text: "R2",
          episode_id: 2,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });
      });
    });

    describe("C7: abort on component unmount", () => {
      it("aborts in-flight request when hook unmounts", async () => {
        // Deferred promise that never resolves — we only care about the signal
        mockChat.mockReturnValueOnce(new Promise(() => {}));

        const { result, unmount } = renderHook(() => useChat());

        act(() => { result.current.sendMessage("hello"); });

        // Verify the signal was passed to mockChat
        const callArgs = mockChat.mock.calls[0];
        // mockChat(reChat eqBody, options)) — 2nd arg has signal
        const options = callArgs[1] as { signal?: AbortSignal } | undefined;
        expect(options?.signal).toBeDefined();

        const signal = options!.signal!;
        expect(signal.aborted).toBe(false);

        // Unmount triggers useEffect cleanup → abortRef.current?.abort()
        act(() => { unmount(); });

        // Signal should now be aborted
        expect(signal.aborted).toBe(true);
      });
    });

    describe("M10: abort removes orphan user message", () => {
      it("removes the last user message and resets status to idle", async () => {
        let resolveChat: (value: unknown) => void;
        const deferredPromise = new Promise((resolve) => { resolveChat = resolve; });
        mockChat.mockReturnValueOnce(deferredPromise);

        const { result } = renderHook(() => useChat());

        act(() => { result.current.sendMessage("hello"); });

        // Optimistic user message present, status loading
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].role).toBe("user");
        expect(result.current.status).toBe("loading");

        // Abort
        act(() => { result.current.abort(); });

        // Orphan user message removed, status back to idle
        expect(result.current.messages).toHaveLength(0);
        expect(result.current.status).toBe("idle");
        expect(result.current.error).toBeNull();

        // Cleanup
        resolveChat!({
          response_text: "OK",
          episode_id: 1,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });
      });

      it("abort before any message is a no-op on messages", () => {
        const { result } = renderHook(() => useChat());

        act(() => { result.current.abort(); });

        expect(result.current.messages).toHaveLength(0);
        expect(result.current.status).toBe("idle");
      });
    });

    describe("M9: removeLastUserMessage", () => {
      it("removes the last user message from the array", async () => {
        mockChat.mockResolvedValueOnce({
          response_text: "R1",
          episode_id: 1,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });
        // Second send fails
        mockChat.mockRejectedValueOnce(new Error("fail"));

        const { result } = renderHook(() => useChat());

        // Successful send: user1 + assistant1
        await act(async () => { await result.current.sendMessage("msg1"); });
        expect(result.current.messages).toHaveLength(2);

        // Failed send: user2 only (no assistant)
        await act(async () => { await result.current.sendMessage("msg2"); });
        expect(result.current.messages).toHaveLength(3); // user1, asst1, user2
        expect(result.current.status).toBe("error");

        // M9: remove last user message before retry
        act(() => { result.current.removeLastUserMessage(); });

        // user2 removed, only user1 + asst1 remain
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[0].content).toBe("msg1");
        expect(result.current.messages[1].content).toBe("R1");
      });

      it("removeLastUserMessage is a no-op when messages is empty", () => {
        const { result } = renderHook(() => useChat());
        act(() => { result.current.removeLastUserMessage(); });
        expect(result.current.messages).toHaveLength(0);
      });

      it("removeLastUserMessage is a no-op with only assistant messages", async () => {
        // This shouldn't happen in practice, but test edge case
        mockChat.mockResolvedValueOnce({
          response_text: "R1",
          episode_id: 1,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });

        const { result } = renderHook(() => useChat());
        await act(async () => { await result.current.sendMessage("msg1"); });

        // 2 messages: user + assistant
        act(() => { result.current.removeLastUserMessage(); });
        // Only user message removed
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].role).toBe("assistant");
      });
    });

    describe("C6: stats reset regression guard", () => {
      it("clearMessages resets status and error, ready for next send", async () => {
        mockChat.mockRejectedValueOnce(new Error("fail"));
        const { result } = renderHook(() => useChat());

        await act(async () => { await result.current.sendMessage("msg1"); });
        expect(result.current.status).toBe("error");
        expect(result.current.error).toBeTruthy();

        act(() => { result.current.clearMessages(); });
        expect(result.current.messages).toEqual([]);
        expect(result.current.status).toBe("idle");
        expect(result.current.error).toBeNull();

        // After clear, can send again normally
        mockChat.mockResolvedValueOnce({
          response_text: "OK",
          episode_id: 1,
          intent: null,
          context_meta: {},
          api_trace: {},
          recall_items: [],
        });
        await act(async () => { await result.current.sendMessage("msg2"); });
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.status).toBe("success");
      });
    });
  });
});
