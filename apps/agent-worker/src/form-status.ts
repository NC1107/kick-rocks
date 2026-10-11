/**
 * What is still empty and required in the form a control belongs to, read in the page. Only
 * controls the latest snapshot gave a ref are listed, since those are the ones a person could use.
 */
export const READ_FORM_STATUS = `(el) => {
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  const scope = el.form || el.closest("form, [role='form']") || document.body;
  const labelOf = (node) => {
    const labelled = (node.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => { const t = document.getElementById(id); return t ? clean(t.textContent) : ""; }).find(Boolean);
    const fromLabels = Array.from(node.labels || []).map((l) => clean(l.textContent)).find(Boolean);
    return fromLabels || node.getAttribute("aria-label") || labelled || node.getAttribute("placeholder") || node.getAttribute("name") || node.id || "";
  };
  const placeholder = /^(select|choose|pick|please|--|\\u2014)/i;
  const out = [];
  const groups = new Set();
  const nodes = scope.querySelectorAll("input, select, textarea, [role='combobox'], [role='checkbox'], [role='radio'], button[aria-haspopup='listbox']");
  for (const node of nodes) {
    const ref = node.getAttribute("data-kr-ref");
    if (!ref || node.disabled || node.readOnly) continue;
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) continue;
    const role = (node.getAttribute("role") || "").toLowerCase();
    const required = Boolean(node.required) || node.getAttribute("aria-required") === "true";
    if (tag === "input" && type === "radio") {
      const key = (node.form ? "form:" : "") + node.name;
      if (!node.name || groups.has(key)) continue;
      groups.add(key);
      const peers = Array.from(scope.querySelectorAll('input[type="radio"]')).filter((r) => r.name === node.name);
      if (!peers.some((r) => r.required) || peers.some((r) => r.checked)) continue;
      const legend = node.closest("fieldset") && node.closest("fieldset").querySelector("legend");
      out.push({ ref, label: clean(legend ? legend.textContent : node.name), kind: "choice", options: peers.map((r) => clean(Array.from(r.labels || []).map((l) => l.textContent).join(" ")) || r.value) });
      continue;
    }
    if (!required) continue;
    if (tag === "input" && type === "checkbox") {
      if (!node.checked) out.push({ ref, label: labelOf(node), kind: "checkbox" });
    } else if (role === "checkbox" || role === "radio") {
      if (node.getAttribute("aria-checked") !== "true") out.push({ ref, label: labelOf(node) || clean(node.textContent), kind: "checkbox" });
    } else if (tag === "select") {
      const chosen = node.options[node.selectedIndex];
      if (node.value === "" || !chosen || chosen.disabled) {
        out.push({ ref, label: labelOf(node), kind: "list", options: Array.from(node.options).filter((o) => o.value !== "" && !o.disabled).map((o) => clean(o.textContent)) });
      }
    } else if (role === "combobox" || node.getAttribute("aria-haspopup") === "listbox") {
      const shown = clean(node.value || node.textContent);
      if (shown === "" || placeholder.test(shown)) {
        out.push({ ref, label: labelOf(node) || shown, kind: "combobox", expanded: node.getAttribute("aria-expanded") === "true" });
      }
    } else if (!(node.value || "").trim()) {
      out.push({ ref, label: labelOf(node), kind: "text" });
    }
  }
  return out;
}`;

export interface EmptyControl {
  ref: string;
  label: string;
  kind: "text" | "checkbox" | "list" | "choice" | "combobox";
  options?: string[];
  expanded?: boolean;
}

const MAX_CONTROLS = 5;
const MAX_OPTIONS = 4;
const MAX_WORDS = 40;

export const ALL_FILLED = "Every required control in this form is filled.";
export const NO_FIELD_RULE =
  "A required control that asks for a detail of the person the task has no field for means report blocked with reason unknown, naming it. A choice that is not about the person, such as which product or which kind of request, is yours: pick the option that fits the task.";

function shortened(text: string, length: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > length ? `${one.slice(0, length - 3)}...` : one;
}

function describe(control: EmptyControl): string {
  const label = JSON.stringify(shortened(control.label, MAX_WORDS));
  if (control.kind === "checkbox") return `[${control.ref}] checkbox ${label}`;
  const options = control.options ?? [];
  const shown = options
    .slice(0, MAX_OPTIONS)
    .map((option) => JSON.stringify(shortened(option, MAX_WORDS)));
  const more = options.length > MAX_OPTIONS ? ", ..." : "";
  const kind = control.kind === "choice" ? "a choice" : "a list";
  const detail =
    control.kind === "text"
      ? ""
      : shown.length > 0
        ? ` (${kind}: ${shown.join(", ")}${more})`
        : ` (${kind})`;
  return `[${control.ref}] ${label}${detail}`;
}

/** The controls still to fill, as a list the model can act on, or null when none are left. */
export function emptyControlList(controls: readonly EmptyControl[]): string | null {
  if (controls.length === 0) return null;
  const shown = controls.slice(0, MAX_CONTROLS).map(describe);
  const rest = controls.length - MAX_CONTROLS;
  return `${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

/** The line that follows every action on a form control. */
export function formStatusLine(controls: readonly EmptyControl[]): string {
  const list = emptyControlList(controls);
  if (list === null) return ALL_FILLED;
  return `Still empty and required in this form: ${list}\n${NO_FIELD_RULE}`;
}
