import {
  ContactMethod,
  Requirement,
  TargetCategory,
  TargetKind,
  TargetPriority,
} from "@kickrocks/shared";

export interface TargetFilters {
  q: string;
  kind: TargetKind | "";
  category: TargetCategory | "";
  contactMethod: ContactMethod | "";
  requirement: Requirement | "";
  priority: TargetPriority | "";
  page: number;
}

export const FILTER_KEYS = [
  "q",
  "kind",
  "category",
  "contactMethod",
  "requirement",
  "priority",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

function pick<T extends string>(schema: { options: readonly T[] }, value: string | null): T | "" {
  return schema.options.find((option) => option === value) ?? "";
}

/** Reads the filters from the address bar, dropping any value a person typed that is not one. */
export function readFilters(params: URLSearchParams): TargetFilters {
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    kind: pick(TargetKind, params.get("kind")),
    category: pick(TargetCategory, params.get("category")),
    contactMethod: pick(ContactMethod, params.get("contactMethod")),
    requirement: pick(Requirement, params.get("requirement")),
    priority: pick(TargetPriority, params.get("priority")),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function hasFilters(filters: TargetFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== "");
}

export const TARGETS_PAGE_SIZE = 25;

/** The query the list route takes: empty filters are left out so the server applies none. */
export function toQuery(filters: TargetFilters) {
  return {
    page: filters.page,
    pageSize: TARGETS_PAGE_SIZE,
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.contactMethod ? { contactMethod: filters.contactMethod } : {}),
    ...(filters.requirement ? { requirement: filters.requirement } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
  };
}
