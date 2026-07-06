"use client";

import { Component } from "react";
import ErrorDisplay, { type ErrorDisplayProps } from "./ErrorDisplay";

// ── Props ──

export interface ErrorBoundaryProps {
  /** ErrorDisplay variant for the fallback UI (default: "card"). */
  fallbackVariant?: ErrorDisplayProps["variant"];
  /** Optional callback for logging / telemetry. */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  children: React.ReactNode;
}

// ── State ──

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — component-level crash isolation.
 *
 * Wraps children in a React 19 class component error boundary. When a child
 * throws during render, the boundary catches it, logs via console.error (and
 * optional `onError` callback), and renders an `ErrorDisplay` fallback instead
 * of letting the crash propagate to the route-level error.tsx.
 *
 * Three-layer wrapping strategy (Phase 66 B33 C10):
 *   1. ChatPanel messages.map() — per-message isolation (fallbackVariant="inline")
 *   2. ChatMessage sub-panels — independent isolation (fallbackVariant="inline")
 *   3. JourneyCards grid — per-card isolation (fallbackVariant="inline")
 *
 * Zero new dependencies — relies on React's built-in error boundary lifecycle
 * and the existing ErrorDisplay component for the fallback UI.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Caught render error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
    // Dev 模式额外日志（当前不可见 errorInfo 详情，helpful for debugging）
    if (process.env.NODE_ENV === "development") {
      console.error(
        "[ErrorBoundary] componentStack:",
        errorInfo.componentStack ?? "(not available)"
      );
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorDisplay
          variant={this.props.fallbackVariant ?? "card"}
          error={this.state.error}
        />
      );
    }

    return this.props.children;
  }
}
