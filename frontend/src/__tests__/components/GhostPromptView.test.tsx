import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GhostPromptView from "@/components/chat/GhostPromptView";

describe("GhostPromptView", () => {
  it("shows placeholder when systemPrompt is null", () => {
    render(<GhostPromptView systemPrompt={null} />);
    expect(screen.getByText(/未返回 system prompt/)).toBeInTheDocument();
  });

  it("shows placeholder when systemPrompt is undefined", () => {
    render(<GhostPromptView systemPrompt={undefined} />);
    expect(screen.getByText(/未返回 system prompt/)).toBeInTheDocument();
  });

  it("renders collapsed view with token estimate", () => {
    const prompt = "You are a helpful assistant.\nAlways be concise.";
    render(<GhostPromptView systemPrompt={prompt} />);

    expect(screen.getByText(/Ghost Prompt/)).toBeInTheDocument();
    // token 估算：prompt 长度 / 3 ≈ 18
    expect(screen.getByText(/tokens/)).toBeInTheDocument();
  });

  it("renders copy button when collapsed", () => {
    render(<GhostPromptView systemPrompt="test prompt" />);
    expect(screen.getByText("复制")).toBeInTheDocument();
  });

  it("is collapsed by default (no <pre> visible)", () => {
    render(<GhostPromptView systemPrompt="test prompt" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // ── 空字符串行为 ──

  it("shows placeholder for empty string systemPrompt", () => {
    render(<GhostPromptView systemPrompt="" />);
    expect(screen.getByText(/未返回 system prompt/)).toBeInTheDocument();
  });

  // ── 展开/折叠 ──

  it("expands to show prompt content on click", async () => {
    const prompt = "You are a helpful assistant.";
    render(<GhostPromptView systemPrompt={prompt} />);
    const header = screen.getByText(/Ghost Prompt/);
    fireEvent.click(header);
    await waitFor(() => {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    });
  });

  it("expand-collapse-expand lifecycle works correctly", async () => {
    const prompt = "You are a helpful assistant.";
    render(<GhostPromptView systemPrompt={prompt} />);
    const header = screen.getByText(/Ghost Prompt/);
    // Expand
    fireEvent.click(header);
    await waitFor(() => {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    });
    // Collapse (content stays in DOM but hidden by CollapsibleSection)
    fireEvent.click(header);
    // Expand again — content should be accessible again
    fireEvent.click(header);
    await waitFor(() => {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    });
  });

  // ── Token 估算准确性 ──

  it("shows correct token estimate for known-length prompt", () => {
    const prompt = "123456789"; // 9 chars → Math.ceil(9/3) = 3
    render(<GhostPromptView systemPrompt={prompt} />);
    expect(screen.getByText(/3 tokens/)).toBeInTheDocument();
  });

  // ── pre 元素样式 ──

  it("expanded pre element has max-h-80 and overflow-y-auto", async () => {
    render(<GhostPromptView systemPrompt="test" />);
    fireEvent.click(screen.getByText(/Ghost Prompt/));
    await waitFor(() => {
      const pre = document.querySelector("pre");
      expect(pre).toBeInTheDocument();
      expect(pre!.className).toContain("max-h-80");
      expect(pre!.className).toContain("overflow-y-auto");
    });
  });

  // ── 标题格式 ──

  it("title contains Ghost Prompt emoji and token count", () => {
    const prompt = "hello world"; // 11 chars → Math.ceil(11/3) = 4
    render(<GhostPromptView systemPrompt={prompt} />);
    expect(screen.getByText(/👻 Ghost Prompt/)).toBeInTheDocument();
    expect(screen.getByText(/4 tokens/)).toBeInTheDocument();
  });
});
