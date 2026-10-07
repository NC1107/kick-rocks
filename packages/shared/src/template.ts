import { slugify } from "./broker.js";

export class TemplateError extends Error {
  override name = "TemplateError";
}

type Filter = (value: string) => string;

const FILTERS: Record<string, Filter> = {
  slug: slugify,
  lower: (value) => value.toLowerCase(),
  urlencode: encodeURIComponent,
};

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*(?:\|\s*([a-z]+)\s*)?\}\}/g;

/** Names of the fields a template refers to, in order of first use. */
export function templateFields(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1] as string);
  return Array.from(names);
}

/**
 * Fills `{{field}}` placeholders, optionally through one filter (`slug`, `lower`, `urlencode`).
 * Anything that cannot be rendered throws, because a half-filled URL or form value sent to a
 * real site is worse than a failed run.
 */
export function renderTemplate(
  template: string,
  fields: Readonly<Partial<Record<string, string>>>,
): string {
  const leftover = template.replace(PLACEHOLDER, "");
  if (leftover.includes("{{") || leftover.includes("}}")) {
    throw new TemplateError(`Malformed placeholder in template "${template}"`);
  }
  return template.replace(PLACEHOLDER, (_whole, name: string, filterName?: string) => {
    const value = fields[name];
    if (value === undefined) throw new TemplateError(`Unknown template field "${name}"`);
    if (filterName === undefined) return value;
    const filter = FILTERS[filterName];
    if (!filter) throw new TemplateError(`Unknown template filter "${filterName}"`);
    return filter(value);
  });
}
