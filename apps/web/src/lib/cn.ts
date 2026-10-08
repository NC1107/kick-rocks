type ClassValue = string | false | null | undefined;

/** Joins class names, skipping the falsy ones. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
