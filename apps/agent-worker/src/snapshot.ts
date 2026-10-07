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
}

export const REF_ATTRIBUTE = "data-kr-ref";

/**
 * Marks every control the model may use with `data-kr-ref` and describes the page. A control that a
 * person could not see is left out and unmarked: a field hidden from people is a honeypot, and the
 * person's details must never be typed into one.
 */
export const READ_SNAPSHOT = `(() => {
  const MAX_TEXT = 300;
  const MAX_OPTIONS = 80;
  const MAX_ITEMS = 600;
  for (const el of document.querySelectorAll("[data-kr-ref]")) el.removeAttribute("data-kr-ref");

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
  const controlVisible = (el) => {
    if (!shown(el) || !rectOk(el)) return false;
    return Number(getComputedStyle(el).opacity) > 0.01;
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

  let n = 0;
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
    n += 1;
    const ref = "e" + n;
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

  const walk = (node) => {
    if (items.length >= MAX_ITEMS) return;
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
  return { title: document.title, url: location.href, items };
})()`;

export interface SnapshotOptions {
  /** Hides a value the person owns from text the model reads. */
  mask: (text: string) => string;
  maxChars?: number;
}

export const DEFAULT_SNAPSHOT_CHARS = 12_000;

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
      if (item.options) parts.push(`options: ${item.options.map((o) => quote(o)).join(" | ")}`);
      return parts.join(" ");
    }
  }
}

/** The text the model reads, cut at a budget so a long page cannot fill its context. */
export function formatSnapshot(raw: RawSnapshot, options: SnapshotOptions): string {
  const budget = options.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
  const header = [`url: ${options.mask(raw.url)}`, `title: ${quote(options.mask(raw.title))}`];
  const lines: string[] = [];
  let used = header.join("\n").length;
  let omitted = 0;
  for (const item of raw.items) {
    const text = line(item, options.mask);
    if (used + text.length + 1 > budget) {
      omitted += 1;
      continue;
    }
    used += text.length + 1;
    lines.push(text);
  }
  const controls = raw.items.filter((item) => item.t === "control").length;
  const footer =
    omitted > 0
      ? [`(${omitted} more items left out because the page is long; ${controls} controls in total)`]
      : [];
  return [...header, ...lines, ...footer].join("\n");
}
