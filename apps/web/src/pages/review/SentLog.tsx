import type { SendLog } from "@kickrocks/shared";
import { useState } from "react";
import { Button, Row, RowGroup, Section, Tag } from "../../components/ui/index.js";
import { logLine, summarize } from "./sends-model.js";

const SHOWN = 30;

/**
 * What the browser sent during an agent run, from the server's own record and not from the
 * worker's account: lookups, requests released with the answer they got, refusals, and notes.
 */
export function SentLog({ log }: { log: SendLog }) {
  const [all, setAll] = useState(false);
  if (log.sends.length === 0) return null;
  const summary = summarize(log);
  const rows = log.sends.filter((row) => row.reason !== "run_started");
  const newest = [...rows].reverse();
  const shown = all ? newest : newest.slice(0, SHOWN);

  return (
    <Section label="What left the browser" count={rows.length} as="h3">
      <p className="mb-2 text-body text-ink">
        {summary.unguarded
          ? "The page used a channel the gate cannot read, so a form may have gone out through it."
          : summary.nothingLeft
            ? summary.lookups === 0
              ? "No contact details left the browser."
              : `No contact details left the browser; ${summary.lookups} ${summary.lookups === 1 ? "search" : "searches"} with your name or place did.`
            : `${summary.released} ${summary.released === 1 ? "request" : "requests"} carrying your details left the browser.`}
      </p>
      <RowGroup>
        {shown.map((row) => {
          const line = logLine(row, log.values);
          return (
            <Row
              key={row.id}
              title={line.title}
              description={<span className="font-mono">{line.detail}</span>}
              trailing={<Tag>{row.kind === "guard_event" ? "note" : row.kind}</Tag>}
            />
          );
        })}
      </RowGroup>
      {newest.length > SHOWN && !all ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          Show all {newest.length}
        </Button>
      ) : null}
    </Section>
  );
}
