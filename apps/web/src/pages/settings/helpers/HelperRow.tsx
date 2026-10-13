import type { ReactNode } from "react";
import { CopyButton, RelativeTime, StatusShapeGlyph } from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { type HelperReading, STATE_MARKS } from "./helpers-model.js";

/** The state as a mark and one plain word; only a state that needs the person takes color. */
export function StateWord({ reading }: { reading: HelperReading }) {
  const mark = STATE_MARKS[reading.state];
  return (
    <span className="inline-flex items-center gap-1.5 text-meta">
      <StatusShapeGlyph shape={mark.shape} />
      <span className={mark.attention ? "font-medium text-attention-text" : "text-ink-2"}>
        {reading.word}
      </span>
    </span>
  );
}

function Detail({ reading, extra }: { reading: HelperReading; extra?: ReactNode }) {
  if (reading.detail === "") return null;
  return (
    <p className="min-w-0 font-mono text-meta tabular-nums text-ink-3 [overflow-wrap:anywhere]">
      {reading.detail}
      {reading.lastSeenAt ? (
        <>
          {" "}
          <RelativeTime iso={reading.lastSeenAt} />
        </>
      ) : null}
      {extra}
    </p>
  );
}

/**
 * One helper: its name with its state, one mono detail, and at most one action at the trailing
 * edge. `below` is for what the action opens, which spans the row.
 */
export function HelperRow({
  name,
  reading,
  action,
  detailExtra,
  below,
  as: Tag = "div",
  onSubmit,
}: {
  name: string;
  reading: HelperReading;
  action?: ReactNode;
  detailExtra?: ReactNode;
  below?: ReactNode;
  as?: "div" | "form";
  onSubmit?: () => void;
}) {
  return (
    <Tag
      role="group"
      aria-label={name}
      data-row="true"
      {...(Tag === "form"
        ? {
            noValidate: true,
            onSubmit: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              onSubmit?.();
            },
          }
        : {})}
      className="flex flex-col gap-2 px-3.5 py-2"
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-ui font-medium text-ink">{name}</span>
            <StateWord reading={reading} />
          </div>
          <Detail reading={reading} extra={detailExtra} />
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {below}
    </Tag>
  );
}

/** The command that starts a helper, to copy, and a line that says whether it has called in yet. */
export function CommandPanel({ command, online }: { command: string; online: boolean }) {
  return (
    <div className="flex flex-col gap-2 pb-1">
      <div className="flex items-center gap-2 rounded-sm border border-line-strong bg-field py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 font-mono text-meta text-ink [overflow-wrap:anywhere]">
          {command}
        </code>
        <CopyButton value={command} label="Copy command" iconOnly />
      </div>
      <p
        role="status"
        className={cn(
          "inline-flex items-center gap-1.5 text-meta",
          online ? "text-ink-2" : "text-ink-3",
        )}
      >
        <StatusShapeGlyph shape={online ? "disc" : "ring"} />
        {online ? "Heartbeat received" : "waiting for heartbeat..."}
      </p>
    </div>
  );
}
