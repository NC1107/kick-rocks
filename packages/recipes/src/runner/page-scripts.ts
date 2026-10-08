/**
 * Code that runs inside the page, kept as strings. Passing a function would let a transpiler that
 * keeps function names (tsx does) wrap it in a helper that does not exist in the browser.
 * Playwright calls a function it is given with the arguments, but treats a string as an expression
 * and does not call it, so a script that takes arguments is rebuilt into a function from its text,
 * which Playwright then sends to the page exactly as written.
 */
function fromSource<F>(source: string): F {
  return new Function(`return (${source});`)() as F;
}

/** Signals about challenges in one document, read without any knowledge of what they mean. */
export const READ_CHALLENGE_SIGNALS = `(() => {
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
      });
    }
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const filled = (selector) =>
    Array.from(document.querySelectorAll(selector)).some((el) => (el.value || "").length > 0);
  const solved = {
    recaptcha: filled('textarea[name="g-recaptcha-response"]'),
    hcaptcha: filled('textarea[name="h-captcha-response"]'),
    turnstile: filled('input[name="cf-turnstile-response"]'),
  };
  const widgets = [];
  for (const frame of document.querySelectorAll("iframe")) {
    if (!visible(frame)) continue;
    const src = (frame.getAttribute("src") || "").toLowerCase();
    if (/recaptcha\\/(api2|enterprise)\\/(anchor|bframe)|google\\.com\\/recaptcha/.test(src)) {
      if (/[?&]size=invisible/.test(src) || solved.recaptcha) continue;
      widgets.push("recaptcha");
    } else if (/hcaptcha/.test(src)) {
      if (!solved.hcaptcha) widgets.push("hcaptcha");
    } else if (/challenges\\.cloudflare\\.com|turnstile/.test(src)) {
      if (!solved.turnstile) widgets.push("turnstile");
    } else if (/arkoselabs|funcaptcha/.test(src)) {
      widgets.push("arkose");
    } else if (/captcha-delivery\\.com/.test(src)) {
      widgets.push("datadome");
    } else if (/captcha/.test(src)) {
      widgets.push("generic");
    }
  }
  const container = (selector, vendor, isSolved) => {
    for (const el of document.querySelectorAll(selector)) {
      const tag = el.tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "A") continue;
      if ((el.getAttribute("data-size") || "").toLowerCase() === "invisible") continue;
      if (visible(el) && !isSolved) widgets.push(vendor);
    }
  };
  container(".g-recaptcha", "recaptcha", solved.recaptcha);
  container(".h-captcha", "hcaptcha", solved.hcaptcha);
  container(".cf-turnstile", "turnstile", solved.turnstile);
  container("#px-captcha", "perimeterx", false);
  for (const img of document.querySelectorAll("img")) {
    const hint = ((img.getAttribute("src") || "") + " " + (img.getAttribute("alt") || "")).toLowerCase();
    const rect = img.getBoundingClientRect();
    if (/captcha/.test(hint) && !/recaptcha|hcaptcha/.test(hint) && rect.width >= 30 && rect.height >= 15 && visible(img)) {
      widgets.push("image");
    }
  }
  for (const input of document.querySelectorAll("input")) {
    const name = (input.getAttribute("name") || "").toLowerCase();
    if (/captcha/.test(name) && input.type !== "hidden" && visible(input)) widgets.push("image");
  }
  const markers = [
    "#challenge-form",
    "#cf-challenge-running",
    "#challenge-running",
    "#challenge-stage",
    "#challenge-error-text",
    ".cf-browser-verification",
    "#cf-error-details",
  ].filter((selector) => document.querySelector(selector) !== null);
  const text = document.body ? document.body.innerText || "" : "";
  return {
    title: document.title || "",
    text: text.slice(0, 6000),
    textLength: text.length,
    widgets,
    markers,
  };
})()`;

/** Reads each rule's matches inside every element: (elements, rules) => values per element. */
const READ_FIELDS_SOURCE = `(elements, rules) => elements.map((element) => {
  const out = {};
  for (const [key, rule] of Object.entries(rules)) {
    const nodes = rule.css === ":scope" ? [element] : Array.from(element.querySelectorAll(rule.css));
    const read = (node) => {
      const raw = rule.attr ? node.getAttribute(rule.attr) : node.textContent;
      return (raw || "").replace(/\\s+/g, " ").trim();
    };
    const values = rule.all ? nodes.map(read) : nodes.slice(0, 1).map(read);
    out[key] = values.filter((value) => value.length > 0);
  }
  return out;
})`;

/** The options of a select element, or null when the element is something else. */
const READ_OPTIONS_SOURCE = `(element) => {
  if (!(element instanceof HTMLSelectElement)) return null;
  return Array.from(element.options).map((option) => ({
    value: option.value,
    label: option.label || option.textContent || "",
    disabled: option.disabled,
  }));
}`;

/** The rendered text of the document, for matching what a person would read. */
export const READ_TEXT = `(() => (document.body ? document.body.innerText || "" : ""))()`;

/** Whether an element is a checkbox or radio button, so a matched row can be ticked or clicked. */
const IS_CHECKABLE_SOURCE = `(element) =>
  element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")`;

/** The page has the DOM types; this package is compiled without them. */
type PageElement = object;
type FieldRule = { css: string; attr?: string | undefined; all?: boolean | undefined };
interface OptionInfo {
  value: string;
  label: string;
  disabled: boolean;
}

export const READ_FIELDS =
  fromSource<
    (elements: PageElement[], rules: Record<string, FieldRule>) => Record<string, string[]>[]
  >(READ_FIELDS_SOURCE);
export const READ_OPTIONS =
  fromSource<(element: PageElement) => OptionInfo[] | null>(READ_OPTIONS_SOURCE);
export const IS_CHECKABLE = fromSource<(element: PageElement) => boolean>(IS_CHECKABLE_SOURCE);
