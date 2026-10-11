/** A record the worker has read, by the address it really has and the one the model was shown. */
export interface KnownRecord {
  address: string;
  shown: string;
}

export type RecordLink = { address: string } | { problem: "unknown" | "ambiguous" };

function bare(address: string): string {
  return (address.split("#")[0] ?? address).replace(/\/+$/, "");
}

function pathOf(address: string): string {
  try {
    const url = new URL(address);
    return bare(`${url.pathname}${url.search}`);
  } catch {
    return bare(address);
  }
}

function only(found: readonly KnownRecord[]): RecordLink {
  const addresses = new Set(found.map((record) => record.address));
  if (addresses.size === 1) return { address: [...addresses][0] as string };
  return { problem: addresses.size === 0 ? "unknown" : "ambiguous" };
}

const MIN_SUFFIX = 4;

/**
 * Which record an entry of a report names. A model copies a link in whatever shape is easiest, so
 * the whole address, its path, a unique tail of it, and the ref of a link in the latest snapshot
 * all count. An entry that fits two records names neither.
 */
export function resolveRecordEntry(
  entry: string,
  known: readonly KnownRecord[],
  refs: ReadonlyMap<string, string>,
): RecordLink {
  const cleaned = entry
    .trim()
    .replace(/^[[<("'`]+/, "")
    .replace(/[\]>)"'`,;]+$/, "")
    .trim();
  if (cleaned === "") return { problem: "unknown" };
  if (/^e\d{1,5}$/i.test(cleaned)) {
    const address = refs.get(cleaned.toLowerCase());
    return address === undefined ? { problem: "unknown" } : only(matching(known, address));
  }
  const wanted = bare(cleaned);
  const whole = known.filter((r) => bare(r.shown) === wanted || bare(r.address) === wanted);
  if (whole.length > 0) return only(whole);
  if (wanted.startsWith("/")) {
    const byPath = known.filter((r) => pathOf(r.shown) === wanted || pathOf(r.address) === wanted);
    if (byPath.length > 0) return only(byPath);
  }
  if (wanted.length < MIN_SUFFIX) return { problem: "unknown" };
  return only(
    known.filter((r) => bare(r.shown).endsWith(wanted) || bare(r.address).endsWith(wanted)),
  );
}

function matching(known: readonly KnownRecord[], address: string): KnownRecord[] {
  return known.filter((record) => bare(record.address) === bare(address));
}
