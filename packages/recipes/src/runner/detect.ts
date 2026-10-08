import type { BlockedReason } from "@kickrocks/shared";
import type { Frame, Page } from "playwright";
import { RunAborted } from "./errors.js";
import { sleepFor } from "./pacing.js";
import { READ_CHALLENGE_SIGNALS } from "./page-scripts.js";

/** A human check on the page. Nothing here tries to pass it. */
export interface BlockFinding {
  reason: Extract<BlockedReason, "captcha" | "bot_detection">;
  detail: string;
  /**
   * A whole-page interstitial can clear by itself once a real browser passes its script check, so
   * it gets a grace period before it counts. A widget in a form never clears without a person.
   */
  transient: boolean;
}

interface ChallengeSignals {
  title: string;
  text: string;
  textLength: number;
  widgets: string[];
  markers: string[];
}

const INTERSTITIAL_TITLE =
  /^\s*(just a moment|attention required|checking your browser|security check|one more step|access denied|are you a robot|verify you are human|pardon our interruption|you have been blocked)/i;

/** Only a short page can be an interstitial; a long article may mention any of these in passing. */
const INTERSTITIAL_TEXT = [
  /verif(y|ying) (that )?you are (a )?human/i,
  /checking (if the site connection is secure|your browser before accessing)/i,
  /press (and|&) hold/i,
  /are you (a robot|human)\b/i,
  /unusual traffic from your (computer )?network/i,
  /access to this (page|site|website) (has been )?(denied|blocked)/i,
  /\byou have been blocked\b/i,
  /\baccess denied\b/i,
  /enable javascript and cookies to continue/i,
  /needs to review the security of your connection/i,
  /performing security verification/i,
  /complete the security check/i,
];

const SHORT_PAGE_CHARS = 2500;

const WIDGET_LABELS: Record<string, string> = {
  recaptcha: "reCAPTCHA",
  hcaptcha: "hCaptcha",
  turnstile: "Cloudflare Turnstile",
  arkose: "Arkose Labs challenge",
  datadome: "DataDome challenge",
  perimeterx: "PerimeterX challenge",
  image: "image CAPTCHA",
  generic: "CAPTCHA",
};

function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}...` : flat;
}

/** Whether a whole page is a bot check, judged from its title, markup, and (when short) its words. */
export function interstitialIn(signals: ChallengeSignals): string | null {
  if (INTERSTITIAL_TITLE.test(signals.title)) return clip(signals.title, 80);
  if (signals.markers.length > 0) return signals.title ? clip(signals.title, 80) : "bot check";
  if (signals.textLength < SHORT_PAGE_CHARS) {
    const hit = INTERSTITIAL_TEXT.find((pattern) => pattern.test(signals.text));
    if (hit) return signals.title ? clip(signals.title, 80) : "bot check";
  }
  return null;
}

/** Decides what, if anything, stands in the way, from the signals of the page and its frames. */
export function classifySignals(
  main: ChallengeSignals,
  frames: ChallengeSignals[],
): BlockFinding | null {
  const interstitial = interstitialIn(main);
  if (interstitial !== null) {
    return {
      reason: "bot_detection",
      detail: `The site is showing a bot check ("${interstitial}").`,
      transient: true,
    };
  }
  const widgets = [main, ...frames].flatMap((signals) => signals.widgets);
  const first = widgets[0];
  if (first !== undefined) {
    return {
      reason: "captcha",
      detail: `${WIDGET_LABELS[first] ?? "A CAPTCHA"} is on the page and needs a person.`,
      transient: false,
    };
  }
  return null;
}

async function read(frame: Frame): Promise<ChallengeSignals | null> {
  try {
    const signals = await Promise.race([
      frame.evaluate<ChallengeSignals>(READ_CHALLENGE_SIGNALS),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return signals;
  } catch {
    return null;
  }
}

/** Looks at the page and every frame in it for a CAPTCHA or a bot check. */
export async function detectBlock(page: Page): Promise<BlockFinding | null> {
  const mainFrame = page.mainFrame();
  const main = await read(mainFrame);
  const others = await Promise.all(
    page
      .frames()
      .filter((frame) => frame !== mainFrame)
      .map(read),
  );
  return classifySignals(
    main ?? { title: "", text: "", textLength: 0, widgets: [], markers: [] },
    others.filter((signals): signals is ChallengeSignals => signals !== null),
  );
}

/**
 * Detects a block, giving a whole-page interstitial time to clear on its own first. Returns null
 * when the page is clear, so the run carries on.
 */
export async function detectBlockAfterGrace(
  page: Page,
  options: { graceMs: number; signal?: AbortSignal | undefined },
): Promise<BlockFinding | null> {
  let finding = await detectBlock(page);
  if (finding === null || !finding.transient) return finding;
  const deadline = Date.now() + options.graceMs;
  while (finding?.transient && Date.now() < deadline) {
    if (options.signal?.aborted) throw new RunAborted();
    await sleepFor(300, options.signal);
    finding = await detectBlock(page);
  }
  return finding;
}

/** Waits for a widget to render, for a step that is placed where the recipe expects a CAPTCHA. */
export async function waitForBlock(
  page: Page,
  options: { waitMs: number; graceMs: number; signal?: AbortSignal | undefined },
): Promise<BlockFinding | null> {
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const finding = await detectBlockAfterGrace(page, options);
    if (finding !== null || Date.now() >= deadline) return finding;
    if (options.signal?.aborted) throw new RunAborted();
    await sleepFor(250, options.signal);
  }
}
