import { MODEL_APPLY_FLOOR } from "@kickrocks/shared";

/** Rules answers at or above this confidence are applied. */
export const RULES_THRESHOLD = 0.6;

/**
 * The confidence a model answer is applied at: its own threshold from the manifest, raised by the
 * person's setting, and never below the floor. Language model answers have no threshold because
 * none was ever measured to reach the precision that applying a reply needs.
 */
export function modelThreshold(manifestThreshold: number, override: number | null): number {
  return Math.max(MODEL_APPLY_FLOOR, manifestThreshold, override ?? 0);
}
