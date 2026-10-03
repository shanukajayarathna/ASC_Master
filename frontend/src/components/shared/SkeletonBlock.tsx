import Skeleton from "@mui/material/Skeleton";

/**
 * Generic first-load placeholders for pages whose data takes a moment — same bare-MUI-
 * `Skeleton` approach used across the app, just not pixel-matched to any one page's exact
 * layout. Compose these per page (`SkeletonCard` for a summary or chart, `SkeletonRows`
 * for a table) rather than reaching for a bespoke
 * skeleton per page.
 */

/** A handful of stacked lines, alternating width — stands in for a table or a list. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-surface p-4 flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="text" height={20} width={i % 2 === 0 ? "92%" : "68%"} />
      ))}
    </div>
  );
}

/** One rounded block — stands in for a chart or summary card. */
export function SkeletonCard({ height = 140 }: { height?: number }) {
  return <Skeleton variant="rounded" height={height} sx={{ borderRadius: "var(--radius-lg)" }} />;
}
