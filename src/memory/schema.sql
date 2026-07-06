-- Memory-Playground 数据库 Schema
-- ADR-001: SQLite 存储结构化元数据
-- ADR-002: Episode（对话片段，时间衰减）+ Fact（事实知识，重要性加权）

CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    timestamp REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    importance REAL NOT NULL DEFAULT 0.5,
    initial_strength REAL NOT NULL DEFAULT 1.0,
    lambda REAL NOT NULL DEFAULT 0.1,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_recall REAL,
    faiss_id INTEGER,
    tier TEXT NOT NULL DEFAULT 'warm',
    last_consolidated_at REAL,
    session_id TEXT
);

CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_episode_id INTEGER,
    faiss_id INTEGER,
    subject TEXT,
    relation TEXT,
    object TEXT,
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (source_episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recall_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    recalled_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    strength_before REAL NOT NULL,
    strength_after REAL NOT NULL,
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fact_confidence_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_id INTEGER NOT NULL,
    confidence_before REAL NOT NULL,
    confidence_after REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    logged_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE
);

-- 管道 trace 持久化 — 每步耗时 + 状态 + 附加指标
CREATE TABLE IF NOT EXISTS pipeline_trace (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    elapsed_ms REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_trace_session
    ON pipeline_trace(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_trace_step
    ON pipeline_trace(step_name, created_at);

-- 任务规划持久化 — plan_run 一行对应一次规划生成，plan_subtasks 拆分子任务
CREATE TABLE IF NOT EXISTS plan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_msg TEXT NOT NULL,
    intent_category TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0.3,
    subtask_count INTEGER NOT NULL DEFAULT 0,
    dag_edges_json TEXT NOT NULL DEFAULT '[]',
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS plan_subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_run_id INTEGER NOT NULL,
    subtask_id TEXT NOT NULL,
    description TEXT NOT NULL,
    depends_on_json TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (plan_run_id) REFERENCES plan_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_runs_session
    ON plan_runs(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_plan_subtasks_run
    ON plan_subtasks(plan_run_id, sort_order);

-- 会话回归摘要 — 每会话边界的开放项快照
CREATE TABLE IF NOT EXISTS session_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    last_activity_at REAL NOT NULL,
    unfinished_intents_json TEXT NOT NULL DEFAULT '[]',
    open_questions_json TEXT NOT NULL DEFAULT '[]',
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_created
    ON session_summaries(created_at DESC);

-- 反思洞察持久化 — 从多次 post_mortem 提取的跨计划通用模式
CREATE TABLE IF NOT EXISTS reflection_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insight_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    source_plan_ids_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reflection_insights_type
    ON reflection_insights(insight_type, created_at DESC);

-- Schema versioning: tracks applied migrations (I-113)
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at REAL NOT NULL DEFAULT (strftime('%s','now')),
    description TEXT NOT NULL
);
