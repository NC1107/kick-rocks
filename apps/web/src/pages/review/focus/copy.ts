import type { FormOutcome, NeedsYouKind, ProfileField } from "@kickrocks/shared";

/** Every word the Needs you card shows, in one place so the length rules are easy to check. */
export interface KindCopy {
  /** One or two words, in capitals when shown. */
  tag: string;
  /** At most three, each at most five words. */
  steps: readonly string[];
  /** At most one short sentence, for what a step cannot say. */
  hint?: string;
  primary: string;
  second: string | null;
  /** What the return prompt asks after the page was opened. */
  question: string;
}

const ASK = "Did it work?";

export const KIND_COPY: Record<NeedsYouKind, KindCopy> = {
  hold: {
    tag: "Waiting",
    steps: [],
    primary: "Send now",
    second: "Stop",
    question: ASK,
  },
  approve: {
    tag: "Needs OK",
    steps: [],
    primary: "Approve",
    second: "Do it myself",
    question: ASK,
  },
  check_sent: {
    tag: "Check sent",
    steps: ["Open the page", "Check it went through"],
    primary: "Open the page",
    second: "Already done",
    question: "Did it go through?",
  },
  captcha: {
    tag: "CAPTCHA",
    steps: ["Open the page", "Solve the CAPTCHA", "Submit the form"],
    primary: "Open and solve",
    second: "Already done",
    question: ASK,
  },
  phone_code: {
    tag: "Phone code",
    steps: ["Open the page", "Enter the texted code"],
    primary: "Open the page",
    second: "Already done",
    question: ASK,
  },
  id: {
    tag: "ID",
    steps: ["Open the page", "Upload a photo ID"],
    hint: "Only if you're OK sharing it.",
    primary: "Open the page",
    second: "Don't send ID",
    question: ASK,
  },
  email_link: {
    tag: "Email link",
    steps: ["Find their email", "Tap the link"],
    primary: "Done",
    second: "Check mail",
    question: ASK,
  },
  login: {
    tag: "Sign in",
    steps: ["Open the page", "Sign in or sign up", "Finish the form"],
    primary: "Open the page",
    second: "Already done",
    question: ASK,
  },
  bot: {
    tag: "Bot check",
    steps: ["Open in your browser", "Finish the form"],
    primary: "Open the page",
    second: "Already done",
    question: ASK,
  },
  by_hand: {
    tag: "By hand",
    steps: ["Open the page", "Finish the removal"],
    primary: "Open the page",
    second: "Already done",
    question: ASK,
  },
  record: {
    tag: "Record",
    steps: [],
    primary: "This is me",
    second: "Not me",
    question: ASK,
  },
  details: {
    tag: "Details",
    steps: [],
    hint: "Only ticked details go out.",
    primary: "Send details",
    second: "Don't send",
    question: ASK,
  },
};

/** The ways a task tied to a request can end, besides "it worked". */
export const OTHER_OUTCOMES: readonly { outcome: FormOutcome; label: string }[] = [
  { outcome: "awaiting_email_confirmation", label: "Needs email link" },
  { outcome: "not_found", label: "No record" },
  { outcome: "already_removed", label: "Already gone" },
];

export const CHIP_LABELS: Record<ProfileField, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Name",
  email: "Email",
  phone: "Phone",
  city: "City",
  state: "State",
  zip: "ZIP",
  street: "Street",
  birth_year: "Birth year",
  date_of_birth: "Date of birth",
  record_url: "Record link",
};

/** The words around the card that are not part of one kind. */
export const WORDS = {
  allDone: "All done.",
  nothing: "Nothing needs you.",
  tried: (count: number) => `Tried ${count}×`,
  stuck: "Stuck? Hand to an agent",
  openRecord: "Open record",
  pickWhat: "Pick what to send",
  skipTitle: "Skip this target?",
  skipConfirm: "Skip it",
  keep: "Keep it",
  snoozeTitle: "Snooze",
  upNext: "Up next",
} as const;

export const sendDetails = (count: number) => `Send ${count} detail${count === 1 ? "" : "s"}`;
