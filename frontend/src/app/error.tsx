"use client";

import ErrorDisplay from "@/components/ui/ErrorDisplay";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorDisplay variant="fullscreen" error={error} onRetry={reset} />;
}
