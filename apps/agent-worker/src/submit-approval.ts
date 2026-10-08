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
  ) {
    super(
      via === "change"
        ? "Choosing an option or ticking a box on this page tried to send the form"
        : `A person has to approve clicking ${label || "this control"} before the form is sent`,
    );
  }
}

/** The send control a person approved, which the approved run may click once and nothing else. */
export interface ApprovedControl {
  origin: string;
  control: string;
}

/** Whether a click is the one the person looked at before approving. */
export function isApprovedControl(
  approved: ApprovedControl,
  pageUrl: string,
  label: string,
): boolean {
  try {
    return new URL(pageUrl).origin === approved.origin && label === approved.control;
  } catch {
    return false;
  }
}

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
