import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LearnNote } from "@/lib/constants";

/** 测试用 localStorage mock store */
let mockStore: Record<string, string>;

/** 工厂：创建一条测试笔记 */
function makeNote(overrides: Partial<LearnNote> = {}): LearnNote {
  return {
    id: "note-1",
    questionId: "q1.1",
    selectedText: "溢出策略有三种常见处理方式。",
    noteText: "这里要注意滑动窗口和摘要压缩的适用场景。",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

/** 在 mock localStorage 中预置笔记数据 */
function seedNotes(questionId: string, notes: LearnNote[]) {
  const key = "gm-learn-notes";
  const existing = JSON.parse(mockStore[key] || "{}") as Record<string, LearnNote[]>;
  existing[questionId] = notes;
  mockStore[key] = JSON.stringify(existing);
}

// NotesPanel 在挂载后通过 useEffect 从 localStorage 读取 notesMap，
// 因此在 render 之前需要 `seedNotes()` 将种子数据写入 mockStore。
// 注意：首帧渲染返回 defaultValue {}，然后 useEffect 触发重新渲染恢复存储值。
// 因此所有断言需要 `waitFor` / `findBy*` 等待级联渲染完成。

import NotesPanel from "@/components/learn/NotesPanel";

describe("NotesPanel", () => {
  beforeEach(() => {
    mockStore = {};
    const mockLS = {
      getItem: vi.fn((key: string) => mockStore[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockStore[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStore[key];
      }),
      clear: vi.fn(() => {
        mockStore = {};
      }),
      get length() {
        return Object.keys(mockStore).length;
      },
      key: vi.fn((index: number) => Object.keys(mockStore)[index] ?? null),
    };
    vi.stubGlobal("localStorage", mockLS);
    // Stub crypto.randomUUID for deterministic note IDs
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "test-uuid-1"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 创建笔记 ──────────────────────────────────────────────

  it("renders empty state with add CTA when no notes", async () => {
    render(<NotesPanel questionId="q1.1" />);
    const empty = await screen.findByTestId("notes-panel-empty");
    expect(empty).toBeDefined();
    expect(screen.getByText(/还没有笔记/)).toBeDefined();
    expect(screen.getByTestId("note-create-btn")).toBeDefined();
  });

  it("expands inline creation area on + click", async () => {
    render(<NotesPanel questionId="q1.1" />);
    const addBtn = await screen.findByTestId("note-create-btn");
    fireEvent.click(addBtn);
    expect(screen.getByTestId("note-create-textarea")).toBeDefined();
    expect(screen.getByTestId("note-create-save-btn")).toBeDefined();
    expect(screen.getByTestId("note-create-cancel-btn")).toBeDefined();
  });

  it("saves new note to localStorage on save", async () => {
    render(<NotesPanel questionId="q1.1" />);
    const addBtn = await screen.findByTestId("note-create-btn");
    fireEvent.click(addBtn);

    const textarea = screen.getByTestId("note-create-textarea");
    fireEvent.change(textarea, {
      target: { value: "我的第一条笔记" },
    });
    fireEvent.click(screen.getByTestId("note-create-save-btn"));

    await waitFor(() => {
      const stored = JSON.parse(mockStore["gm-learn-notes"]) as Record<string, LearnNote[]>;
      const notes = stored["q1.1"];
      expect(notes).toHaveLength(1);
      expect(notes[0].noteText).toBe("我的第一条笔记");
      expect(notes[0].selectedText).toBe("");
      expect(notes[0].questionId).toBe("q1.1");
      expect(notes[0].id).toBe("test-uuid-1");
    });
  });

  it("cancels creation without saving", async () => {
    render(<NotesPanel questionId="q1.1" />);
    const addBtn = await screen.findByTestId("note-create-btn");
    fireEvent.click(addBtn);

    const textarea = screen.getByTestId("note-create-textarea");
    fireEvent.change(textarea, { target: { value: "不会保存的内容" } });
    fireEvent.click(screen.getByTestId("note-create-cancel-btn"));

    await waitFor(() => {
      expect(screen.queryByTestId("note-create-textarea")).toBeNull();
    });
    // localStorage 不应有任何写入
    expect(mockStore["gm-learn-notes"]).toBeUndefined();
  });

  // ── 笔记列表渲染 ──────────────────────────────────────────

  it("renders saved notes as cards", async () => {
    seedNotes("q1.1", [
      makeNote({ id: "n1", noteText: "第一条笔记", selectedText: "溢出策略" }),
    ]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => {
      expect(screen.getByTestId("note-card-n1")).toBeDefined();
      expect(screen.getByText("第一条笔记")).toBeDefined();
      expect(screen.getByText("溢出策略")).toBeDefined();
    });
  });

  it("renders selectedText as blockquote when non-empty", async () => {
    seedNotes("q1.1", [
      makeNote({ id: "n1", selectedText: "上下文窗口溢出的三种处理方式" }),
    ]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => {
      const quote = screen.getByTestId("note-quote-n1");
      expect(quote).toBeDefined();
      expect(quote.tagName).toBe("BLOCKQUOTE");
    });
  });

  it("does not render blockquote when selectedText is empty", async () => {
    seedNotes("q1.1", [
      makeNote({ id: "n1", selectedText: "", noteText: "纯文本笔记" }),
    ]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => {
      expect(screen.getByText("纯文本笔记")).toBeDefined();
      expect(screen.queryByTestId("note-quote-n1")).toBeNull();
    });
  });

  it("shows note count in header", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1" }), makeNote({ id: "n2" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => {
      expect(screen.getByTestId("notes-count").textContent).toBe("2");
    });
  });

  // ── 编辑笔记 ──────────────────────────────────────────────

  it("enters edit mode on edit button click", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1", noteText: "原始文本" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => {
      expect(screen.getByTestId("note-card-n1")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("note-edit-btn-n1"));

    await waitFor(() => {
      const textarea = screen.getByTestId("note-edit-textarea") as HTMLTextAreaElement;
      expect(textarea).toBeDefined();
      expect(textarea.value).toBe("原始文本");
    });
  });

  it("saves edited note and exits edit mode", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1", noteText: "原始文本" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => expect(screen.getByTestId("note-card-n1")).toBeDefined());
    fireEvent.click(screen.getByTestId("note-edit-btn-n1"));

    const textarea = await screen.findByTestId("note-edit-textarea");
    fireEvent.change(textarea, { target: { value: "修改后的文本" } });
    fireEvent.click(screen.getByTestId("note-save-btn"));

    await waitFor(() => {
      const stored = JSON.parse(mockStore["gm-learn-notes"]) as Record<string, LearnNote[]>;
      expect(stored["q1.1"][0].noteText).toBe("修改后的文本");
      expect(stored["q1.1"][0].updatedAt).toBeGreaterThan(
        stored["q1.1"][0].createdAt,
      );
    });
  });

  it("cancels edit without saving", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1", noteText: "原始文本" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => expect(screen.getByTestId("note-card-n1")).toBeDefined());
    fireEvent.click(screen.getByTestId("note-edit-btn-n1"));

    const textarea = await screen.findByTestId("note-edit-textarea");
    fireEvent.change(textarea, { target: { value: "未保存的修改" } });
    fireEvent.click(screen.getByTestId("note-cancel-btn"));

    await waitFor(() => {
      const stored = JSON.parse(mockStore["gm-learn-notes"]) as Record<string, LearnNote[]>;
      expect(stored["q1.1"][0].noteText).toBe("原始文本");
    });
  });

  // ── 删除笔记 ──────────────────────────────────────────────

  it("opens ConfirmModal on delete click", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => expect(screen.getByTestId("note-card-n1")).toBeDefined());
    fireEvent.click(screen.getByTestId("note-delete-btn-n1"));

    await waitFor(() => {
      // ConfirmModal is rendered via portal; check for confirm button
      expect(screen.getByText("删除")).toBeDefined();
    });
  });

  it("deletes note on confirm", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1" })]);
    render(<NotesPanel questionId="q1.1" />);

    await waitFor(() => expect(screen.getByTestId("note-card-n1")).toBeDefined());
    fireEvent.click(screen.getByTestId("note-delete-btn-n1"));

    await waitFor(() => expect(screen.getByText("删除")).toBeDefined());
    fireEvent.click(screen.getByText("删除"));

    await waitFor(() => {
      const stored = JSON.parse(mockStore["gm-learn-notes"]) as Record<string, LearnNote[]>;
      expect(stored["q1.1"]).toHaveLength(0);
    });
  });

  // ── questionId 切换 ───────────────────────────────────────

  it("resets edit state when questionId changes", async () => {
    seedNotes("q1.1", [makeNote({ id: "n1", noteText: "Ch1 笔记" })]);
    seedNotes("q1.2", [makeNote({ id: "n2", noteText: "Ch1 Q2 笔记" })]);

    const { rerender } = render(<NotesPanel questionId="q1.1" />);
    await waitFor(() => expect(screen.getByTestId("note-card-n1")).toBeDefined());

    // Enter edit mode on q1.1 note
    fireEvent.click(screen.getByTestId("note-edit-btn-n1"));
    await waitFor(() => expect(screen.getByTestId("note-edit-textarea")).toBeDefined());

    // Switch question
    rerender(<NotesPanel questionId="q1.2" />);

    await waitFor(() => {
      // Edit mode should be closed
      expect(screen.queryByTestId("note-edit-textarea")).toBeNull();
      // q1.2 note should be visible
      expect(screen.getByTestId("note-card-n2")).toBeDefined();
    });
  });

  // ── B66: initialSelectedText auto-create ───────────────────

  describe("B66 initialSelectedText", () => {
    it("auto-enters create mode when initialSelectedText is provided", async () => {
      render(
        <NotesPanel
          questionId="q1.1"
          initialSelectedText="选中的示例文本"
        />,
      );
      const textarea = await screen.findByTestId("note-create-textarea");
      expect(textarea).toBeDefined();
      // 应显示选中文本引用
      const quote = screen.getByTestId("note-create-quote");
      expect(quote).toBeDefined();
      expect(quote.textContent).toContain("选中的示例文本");
    });

    it("saves note with selectedText populated from initialSelectedText", async () => {
      render(
        <NotesPanel
          questionId="q1.1"
          initialSelectedText="被选中的溢出策略段落"
        />,
      );
      const textarea = await screen.findByTestId("note-create-textarea");
      fireEvent.change(textarea, { target: { value: "我的划词笔记" } });
      fireEvent.click(screen.getByTestId("note-create-save-btn"));

      await waitFor(() => {
        const stored = JSON.parse(
          mockStore["gm-learn-notes"],
        ) as Record<string, LearnNote[]>;
        const notes = stored["q1.1"];
        expect(notes).toHaveLength(1);
        expect(notes[0].selectedText).toBe("被选中的溢出策略段落");
        expect(notes[0].noteText).toBe("我的划词笔记");
      });
    });

    it("calls onNoteCreated after save", async () => {
      const onNoteCreated = vi.fn();
      render(
        <NotesPanel
          questionId="q1.1"
          initialSelectedText="划词文本"
          onNoteCreated={onNoteCreated}
        />,
      );
      const textarea = await screen.findByTestId("note-create-textarea");
      fireEvent.change(textarea, { target: { value: "笔记内容" } });
      fireEvent.click(screen.getByTestId("note-create-save-btn"));

      await waitFor(() => {
        expect(onNoteCreated).toHaveBeenCalledTimes(1);
      });
    });

    it("calls onNoteCreated after cancel", async () => {
      const onNoteCreated = vi.fn();
      render(
        <NotesPanel
          questionId="q1.1"
          initialSelectedText="划词文本"
          onNoteCreated={onNoteCreated}
        />,
      );
      await screen.findByTestId("note-create-textarea");
      fireEvent.click(screen.getByTestId("note-create-cancel-btn"));

      await waitFor(() => {
        expect(onNoteCreated).toHaveBeenCalledTimes(1);
      });
    });

    it("does not auto-create when initialSelectedText is empty string", async () => {
      render(
        <NotesPanel questionId="q1.1" initialSelectedText="" />,
      );
      // empty string should not trigger create mode
      const empty = await screen.findByTestId("notes-panel-empty");
      expect(empty).toBeDefined();
    });

    it("does not show quote in create UI when initialSelectedText is absent", async () => {
      render(<NotesPanel questionId="q1.1" />);
      const addBtn = await screen.findByTestId("note-create-btn");
      fireEvent.click(addBtn);
      // 手动创建不应有选中引用块
      expect(screen.queryByTestId("note-create-quote")).toBeNull();
    });
  });
});
