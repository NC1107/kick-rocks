import type { NeedsYouItem, NeedsYouQueue } from "@kickrocks/shared";
import { useState } from "react";
import { Button, Row, Section } from "../../../components/ui/index.js";
import { shortLabel } from "../headline.js";
import { WORDS } from "./copy.js";
import { effortShort, itemTitle } from "./model.js";

/** What to do, and for a listing whose title is a site, the name on the listing. */
function describe(item: NeedsYouItem): string {
  const label = shortLabel(item);
  return "match" in item.source ? `${label} \u00b7 ${item.source.match.fields.name}` : label;
}

/** The site a queue item is about, or what it is when it has none. */
export const upNextTitle = (item: NeedsYouItem): string =>
  "match" in item.source ? item.source.match.targetName : itemTitle(item);

/** "HomeRecords · Pick details": one mono line for the item that follows the open one. */
export const upNextLine = (item: NeedsYouItem): string =>
  `${upNextTitle(item)} \u00b7 ${shortLabel(item)}`;

/** What comes after the open item: a short title and how long each takes, with snoozed items folded away. */
export function UpNext({
  items,
  currentKey,
  snoozed,
  onSelect,
  onBringBack,
  heading = true,
}: {
  items: readonly NeedsYouItem[];
  currentKey: string | null;
  snoozed: NeedsYouQueue["snoozed"];
  onSelect: (key: string) => void;
  onBringBack: (key: string) => void;
  /** Off where a title above already says it, such as in a sheet. */
  heading?: boolean;
}) {
  const [showSnoozed, setShowSnoozed] = useState(false);
  const list = (
    <div className="divide-y divide-line border-t border-line">
      {items.map((item) => (
        <Row
          key={item.key}
          selected={item.key === currentKey}
          onClick={() => onSelect(item.key)}
          title={upNextTitle(item)}
          description={describe(item)}
          trailing={
            <span className="font-mono text-caption text-ink-3 tabular-nums">
              {effortShort(item.effort.minutes)}
            </span>
          }
          className="py-1.5"
        />
      ))}
    </div>
  );
  return (
    <nav aria-label={WORDS.upNext} className="flex min-w-0 flex-col gap-2">
      {heading ? (
        <Section label={WORDS.upNext} count={items.length}>
          {list}
        </Section>
      ) : (
        list
      )}
      {snoozed.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={showSnoozed}
            onClick={() => setShowSnoozed(!showSnoozed)}
            className="self-start rounded-xs font-mono text-caption text-ink-3 hover:text-ink-2"
          >
            {snoozed.length} snoozed
          </button>
          {showSnoozed ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {snoozed.map((entry) => (
                <li key={entry.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-meta text-ink-2">{entry.title}</span>
                  <Button size="sm" variant="ghost" onClick={() => onBringBack(entry.key)}>
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
