/** 记忆系统 + 标签 + Session 管理领域类型 */

import type { RecallItem } from "./types-chat";

/** GET /memory/episodes 序列化的 episode 记录 */
export interface EpisodeOut {
  id: number;
  content: string;
  importance: number;
  initial_strength: number;
  lambda: number;
  timestamp: number;
  faiss_id: number | null;
  access_count: number;
  last_recall: number | null;
  tier: string; // "hot" | "warm" | "cold"
}

/** GET /memory/facts 序列化的事实记录 */
export interface FactOut {
  id: number;
  content: string;
  confidence: number;
  source_episode_id: number | null;
  faiss_id: number | null;
  subject: string | null;
  relation: string | null;
  object: string | null;
  timestamp: number | null;
}

/** POST /memory/recall 请求 */
export interface RecallRequest {
  query: string;
  top_k?: number;
  threshold?: number;
  strengthen?: boolean;
}

/** POST /memory/recall 响应 */
export interface RecallResponse {
  query: string;
  items: RecallItem[];
  count: number;
}

/** POST /memory/decay 请求 */
export interface DecayRequest {
  lambda_override?: number | null;
}

/** 单条 episode 的衰减结果 */
export interface DecayDelta {
  id: number;
  old_strength: number;
  new_strength: number;
}

/** POST /memory/decay 响应 */
export interface DecayResponse {
  items_decayed: number;
  deltas: DecayDelta[];
}

// ── Tags ─────────────────────────────────────────────────────────────

/** GET /memory/tag-summary 单个标签条目 */
export interface TagSummaryItem {
  subject: string;
  relation: string;
  max_confidence: number;
  fact_count: number;
  distinct_objects: number;
}

/** 单条事实置信度变更日志 */
export interface FactConfidenceLogItem {
  fact_id: number;
  confidence_before: number;
  confidence_after: number;
  reason: string;
  logged_at: number | null;
}

/** 标签详情中的单条事实——含来源 episode 和置信度变更历史 */
export interface TagFactItem {
  id: number;
  content: string;
  confidence: number;
  object: string | null;
  source_episode_id: number | null;
  episode_content: string | null;
  episode_timestamp: number | null;
  created_at: number | null;
  updated_at: number | null;
  confidence_log: FactConfidenceLogItem[];
}

/** GET /memory/tag-detail 响应 */
export interface TagDetailResponse {
  subject: string;
  relation: string;
  max_confidence: number;
  fact_count: number;
  distinct_objects: number;
  facts: TagFactItem[];
}

/** POST /memory/facts/{fact_id}/confidence 请求体。 */
export interface FactConfidenceUpdateRequest {
  delta: number;
  reason: string;
}

/** POST /memory/facts/{fact_id}/confidence 响应体。 */
export interface FactConfidenceUpdateResponse {
  fact_id: number;
  confidence_before: number;
  confidence_after: number;
  reason: string;
  logged_at: number;
}

// ── Tier Distribution (Phase 54 Batch 5) ──────────────────────────────────

/** GET /memory/tiers 响应——三层分级分布 + 每层 episode 摘要 */
export interface TierDistributionResponse {
  distribution: Record<string, number>; // {"hot": N, "warm": N, "cold": N}
  episodes_by_tier: Record<string, number[]>; // {"hot": [1,2], ...}
  config: Record<string, unknown>; // 阈值/权重快照
  tier_enabled: boolean;
}

// ── Session Reset / Wipe ─────────────────────────────────────────────────

/** POST /session/reset 响应——一键清空所有数据后的回执 */
export interface WipeResponse {
  status: string;
  profile: string;
  detail: string;
}

// ── Session Forget (Phase 66 B21) ────────────────────────────────────────

/** POST /session/forget 请求体——按 session_id 定向遗忘 */
export interface SessionForgetRequest {
  session_id: string;
}

/** POST /session/forget 响应体——遗忘操作的回执统计 */
export interface SessionForgetResponse {
  episodes_deleted: number;
  facts_deleted: number;
  faiss_vectors_removed: number;
  session_id: string;
}
