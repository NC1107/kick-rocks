/**
 * What the model sees of a page: a short list of headings, text, and the controls it can use, each
 * control with a ref the tools accept. Code that runs in the page is kept as strings, because a
 * transpiler that keeps function names would wrap a function in a helper the browser does not have.
 */
export function fromSource<F>(source: string): F {
  return new Function(`return (${source});`)() as F;
}

export type SnapshotItem =
  | { t: "heading"; level: number; text: string }
  | { t: "text"; text: string }
  | { t: "frame"; host: string }
  | { t: "overlay"; hidden: number }
  | {
      t: "control";
      ref: string;
      role: string;
      name: string;
      value?: string;
      checked?: boolean;
      disabled?: boolean;
      required?: boolean;
      href?: string;
      options?: string[];
      inputType?: string;
    };

export interface RawSnapshot {
  title: string;
  url: string;
  items: SnapshotItem[];
  /** Set when the page held more than {@link MAX_SNAPSHOT_ITEMS} items and the rest was not read. */
  truncated?: boolean;
}

export const MAX_SNAPSHOT_ITEMS = 3000;

export const REF_ATTRIBUTE = "data-kr-ref";

/**
 * Whether a person could really see and use a control: big enough, not clipped away by a wrapper
 * or a clip rule, within the page's width, and on top at its centre once scrolled into view. The
 * sizes and offsets that honeypot fields use to stay out of sight each fail one of these.
 */
export const REACHABLE = `(el) => {
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const left = rect.left + window.scrollX;
  const pageWidth = Math.max(window.innerWidth, document.documentElement.clientWidth);
  if (left + rect.width <= 0 || left >= pageWidth) return false;
  for (let walker = el; walker && walker !== document.documentElement; walker = walker.parentElement) {
    const style = getComputedStyle(walker);
    if (style.clipPath !== "none" || (style.clip !== "auto" && style.clip !== "")) return false;
    if (walker === el) continue;
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (!clipsX && !clipsY) continue;
    const box = walker.getBoundingClientRect();
    const width = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
    const height = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
    if ((clipsX && width < 4) || (clipsY && height < 4)) return false;
  }
  if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(true);
  else el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const now = el.getBoundingClientRect();
  const hit = document.elementFromPoint(now.left + now.width / 2, now.top + now.height / 2);
  if (!hit) return false;
  if (hit === el || el.contains(hit)) return true;
  return Boolean(el.labels && Array.from(el.labels).some((label) => label.contains(hit)));
}`;

/**
 * Marks every control the model may use with `data-kr-ref` and describes the page. A control that a
 * person could not see is left out and unmarked: a field hidden from people is a honeypot, and the
 * person's details must never be typed into one.
 */
