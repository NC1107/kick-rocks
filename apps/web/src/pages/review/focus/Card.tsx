import type { NeedsYouItem } from "@kickrocks/shared";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { screenshotUrl } from "../../../api/index.js";
import {
  Button,
  Dialog,
  EntityLink,
  Hatch,
  IconButton,
  InlineError,
  Kbd,
  Menu,
  type MenuItem,
  Meter,
  Tag,
} from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { ageLabel } from "../model.js";
import { useFocus } from "./context.js";
import { KIND_COPY, WORDS } from "./copy.js";
import { effortLabel, itemTitle } from "./model.js";

/** A step the person takes, numbered in mono. Five words at most, and three steps at most. */
export function Steps({ steps }: { steps: readonly string[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0">
      {steps.map((step, index) => (
        <li key={step} className="flex items-baseline gap-2.5 text-body text-ink">
          {steps.length > 1 ? (
            <span className="w-4 shrink-0 font-mono text-meta text-ink-3 tabular-nums">
              {index + 1}
            </span>
          ) : null}
          {step}
        </li>
      ))}
    </ol>
  );
}

/** The page where the task stopped, small enough to leave the card short and tappable for the rest. */
export function Thumbnail({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <Hatch className="h-18 px-3 py-3">No screenshot.</Hatch>;
  const url = screenshotUrl(taskId);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block h-18 w-full max-w-72 overflow-hidden rounded-sm border border-line bg-canvas text-left"
      >
        <img
          src={url}
          alt="The page where the task stopped. Select to enlarge."
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="The page" size="lg">
        <div className="max-h-[70vh] overflow-auto rounded-sm border border-line bg-canvas">
          <img src={url} alt="The page where the task stopped" className="h-auto w-full" />
        </div>
      </Dialog>
    </>
  );
}

function TopBar({ menu }: { menu: readonly MenuItem[] }) {
  const { progress, canMove, next, previous } = useFocus();
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
      <IconButton label="Previous" onClick={previous} disabled={!canMove}>
        <ChevronLeft />
      </IconButton>
      <IconButton label="Next" onClick={next} disabled={!canMove}>
        <ChevronRight />
      </IconButton>
      <span className="font-mono text-meta text-ink-2 tabular-nums">
        {progress.position} of {progress.total}
      </span>
      <Meter
        label="Done this sitting"
        value={progress.done}
        max={Math.max(progress.total, 1)}
        ticks={[]}
        warnAt={2}
        className="min-w-0 flex-1"
      />
      <Menu
        align="end"
        items={menu}
        trigger={(props) => (
          <IconButton label="More" {...props}>
            <MoreHorizontal />
          </IconButton>
        )}
      />
    </div>
  );
}

export interface ActionSpec {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
}

/** One filled button and at most one quiet one. On a phone the bar sticks to the bottom edge. */
export function ActionBar({
  primary,
  second,
  error,
  hints = true,
  enter = true,
}: {
  primary: ActionSpec;
  second?: ActionSpec | null | undefined;
  error?: string | undefined;
  hints?: boolean;
  /** Whether Enter on the page presses the primary button. Off where it sends personal data. */
  enter?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
        <Button
          variant="primary"
          data-primary={enter ? "" : undefined}
          onClick={primary.onClick}
          loading={primary.loading ?? false}
          disabled={primary.disabled ?? false}
          title={primary.title}
          className="max-sm:min-h-11"
        >
          {primary.label}
        </Button>
        {second ? (
          <Button
            variant="ghost"
            onClick={second.onClick}
            loading={second.loading ?? false}
            disabled={second.disabled ?? false}
            title={second.title}
            className="max-sm:min-h-11"
          >
            {second.label}
          </Button>
        ) : null}
        {hints ? (
          <span className="ml-auto hidden items-center gap-1 text-caption text-ink-3 lg:inline-flex pointer-coarse:hidden">
            {enter ? <Kbd>Enter</Kbd> : null}
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <Kbd>z</Kbd>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface CardFrameProps {
  item: NeedsYouItem;
  menu: readonly MenuItem[];
  /** The tag text when it is more than the kind's own, such as a countdown. */
  tagText?: string | undefined;
  /** What the card says, between its header and its actions. */
  children?: ReactNode;
  /** The action bar, or the return prompt in its place. */
  bar: ReactNode;
  /** Dialogs the card opens, kept outside the card's layout. */
  dialogs?: ReactNode;
}

/**
 * The same card for every kind: where you are in the queue, what it is about, what to do, and the
 * one button that does it. Only the middle changes from kind to kind.
 */
export function CardFrame({ item, menu, tagText, children, bar, dialogs }: CardFrameProps) {
  const copy = KIND_COPY[item.kind];
  const title = itemTitle(item);
  return (
    <article
      aria-label={title}
      data-kind={item.kind}
      className="flex min-w-0 max-w-[40rem] flex-col rounded-md border border-line bg-surface"
    >
      <TopBar menu={menu} />
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 break-words text-heading font-semibold text-ink [&_a]:text-ink [&_a:hover]:text-accent-text">
              {item.target && item.kind !== "record" ? (
                <EntityLink
                  to={{ kind: "target", id: item.target.id, name: item.target.name }}
                  variant="quiet"
                />
              ) : (
                title
              )}
            </h2>
            <p className="m-0 flex shrink-0 items-baseline gap-2 font-mono text-meta text-ink-3 tabular-nums">
              <span>{effortLabel(item.effort.minutes)}</span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="sr-only">Waiting </span>
                {ageLabel(item.since)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="attention">{tagText ?? copy.tag}</Tag>
            {item.tries > 0 ? <Tag>{WORDS.tried(item.tries)}</Tag> : null}
          </div>
        </header>
        {children}
      </div>
      <div
        className={cn(
          "sticky bottom-0 z-10 rounded-b-md border-t border-line bg-canvas px-4 py-3",
          "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-none max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        {bar}
      </div>
      {dialogs}
    </article>
  );
}
