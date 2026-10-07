import { type ProfileFields, slugify } from "@kickrocks/shared";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ENTITIES: Record<string, string[]> = {
  "&": ["&amp;", "&#38;", "&#x26;"],
  "'": ["&#39;", "&#x27;", "&apos;"],
  '"': ["&quot;", "&#34;", "&#x22;"],
  "<": ["&lt;", "&#60;", "&#x3c;"],
  ">": ["&gt;", "&#62;", "&#x3e;"],
};

/** Every way one character can appear in a URL or in markup, so a value can be spelled by mixing them. */
function characterSpellings(character: string): string[] {
  if (character === " ") return [" ", "+", "%20", "&nbsp;", "&#32;"];
  const spellings = new Set<string>([character, ...(ENTITIES[character] ?? [])]);
  spellings.add(encodeURIComponent(character));
  spellings.add(encodeURI(character));
  spellings.add(new URLSearchParams({ v: character }).toString().slice(2));
  for (const byte of new TextEncoder().encode(character)) {
    spellings.add(`%${byte.toString(16).padStart(2, "0")}`);
  }
  return [...spellings];
}

/**
 * A regular expression source matching a value in any spelling it can take in an address or a
 * page: as typed, form-urlencoded, encodeURIComponent, encodeURI, with a plus or %20 for each
 * space, in lower or upper case hex (match it with the `i` flag), or as markup entities. Each
 * character is matched on its own, so spellings may also be mixed within one value.
 */
export function valueSpellingPattern(value: string): string {
  return Array.from(value)
    .map((character) => {
      const spellings = characterSpellings(character).map(escapeRegExp);
      return spellings.length === 1 ? (spellings[0] ?? "") : `(?:${spellings.join("|")})`;
    })
    .join("");
}

interface Entry {
  pattern: string;
  label: string;
  length: number;
}

/**
 * Hides the person's field values in text that leaves the run, such as the message of a failure,
 * which the server stores and shows on a timeline. A value appears in an error as typed, in a URL
 * as encoded, or as a slug, so every spelling is replaced by the name of the field.
 */
export function createRedactor(fields: ProfileFields): (text: string) => string {
  const entries: Entry[] = [];
  for (const [name, raw] of Object.entries(fields)) {
    const value = raw?.trim();
    if (!value || value.length < 3) continue;
    const label = `{{${name}}}`;
    entries.push({ pattern: valueSpellingPattern(value), label, length: value.length });
    const slug = slugify(value);
    if (slug.length >= 3) entries.push({ pattern: escapeRegExp(slug), label, length: slug.length });
  }
  if (entries.length === 0) return (text) => text;
  // The longest values go first, so a value that contains another is not left half replaced.
  entries.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(entries.map((entry) => `(${entry.pattern})`).join("|"), "gi");
  return (text) =>
    text.replace(pattern, (...args: unknown[]) => {
      const index = args.slice(1, entries.length + 1).findIndex((group) => group !== undefined);
      return entries[index]?.label ?? String(args[0]);
    });
}
