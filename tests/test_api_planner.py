"""API tests — /planner endpoints (classify, plans, plan override)."""

from __future__ import annotations

import copy
from unittest.mock import MagicMock

from .helpers import _mock_context_meta, build_mock_engines, make_client


class TestPlanner:
    """Standalone intent classification endpoint."""

    def test_planner_classify_success(self) -> None:
        planner = MagicMock()
        from src.planner import IntentResult

        mock_result = IntentResult(category="提问", confidence=0.95, rationale="用户询问工作原理")
        planner.classify_intent.return_value = (mock_result, {"caller": "planner"})

        engines = build_mock_engines(planner=planner)
        with make_client(engines) as client:
            resp = client.post(
                "/planner/classify",
                json={"user_msg": "怎么工作的？"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["category"] == "提问"
            assert data["confidence"] == 0.95

    def test_planner_classify_empty_input(self) -> None:
        with make_client() as client:
            resp = client.post("/planner/classify", json={"user_msg": ""})
            assert resp.status_code == 422

    def test_planner_classify_engine_error(self) -> None:
        planner = MagicMock()
        planner.classify_intent.side_effect = RuntimeError("Planner crashed")
        engines = build_mock_engines(planner=planner)
        with make_client(engines) as client:
            resp = client.post(
                "/planner/classify",
                json={"user_msg": "hello"},
            )
            assert resp.status_code == 500


class TestPlanStorageAPI:
    """Phase 53 Batch 2 — GET /planner/plans + GET /planner/plans/{id}."""

    @staticmethod
    def _make_plan_dict(
        plan_id: int = 1,
        session_id: str = "test-session",
        user_msg: str = "测试消息",
    ) -> dict[str, object]:
        return {
            "id": plan_id,
            "session_id": session_id,
            "user_msg": user_msg,
            "intent_category": "提问",
            "rationale": "测试理由",
            "confidence": 0.85,
            "subtask_count": 2,
            "dag_edges_json": '[["1","2"]]',
            "created_at": 1719700000.0,
        }

    def test_list_plans_empty(self) -> None:
        """Empty DB returns empty list."""
        store = MagicMock()
        store.list_plans.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_list_plans_with_data(self) -> None:
        """3 plans inserted → list returns 3, sorted by time desc."""
        store = MagicMock()
        plans = [self._make_plan_dict(i, user_msg=f"消息 {i}") for i in range(3, 0, -1)]
        store.list_plans.return_value = plans
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 3
            assert data[0]["id"] == 3
            assert data[2]["id"] == 1

    def test_list_plans_session_filter(self) -> None:
        """session_id filter works."""
        store = MagicMock()
        store.list_plans.return_value = [self._make_plan_dict(session_id="sess-A")]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans?session_id=sess-A")
            assert resp.status_code == 200
            store.list_plans.assert_called_once_with(session_id="sess-A", limit=20)

    def test_list_plans_respects_limit(self) -> None:
        """limit parameter passed correctly to store."""
        store = MagicMock()
        store.list_plans.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans?limit=5")
            assert resp.status_code == 200
            store.list_plans.assert_called_once_with(session_id=None, limit=5)

    def test_get_plan_detail(self) -> None:
        """GET /planner/plans/{id} returns full plan with subtasks."""
        store = MagicMock()
        plan = self._make_plan_dict()
        plan["subtasks"] = [
            {
                "id": 1,
                "plan_run_id": 1,
                "subtask_id": "1",
                "description": "收集需求",
                "depends_on_json": "[]",
                "sort_order": 0,
                "status": "pending",
                "created_at": 1719700000.0,
            },
            {
                "id": 2,
                "plan_run_id": 1,
                "subtask_id": "2",
                "description": "输出方案",
                "depends_on_json": '["1"]',
                "sort_order": 1,
                "status": "pending",
                "created_at": 1719700000.0,
            },
        ]
        store.get_plan.return_value = plan
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans/1")
            assert resp.status_code == 200
            data = resp.json()
            assert data["id"] == 1
            assert data["user_msg"] == "测试消息"
            assert len(data["subtasks"]) == 2
            assert data["subtasks"][0]["subtask_id"] == "1"
            assert data["subtasks"][1]["subtask_id"] == "2"

    def test_get_plan_404(self) -> None:
        """Non-existent plan_id returns 404."""
        store = MagicMock()
        store.get_plan.return_value = {}
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/planner/plans/9999")
            assert resp.status_code == 404

    def test_chat_request_accepts_session_id(self) -> None:
        """ChatRequest optional session_id doesn't affect pipeline."""
        chat = MagicMock()
        planner = MagicMock()
        from src.planner import IntentResult

        planner.classify_intent.return_value = (
            IntentResult("闲聊", 0.9, "打招呼"),
            {},
        )
        chat.generate_and_store.return_value = (
            "你好！",
            1,
            _mock_context_meta(),
            {
                "caller": "test",
                "model": "mock",
                "temperature": 0.7,
                "max_tokens": 1024,
                "elapsed_ms": 100.0,
                "prompt_tokens": 10,
                "completion_tokens": 5,
            },
        )
        engines = build_mock_engines(chat=chat, planner=planner)
        with make_client(engines, plan_storage_enabled=False) as client:
            resp = client.post(
                "/chat",
                json={"user_input": "你好", "session_id": "test-sess-123"},
            )
            assert resp.status_code == 200
            assert resp.json()["response_text"] == "你好！"

    def test_plan_storage_disabled_no_write(self) -> None:
        """plan_storage_enabled=False → insert_plan not called."""
        store = MagicMock()
        planner = MagicMock()
        chat = MagicMock()
        from src.planner import IntentResult
        from src.planner.plan import PlanResult

        planner.classify_intent.return_value = (
            IntentResult("提问", 0.9, "询问"),
            {},
        )
        plan_result = PlanResult(
            subtasks=[{"id": "1", "description": "任务1", "depends_on": []}],
            dag_edges=[],
            rationale="简单任务",
            confidence=0.85,
        )
        planner.generate_plan.return_value = (plan_result, {})
        chat.generate_and_store.return_value = (
            "回答",
            1,
            _mock_context_meta(),
            {
                "caller": "test",
                "model": "mock",
                "temperature": 0.7,
                "max_tokens": 1024,
                "elapsed_ms": 100.0,
                "prompt_tokens": 10,
                "completion_tokens": 5,
            },
        )
        engines = build_mock_engines(store=store, chat=chat, planner=planner)
        with make_client(engines, plan_storage_enabled=False) as client:
            resp = client.post(
                "/chat",
                json={"user_input": "怎么工作？", "session_id": "sess-test"},
            )
            assert resp.status_code == 200
            store.insert_plan.assert_not_called()

    def test_plan_storage_enabled_writes(self) -> None:
        """plan_storage_enabled=True + non-empty plan → insert_plan called."""
        store = MagicMock()
        store.insert_plan.return_value = 42
        planner = MagicMock()
        chat = MagicMock()
        from src.planner import IntentResult
        from src.planner.plan import PlanResult

        planner.classify_intent.return_value = (
            IntentResult("指令", 0.88, "用户要求执行操作"),
            {},
        )
        plan_result = PlanResult(
            subtasks=[
                {"id": "1", "description": "步骤1", "depends_on": []},
                {"id": "2", "description": "步骤2", "depends_on": ["1"]},
            ],
            dag_edges=[("1", "2")],
            rationale="两步操作",
            confidence=0.9,
        )
        planner.generate_plan.return_value = (plan_result, {})
        chat.generate_and_store.return_value = (
            "好的",
            1,
            _mock_context_meta(),
            {
                "caller": "test",
                "model": "mock",
                "temperature": 0.7,
                "max_tokens": 1024,
                "elapsed_ms": 100.0,
                "prompt_tokens": 10,
                "completion_tokens": 5,
            },
        )
        engines = build_mock_engines(store=store, chat=chat, planner=planner)
        with make_client(engines, plan_storage_enabled=True) as client:
            resp = client.post(
                "/chat",
                json={"user_input": "做两件事", "session_id": "sess-enabled"},
            )
            assert resp.status_code == 200
            store.insert_plan.assert_called_once()
            call_args = store.insert_plan.call_args
            assert call_args[1]["session_id"] == "sess-enabled"
            assert call_args[1]["user_msg"] == "做两件事"
            assert call_args[1]["intent_category"] == "指令"
            data = resp.json()
            assert data["api_trace"]["plan_run_id"] == 42


class TestPlanOverrideEndpoint:
    """PATCH /planner/plans/{plan_id} — user intervention endpoint."""

    def test_patch_accept_revised_plan(self) -> None:
        """Accept AI revised plan — all pending steps → accepted."""
        store = MagicMock()
        store.get_plan.return_value = {
            "id": 1,
            "session_id": "test",
            "user_msg": "帮我写邮件",
            "intent_category": "指令",
            "rationale": "执行任务",
            "confidence": 0.85,
            "subtask_count": 2,
            "dag_edges_json": "[]",
            "created_at": 1719700000.0,
            "subtasks": [
                {
                    "id": 10,
                    "plan_run_id": 1,
                    "subtask_id": "1",
                    "description": "检索资料",
                    "depends_on_json": "[]",
                    "sort_order": 0,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
                {
                    "id": 11,
                    "plan_run_id": 1,
                    "subtask_id": "2",
                    "description": "生成文案",
                    "depends_on_json": '["1"]',
                    "sort_order": 1,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
            ],
        }
        updated_plan = {
            "id": 1,
            "session_id": "test",
            "user_msg": "帮我写邮件",
            "intent_category": "指令",
            "rationale": "执行任务",
            "confidence": 0.85,
            "subtask_count": 2,
            "dag_edges_json": "[]",
            "created_at": 1719700000.0,
            "subtasks": [
                {
                    "id": 10,
                    "plan_run_id": 1,
                    "subtask_id": "1",
                    "description": "检索资料",
                    "depends_on_json": "[]",
                    "sort_order": 0,
                    "status": "accepted",
                    "created_at": 1719700000.0,
                },
                {
                    "id": 11,
                    "plan_run_id": 1,
                    "subtask_id": "2",
                    "description": "生成文案",
                    "depends_on_json": '["1"]',
                    "sort_order": 1,
                    "status": "accepted",
                    "created_at": 1719700000.0,
                },
            ],
        }
        store.get_plan.side_effect = [store.get_plan.return_value, updated_plan]
        store.update_subtask.return_value = True
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/1",
                json={
                    "overrides": [
                        {"step_id": "1", "action": "accept"},
                        {"step_id": "2", "action": "accept"},
                    ]
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["plan_id"] == 1
        assert body["applied"] == 2
        assert body["rejected"] == 0
        assert body["detail"]["subtasks"][0]["status"] == "accepted"

    def test_patch_skip_and_reject(self) -> None:
        """Skip one step, reject another — mixed intervention."""
        base_plan = {
            "id": 2,
            "session_id": "test",
            "user_msg": "分析性能瓶颈",
            "intent_category": "探索",
            "rationale": "分步分析",
            "confidence": 0.7,
            "subtask_count": 3,
            "dag_edges_json": "[]",
            "created_at": 1719700000.0,
            "subtasks": [
                {
                    "id": 20,
                    "plan_run_id": 2,
                    "subtask_id": "1",
                    "description": "profile",
                    "depends_on_json": "[]",
                    "sort_order": 0,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
                {
                    "id": 21,
                    "plan_run_id": 2,
                    "subtask_id": "2",
                    "description": "分析热点",
                    "depends_on_json": '["1"]',
                    "sort_order": 1,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
                {
                    "id": 22,
                    "plan_run_id": 2,
                    "subtask_id": "3",
                    "description": "优化方案",
                    "depends_on_json": '["2"]',
                    "sort_order": 2,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
            ],
        }
        call_count = [0]

        def get_plan_side_effect(_pid: int) -> dict[str, object]:
            if call_count[0] == 0:
                call_count[0] += 1
                return copy.deepcopy(base_plan)
            updated = copy.deepcopy(base_plan)
            updated["subtasks"][0]["status"] = "skipped"  # type: ignore[index]
            updated["subtasks"][2]["status"] = "rejected"  # type: ignore[index]
            return updated

        store = MagicMock()
        store.get_plan.side_effect = get_plan_side_effect
        store.update_subtask.return_value = True
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/2",
                json={
                    "overrides": [
                        {"step_id": "1", "action": "skip"},
                        {"step_id": "3", "action": "reject"},
                    ]
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] == 2
        assert body["rejected"] == 0

    def test_patch_modify_with_description(self) -> None:
        """Modify step description."""
        store = MagicMock()
        store.get_plan.return_value = {
            "id": 3,
            "session_id": "test",
            "user_msg": "查询天气",
            "intent_category": "提问",
            "rationale": "简单查询",
            "confidence": 0.9,
            "subtask_count": 1,
            "dag_edges_json": "[]",
            "created_at": 1719700000.0,
            "subtasks": [
                {
                    "id": 30,
                    "plan_run_id": 3,
                    "subtask_id": "1",
                    "description": "调用 API",
                    "depends_on_json": "[]",
                    "sort_order": 0,
                    "status": "pending",
                    "created_at": 1719700000.0,
                },
            ],
        }
        updated_plan = dict(store.get_plan.return_value)
        updated_subtasks = list(updated_plan["subtasks"])
        updated_subtasks[0]["description"] = "用缓存优化后的 API 调用"
        updated_subtasks[0]["status"] = "modified"
        updated_plan["subtasks"] = updated_subtasks
        store.get_plan.side_effect = [store.get_plan.return_value, updated_plan]
        store.update_subtask.return_value = True
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/3",
                json={
                    "overrides": [
                        {
                            "step_id": "1",
                            "action": "modify",
                            "new_description": "用缓存优化后的 API 调用",
                        }
                    ]
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] == 1

    def test_patch_immutable_status_rejected(self) -> None:
        """Completed steps cannot be overridden (terminal state protection)."""
        store = MagicMock()
        store.get_plan.return_value = {
            "id": 4,
            "session_id": "test",
            "user_msg": "写代码",
            "intent_category": "指令",
            "rationale": "已完成任务",
            "confidence": 0.95,
            "subtask_count": 1,
            "dag_edges_json": "[]",
            "created_at": 1719700000.0,
            "subtasks": [
                {
                    "id": 40,
                    "plan_run_id": 4,
                    "subtask_id": "1",
                    "description": "实现功能",
                    "depends_on_json": "[]",
                    "sort_order": 0,
                    "status": "success",
                    "created_at": 1719700000.0,
                },
            ],
        }
        store.get_plan.side_effect = [store.get_plan.return_value, store.get_plan.return_value]
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/4",
                json={
                    "overrides": [
                        {"step_id": "1", "action": "reject"},
                    ]
                },
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["rejected"] == 1
        assert body["applied"] == 0
        store.update_subtask.assert_not_called()

    def test_patch_404_nonexistent_plan(self) -> None:
        """Non-existent plan_id returns 404."""
        store = MagicMock()
        store.get_plan.return_value = {}
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/99999",
                json={
                    "overrides": [
                        {"step_id": "1", "action": "skip"},
                    ]
                },
            )

        assert resp.status_code == 404
        assert "不存在" in resp.json()["detail"]

    def test_patch_validation_empty_overrides(self) -> None:
        """Empty overrides list triggers 422 validation error."""
        store = MagicMock()
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/1",
                json={"overrides": []},
            )

        assert resp.status_code == 422

    def test_patch_validation_invalid_action(self) -> None:
        """Invalid action value triggers 422 validation error."""
        store = MagicMock()
        engines = build_mock_engines(store=store)

        with make_client(engines) as client:
            resp = client.patch(
                "/planner/plans/1",
                json={
                    "overrides": [
                        {"step_id": "1", "action": "invalid_action"},
                    ]
                },
            )

        assert resp.status_code == 422
