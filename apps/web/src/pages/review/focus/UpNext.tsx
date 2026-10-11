import type { NeedsYouItem, NeedsYouQueue } from "@kickrocks/shared";
import { useState } from "react";
import { Button, Row, RowGroup, Section, StatusShapeGlyph } from "../../../components/ui/index.js";
import { WORDS } from "./copy.js";
import { effortShort, itemTitle } from "./model.js";

/** What comes after the open item: a short title and how long each takes, with snoozed items folded away. */
export function UpNext({
  items,
  currentKey,
  snoozed,
  onSelect,
  onBringBack,
}: {
  items: readonly NeedsYouItem[];
  currentKey: string | null;
  snoozed: NeedsYouQueue["snoozed"];
  onSelect: (key: string) => void;
  onBringBack: (key: string) => void;
}) {
  const [showSnoozed, setShowSnoozed] = useState(false);
  return (
    <nav aria-label={WORDS.upNext} className="flex min-w-0 flex-col gap-2">
      <Section label={WORDS.upNext} count={items.length}>
        <RowGroup>
          {items.map((item) => (
            <Row
              key={item.key}
              selected={item.key === currentKey}
              onClick={() => onSelect(item.key)}
              leading={<StatusShapeGlyph shape="triangle" />}
              title={itemTitle(item)}
              trailing={
                <span className="font-mono text-caption text-ink-3 tabular-nums">
                  {effortShort(item.effort.minutes)}
                </span>
              }
              className="py-1.5"
            />
          ))}
        </RowGroup>
      </Section>
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
