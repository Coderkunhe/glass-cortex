/** Profile 管理领域类型 */

/** 单个 Profile 元数据 */
export interface ProfileInfo {
  name: string;
  db_size_bytes: number;
  has_index: boolean;
  episode_count: number;
  fact_count: number;
  index_vectors: number;
}

/** GET /profiles 响应 */
export interface ProfileListResponse {
  profiles: ProfileInfo[];
  current: string;
}

/** POST /profiles/switch 请求体 */
export interface ProfileSwitchRequest {
  name: string;
}

/** POST /profiles/switch 响应 */
export interface ProfileSwitchResponse {
  profile: string;
  status: "switched" | "already_active";
}
