import type { Page } from "playwright";
import { isClosedError } from "./errors.js";
import { READ_TEXT } from "./page-scripts.js";

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether a page's words contain a phrase, ignoring case and how the page breaks its lines. */
export function textContains(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

/** The words a person would read on the page and in every frame of it. */
export async function pageText(page: Page): Promise<string> {
  const parts = await Promise.all(
    page.frames().map(async (frame) => {
      try {
        return await frame.evaluate<string>(READ_TEXT);
      } catch (error) {
        if (isClosedError(error)) throw error;
        return "";
      }
    }),
  );
  return parts.join("\n");
}

export function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? flat.slice(0, length) : flat;
}

/** An address read from a page, resolved against the page and limited to web pages. */
export function webUrlFrom(raw: string | undefined, base: string): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
