import { formatDateTime, shortRelative } from "../../lib/format.js";
import { useNow } from "../../lib/use-now.js";
import { Tooltip } from "./Tooltip.js";

/** "7m ago" in the line, the exact time on hover and focus. */
export function RelativeTime({ iso }: { iso: string }) {
  const now = useNow();
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time dateTime={iso}>{shortRelative(iso, now)}</time>
    </Tooltip>
  );
}
