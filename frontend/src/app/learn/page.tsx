import { Suspense } from "react";
import {
  getChapters,
  loadAllChaptersParallel,
} from "@/lib/content/questions";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import LearnClientShell from "./_components/LearnClientShell";
import LearnLoadingSkeleton from "./_components/LearnLoadingSkeleton";

/**
 * /learn 路由页。
 * 服务端组件：通过 Promise.all 并行加载全部 8 章答案，
 * 通过 searchParams 接收 ?q= 参数实现 deep linking。
 * Suspense 包裹 LearnClientShell 以兼容 useSearchParams。
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const chapters = getChapters();

  // 并行加载全部章节答案 — 各章通过动态 import() 独立加载
  const questionsByChapter = await loadAllChaptersParallel();
  const { q } = await searchParams;
  const initialUrlId = q ?? null;

  return (
    <Suspense fallback={<LearnLoadingSkeleton />}>
      <ErrorBoundary fallbackVariant="card">
        <LearnClientShell
          chapters={chapters}
          questionsByChapter={questionsByChapter}
          initialUrlId={initialUrlId}
        />
      </ErrorBoundary>
    </Suspense>
  );
}
