/**
 * The four state families. Each is defined once in index.css with a color for its shape fill, one
 * for its text, and an rgb triplet for washes, so adding a state never means choosing new colors.
 */
export const TONES = ["neutral", "positive", "attention", "danger"] as const;
export type Family = (typeof TONES)[number];

export type Tone = Family;

/** What a notice means, independent of its hue. */
export type Intent = "info" | "success" | "warning" | "danger";

export const INTENT_TONE: Record<Intent, Family> = {
  info: "neutral",
  success: "positive",
  warning: "attention",
  danger: "danger",
};
