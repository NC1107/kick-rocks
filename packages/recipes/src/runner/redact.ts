import { type ProfileFields, slugify } from "@kickrocks/shared";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Hides the person's field values in text that leaves the run, such as the message of a failure,
 * which the server stores and shows on a timeline. A value appears in an error as typed, in a URL
 * as encoded, or as a slug, so all three spellings are replaced by the name of the field.
 */
export function createRedactor(fields: ProfileFields): (text: string) => string {
  const replacements = new Map<string, string>();
  for (const [name, raw] of Object.entries(fields)) {
    const value = raw?.trim();
    if (!value || value.length < 3) continue;
    for (const spelling of [value, encodeURIComponent(value), slugify(value)]) {
      if (spelling.length >= 3) replacements.set(spelling, `{{${name}}}`);
    }
  }
  if (replacements.size === 0) return (text) => text;
  const pattern = new RegExp(
    Array.from(replacements.keys())
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "gi",
  );
  const byLowerCase = new Map(
    Array.from(replacements, ([spelling, label]) => [spelling.toLowerCase(), label]),
  );
  return (text) => text.replace(pattern, (match) => byLowerCase.get(match.toLowerCase()) ?? match);
}
