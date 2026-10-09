import { Parser } from "htmlparser2";

export interface MailLink {
  url: string;
  /** What the link says, empty for a bare address in plain text. */
  text: string;
}

const MAX_LINKS = 200;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`\])}]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

const ATTRIBUTION_LINE = /^on\b.{5,250}\bwrote:?\s*$/i;
const ORIGINAL_MESSAGE = /^[-_=\s]{2,}(original message|forwarded message)[-_=\s]{2,}$/i;
const SEPARATOR_LINE = /^_{10,}$/;
const HEADER_BLOCK_START = /^(from|sent|date|to|subject):\s/i;

/**
 * The part of a reply that its author wrote. Replies quote the request we sent, and that text says
 * "opt out" and "delete my data", so matching keywords against it would classify every reply as
 * the request itself.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    const joined = `${line} ${(lines[index + 1] ?? "").trim()}`;
    if (
      ATTRIBUTION_LINE.test(line) ||
      (line.toLowerCase().startsWith("on ") && ATTRIBUTION_LINE.test(joined)) ||
      ORIGINAL_MESSAGE.test(line) ||
      SEPARATOR_LINE.test(line)
    ) {
      break;
    }
    if (/^from:\s/i.test(line)) {
      const following = lines.slice(index + 1, index + 5).map((entry) => entry.trim());
      if (following.some((entry) => HEADER_BLOCK_START.test(entry))) break;
    }
    if (line.startsWith(">")) continue;
    kept.push(lines[index] as string);
  }
  return kept.join("\n").trim();
}

function parseWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/\s+/g, ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const MAX_LABEL_CHARS = 40;

/** Plain-text mail writes a link as `label<https://...>`, so the words just before the bracket are its text. */
function wordsBeforeAngleLink(text: string, index: number): string {
  if (text[index - 1] !== "<") return "";
  const before = text.slice(Math.max(0, index - 1 - MAX_LABEL_CHARS), index - 1);
  return before.split("\n").pop() ?? "";
}

/**
 * Every web link in a message, from the anchors of the HTML body (parsed, not matched with a
 * regular expression) and from addresses written out in the text. A link inside a quoted section
 * is ignored, because it belongs to something we sent or to an older message.
 */
export function extractLinks(html: string | null, text: string): MailLink[] {
  const found = new Map<string, MailLink>();
  const add = (raw: string, label: string) => {
    if (found.size >= MAX_LINKS) return;
    const url = parseWebUrl(raw);
    if (!url) return;
    const existing = found.get(url);
    const cleaned = label.replace(/\s+/g, " ").trim();
    if (!existing) found.set(url, { url, text: cleaned });
    else if (!existing.text && cleaned) existing.text = cleaned;
  };

  if (html) {
    let quoteDepth = 0;
    let anchorHref: string | null = null;
    let anchorText = "";
    const parser = new Parser(
      {
        onopentag(name, attributes) {
          if (name === "blockquote") quoteDepth += 1;
          if (name === "a" && quoteDepth === 0 && attributes.href) {
            anchorHref = attributes.href;
            anchorText = "";
          }
        },
        ontext(data) {
          if (anchorHref !== null) anchorText += data;
        },
        onclosetag(name) {
          if (name === "blockquote" && quoteDepth > 0) quoteDepth -= 1;
          if (name === "a" && anchorHref !== null) {
            add(anchorHref, anchorText);
            anchorHref = null;
          }
        },
      },
      { decodeEntities: true },
    );
    parser.write(html);
    parser.end();
  }

  const body = stripQuoted(text);
  for (const match of body.matchAll(URL_IN_TEXT)) {
    add(match[0].replace(TRAILING_PUNCTUATION, ""), wordsBeforeAngleLink(body, match.index));
  }
  return Array.from(found.values());
}

const PHONE_NUMBER = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

/** The first phone number in what the sender wrote, as written, or null when there is none. */
export function phoneNumberIn(text: string): string | null {
  return PHONE_NUMBER.exec(stripQuoted(text))?.[0].trim() ?? null;
}
