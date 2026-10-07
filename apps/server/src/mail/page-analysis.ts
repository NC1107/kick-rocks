import { Parser } from "htmlparser2";

export interface PageAnalysis {
  /** A human check (CAPTCHA or an interstitial) stands between the visitor and the page. */
  challenge: boolean;
  /** The page says the link has expired or is not valid. */
  invalidLink: boolean;
  /** A button has to be pressed, as on a page that asks the visitor to confirm. */
  needsButtonPress: boolean;
  /** The page does nothing without JavaScript, or moves on by itself. */
  needsScript: boolean;
}

const CHALLENGE_SOURCES =
  /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|captcha-delivery|arkoselabs/i;
const CHALLENGE_CLASSES = /\b(g-recaptcha|h-captcha|cf-turnstile|cf-challenge)\b/i;
const CHALLENGE_TITLES =
  /^(just a moment|attention required|verify you are human|are you a robot|access denied|security check)/i;
const ACTION_WORDS =
  /\b(confirm|verify|continue|complete|submit|proceed|remove|opt[ -]?out|unsubscribe|delete|yes)\b/i;
const INVALID_LINK =
  /\b(link (has |is )?(expired|invalid|no longer valid)|(expired|invalid|broken) (link|token|url)|(token|link|code) (is |has )?(expired|invalid)|no longer valid|already (been )?used)\b/i;
const SCRIPT_REQUIRED =
  /\b(enable|turn on)\b.{0,40}\bjavascript\b|\bjavascript\b.{0,40}\b(required|disabled)\b/i;

/** Pages with real content are longer than this; an error notice is not. */
const SHORT_PAGE_CHARS = 3000;
/** A page with fewer visible characters than this and a script is a shell that renders in a browser. */
const SHELL_TEXT_CHARS = 40;
const MAX_TEXT_SAMPLE = 6000;

const HIDDEN_TEXT = new Set(["script", "style", "noscript", "head", "title", "template"]);

/**
 * Reads a page the way a link follower needs to: does it finish the job with a plain GET, or does
 * a browser have to press a button, run a script, or get past a human check. The page is parsed
 * with a real HTML parser and never rendered or executed.
 */
export function analyzePage(html: string): PageAnalysis {
  let hiddenDepth = 0;
  const hiddenStack: string[] = [];
  let visibleChars = 0;
  let sample = "";
  let scripts = 0;
  let title = "";
  let inTitle = false;
  let inButton = false;
  let buttonText = "";
  let noscriptText = "";
  let inNoscript = false;
  let challenge = false;
  let metaRefresh = false;
  let actionButton = false;
  let formCount = 0;

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "script") {
          scripts += 1;
          if (CHALLENGE_SOURCES.test(attributes.src ?? "")) challenge = true;
        }
        if (name === "iframe" && CHALLENGE_SOURCES.test(attributes.src ?? "")) challenge = true;
        if (CHALLENGE_CLASSES.test(attributes.class ?? "")) challenge = true;
        if (
          name === "meta" &&
          (attributes["http-equiv"] ?? "").toLowerCase() === "refresh" &&
          /url\s*=/i.test(attributes.content ?? "")
        ) {
          metaRefresh = true;
        }
        if (name === "form") {
          formCount += 1;
        }
        if (name === "input") {
          const type = (attributes.type ?? "").toLowerCase();
          if (
            (type === "submit" || type === "button") &&
            ACTION_WORDS.test(attributes.value ?? "")
          ) {
            actionButton = true;
          }
        }
        if (name === "button") {
          inButton = true;
          buttonText = "";
        }
        if (name === "title") inTitle = true;
        if (name === "noscript") inNoscript = true;
        if (HIDDEN_TEXT.has(name)) {
          hiddenDepth += 1;
          hiddenStack.push(name);
        }
      },
      ontext(text) {
        if (inTitle) title += text;
        if (inNoscript) noscriptText += text;
        if (inButton) buttonText += text;
        if (hiddenDepth > 0) return;
        const compact = text.replace(/\s+/g, " ").trim();
        if (!compact) return;
        visibleChars += compact.length;
        if (sample.length < MAX_TEXT_SAMPLE) sample += `${compact} `;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
        if (name === "noscript") inNoscript = false;
        if (name === "button") {
          inButton = false;
          if (ACTION_WORDS.test(buttonText)) actionButton = true;
        }
        if (hiddenStack[hiddenStack.length - 1] === name) {
          hiddenStack.pop();
          hiddenDepth -= 1;
        }
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();

  const trimmedTitle = title.replace(/\s+/g, " ").trim();
  const invalidLink =
    visibleChars < SHORT_PAGE_CHARS &&
    (INVALID_LINK.test(sample) || INVALID_LINK.test(trimmedTitle));
  return {
    challenge: challenge || CHALLENGE_TITLES.test(trimmedTitle),
    invalidLink,
    needsButtonPress: actionButton && (formCount > 0 || scripts > 0),
    needsScript:
      metaRefresh ||
      SCRIPT_REQUIRED.test(noscriptText) ||
      (visibleChars < SHELL_TEXT_CHARS && scripts > 0),
  };
}
