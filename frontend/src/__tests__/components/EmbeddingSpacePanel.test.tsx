import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import EmbeddingSpacePanel from "@/components/lab/EmbeddingSpacePanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockCoordsSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        coords: [
          { id: 1, x: 0.5, y: 0.3, z: 0.8, label: "记忆A", kind: "episode", color: "#4f6ef7" },
          { id: 2, x: -0.2, y: -0.1, z: 0.5, label: "知识B", kind: "fact", color: "#e53e3e" },
          { id: 3, x: 0.1, y: -0.5, z: 0.3, label: "记忆C", kind: "episode", color: "#4f6ef7" },
        ],
        total_vectors: 100,
        pca_variance_explained: [0.45, 0.28, 0.12],
      }),
  };
}

function mockEmptyCoords() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        coords: [],
        total_vectors: 0,
        pca_variance_explained: [],
      }),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("EmbeddingSpacePanel", () => {
  it("renders header and idle hint after empty fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyCoords());
    render(<EmbeddingSpacePanel />);
    expect(screen.getByText("嵌入空间")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("暂无向量数据，先创建一些记忆再回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<EmbeddingSpacePanel />);
    await waitFor(() => {
      expect(screen.getByText("加载嵌入坐标…")).toBeInTheDocument();
    });
  });

  it("renders SVG scatter plot with correct number of dots", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      // 3 coords → 3 <circle> elements
      const circles = document.querySelectorAll("circle[data-dot]");
      expect(circles.length).toBe(3);
    });
  });

  it("shows PCA variance explained text", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/PC1/)).toBeInTheDocument();
      expect(screen.getByText(/45/)).toBeInTheDocument();
    });
  });

  it("shows legend with episode and fact entries", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/记忆 \(Episode\)/)).toBeInTheDocument();
      expect(screen.getByText(/知识 \(Fact\)/)).toBeInTheDocument();
    });
  });

  it("handles single dot without crash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          coords: [{ id: 1, x: 0, y: 0, z: 0.5, label: "唯一", kind: "episode", color: "#4f6ef7" }],
          total_vectors: 1,
          pca_variance_explained: [1.0],
        }),
    });
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      const circles = document.querySelectorAll("circle[data-dot]");
      expect(circles.length).toBe(1);
    });
  });

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      const circles = document.querySelectorAll("circle[data-dot]");
      expect(circles.length).toBe(3);
    });
  });

  // ── 刷新按钮 ──

  it("shows refresh button only in success state", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      const circles = document.querySelectorAll("circle[data-dot]");
      expect(circles.length).toBe(3);
    });

    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    expect(refreshBtn).toBeInTheDocument();
  });

  // ── total_vectors 计数 ──

  it("displays total vectors count in header", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      // header shows "共 100 个向量"
      expect(screen.getByText(/共 100 个向量/)).toBeInTheDocument();
    });
  });

  // ── PC3 方差展示 ──

  it("shows PC3 variance when three components present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          coords: [
            { id: 1, x: 0.5, y: 0.3, z: 0.8, label: "A", kind: "episode", color: "#4f6ef7" },
          ],
          total_vectors: 1,
          pca_variance_explained: [0.45, 0.28, 0.12],
        }),
    });
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/PC3 12%/)).toBeInTheDocument();
    });
  });

  // ── 网络异常 ──

  it("handles network error with retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      const circles = document.querySelectorAll("circle[data-dot]");
      expect(circles.length).toBe(3);
    });
  });
});
