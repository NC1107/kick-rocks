import { API_ROUTES, type ProfileField, resolveProfileFields } from "@kickrocks/shared";
import { useEffect, useRef, useState } from "react";
import { useApiQuery } from "../../../api/index.js";
import { cn } from "../../../lib/cn.js";
import { copyText } from "../../../lib/clipboard.js";
import { CHIP_LABELS } from "./copy.js";
import { COPIED_MS, maskValue } from "./model.js";

const CHIP =
  "inline-flex min-h-control max-w-full items-center gap-1.5 rounded-sm border border-line-strong bg-field px-2.5 text-meta transition-colors duration-100 hover:bg-hover focus-visible:-outline-offset-2 pointer-coarse:min-h-11";

/** The profile values for some fields, resolved in the browser so the queue never carries them. */
export function useProfileValues(profileId: string, fields: readonly ProfileField[]) {
  const profile = useApiQuery(API_ROUTES.profilesGet, { params: { id: profileId } });
  const values = profile.data
    ? resolveProfileFields(profile.data.identities, fields, {
        asOf: new Date().toISOString().slice(0, 10),
      })
    : null;
  return { loaded: profile.data !== undefined, values };
}

/**
 * Details to type into a page, each hidden until tapped. The first tap copies the value and shows
 * it, and it stays shown while the item is open.
 */
export function Chips({
  profileId,
  fields,
  extra,
}: {
  profileId: string;
  fields: readonly ProfileField[];
  /** Read-only facts that go beside the details, such as who the email is from. */
  extra?: string | undefined;
}) {
  const { values } = useProfileValues(profileId, fields);
  const [shown, setShown] = useState<ReadonlySet<ProfileField>>(new Set());
  const [copied, setCopied] = useState<ProfileField | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rows = fields.flatMap((field) => {
    const value = values?.[field];
    return value === undefined ? [] : [{ field, value }];
  });
  if (rows.length === 0 && !extra) return null;

  const tap = async (field: ProfileField, value: string) => {
    await copyText(value);
    setShown((current) => new Set(current).add(field));
    setCopied(field);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {rows.map(({ field, value }) => (
        <li key={field} className="min-w-0 max-w-full">
          <button
            type="button"
            aria-label={`Copy ${CHIP_LABELS[field].toLowerCase()}`}
            onClick={() => tap(field, value)}
            className={CHIP}
          >
            <span className="shrink-0 text-ink-3">{CHIP_LABELS[field]}</span>
            {copied === field ? (
              <span className="font-medium text-positive-text">Copied</span>
            ) : (
              <span
                className={cn("min-w-0 truncate font-mono text-ink", shown.has(field) && "break-all")}
              >
                {shown.has(field) ? value : maskValue(field, value)}
              </span>
            )}
          </button>
        </li>
      ))}
      {extra ? (
        <li className="min-w-0 max-w-full">
          <span className="inline-flex min-h-control items-center rounded-sm border border-line px-2.5 font-mono text-meta text-ink-2">
            {extra}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
