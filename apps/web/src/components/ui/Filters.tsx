import { SlidersHorizontal, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";
import { Select } from "./Select.js";
import { Tag } from "./Tag.js";

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
  className?: string;
}

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
 * bottom sheet with 44px rows below that. Filters apply as they change.
 */
export function Filters({ groups, onClear, extraActive = 0, className }: FiltersProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const active = groups.filter((group) => group.value).length + extraActive;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("select")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!(onPhone() || rootRef.current?.contains(event.target as Node))) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select") ?? [],
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!(first && last)) return;
    const leavingStart = event.shiftKey && document.activeElement === first;
    const leavingEnd = !event.shiftKey && document.activeElement === last;
    if (!(leavingStart || leavingEnd)) return;
    if (onPhone()) {
      event.preventDefault();
      (leavingStart ? last : first).focus();
    } else {
      close(false);
    }
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
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-30 animate-fade bg-scrim sm:hidden"
            onClick={() => close(true)}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-lg border-t border-line-popover bg-popover pb-[env(safe-area-inset-bottom)] shadow-pop sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:z-30 sm:mt-1 sm:max-h-none sm:w-80 sm:rounded-lg sm:border sm:pb-0"
          >
            <div className="flex items-center justify-between gap-2 py-1.5 pr-1.5 pl-3.5">
              <h2 id={titleId} className="text-ui font-semibold text-ink">
                Filters
              </h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" disabled={active === 0} onClick={onClear}>
                  Clear all
                </Button>
                <IconButton label="Close filters" onClick={() => close(true)}>
                  <X aria-hidden="true" />
                </IconButton>
              </div>
            </div>
            <div className="overflow-y-auto border-t border-line-popover px-3.5 py-1.5">
              {groups.map((group) => (
                <FilterRow key={group.id} group={group} />
              ))}
            </div>
          </div>
        </>
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

/** Outlined tags for the filters in effect, each removable. Renders nothing when none is. */
export function FilterTags({ tags }: { tags: readonly ActiveTag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="mb-2.5 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag.id}>
          <Tag className="h-6 gap-1 pr-1">
            {tag.label}
            <button
              type="button"
              aria-label={`Remove ${tag.label}`}
              onClick={tag.onRemove}
              className="relative inline-flex size-4 items-center justify-center rounded-xs text-ink-3 before:absolute before:-inset-3 hover:text-ink sm:before:-inset-1 [&_svg]:size-3"
            >
              <X aria-hidden="true" />
            </button>
          </Tag>
        </li>
      ))}
    </ul>
  );
}