export const READ_SNAPSHOT = `(() => {
  const MAX_TEXT = 300;
  const MAX_OPTIONS = 80;
  const MAX_ITEMS = ${MAX_SNAPSHOT_ITEMS};
  const earlier = new Map();
  let highest = window.__krHighestRef || 0;
  for (const el of document.querySelectorAll("[data-kr-ref]")) {
    const ref = el.getAttribute("data-kr-ref");
    if (!earlier.has(ref)) earlier.set(ref, el);
    highest = Math.max(highest, Number(ref.slice(1)) || 0);
    el.removeAttribute("data-kr-ref");
  }
  const reused = new Map(Array.from(earlier, ([ref, el]) => [el, ref]));
  const taken = new Set();
  const startX = window.scrollX;
  const startY = window.scrollY;
  const reachable = ${REACHABLE};
  const NOT_TYPED = new Set(["checkbox", "radio", "file", "button", "submit", "reset", "image", "hidden"]);
  const needsReach = (el) => {
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    return el.tagName === "INPUT" && !NOT_TYPED.has((el.type || "text").toLowerCase());
  };

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "HEAD"]);
  const TEXT_INPUTS = new Set(["text", "email", "tel", "search", "url", "number", "password", "date", "datetime-local", "month", "week", "time"]);
  const BUTTON_INPUTS = new Set(["button", "submit", "reset", "image"]);
  const ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "combobox", "textbox"]);
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  const clip = (text, n) => (text.length > n ? text.slice(0, n - 3) + "..." : text);

  const rectOk = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return r.right + window.scrollX > 0 && r.bottom + window.scrollY > 0;
  };
  const shown = (el) => {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    return true;
  };
  let covered = 0;
  const stackLevel = (el) => {
    let level = 0;
    for (let walker = el; walker && walker !== document.documentElement; walker = walker.parentElement) {
      level = Math.max(level, parseInt(getComputedStyle(walker).zIndex, 10) || 0);
    }
    return level;
  };
  // The layers that cover most of the window, found once: a point is hit-tested, then its
  // ancestors are walked up to a fixed or absolute box of that size. Testing every control would
  // scroll it into view, which is slow on a long page and looks like nothing a person does.
  const overlays = [];
  for (const [x, y] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
    const hit = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
    for (let walker = hit; walker && walker !== document.body && walker !== document.documentElement; walker = walker.parentElement) {
      const position = getComputedStyle(walker).position;
      if (position !== "fixed" && position !== "absolute") continue;
      const area = walker.getBoundingClientRect();
      if (area.width < window.innerWidth * 0.9 || area.height < window.innerHeight * 0.9) continue;
      if (stackLevel(walker) > 0 && !overlays.includes(walker)) overlays.push(walker);
      break;
    }
  }
  const aboveOverlay = (el, overlay) => {
    for (let walker = el; walker && walker !== document.documentElement; walker = walker.parentElement) {
      if (getComputedStyle(walker).position !== "fixed") continue;
      const own = stackLevel(walker);
      const under = stackLevel(overlay);
      return own > under || (own === under && Boolean(overlay.compareDocumentPosition(walker) & Node.DOCUMENT_POSITION_FOLLOWING));
    }
    return false;
  };
  const coveredByOverlay = (el) => overlays.some((overlay) => !overlay.contains(el) && !aboveOverlay(el, overlay));
  const controlVisible = (el) => {
    if (!shown(el) || !rectOk(el)) return false;
    if (Number(getComputedStyle(el).opacity) <= 0.01) return false;
    if (coveredByOverlay(el)) {
      covered += 1;
      return false;
    }
    return !needsReach(el) || reachable(el);
  };

  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label && clean(label)) return clean(label);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\\s+/).map((id) => { const t = document.getElementById(id); return t ? clean(t.textContent) : ""; }).join(" ");
      if (clean(text)) return clean(text);
    }
    if (el.labels && el.labels.length > 0) {
      const text = Array.from(el.labels).map((l) => clean(l.textContent)).join(" ");
      if (text) return text;
    }
    const tag = el.tagName;
    if (tag === "INPUT" && BUTTON_INPUTS.has((el.type || "").toLowerCase())) {
      return clean(el.value) || clean(el.getAttribute("alt")) || (el.type || "");
    }
    const inner = clean(el.textContent);
    if (inner && tag !== "SELECT" && tag !== "TEXTAREA") return inner;
    const alt = el.querySelector && el.querySelector("img[alt]");
    if (alt && clean(alt.getAttribute("alt"))) return clean(alt.getAttribute("alt"));
    return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title")) || clean(el.getAttribute("name")) || "";
  };

  let suppress = 0;
  const items = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const text = clean(buffer.join(" "));
    buffer = [];
    if (text) items.push({ t: "text", text: clip(text, MAX_TEXT) });
  };
  const control = (el, role, extra) => {
    flush();
    let ref = reused.get(el);
    if (ref === undefined || taken.has(ref)) {
      highest += 1;
      ref = "e" + highest;
    }
    taken.add(ref);
    el.setAttribute("data-kr-ref", ref);
    items.push(Object.assign({ t: "control", ref, role, name: clip(nameOf(el), 120) }, extra,
      el.disabled ? { disabled: true } : {}, el.required || el.getAttribute("aria-required") === "true" ? { required: true } : {}));
  };

  const describe = (el) => {
    const tag = el.tagName;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (href === null || /^\\s*javascript:/i.test(href)) {
        if (!role) return false;
        control(el, role, {});
        return true;
      }
      control(el, role === "button" ? "button" : "link", { href: el.href });
      return true;
    }
    if (tag === "BUTTON" || tag === "SUMMARY") { control(el, "button", {}); return true; }
    if (tag === "SELECT") {
      const options = Array.from(el.options).slice(0, MAX_OPTIONS).map((o) => clip(clean(o.textContent), 60));
      const selected = el.selectedOptions && el.selectedOptions[0];
      control(el, "combobox", { value: selected ? clean(selected.textContent) : "", options });
      return true;
    }
    if (tag === "TEXTAREA") { control(el, "textbox", { value: el.value, inputType: "textarea" }); return true; }
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      if (type === "hidden") return true;
      if (BUTTON_INPUTS.has(type)) { control(el, "button", {}); return true; }
      if (type === "checkbox" || type === "radio") { control(el, type, { checked: el.checked }); return true; }
      if (type === "file") { control(el, "file", {}); return true; }
      if (TEXT_INPUTS.has(type) || type === "") { control(el, "textbox", { value: el.value, inputType: type }); return true; }
      control(el, "textbox", { value: el.value, inputType: type });
      return true;
    }
    if (el.isContentEditable && el.getAttribute("contenteditable") !== null) {
      control(el, "textbox", { value: clean(el.textContent), inputType: "contenteditable" }); return true;
    }
    if (ROLES.has(role)) {
      const extra = role === "checkbox" || role === "radio" || role === "switch" ? { checked: el.getAttribute("aria-checked") === "true" } : {};
      control(el, role, extra);
      return true;
    }
    return false;
  };

  let truncated = false;
  const walk = (node) => {
    if (items.length >= MAX_ITEMS) {
      if (node.nodeType === 1 ? !SKIP.has(node.tagName.toUpperCase()) : node.nodeType === 3 && node.nodeValue.trim()) truncated = true;
      return;
    }
    if (node.nodeType === 3) {
      const text = node.nodeValue;
      if (suppress === 0 && text && text.trim()) buffer.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (SKIP.has(el.tagName.toUpperCase())) return;
    if (!shown(el)) return;
    if (el.tagName === "IFRAME") {
      flush();
      if (rectOk(el)) {
        let host = "";
        try { host = new URL(el.src, location.href).hostname; } catch (e) { host = ""; }
        items.push({ t: "frame", host: host || "inline" });
      }
      return;
    }
    if (/^H[1-6]$/.test(el.tagName)) {
      flush();
      const text = clean(el.textContent);
      if (text) items.push({ t: "heading", level: Number(el.tagName[1]), text: clip(text, MAX_TEXT) });
      return;
    }
    const interactive = el.matches("a, button, summary, select, textarea, input, [contenteditable], [role]");
    if (interactive) {
      const visible = controlVisible(el);
      if (!visible) {
        if (!(el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON")) {
          for (const child of el.childNodes) walk(child);
        }
        return;
      }
      if (describe(el)) return;
    }
    const display = getComputedStyle(el).display;
    const block = !display.startsWith("inline");
    // A label's words are already the name of its control, so they are not repeated as text.
    const labelling = el.tagName === "LABEL" && (el.control || el.querySelector("input, select, textarea"));
    if (block) flush();
    if (labelling) suppress += 1;
    for (const child of el.childNodes) walk(child);
    if (labelling) suppress -= 1;
    if (block) flush();
  };

  walk(document.body || document.documentElement);
  flush();
  if (covered > 0) items.unshift({ t: "overlay", hidden: covered });
  window.__krHighestRef = highest;
  window.scrollTo(startX, startY);
  return { title: document.title, url: location.href, items, truncated };
})()`;

