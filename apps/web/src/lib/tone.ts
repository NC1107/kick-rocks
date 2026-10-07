/**
 * The hues a badge, pill, or alert can take. Each one is defined once in index.css as a hue and
 * lightness steps for light and dark, so adding a state never means choosing new colors.
 */
export const TONES = [
  "neutral",
  "slate",
  "blue",
  "indigo",
  "violet",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "sand",
] as const;
export type Tone = (typeof TONES)[number];

/** What a notice means, independent of its hue. */
export type Intent = "info" | "success" | "warning" | "danger";

export const INTENT_TONE: Record<Intent, Tone> = {
  info: "blue",
  success: "green",
  warning: "amber",
  danger: "red",
};
