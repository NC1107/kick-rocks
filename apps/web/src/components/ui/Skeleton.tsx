import { cn } from "../../lib/cn.js";

/** A grey block that stands in for content that is on its way. Size it with className. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-line", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder lines have no identity
          key={line}
          className={cn("h-3.5", line === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}
