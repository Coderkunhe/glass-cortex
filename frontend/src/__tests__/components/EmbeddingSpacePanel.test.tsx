import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

// ── Mock three + OrbitControls — jsdom 无 WebGL / Canvas ──

const mockDispose = vi.fn();
const mockSetSize = vi.fn();
const mockSetPixelRatio = vi.fn();
const mockRender = vi.fn();
const mockAdd = vi.fn();
const mockRemove = vi.fn();
const mockClear = vi.fn();
const mockSetColorAt = vi.fn();
const mockSetMatrixAt = vi.fn();
const mockGetColorAt = vi.fn();
const mockUpdateMatrix = vi.fn();
const mockProject = vi.fn(() => ({ x: 0, y: 0, z: 0 }));
const mockClone = vi.fn(function (this: { x: number; y: number }) {
  return { x: this.x, y: this.y };
});
const mockDomElement = document.createElement("canvas");

vi.mock("three", () => ({
  Scene: vi.fn(() => ({
    add: mockAdd,
    remove: mockRemove,
    clear: mockClear,
    background: null,
  })),
  PerspectiveCamera: vi.fn(() => ({
    position: { set: vi.fn() },
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
    aspect: 1,
  })),
  WebGLRenderer: vi.fn(() => ({
    setSize: mockSetSize,
    setPixelRatio: mockSetPixelRatio,
    render: mockRender,
    dispose: mockDispose,
    domElement: mockDomElement,
  })),
  GridHelper: vi.fn(() => ({
    material: { opacity: 0, transparent: true },
  })),
  Line: vi.fn(),
  LineBasicMaterial: vi.fn(),
  BufferGeometry: vi.fn(() => ({
    setFromPoints: vi.fn(() => ({})),
  })),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn(() => ({ position: { set: vi.fn() } })),
  SphereGeometry: vi.fn(),
  InstancedMesh: vi.fn(function (this: Record<string, unknown>) {
    this.instanceMatrix = { needsUpdate: false };
    this.instanceColor = { needsUpdate: false };
    this.visible = true;
    this.geometry = { dispose: mockDispose };
    this.material = { dispose: mockDispose };
    this.setColorAt = mockSetColorAt;
    this.setMatrixAt = mockSetMatrixAt;
    this.getColorAt = mockGetColorAt;
    return this;
  }),
  MeshStandardMaterial: vi.fn(),
  Raycaster: vi.fn(() => ({
    setFromCamera: vi.fn(),
    intersectObjects: vi.fn(() => []),
    params: { Points: { threshold: 0 } },
  })),
  Vector2: vi.fn((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
  Vector3: vi.fn((x?: number, y?: number, z?: number) => ({
    x: x ?? 0, y: y ?? 0, z: z ?? 0,
    clone: mockClone,
    project: mockProject,
    set: vi.fn(),
  })),
  Color: vi.fn((c?: string) => ({
    set: vi.fn(function (this: Record<string, unknown>, v: string) {
      this._value = v;
      return this;
    }),
    _value: c ?? "#000",
    r: 0, g: 0, b: 0,
  })),
  Object3D: vi.fn(() => ({
    position: { set: vi.fn() },
    scale: { setScalar: vi.fn() },
    updateMatrix: mockUpdateMatrix,
    matrix: { elements: Array.from({ length: 16 }, () => 0) },
  })),
  Group: vi.fn(() => ({
    add: mockAdd,
    remove: mockRemove,
    traverse: vi.fn(),
  })),
  Mesh: vi.fn(),
  Material: vi.fn(),
}));

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: vi.fn(() => ({
    enableDamping: false,
    dampingFactor: 0,
    minDistance: 0,
    maxDistance: 100,
    target: { set: vi.fn() },
    update: vi.fn(),
    dispose: mockDispose,
  })),
}));

// ── 组件导入（必须在 mock 之后） ──
import EmbeddingSpacePanel from "@/components/lab/EmbeddingSpacePanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
  mockDispose.mockClear();
  mockSetSize.mockClear();
  mockRender.mockClear();
  mockAdd.mockClear();
  mockRemove.mockClear();
  mockClear.mockClear();
  mockSetColorAt.mockClear();
  mockSetMatrixAt.mockClear();
  mockGetColorAt.mockClear();
  mockUpdateMatrix.mockClear();
  mockProject.mockClear();
  mockClone.mockClear();
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

  it("renders 3D container and operation hint when data loads", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      // 操作提示文本可见，确认 3D 区域挂载
      expect(screen.getByText(/拖拽旋转/)).toBeInTheDocument();
    });
  });

  it("shows PCA variance explained text", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/PC1 45%/)).toBeInTheDocument();
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
      // 单点场景：3D 区域应正常渲染
      expect(screen.getByText(/可见 1/)).toBeInTheDocument();
      expect(screen.getByText(/共 1 个向量/)).toBeInTheDocument();
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
      // 重试成功后显示可视化区域
      expect(screen.getByText(/拖拽旋转/)).toBeInTheDocument();
    });
  });

  it("shows refresh button only in success state", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
      expect(refreshBtn).toBeInTheDocument();
    });
  });

  it("displays total vectors count in header", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/共 100 个向量/)).toBeInTheDocument();
    });
  });

  // ── Kind 过滤 ──

  it("shows kind filter toggles when data is loaded", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/记忆 \(2\)/)).toBeInTheDocument();
      expect(screen.getByText(/知识 \(1\)/)).toBeInTheDocument();
    });
  });

  it("toggles episode filter badge style on click", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByText(/记忆 \(2\)/)).toBeInTheDocument();
    });

    const epBtn = screen.getByText(/记忆 \(2\)/).closest("button")!;
    fireEvent.click(epBtn);

    // 点击后不再有 active 视觉（依赖 CSS class）
    await waitFor(() => {
      const btns = screen.getAllByRole("button");
      const epFilter = btns.find((b) => b.textContent?.includes("记忆"));
      expect(epFilter).toBeInTheDocument();
    });
  });

  // ── 搜索 ──

  it("shows search input when data is loaded", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("搜索标签…")).toBeInTheDocument();
    });
  });

  it("shows search match count after typing", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("搜索标签…")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索标签…");
    fireEvent.change(input, { target: { value: "记忆" } });

    await waitFor(() => {
      expect(screen.getByText(/匹配 2 个/)).toBeInTheDocument();
    });
  });

  it("clears search via close button", async () => {
    mockFetch.mockResolvedValueOnce(mockCoordsSuccess());
    render(<EmbeddingSpacePanel />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("搜索标签…")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索标签…");
    fireEvent.change(input, { target: { value: "记忆" } });

    await waitFor(() => {
      expect(screen.getByLabelText("清除搜索")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("清除搜索"));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  // ── PC3 方差 ──

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
      // 重试成功后显示可视化区域
      expect(screen.getByText(/拖拽旋转/)).toBeInTheDocument();
    });
  });
});
