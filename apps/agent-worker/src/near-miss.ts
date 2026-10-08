import { BlockedReason } from "@kickrocks/shared";

/**
 * Small models often send a right answer in a slightly wrong shape. These repairs touch only
 * fields that carry no personal data, or that the worker checks again afterwards, so nothing the
 * strict schemas guard is loosened.
 */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NOT_A_VALUE =
  /^(?:none|n\/a|na|null|nil|-+|unknown|not (?:given|listed|shown|available|provided)|none (?:listed|given|shown|found|provided))\.?$/i;

/** An entry that says there is nothing, which a list of relatives, phones or emails does not need. */
export function isPlaceholderEntry(entry: string): boolean {
  return entry.trim() === "" || NOT_A_VALUE.test(entry.trim());
}

const BARE_DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/**
 * The domain a confirmation email comes from: an address is reduced to its domain and a link to its
 * host. Anything else is not a domain, so it is dropped and the caller keeps the words in the notes.
 */
export function senderDomain(raw: unknown): { domain?: string; leftover?: string } {
  if (typeof raw !== "string") return {};
  const text = raw.trim();
  if (isPlaceholderEntry(text)) return {};
  const address = /^[^\s@<>]*@([^\s@<>]+)>?$/.exec(text) ?? /<[^\s@<>]*@([^\s@<>]+)>/.exec(text);
  let candidate = address?.[1] ?? text;
  if (!address && /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      candidate = new URL(text).hostname;
    } catch {
      return { leftover: text };
    }
  }
  candidate = candidate.replace(/\.$/, "");
  return BARE_DOMAIN.test(candidate) && candidate.includes(".")
    ? { domain: candidate.toLowerCase() }
    : { leftover: text };
}

function repairForm(form: Json): Json {
  if (!("confirmationFrom" in form)) return form;
  const { confirmationFrom, ...rest } = form;
  const { domain, leftover } = senderDomain(confirmationFrom);
  if (domain !== undefined) return { ...rest, confirmationFrom: domain };
  if (leftover === undefined) return rest;
  const note = `Confirmation sender: ${leftover}`;
  const notes =
    typeof rest.notes === "string" && rest.notes !== "" ? `${rest.notes} ${note}` : note;
  return { ...rest, notes };
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textOf).filter((part): part is string => part !== null && part !== "");
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function repairLocations(value: unknown): unknown {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return value;
  return value.flatMap((entry) => {
    const text = textOf(entry);
    return text === null ? [entry] : [text];
  });
}

function withoutPlaceholders(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((entry) => typeof entry !== "string" || !isPlaceholderEntry(entry));
}

function repairCandidate(candidate: unknown): unknown {
  if (!isObject(candidate)) return candidate;
  const repaired: Json = { ...candidate };
  if ("locations" in repaired) repaired.locations = repairLocations(repaired.locations);
  for (const key of ["relatives", "phones", "emails"]) {
    if (key in repaired) repaired[key] = withoutPlaceholders(repaired[key]);
  }
  return repaired;
}

/** The result a report carries, with the shapes a small model gets slightly wrong put right. */
export function repairResult(result: unknown): unknown {
  if (!isObject(result)) return result;
  if (isObject(result.form)) return { ...result, form: repairForm(result.form) };
  const scan = result.scan;
  if (isObject(scan) && Array.isArray(scan.candidates)) {
    return { ...result, scan: { ...scan, candidates: scan.candidates.map(repairCandidate) } };
  }
  return result;
}

/**
 * A blocked reason that is no reason at all becomes unknown, with the model's own word kept in
 * the detail so a person still reads what it meant. The two reasons only the worker may give are
 * real reasons, so they stay and the strict schema refuses them.
 */
export function repairReport(args: unknown): unknown {
  if (!isObject(args)) return args;
  if (args.status === "complete" && "result" in args) {
    return { ...args, result: repairResult(args.result) };
  }
  if (args.status !== "blocked" || typeof args.reason !== "string") return args;
  if (BlockedReason.safeParse(args.reason).success) return args;
  const detail = typeof args.detail === "string" ? args.detail : "";
  return {
    ...args,
    reason: "unknown",
    detail: `${args.reason}: ${detail}`.trim().replace(/:$/, ""),
  };
}

/** What to change, in words, for the mistakes a model makes often enough to have a standard answer. */
export function hintFor(path: readonly PropertyKey[], message: string): string {
  const field = String(path.at(-1) ?? "");
  if (field === "confirmationFrom") {
    return "confirmationFrom must be a bare domain such as example.com, or left out";
  }
  if (field === "locations") return 'locations must be a list of strings such as ["City, ST"]';
  return message;
}
