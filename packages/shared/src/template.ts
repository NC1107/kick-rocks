import { slugify } from "./broker.js";
import { US_STATES } from "./geography.js";

export class TemplateError extends Error {
  override name = "TemplateError";
}

type Filter = (value: string) => string;

function stateName(value: string): string {
  const state = US_STATES.find((candidate) => candidate.code === value.toUpperCase());
  if (!state) throw new TemplateError(`"${value}" is not a state code`);
  return state.name;
}

const FILTERS: Record<string, Filter> = {
  slug: slugify,
  lower: (value) => value.toLowerCase(),
  urlencode: encodeURIComponent,
  /** "TX" to "Texas", for dropdowns that show the full name. */
  state_name: stateName,
};

export const TEMPLATE_FILTERS = Object.keys(FILTERS);

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*((?:\|\s*[a-z_]+\s*)*)\}\}/g;

/** The filter names of a placeholder's `|a|b` tail, in the order they apply. */
function filterNames(tail: string): string[] {
  return tail
    .split("|")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * What is wrong with a template that can be known without any field values: a malformed
 * placeholder or a filter that does not exist. Null when the template is well formed.
 */
export function templateProblem(template: string): string | null {
  const leftover = template.replace(PLACEHOLDER, "");
  if (leftover.includes("{{") || leftover.includes("}}")) {
    return `Malformed placeholder in "${template}"`;
  }
  for (const match of template.matchAll(PLACEHOLDER)) {
    for (const filter of filterNames(match[2] as string)) {
      if (!(filter in FILTERS)) return `Unknown template filter "${filter}"`;
    }
  }
  return null;
}

/** Names of the fields a template refers to, in order of first use. */
export function templateFields(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1] as string);
  return Array.from(names);
}

/**
 * Fills `{{field}}` placeholders, optionally through filters (`slug`, `lower`, `urlencode`,
 * `state_name`) that apply left to right, so `{{state|state_name|slug}}` gives "new-york".
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
  return template.replace(PLACEHOLDER, (_whole, name: string, tail: string) => {
    const value = fields[name];
    if (value === undefined) throw new TemplateError(`Unknown template field "${name}"`);
    return filterNames(tail).reduce((current, filterName) => {
      const filter = FILTERS[filterName];
      if (!filter) throw new TemplateError(`Unknown template filter "${filterName}"`);
      return filter(current);
    }, value);
  });
}