interface SnapshotOptions {
  /** Hides a value the person owns from the text. Left out, the text is shown as the page has it. */
  mask?: (text: string) => string;
  /** The most characters one part may hold. */
  maxChars?: number;
  /** Which part of a long page to show, counted from 1. */
  part?: number;
}

const DEFAULT_SNAPSHOT_CHARS = 12_000;

function quote(text: string): string {
  return JSON.stringify(text);
}

function line(item: SnapshotItem, mask: (text: string) => string): string {
  switch (item.t) {
    case "heading":
      return `heading(${item.level}) ${quote(mask(item.text))}`;
    case "text":
      return `text ${quote(mask(item.text))}`;
    case "frame":
      return `embedded frame from ${item.host} (its content cannot be read or used)`;
    case "overlay":
      return `A full-page overlay, such as a cookie banner or a notice, covers the page and ${item.hidden} control${item.hidden === 1 ? "" : "s"} behind it cannot be used. Dismiss it first with one of its own buttons listed below, then call snapshot.`;
    case "control": {
      const parts = [`[${item.ref}] ${item.role} ${quote(mask(item.name))}`];
      if (item.href !== undefined) parts.push(`-> ${mask(item.href)}`);
      if (item.checked !== undefined) parts.push(item.checked ? "(checked)" : "(unchecked)");
      if (item.required) parts.push("required");
      if (item.disabled) parts.push("disabled");
      if (item.inputType && item.inputType !== "text") parts.push(`type=${item.inputType}`);
      if (item.value !== undefined && item.value !== "") {
        parts.push(
          item.inputType === "password" ? "value=(hidden)" : `value=${quote(mask(item.value))}`,
        );
      }
      if (item.options) {
        parts.push(`options: ${item.options.map((o) => quote(mask(o))).join(" | ")}`);
      }
      return parts.join(" ");
    }
  }
}

