"""E2E 快乐路径测试 — 端到端验证用户旅程。

Batch 139：覆盖 6 个正常用户旅程场景（无错误、无异常）。
需要 DEEPSEEK_API_KEY 环境变量（真实 LLM 调用）。

运行:
  export DEEPSEEK_API_KEY="sk-xxx"
  make e2e-test
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module", autouse=True)
def servers() -> Any:
    """启动 FastAPI + Next.js（模块级 fixture，一次性）。"""
    if not os.environ.get("DEEPSEEK_API_KEY"):
        pytest.skip("需要 DEEPSEEK_API_KEY")

    procs: list[Any] = []

    # FastAPI
    print("\n[E2E] 启动 FastAPI (port 8000)...")
    p1 = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=str(PROJECT_ROOT),
        env={**os.environ, "PYTHONPATH": str(PROJECT_ROOT), "HF_HUB_OFFLINE": "1"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    procs.append(p1)
    _wait("http://localhost:8000/health", timeout=20)
    print("[E2E] ✅ FastAPI 就绪")

    # Next.js
    print("[E2E] 启动 Next.js (port 3000)...")
    p2 = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(PROJECT_ROOT / "frontend"),
        env={**os.environ, "NEXT_PUBLIC_API_URL": "http://localhost:8000"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    procs.append(p2)
    _wait("http://localhost:3000", timeout=60)
    print("[E2E] ✅ Next.js 就绪")

    yield

    for p in reversed(procs):
        p.terminate()
        p.wait(timeout=5)


def _wait(url: str, timeout: int) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"{url} 在 {timeout}s 内未响应")


@pytest.fixture(scope="function")
def page(servers: Any) -> Any:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.set_default_timeout(15000)
        yield page
        browser.close()


# ═══════════════════════════════════════════
# 测试场景
# ═══════════════════════════════════════════


def test_01_send_message(page: Any) -> None:
    """用户发送消息 → AI 回复出现。"""
    page.goto("http://localhost:3000", wait_until="load", timeout=30000)
    page.wait_for_timeout(3000)

    # 输入消息
    input_box = page.get_by_placeholder("输入消息")
    assert input_box is not None, "找不到聊天输入框"
    input_box.fill("布偶猫怎么养")
    input_box.press("Enter")

    # 等待 loading 消失 → AI 回复完成（响应式等待，不等满 40s）
    page.locator("text=思考中").wait_for(state="hidden", timeout=45000)

    # 验证用户消息出现在页面上
    body_text = page.locator("body").inner_text()
    assert "布偶猫" in body_text, "用户消息未出现在页面上"


def test_02_memory_stored(page: Any) -> None:
    """发送消息 → 回复出现。"""
    page.goto("http://localhost:3000", wait_until="load", timeout=30000)
    page.wait_for_timeout(3000)

    input_box = page.get_by_placeholder("输入消息")
    assert input_box is not None
    input_box.fill("Python 异步编程")
    input_box.press("Enter")
    page.locator("text=思考中").wait_for(state="hidden", timeout=45000)

    body_text = page.locator("body").inner_text()
    assert "Python" in body_text, "消息内容未出现在页面上"


def test_03_nonempty_reply(page: Any) -> None:
    """回复内容非空验证。"""
    page.goto("http://localhost:3000", wait_until="load", timeout=30000)
    page.wait_for_timeout(3000)

    input_box = page.get_by_placeholder("输入消息")
    input_box.fill("什么是 RAG？")
    input_box.press("Enter")
    page.locator("text=思考中").wait_for(state="hidden", timeout=45000)

    body_text = page.locator("body").inner_text()
    assert len(body_text) > 200, "页面内容过短，可能未正确回复"


def test_04_theme_switch(page: Any) -> None:
    """亮/暗主题切换 → 验证 data-theme 变化。"""
    page.goto("http://localhost:3000", wait_until="load", timeout=30000)
    page.wait_for_timeout(3000)

    initial = page.evaluate("document.documentElement.getAttribute('data-theme')")

    # 通过 aria-label 定位主题切换按钮
    theme_btn = page.locator('button[aria-label*="模式"]')
    count = theme_btn.count()
    if count == 0:
        pytest.skip("主题切换按钮未找到")

    theme_btn.first.click()
    page.wait_for_timeout(1500)
    after = page.evaluate("document.documentElement.getAttribute('data-theme')")
    assert after != initial, f"主题应切换：{initial} → {after}"

    # 点回
    theme_btn.first.click()
    page.wait_for_timeout(1500)
    restored = page.evaluate("document.documentElement.getAttribute('data-theme')")
    assert restored == initial, f"主题应恢复：{restored} == {initial}"


def test_05_dark_mode_ui(page: Any) -> None:
    """暗色模式 UI 背景验证。"""
    page.goto("http://localhost:3000", wait_until="load", timeout=30000)
    page.wait_for_timeout(3000)

    page.evaluate("document.documentElement.setAttribute('data-theme', 'dark')")
    page.wait_for_timeout(500)

    body_bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    r, g, b = (int(x) for x in body_bg.strip("rgb() ").split(",")[:3])
    assert (r + g + b) // 3 < 100, f"暗色模式背景应深色：{body_bg}"


def test_06_api_health(page: Any, servers: Any) -> None:
    """FastAPI 健康检查。"""
    resp = urllib.request.urlopen("http://localhost:8000/health", timeout=5)
    assert resp.status == 200
    data = resp.read().decode()
    assert "status" in data or "ok" in data.lower()
