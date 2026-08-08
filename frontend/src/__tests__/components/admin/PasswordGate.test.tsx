import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PasswordGate from "@/components/admin/PasswordGate";

// ── Helpers ──────────────────────────────────────────────────────────

/** 默认密码 — 与源码 DEFAULT_PASSWORD 一致 */
const DEFAULT_PW = "Coder@9527";

function renderGate() {
  const onSuccess = vi.fn();
  const result = render(<PasswordGate onSuccess={onSuccess} />);
  const getInput = () => screen.getByPlaceholderText("输入密码") as HTMLInputElement;
  const getSubmitBtn = () => screen.getByText("进入工程") as HTMLButtonElement;
  const getToggleBtn = () => screen.getByRole("button", { name: /显示密码|隐藏密码/ });
  return { onSuccess, getInput, getSubmitBtn, getToggleBtn, ...result };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("PasswordGate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders the title and description", () => {
      renderGate();
      expect(screen.getByText("AI 工程协作管理面板")).toBeInTheDocument();
      expect(screen.getByText("请输入管理密码以继续")).toBeInTheDocument();
    });

    it("renders password input with autofocus", () => {
      const { getInput } = renderGate();
      const input = getInput();
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
      expect(input.type).toBe("password");
    });

    it("renders the submit button disabled when input is empty", () => {
      const { getSubmitBtn } = renderGate();
      expect(getSubmitBtn().disabled).toBe(true);
    });

    it("enables submit button when input has content", () => {
      const { getInput, getSubmitBtn } = renderGate();
      fireEvent.change(getInput(), { target: { value: "test" } });
      expect(getSubmitBtn().disabled).toBe(false);
    });

    it("renders lock icon", () => {
      renderGate();
      const container = document.querySelector(".bg-brand-50");
      expect(container).toBeInTheDocument();
    });
  });

  describe("password toggle visibility", () => {
    it("toggles input type between password and text", () => {
      const { getInput, getToggleBtn } = renderGate();
      expect(getInput().type).toBe("password");

      fireEvent.click(getToggleBtn());
      expect(getInput().type).toBe("text");

      fireEvent.click(getToggleBtn());
      expect(getInput().type).toBe("password");
    });

    it("updates aria-label on toggle", () => {
      const { getToggleBtn } = renderGate();
      expect(getToggleBtn().getAttribute("aria-label")).toBe("显示密码");

      fireEvent.click(getToggleBtn());
      expect(getToggleBtn().getAttribute("aria-label")).toBe("隐藏密码");
    });
  });

  describe("authentication", () => {
    it("calls onSuccess when correct password is submitted", () => {
      const { onSuccess, getInput, getSubmitBtn } = renderGate();
      fireEvent.change(getInput(), { target: { value: DEFAULT_PW } });
      fireEvent.click(getSubmitBtn());
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("shows error when wrong password is submitted", () => {
      const { onSuccess, getInput, getSubmitBtn } = renderGate();
      fireEvent.change(getInput(), { target: { value: "wrong-password" } });
      fireEvent.click(getSubmitBtn());

      expect(onSuccess).not.toHaveBeenCalled();
      expect(screen.getByText("密码错误，请重试")).toBeInTheDocument();
      // Input should have red border class
      expect(getInput().className).toMatch(/border-red-500/);
    });

    it("clears error when user starts typing again", () => {
      const { getInput, getSubmitBtn } = renderGate();

      // First attempt: wrong password
      fireEvent.change(getInput(), { target: { value: "wrong" } });
      fireEvent.click(getSubmitBtn());
      expect(screen.getByText("密码错误，请重试")).toBeInTheDocument();

      // User types again — error should clear
      fireEvent.change(getInput(), { target: { value: "new attempt" } });
      expect(screen.queryByText("密码错误，请重试")).not.toBeInTheDocument();
      expect(getInput().className).not.toMatch(/border-red-500/);
    });

    it("adds shake animation class on error", () => {
      const { getInput, getSubmitBtn } = renderGate();
      fireEvent.change(getInput(), { target: { value: "wrong" } });
      fireEvent.click(getSubmitBtn());

      const card = document.querySelector(".rounded-gm-xl");
      expect(card?.className).toMatch(/animate-\[shake_0\.4s_ease-in-out\]/);
    });
  });

  describe("environment variable override", () => {
    it("uses NEXT_PUBLIC_ADMIN_PASSWORD env var when set", () => {
      vi.stubEnv("NEXT_PUBLIC_ADMIN_PASSWORD", "custom-env-pw");
      const { onSuccess, getInput, getSubmitBtn } = renderGate();

      fireEvent.change(getInput(), { target: { value: "custom-env-pw" } });
      fireEvent.click(getSubmitBtn());
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("rejects default password when env var overrides it", () => {
      vi.stubEnv("NEXT_PUBLIC_ADMIN_PASSWORD", "custom-env-pw");
      const { onSuccess, getInput, getSubmitBtn } = renderGate();

      fireEvent.change(getInput(), { target: { value: DEFAULT_PW } });
      fireEvent.click(getSubmitBtn());
      expect(onSuccess).not.toHaveBeenCalled();
      expect(screen.getByText("密码错误，请重试")).toBeInTheDocument();
    });

    it("falls back to default password when env var is not set", () => {
      const { onSuccess, getInput, getSubmitBtn } = renderGate();
      fireEvent.change(getInput(), { target: { value: DEFAULT_PW } });
      fireEvent.click(getSubmitBtn());
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe("submit via Enter key", () => {
    it("triggers authentication on form submit via enter", () => {
      const { onSuccess, getInput } = renderGate();
      fireEvent.change(getInput(), { target: { value: DEFAULT_PW } });
      fireEvent.submit(getInput().closest("form")!);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
