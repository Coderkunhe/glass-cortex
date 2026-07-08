/**
 * useFetchData — 泛型数据抓取 hook。
 *
 * 消除 14 个 Lab 面板 + 5 个 Observability 面板中重复的
 * state/data/error 三态管理样板代码（~15 行/面板 × 19 面板 = ~285 行）。
 *
 * 对标 React 社区 useSWR / React Query 的简化内联版——不引入外部依赖，
 * 直接消费项目已有的 `FetchState` 类型和 `api` client。
 *
 * B117 创建 + 3 Lab 面板试点，B118 推广到全量 19 面板。
 *
 * @module hooks/useFetchData
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { FetchState } from "@/lib/api/types";

export interface UseFetchDataResult<T> {
  /** 当前抓取状态：idle / loading / success / error */
  state: FetchState;
  /** 抓取成功时的数据，否则为 null */
  data: T | null;
  /** 抓取失败时的错误对象，否则为 null */
  error: Error | string | null;
  /** 手动触发重新抓取（供 RefreshButton / onRetry 使用） */
  refresh: () => Promise<void>;
}

export interface UseFetchDataOptions<T> {
  /**
   * 判定数据为"空"——返回 true 时 state 设为 "idle" 而非 "success"。
   * 默认：data === null 视为空。
   */
  isEmpty?: (data: T) => boolean;
}

/**
 * 泛型数据抓取 hook。
 *
 * @param fetchFn  - 异步抓取函数，返回数据或抛错
 * @param deps     - 依赖数组，变化时自动重新抓取（对标 useCallback deps）
 * @param options  - 可选配置（isEmpty 判空回调等）
 */
export function useFetchData<T>(
  fetchFn: () => Promise<T>,
  deps: React.DependencyList,
  options?: UseFetchDataOptions<T>,
): UseFetchDataResult<T> {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // 用 ref 持有最新 fetchFn/options，避免 useCallback 依赖非字面量数组
  const fetchFnRef = useRef(fetchFn);
  const isEmptyRef = useRef(options?.isEmpty);
  useEffect(() => {
    fetchFnRef.current = fetchFn;
    isEmptyRef.current = options?.isEmpty;
  });

  const refresh = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await fetchFnRef.current();
      setData(result);
      const empty = isEmptyRef.current
        ? isEmptyRef.current(result)
        : result === null;
      setState(empty ? "idle" : "success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState("error");
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, deps);

  return { state, data, error, refresh };
}
