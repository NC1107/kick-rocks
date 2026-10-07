/** Escapes LIKE wildcards so a search for "100%" finds that text and not everything. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
