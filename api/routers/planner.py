"""Planner 端点——意图分类 + 任务规划。

独立分类/规划端点，不运行完整聊天管线。用于调试和 UI 预分类/预规划场景。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

from api.dependencies import EnginesDep
from api.schemas import (
    PlanDetailOut,
    PlanGenerateRequest,
    PlanGenerateResponse,
    PlannerClassifyRequest,
    PlannerClassifyResponse,
    PlanOverrideAction,
    PlanOverrideRequest,
    PlanOverrideResponse,
    PlanRunOut,
    PlanSubtaskOut,
    ReflectionRequest,
    ReflectionResponse,
    ReplanDetectRequest,
    ReplanDetectResponse,
    SubTaskSchema,
)

router = APIRouter(prefix="/planner", tags=["planner"])


@router.post("/classify", response_model=PlannerClassifyResponse)
def classify_intent(
    body: PlannerClassifyRequest,
    engines: Any = EnginesDep,
) -> PlannerClassifyResponse:
    """对用户输入做意图分类，不生成回复。

    Planner 在 7 引擎元组的位置 6。Planner 内置优雅降级——
    API 调用失败时返回默认分类（"提问"/0.3）。
    """
    *_, planner = engines  # 7 引擎元组的位置 6（store 为 0）
    result, trace = planner.classify_intent(body.user_msg)
    return PlannerClassifyResponse(
        category=result.category,
        confidence=result.confidence,
        rationale=result.rationale,
        trace=trace,
    )


@router.post("/generate-plan", response_model=PlanGenerateResponse)
def generate_plan(
    body: PlanGenerateRequest,
    engines: Any = EnginesDep,
) -> PlanGenerateResponse:
    """对用户消息生成任务规划 DAG，不执行聊天管线。

    独立端点用于调试任务分解逻辑。PlanGenerator 通过 PlannerEngine
    组合注入（bootstrap 阶段创建），内置三阶回退解析——
    LLM 调用失败时返回空计划。
    """
    *_, planner = engines  # PlannerEngine 在位置 6，内部持有 PlanGenerator
    result, trace = planner.generate_plan(body.user_msg, body.intent_category)
    return PlanGenerateResponse(
        subtasks=[
            SubTaskSchema(
                id=str(t.get("id", "")),
                description=str(t.get("description", "")),
                depends_on=(
                    [str(d) for d in t["depends_on"]]
                    if isinstance(t.get("depends_on"), list)
                    else []
                ),
            )
            for t in result.subtasks
        ],
        dag_edges=[list(e) for e in result.dag_edges],
        rationale=result.rationale,
        confidence=result.confidence,
        trace=trace,
    )


@router.post("/detect-replan", response_model=ReplanDetectResponse)
def detect_replan(
    body: ReplanDetectRequest,
    engines: Any = EnginesDep,
) -> ReplanDetectResponse:
    """检测用户消息修正导致的意图漂移，生成修正计划。

    独立端点用于调试重规划检测逻辑。ReplanDetector 通过 PlannerEngine
    组合注入（bootstrap 阶段创建），内置三阶回退解析——
    LLM 调用失败时返回 drift_detected=False。
    """
    from src.planner.plan import PlanResult

    *_, planner = engines
    # 构造原始计划（如果提供了 JSON）
    original_plan = PlanResult()
    result, trace = planner.detect_replan(
        body.original_user_msg,
        body.original_intent,
        original_plan,
        body.revised_user_msg,
    )
    # 构造修正计划的响应
    revised = result.revised_plan
    revised_response = (
        PlanGenerateResponse(
            subtasks=[
                SubTaskSchema(
                    id=str(t.get("id", "")),
                    description=str(t.get("description", "")),
                    depends_on=(
                        [str(d) for d in t["depends_on"]]
                        if isinstance(t.get("depends_on"), list)
                        else []
                    ),
                )
                for t in revised.subtasks
            ],
            dag_edges=[list(e) for e in revised.dag_edges],
            rationale=revised.rationale,
            confidence=revised.confidence,
            trace={},
        )
        if result.drift_detected
        else None
    )
    return ReplanDetectResponse(
        drift_detected=result.drift_detected,
        drift_reason=result.drift_reason,
        revised_intent=result.revised_intent,
        revised_plan=revised_response,
        diff_summary=getattr(result, "diff_summary", ""),
        confidence=result.confidence,
        trace=trace,
    )


@router.post("/reflect", response_model=ReflectionResponse)
def reflect(
    body: ReflectionRequest,
    engines: Any = EnginesDep,
) -> ReflectionResponse:
    """对已完成的规划过程进行反思，生成改进建议。

    独立端点用于调试反思逻辑。ReflectionEngine 通过 PlannerEngine
    组合注入（bootstrap 阶段创建），内置三阶回退解析——
    LLM 调用失败时返回空反思。
    """
    from src.planner.plan import PlanResult

    *_, planner = engines
    # 构造计划结果（如果提供了 JSON）
    plan_result = None
    if body.plan_json:
        try:
            data = json.loads(body.plan_json)
            subtasks_raw = data.get("subtasks", [])
            if isinstance(subtasks_raw, list):
                subtasks: list[dict[str, object]] = [
                    {
                        "id": str(t.get("id", "")),
                        "description": str(t.get("description", "")),
                    }
                    for t in subtasks_raw[:8]
                    if isinstance(t, dict)
                ]
                plan_result = PlanResult(subtasks=subtasks)
        except Exception:
            plan_result = None
    result, trace = planner.reflect(
        body.user_msg, body.intent_category, plan_result, body.conversation_summary
    )
    return ReflectionResponse(
        reflections=result.reflections,
        improvement_suggestions=result.improvement_suggestions,
        plan_quality_score=result.plan_quality_score,
        confidence=result.confidence,
        trace=trace,
    )


# ── Plan 存储查询 (Phase 53 Batch 2) ──


@router.get("/plans", response_model=list[PlanRunOut])
def list_plans(
    session_id: str | None = None,
    limit: int = 20,
    engines: Any = EnginesDep,
) -> list[PlanRunOut]:
    """列出最近的规划运行（不含 subtasks，按时间倒序）。

    Args:
        session_id: 可选的会话过滤。None 返回所有 session 的规划。
        limit: 返回数量上限，默认 20。
    """
    store, *_ = engines  # MemoryStore 在 7 引擎元组的位置 0
    plans = store.list_plans(session_id=session_id, limit=limit)
    return [PlanRunOut(**p) for p in plans]


@router.get("/plans/{plan_id}", response_model=PlanDetailOut)
def get_plan(plan_id: int, engines: Any = EnginesDep) -> PlanDetailOut:
    """获取单次规划运行详情——含内联 subtasks。

    Args:
        plan_id: 规划运行 id。

    Raises:
        HTTPException 404: plan_run_id 不存在。
    """
    store, *_ = engines  # MemoryStore 在 7 引擎元组的位置 0
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan run {plan_id} 不存在")
    subtasks_raw = plan.pop("subtasks", [])
    subtasks_out: list[PlanSubtaskOut] = []
    if isinstance(subtasks_raw, list):
        for s in subtasks_raw:
            if isinstance(s, dict):
                subtasks_out.append(
                    PlanSubtaskOut(
                        id=int(s.get("id", 0)),
                        plan_run_id=int(s.get("plan_run_id", 0)),
                        subtask_id=str(s.get("subtask_id", "")),
                        description=str(s.get("description", "")),
                        depends_on_json=str(s.get("depends_on_json", "[]")),
                        sort_order=int(s.get("sort_order", 0)),
                        status=str(s.get("status", "pending")),
                        created_at=float(s.get("created_at", 0.0)),
                    )
                )
    return PlanDetailOut(**plan, subtasks=subtasks_out)


@router.patch("/plans/{plan_id}", response_model=PlanOverrideResponse)
def update_plan(
    plan_id: int,
    body: PlanOverrideRequest,
    engines: Any = EnginesDep,
) -> PlanOverrideResponse:
    """接受用户手动干预，批量更新子任务状态/描述。

    支持对同一 plan 的多个子任务执行不同干预动作（skip/retry/modify/accept/reject）。
    仅更新状态为 pending/failed 的子任务——已成功/已跳过的步骤不可干预。
    返回成功/拒绝计数和更新后的计划详情。

    Args:
        plan_id: 目标规划运行 id。
        body: 包含干预列表的请求体。

    Raises:
        HTTPException 404: plan_run_id 不存在。
    """
    store, *_ = engines  # MemoryStore 在 7 引擎元组的位置 0
    plan = store.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan run {plan_id} 不存在")

    # 构建现有子任务状态映射：subtask_id → current_status
    subtasks_raw = plan.pop("subtasks", [])
    status_map: dict[str, str] = {}
    if isinstance(subtasks_raw, list):
        for s in subtasks_raw:
            if isinstance(s, dict):
                sid = str(s.get("subtask_id", ""))
                sstatus = str(s.get("status", "pending"))
                if sid:
                    status_map[sid] = sstatus

    # 不可干预的终态
    immutable_statuses = {"success", "accepted", "skipped"}

    applied = 0
    rejected = 0
    for override in body.overrides:
        current_status = status_map.get(override.step_id, "")
        if current_status in immutable_statuses:
            rejected += 1
            continue

        # 映射 action 到 subtask 状态
        action_status_map = {
            PlanOverrideAction.SKIP: "skipped",
            PlanOverrideAction.RETRY: "pending",  # 重置为 pending 以重新执行
            PlanOverrideAction.MODIFY: "modified",
            PlanOverrideAction.ACCEPT: "accepted",
            PlanOverrideAction.REJECT: "rejected",
        }
        new_status = action_status_map.get(override.action, override.action.value)

        if store.update_subtask(
            plan_id,
            override.step_id,
            new_status,
            new_description=override.new_description,
        ):
            applied += 1
            if override.step_id in status_map:
                status_map[override.step_id] = new_status
        else:
            rejected += 1

    # 返回更新后的计划详情
    plan_detail = store.get_plan(plan_id)
    if not plan_detail:
        raise HTTPException(status_code=404, detail=f"Plan run {plan_id} 不存在")
    subtasks_out: list[PlanSubtaskOut] = []
    raw_subtasks = plan_detail.pop("subtasks", [])
    if isinstance(raw_subtasks, list):
        for s in raw_subtasks:
            if isinstance(s, dict):
                subtasks_out.append(
                    PlanSubtaskOut(
                        id=int(s.get("id", 0)),
                        plan_run_id=int(s.get("plan_run_id", 0)),
                        subtask_id=str(s.get("subtask_id", "")),
                        description=str(s.get("description", "")),
                        depends_on_json=str(s.get("depends_on_json", "[]")),
                        sort_order=int(s.get("sort_order", 0)),
                        status=str(s.get("status", "pending")),
                        created_at=float(s.get("created_at", 0.0)),
                    )
                )

    return PlanOverrideResponse(
        plan_id=plan_id,
        applied=applied,
        rejected=rejected,
        detail=PlanDetailOut(**plan_detail, subtasks=subtasks_out),
    )