/** Splits the lines into parts that each fit the budget, never cutting a line in two. */
function partition(lines: string[], budget: number): string[][] {
  const parts: string[][] = [[]];
  let used = 0;
  for (const text of lines) {
    const current = parts[parts.length - 1] as string[];
    if (current.length > 0 && used + text.length + 1 > budget) {
      parts.push([text]);
      used = text.length + 1;
    } else {
      current.push(text);
      used += text.length + 1;
    }
  }
  return parts;
}

/**
 * The text the model reads. A page longer than the budget is split into parts of that size, and
 * the model asks for each one in turn, so no control is out of reach and no single answer can
 * fill its context.
 */
export function formatSnapshot(raw: RawSnapshot, options: SnapshotOptions = {}): string {
  const budget = options.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
  const mask = options.mask ?? ((text: string) => text);
  const header = [`url: ${mask(raw.url)}`, `title: ${quote(mask(raw.title))}`];
  const parts = partition(
    raw.items.map((item) => line(item, mask)),
    Math.max(1, budget - header.join("\n").length),
  );
  const wanted = options.part ?? 1;
  const shown = parts[wanted - 1];
  if (shown === undefined) {
    return [
      ...header,
      `(there is no part ${wanted}: the page has ${parts.length} part${parts.length === 1 ? "" : "s"})`,
    ].join("\n");
  }
  const controls = raw.items.filter((item) => item.t === "control").length;
  const footer: string[] = [];
  if (parts.length > 1) {
    footer.push(
      wanted < parts.length
        ? `(part ${wanted} of ${parts.length}; the page is long, so call snapshot with part ${wanted + 1} to read on; ${controls} controls in total)`
        : `(part ${wanted} of ${parts.length}, the last; ${controls} controls in total)`,
    );
  }
  if (raw.truncated && wanted === parts.length) {
    footer.push(
      `(the page was cut off after ${MAX_SNAPSHOT_ITEMS} items, so what comes after them could not be read, and a form that is not listed here may still be on the page)`,
    );
  }
  return [...header, ...shown, ...footer].join("\n");
}
