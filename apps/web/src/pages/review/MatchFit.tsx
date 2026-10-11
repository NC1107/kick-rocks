import {
  describeReason,
  type MatchAssessment,
  type MatchBand,
  type ReasonWeight,
} from "@kickrocks/shared";
import { Tag } from "../../components/ui/index.js";
import type { Tone } from "../../lib/tone.js";

export const BAND_LABELS: Record<MatchBand, string> = {
  likely: "Likely",
  maybe: "Maybe",
  unlikely: "Unlikely",
};

const BAND_TONES: Record<MatchBand, Tone> = {
  likely: "positive",
  maybe: "neutral",
  unlikely: "danger",
};

const WEIGHT_TONES: Record<ReasonWeight, Tone> = {
  strong: "positive",
  weak: "neutral",
  neutral: "neutral",
  weak_against: "attention",
  contradicts: "danger",
};

export function BandTag({ band }: { band: MatchBand }) {
  return <Tag tone={BAND_TONES[band]}>{BAND_LABELS[band]}</Tag>;
}

/** The band, then one chip per reason, toned by how much it counts for or against. */
export function MatchFit({ assessment }: { assessment: MatchAssessment }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <BandTag band={assessment.band} />
      {assessment.reasons.map((reason) => (
        <Tag key={describeReason(reason)} tone={WEIGHT_TONES[reason.weight]} wrap>
          {describeReason(reason)}
        </Tag>
      ))}
    </div>
  );
}
