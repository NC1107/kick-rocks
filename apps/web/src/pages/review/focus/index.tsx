import {
  API_ROUTES,
  type NeedsYouItem,
  type NeedsYouQueue,
  type RequestRight,
  type ReviewQueue,
} from "@kickrocks/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Callout,
  Dialog,
  Kbd,
  RelativeTime,
  Section,
  TextLink,
  useToast,
} from "../../../components/ui/index.js";
import { paths } from "../../../lib/paths.js";
import { shortcutAllowed } from "../keys.js";
import { REVIEW_INVALIDATES } from "../model.js";
import { type FocusContext, FocusState } from "./context.js";
import { KIND_COPY, WORDS } from "./copy.js";
import { KindCard } from "./kinds.js";
import {
  neighbour,
  openedRecently,
  pickKey,
  progressOf,
  RETURN_AFTER_MS,
  type SnoozePreset,
  snoozedLine,
  UNDO_MS,
} from "./model.js";
import { SnoozeSheet } from "./SnoozeSheet.js";
import { UpNext, upNextLine } from "./UpNext.js";

/** `task:abc` is the task `abc`; the address and the routes share the one spelling. */
function refOf(key: string): { kind: "task" | "match" | "details"; id: string } {
  const split = key.indexOf(":");
  return { kind: key.slice(0, split) as "task" | "match" | "details", id: key.slice(split + 1) };
}

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  /** `keepalive` is set when the page is going away, so the request outlives it. */
  send: (keepalive: boolean) => void;
}

