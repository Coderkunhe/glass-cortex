/**
 * useCodeHighlight — 代码块 DOM 增强 Hook。
 *
 * 在客户端 useEffect 中扫描容器内的 <pre><code class="language-xxx"> 代码块，
 * 依次应用：① Prism.js 语法高亮 ② line-numbers 行号 ③ 复制按钮。
 *
 * 对齐 mermaid hydration 模式（ChatMessage.tsx:53-91）：所有 DOM 操作
 * 在 client-only useEffect 中完成，SSR 安全，createRoot 挂载 React 组件。
 *
 * @module hooks/useCodeHighlight
 */

"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import Prism from "@/lib/prism";
import { CopyButton } from "@/components/ui/CopyButton";

/**
 * 对容器内所有代码块执行 Prism 语法高亮 + 行号 + 复制按钮注入。
 *
 * @param containerRef — 包含代码块的 DOM 容器 ref
 * @param deps — 依赖数组，内容变更时重新执行高亮
 */
export function useCodeHighlight(
  containerRef: RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  const copyRootsRef = useRef<Map<HTMLElement, Root>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const codeElements = container.querySelectorAll<HTMLElement>(
      "pre code[class*='language-']",
    );
    if (codeElements.length === 0) return;

    const activePres = new Set<HTMLElement>();

    codeElements.forEach((code) => {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") return;
      activePres.add(pre);

      // ① 行号：给 <pre> 添加 line-numbers class
      pre.classList.add("line-numbers");

      // ② Prism 语法高亮（幂等：Prism 内部通过 data-prism 属性跳过高亮过的元素）
      Prism.highlightElement(code);

      // ③ 复制按钮：通过 createRoot 挂载 CopyButton React 组件
      // 只在首次处理此 <pre> 时创建 root
      if (!copyRootsRef.current.has(pre)) {
        const btnContainer = document.createElement("span");
        btnContainer.className = "gm-code-copy-btn";
        pre.appendChild(btnContainer);

        const root = createRoot(btnContainer);
        copyRootsRef.current.set(pre, root);

        const codeText = code.textContent || "";
        root.render(<CopyButton text={codeText} />);
      }

      // 如果代码内容变了（同一 pre 新内容），更新 copy button
      const existingRoot = copyRootsRef.current.get(pre);
      if (existingRoot) {
        const codeText = code.textContent || "";
        existingRoot.render(<CopyButton text={codeText} />);
      }
    });

    // 清理：卸载已移出 DOM 的 <pre> 对应的 React root
    copyRootsRef.current.forEach((root, pre) => {
      if (!activePres.has(pre)) {
        queueMicrotask(() => root.unmount());
        copyRootsRef.current.delete(pre);
      }
    });

    // 组件卸载时清理所有残留 root，防止 createRoot 泄漏
    const roots = copyRootsRef.current;
    return () => {
      roots.forEach((root) => {
        root.unmount();
      });
      roots.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
