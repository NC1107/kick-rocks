import { SlidersHorizontal, X } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";
import { Select } from "./Select.js";
import { Tag } from "./Tag.js";
import { announceOverlayOpen } from "./Tooltip.js";

export interface FilterOption {
  value: string;
  label: string;
  /** How many rows the option matches, shown after the label. */
  count?: number;
}

export interface FilterGroup {
  id: string;
  /** Names the row and prefixes the active tag, such as "Status". */
  label: string;
  value: string;
  options: readonly FilterOption[];
  /** The option that means no filter, such as "All". */
  allLabel: string;
  onChange: (value: string) => void;
}

export interface ActiveTag {
  id: string;
  /** Names the tag and its remove button, such as "Status: Sent". */
  label: string;
  onRemove: () => void;
}

export interface FiltersProps {
  groups: readonly FilterGroup[];
  /** Clears every filter in the groups, and any other filter the page keeps. */
  onClear: () => void;
  /** Counts filters the popup does not hold, such as a target taken from a link. */
  extraActive?: number;
  /** The result count, such as "12 targets", shown in the sheet header on phones where the toolbar hides it. */
  resultCount?: string | undefined;
  /** Lets the page send focus to the Filters button, such as after the last tag is removed. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
}

const GUTTER = 16;
const PHONE_QUERY = "(max-width: 639px)";

function onPhone(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

function optionLabel(option: FilterOption): string {
  return option.count === undefined ? option.label : `${option.label} (${option.count})`;
}

/** The filters in effect, as the tags shown under the toolbar. */
export function activeFilterTags(groups: readonly FilterGroup[]): ActiveTag[] {
  return groups.flatMap((group) => {
    if (!group.value) return [];
    const option = group.options.find((entry) => entry.value === group.value);
    return [
      {
        id: group.id,
        label: `${group.label}: ${option?.label ?? group.value}`,
        onRemove: () => group.onChange(""),
      },
    ];
  });
}

/**
 * One button that opens every filter of a list. A popover under the button from 640px up, a
 * modal bottom sheet with 44px rows below that. Filters apply as they change.
 */
export function Filters({
  groups,
  onClear,
  extraActive = 0,
  resultCount,
  triggerRef,
  className,
}: FiltersProps) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ownButtonRef = useRef<HTMLButtonElement>(null);
  const buttonRef = triggerRef ?? ownButtonRef;
  const panelRef = useRef<HTMLDialogElement>(null);
  const modalRef = useRef(false);
  const panelId = useId();
  const titleId = useId();
  const active = groups.filter((group) => group.value).length + extraActive;

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) buttonRef.current?.focus();
    },
    [buttonRef],
  );

  const focusFirstSelect = useCallback(
    () => panelRef.current?.querySelector<HTMLElement>("select")?.focus(),
    [],
  );

  // The panel opens before it paints so a popover that would leave the screen can swap sides
  // first. A sheet is the native modal dialog, which makes the page behind inert and traps focus.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!(open && panel)) return;
    modalRef.current = onPhone();
    if (modalRef.current) {
      panel.showModal();
    } else {
      panel.show();
      const root = rootRef.current?.getBoundingClientRect();
      setFlipped(root !== undefined && root.left + panel.offsetWidth > window.innerWidth - GUTTER);
    }
    announceOverlayOpen();
    focusFirstSelect();
  }, [open, focusFirstSelect]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!(modalRef.current || rootRef.current?.contains(event.target as Node))) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (modalRef.current || event.key !== "Tab" || !event.shiftKey) return;
    const first = panelRef.current?.querySelector<HTMLElement>("button:not(:disabled), select");
    if (document.activeElement !== first) return;
    event.preventDefault();
    close(true);
  };

  // Tab past the last control closes the popover once focus has already moved on.
  const onBlur = (event: FocusEvent<HTMLDialogElement>) => {
    const next = event.relatedTarget as Node | null;
    if (modalRef.current || !next || panelRef.current?.contains(next)) return;
    if (next !== buttonRef.current) setOpen(false);
  };

  const clearAll = () => {
    onClear();
    focusFirstSelect();
  };

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <Button
        ref={buttonRef}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={active > 0 ? `Filters, ${active} active` : "Filters"}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {active > 0 ? (
          <span aria-hidden="true" className="font-mono text-meta text-ink-2 tabular-nums">
            {active}
          </span>
        ) : null}
      </Button>
      {open ? (
        <dialog
          ref={panelRef}
          id={panelId}
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onCancel={(event) => {
            event.preventDefault();
            close(true);
          }}
          onMouseDown={(event) => {
            if (modalRef.current && event.target === event.currentTarget) close(true);
          }}
          className={cn(
            "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none flex-col overflow-hidden rounded-t-lg border-0 border-t border-line-popover bg-popover p-0 text-ink shadow-pop backdrop:bg-scrim open:flex open:animate-settle",
            "sm:absolute sm:z-30 sm:inset-auto sm:top-full sm:mt-1 sm:max-h-none sm:w-80 sm:max-w-[calc(100vw-2rem)] sm:rounded-lg sm:border sm:animate-none",
            flipped ? "sm:right-0" : "sm:left-0",
          )}
        >
          <div className="flex items-center justify-between gap-2 py-1.5 pr-2.5 pl-4 sm:pr-1.5 sm:pl-3.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 id={titleId} className="text-ui font-semibold text-ink">
                Filters
              </h2>
              {resultCount ? (
                <span className="truncate font-mono text-meta text-ink-3 tabular-nums sm:hidden">
                  {resultCount}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {active > 0 ? (
                <Button variant="ghost" onClick={clearAll}>
                  Clear all
                </Button>
              ) : null}
              <IconButton label="Close filters" onClick={() => close(true)}>
                <X aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          <div className="overflow-y-auto border-t border-line-popover px-4 py-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-3.5 sm:pb-1.5">
            {groups.map((group) => (
              <FilterRow key={group.id} group={group} />
            ))}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

function FilterRow({ group }: { group: FilterGroup }) {
  const id = useId();
  return (
    <div className="grid min-h-control grid-cols-[5.5rem_1fr] items-center gap-3 py-1">
      <label htmlFor={id} className="text-meta text-ink-3">
        {group.label}
      </label>
      <Select id={id} value={group.value} onChange={(event) => group.onChange(event.target.value)}>
        <option value="">{group.allLabel}</option>
        {group.options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionLabel(option)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Outlined tags for the filters in effect, each removable. Renders nothing when none is. Removing
 * a tag moves focus to a neighbor first, else to `emptyFocusRef`, so a keyboard user keeps their place.
 */
export function FilterTags({
  tags,
  emptyFocusRef,
}: {
  tags: readonly ActiveTag[];
  emptyFocusRef?: RefObject<HTMLElement | null>;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  if (tags.length === 0) return null;

  const remove = (tag: ActiveTag, index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLElement>("button") ?? [];
    (buttons[index + 1] ?? buttons[index - 1] ?? emptyFocusRef?.current)?.focus();
    tag.onRemove();
  };

  return (
    <ul
      ref={listRef}
      aria-label="Active filters"
      className="mb-2.5 flex flex-wrap gap-2 sm:gap-1.5"
    >
      {tags.map((tag, index) => (
        <li key={tag.id}>
          <Tag className="h-6 gap-1 pr-1">
            {tag.label}
            <button
              type="button"
              aria-label={`Remove ${tag.label}`}
              onClick={() => remove(tag, index)}
              className="relative inline-flex size-4 items-center justify-center rounded-xs text-ink-3 before:absolute before:-inset-3.5 hover:text-ink sm:before:-inset-1 [&_svg]:size-3"
            >
              <X aria-hidden="true" />
            </button>
          </Tag>
        </li>
      ))}
    </ul>
  );
}