function End({ done, snoozed, review }: { done: number; snoozed: number; review: ReviewQueue }) {
  const [, setParams] = useSearchParams();
  const links = [
    { label: "Mail", count: review.messages.length, to: paths.reviewSection("mail") },
    { label: "Problems", count: review.failedTasks.length, to: paths.reviewSection("problems") },
  ].filter((link) => link.count > 0);
  return (
    <div className="flex max-w-[40rem] flex-col gap-2 rounded-md border border-line bg-surface px-4 py-4">
      <p className="m-0 text-heading font-semibold text-ink">
        {done > 0 ? WORDS.allDone : WORDS.nothing}
      </p>
      {snoozed > 0 ? (
        <p className="m-0 text-ui text-ink-2">
          {snoozed} snoozed ·{" "}
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams({ show: "snoozed" }))}
            className="rounded-xs text-accent-text underline decoration-accent-text/40 underline-offset-2"
          >
            Show
          </button>
        </p>
      ) : null}
      {links.length > 0 ? (
        <p className="m-0 flex flex-wrap gap-x-4 text-ui">
          {links.map((link) => (
            <TextLink key={link.label} to={link.to}>
              {link.label} · {link.count}
            </TextLink>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function SnoozedList({ queue }: { queue: NeedsYouQueue }) {
  const [, setParams] = useSearchParams();
  const bringBack = useApiMutation(API_ROUTES.needsYouUnsnooze, {
    invalidates: REVIEW_INVALIDATES,
  });
  return (
    <div className="flex max-w-[40rem] flex-col gap-3 rounded-md border border-line bg-surface px-4 py-4">
      <Section label="Snoozed" count={queue.snoozed.length}>
        {queue.snoozed.length === 0 ? (
          <p className="m-0 text-ui text-ink-2">Nothing is snoozed.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {queue.snoozed.map((entry) => {
              const { kind, id } = refOf(entry.key);
              return (
                <li key={entry.key} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui text-ink">{entry.title}</span>
                    <span className="flex items-center gap-2 text-meta text-ink-3">
                      <span>{KIND_COPY[entry.kind].tag}</span>
                      <RelativeTime iso={entry.until} />
                    </span>
                  </span>
                  <Button
                    size="sm"
                    loading={bringBack.isPending && bringBack.variables?.params.id === id}
                    onClick={() => bringBack.mutate({ params: { kind, id } })}
                  >
                    Bring back
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <button
        type="button"
        onClick={() => setParams(new URLSearchParams())}
        className="self-start rounded-xs text-ui text-accent-text underline decoration-accent-text/40 underline-offset-2"
      >
        Back to the queue
      </button>
    </div>
  );
}

/**
 * The Needs you page: one card at a time, the quickest first, with the one button that finishes
 * it. The address names the open item, and the item after it is picked when it is dealt with.
 */
export function Focus({
  profileId,
  mailboxConnected,
  queue,
  review,
}: {
  profileId: string;
  mailboxConnected: boolean;
  queue: NeedsYouQueue;
  review: ReviewQueue;
}) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const itemParam = params.get("item");
  const showSnoozed = params.get("show") === "snoozed";

  const [done, setDone] = useState(0);
  const [promptKey, setPromptKey] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const lastIndex = useRef(0);

  const items = useMemo(
    () => queue.items.filter((item) => !held.has(item.key)),
    [queue.items, held],
  );
  const keys = useMemo(() => items.map((item) => item.key), [items]);
  const selectedKey = pickKey(keys, itemParam, lastIndex.current);
  const selected: NeedsYouItem | undefined = items.find((item) => item.key === selectedKey);
  const progress = progressOf(done, items.length, Math.max(0, keys.indexOf(selectedKey ?? "")));

  useEffect(() => {
    if (selectedKey !== null) lastIndex.current = Math.max(0, keys.indexOf(selectedKey));
  }, [keys, selectedKey]);

  // Dealing with an item removes it, so the address follows to the one that took its place.
  useEffect(() => {
    if (showSnoozed || selectedKey === null || itemParam === selectedKey) return;
    setParams(new URLSearchParams({ item: selectedKey }), { replace: true });
  }, [itemParam, selectedKey, setParams, showSnoozed]);

  const select = useCallback(
    (key: string | null) => {
      if (key === null) return;
      setPromptKey(null);
      setParams(new URLSearchParams({ item: key }), { replace: true });
    },
    [setParams],
  );

  // A page that loads with an "Open the page" from the last two hours asks about it once.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || seen.current.has(selected.key)) return;
    seen.current.add(selected.key);
    if (openedRecently(selected, Date.now())) setPromptKey(selected.key);
  }, [selected]);

  // Coming back to the tab after a while away asks whether the page the person opened worked.
  const openedKey = useRef<string | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      const key = openedKey.current;
      if (key !== null && away >= RETURN_AFTER_MS && selectedRef.current === key) {
        openedKey.current = null;
        setPromptKey(key);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const opened = useApiMutation(API_ROUTES.needsYouOpened);
  const openPage = useCallback(
    (item: NeedsYouItem) => {
      openedKey.current = item.key;
      opened.mutate({ params: refOf(item.key) });
      if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
    },
    [opened],
  );

  const decide = useApiMutation(API_ROUTES.matchDecide, {
    invalidates: REVIEW_INVALIDATES,
    onError: (error) => setFailure(errorMessage(error)),
  });
  const release = useCallback((key: string) => {
    setHeld((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);
  const settle = useCallback((key: string, keepalive = false) => {
    const entry = pending.current.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(key);
    entry.send(keepalive);
  }, []);
  const decideRecord = useCallback(
    (item: NeedsYouItem, decision: "mine" | "not_mine", rights: readonly RequestRight[]) => {
      if (!("match" in item.source)) return;
      const { id } = item.source.match;
      const { key } = item;
      setHeld((current) => new Set(current).add(key));
      setDone((count) => count + 1);
      setPromptKey(null);
      pending.current.set(key, {
        timer: setTimeout(() => settle(key), UNDO_MS),
        send: (keepalive) =>
          decide.mutate(
            { params: { id }, body: { decision, rights: [...rights] }, keepalive },
            { onSettled: () => release(key) },
          ),
      });
      toast.success(decision === "mine" ? "Removal queued" : "Marked not you", undefined, {
        durationMs: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const entry = pending.current.get(key);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending.current.delete(key);
            setDone((count) => Math.max(0, count - 1));
            release(key);
            select(key);
          },
        },
      });
    },
    [decide, release, select, settle, toast],
  );

  // Leaving the page sends what is still waiting, since "mine" cannot be taken back on the server.
  // A phone only reports a hidden tab, and may stop it before the timer fires, so that sends too.
  const settleAll = useRef(() => {});
  settleAll.current = () => {
    for (const key of [...pending.current.keys()]) settle(key, true);
  };
  useEffect(() => {
    const run = () => settleAll.current();
    const onHide = () => {
      if (document.visibilityState === "hidden") run();
    };
    window.addEventListener("pagehide", run);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", run);
      document.removeEventListener("visibilitychange", onHide);
      run();
    };
  }, []);

  const snooze = useApiMutation(API_ROUTES.needsYouSnooze, {
    invalidates: REVIEW_INVALIDATES,
    onError: (error) => setFailure(errorMessage(error)),
  });
  const pickSnooze = (preset: SnoozePreset) => {
    if (!selected) return;
    setSnoozing(false);
    snooze.mutate(
      {
        params: refOf(selected.key),
        body: { until: preset.until.toISOString() },
      },
      { onSuccess: () => toast.success(snoozedLine(preset.until, new Date())) },
    );
  };
  const bringBack = useApiMutation(API_ROUTES.needsYouUnsnooze, {
    invalidates: REVIEW_INVALIDATES,
  });

  const next = useCallback(
    () => select(neighbour(keys, selectedKey, 1)),
    [keys, select, selectedKey],
  );
  const previous = useCallback(
    () => select(neighbour(keys, selectedKey, -1)),
    [keys, select, selectedKey],
  );

  const followingKey = neighbour(keys, selectedKey, 1);
  const following =
    followingKey === selectedKey ? undefined : items.find((item) => item.key === followingKey);

  const context: FocusContext = {
    profileId,
    upNext: following ? upNextLine(following) : null,
    mailboxConnected,
    progress,
    canMove: keys.length > 1,
    promptKey,
    setPrompt: setPromptKey,
    openPage,
    resolved: () => {
      setDone((count) => count + 1);
      setPromptKey(null);
    },
    next,
    previous,
    skip: next,
    openSnooze: () => setSnoozing(true),
    openList: () => setListOpen(true),
    decideRecord,
  };

  // The handler reads the latest selection, so it is bound again on every change.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      if (event.key === "j") next();
      else if (event.key === "k") previous();
      else if (event.key === "z" && selected && selected.kind !== "hold") setSnoozing(true);
      else if (event.key === "Enter" && event.target === document.body) {
        document.querySelector<HTMLElement>("[data-primary]:not(:disabled)")?.click();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (showSnoozed) return <SnoozedList queue={queue} />;

  return (
    <FocusState value={context}>
      <div>
        {failure ? (
          <Callout intent="danger" title="Could not save that" className="mb-4 max-w-[40rem]">
            {failure}
          </Callout>
        ) : null}
        {selected ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
            <KindCard item={selected} />
            <div className="hidden lg:block">
              <UpNext
                items={items}
                currentKey={selectedKey}
                snoozed={queue.snoozed}
                onSelect={select}
                onBringBack={(key) => bringBack.mutate({ params: refOf(key) })}
              />
            </div>
          </div>
        ) : null}
        {selected ? (
          <p className="mt-4 hidden items-center gap-1.5 text-caption text-ink-3 lg:flex pointer-coarse:hidden">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            move
            <Kbd>z</Kbd>
            snooze
          </p>
        ) : null}
        {selected ? null : <End done={done} snoozed={queue.snoozed.length} review={review} />}
      </div>
      <SnoozeSheet
        open={snoozing}
        onClose={() => setSnoozing(false)}
        onPick={pickSnooze}
        now={() => new Date()}
      />
      <Dialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={WORDS.upNext}
        size="sm"
        sheet
      >
        {listOpen ? (
          <UpNext
            heading={false}
            items={items}
            currentKey={selectedKey}
            snoozed={queue.snoozed}
            onSelect={(key) => {
              setListOpen(false);
              select(key);
            }}
            onBringBack={(key) => bringBack.mutate({ params: refOf(key) })}
          />
        ) : null}
      </Dialog>
    </FocusState>
  );
}
