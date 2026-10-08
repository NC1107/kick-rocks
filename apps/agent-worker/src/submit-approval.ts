import { createHash } from "node:crypto";

/**
 * A model that has not passed the safety gate on this install may fill a form but not send it
 * alone. The toolbox cannot know which click sends a form, so it stops at any click that could.
 */
export class SubmitNeedsApproval extends Error {
  override name = "SubmitNeedsApproval";

  constructor(
    /** What the control says, so the person can tell which button the model reached for. */
    readonly label: string,
    readonly pageUrl: string,
    /**
     * `change` means choosing an option or ticking a box tried to send the form by itself. The
     * request was cancelled, and a person is shown the page and finishes it, since there is no
     * button to approve.
     */
    readonly via: "click" | "change" = "click",
    /** For a stop before a control: the form as the run had filled it, which an approval is tied to. */
    readonly fingerprint: string = "",
  ) {
    super(
      via === "change"
        ? "Typing, choosing an option or ticking a box on this page tried to send the form"
        : `A person has to approve clicking ${label || "this control"} before the form is sent`,
    );
  }
}

/** The send control a person approved, which the approved run may click once and nothing else. */
export interface ApprovedControl {
  origin: string;
  control: string;
  fingerprint: string;
}

const SHOWN_CONTROL_LENGTH = 80;

/**
 * What a send control is called in a stop and in the approval that follows. Masking can make a
 * label longer than the raw text it was cut from, so both sides of the comparison are cut after it.
 */
export function shownControl(label: string, mask: (text: string) => string): string {
  const masked = mask(label);
  return masked.length > SHOWN_CONTROL_LENGTH
    ? `${masked.slice(0, SHOWN_CONTROL_LENGTH - 3)}...`
    : masked;
}

/** Whether a click is the one the person looked at, on a form filled the way they saw it. */
export function isApprovedControl(
  approved: ApprovedControl,
  pageUrl: string,
  shown: string,
  fingerprint: string,
): boolean {
  try {
    return (
      new URL(pageUrl).origin === approved.origin &&
      shown === approved.control &&
      fingerprint === approved.fingerprint
    );
  } catch {
    return false;
  }
}

/**
 * What the run put into the form, by control and not by value, so the person's details are never
 * in it and a run that fills the same form the same way gets the same fingerprint. The last thing
 * done to a control is what counts, and a group of radio buttons is one control.
 */
export class FilledForm {
  private readonly entries = new Map<string, string>();

  record(key: string, token: string): void {
    this.entries.set(key, token);
  }

  fingerprint(): string {
    const lines = [...this.entries].map(([key, token]) => `${key}=${token}`).sort();
    return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
  }
}

/** Names a control for the fingerprint, and reads whether it is ticked now. */
export const CONTROL_KEY = `(el) => {
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const labelled = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => { const t = document.getElementById(id); return t ? clean(t.textContent) : ""; });
  const labels = Array.from(el.labels || []).map((l) => clean(l.textContent));
  const named = clean(el.getAttribute("aria-label") || labels.join(" ") || labelled.join(" ") || el.getAttribute("placeholder") || el.getAttribute("title") || "");
  const form = el.form ? Array.from(document.forms).indexOf(el.form) : -1;
  const own = el.getAttribute("name") || el.id || "";
  const group = type === "radio" && own !== "";
  return {
    key: group ? "radio|" + form + "|" + own : [tag, type, form, own, named].join("|"),
    ticked: Boolean(el.checked),
    text: clean(el.tagName === "INPUT" ? labels.join(" ") || el.value : el.textContent).slice(0, 120),
  };
}`;

export interface ControlFacts {
  tag: string;
  type: string;
  role: string;
  label: string;
}

/** Words on a control that offer to send something, for a page that has asked for nothing yet. */
const SENDING_WORDS =
  /\b(submit|send|remove|delete|opt[- ]?out|request|confirm|continue|next|finish|unsubscribe|apply)\b/i;

const BUTTON_INPUTS = new Set(["submit", "button", "image"]);

function isButtonLike({ tag, type, role }: ControlFacts): boolean {
  return tag === "button" || role === "button" || (tag === "input" && BUTTON_INPUTS.has(type));
}

/**
 * Whether clicking the control may send the form. A button after the model entered a detail is
 * assumed to, and so is a button that says so before it. A link only counts when its words offer
 * to send something, since a link is how a page is usually read.
 */
export function mayBeTheSubmit(control: ControlFacts, detailsEntered: number): boolean {
  if (isButtonLike(control)) {
    return detailsEntered > 0 || control.type === "submit" || SENDING_WORDS.test(control.label);
  }
  return control.tag === "a" && SENDING_WORDS.test(control.label);
}

/** What a control says on it, read at the moment it is clicked. */
export const CONTROL_LABEL = `(el) => {
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  const words = el.tagName === "INPUT" ? el.value : el.textContent;
  return clean(el.getAttribute("aria-label") || words || el.getAttribute("title") || "").slice(0, 80);
}`;
