import { BlockedReason, FailureKind, ProfileField } from "@kickrocks/shared";
import { z } from "zod";
import type { ToolSpec } from "./provider.js";

export const MAX_WAIT_SECONDS = 10;

const Ref = z
  .string()
  .regex(/^e\d{1,5}$/, "A ref looks like e12 and comes from the latest snapshot");

export const NavigateArgs = z.object({ url: z.string().min(1).max(2000) });
/** Small local models often send a number as text or send null for "none", so both are accepted. */
export const SnapshotArgs = z.object({ part: z.coerce.number().int().min(1).max(100).nullish() });
export const ClickArgs = z.object({ ref: Ref });
/**
 * The model names a field and never supplies the text, so nothing it makes up, or a page talks it
 * into, can be typed into a form.
 */
export const TypeArgs = z.object({ ref: Ref, field: ProfileField });
export const SelectArgs = z
  .object({
    ref: Ref,
    field: ProfileField.optional(),
    option: z.string().min(1).max(200).optional(),
  })
  .refine((args) => (args.field === undefined) !== (args.option === undefined), {
    message: "Give either field or option, not both",
  });
export const CheckArgs = z.object({ ref: Ref, checked: z.boolean().default(true) });
export const WaitArgs = z.object({
  seconds: z.number().min(0.2).max(MAX_WAIT_SECONDS).default(2),
});

export const ReportArgs = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete"), result: z.unknown() }),
  z.object({
    status: z.literal("blocked"),
    reason: BlockedReason,
    detail: z.string().max(2000).default(""),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string().min(1).max(2000),
    failureKind: FailureKind.exclude(["recipe"]).default("internal"),
    retryable: z.boolean().default(false),
  }),
  z.object({ status: z.literal("release"), reason: z.string().max(500).default("") }),
]);
export type ReportArgs = z.infer<typeof ReportArgs>;

export const TOOL_NAMES = [
  "navigate",
  "snapshot",
  "click",
  "type",
  "select",
  "check",
  "wait",
  "report",
] as const;

const ref = { type: "string", description: "A ref such as e12 from the latest snapshot." };
const fieldNames = ProfileField.options;

function object(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "navigate",
    description:
      "Open a page of the target's own site. Addresses on other domains are refused. Returns the page snapshot.",
    parameters: object({ url: { type: "string", description: "A full https address." } }, ["url"]),
  },
  {
    name: "snapshot",
    description:
      "Read the current page again: headings, text, and the controls you can use, each with a ref. A long page is split into parts, and the first is shown. Pass part to read the next one, and read every part before you decide a control is not there.",
    parameters: object(
      { part: { type: "integer", description: "Which part of a long page to read, from 1." } },
      [],
    ),
  },
  {
    name: "click",
    description:
      "Click a control by ref. Returns the new page snapshot. A link that leaves the target's domains does nothing.",
    parameters: object({ ref }, ["ref"]),
  },
  {
    name: "type",
    description:
      "Type one of the task's fields into a text control. Name the field and the value is filled in for you. Fields that are not in the task cannot be typed.",
    parameters: object({ ref, field: { type: "string", enum: fieldNames } }, ["ref", "field"]),
  },
  {
    name: "select",
    description:
      "Choose an option in a dropdown, either the option that matches one of the task's fields (field) or an option shown in the snapshot (option).",
    parameters: object(
      {
        ref,
        field: { type: "string", enum: fieldNames },
        option: { type: "string", description: "The visible text of an option." },
      },
      ["ref"],
    ),
  },
  {
    name: "check",
    description: "Tick or untick a checkbox or radio button.",
    parameters: object({ ref, checked: { type: "boolean", description: "Defaults to true." } }, [
      "ref",
    ]),
  },
  {
    name: "wait",
    description: `Wait up to ${MAX_WAIT_SECONDS} seconds for the page to change, then read it again.`,
    parameters: object({ seconds: { type: "number" } }, []),
  },
  {
    name: "report",
    description:
      "Finish the task. status complete needs result in the exact shape the instructions give. status blocked stops for a person (captcha, phone_verification, id_upload, email_verification, login_required, bot_detection, unknown) and needs a reason and detail. status failed needs error, failureKind (site, network or internal) and retryable. status release hands the task back unchanged.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["complete", "blocked", "failed", "release"] },
        result: {
          type: "object",
          description: "For complete: the result object from the instructions.",
        },
        reason: {
          type: "string",
          description: "For blocked: one of the block reasons. For release: a short note.",
        },
        detail: { type: "string", description: "For blocked: what stopped you and on which page." },
        error: {
          type: "string",
          description: "For failed: what went wrong, without personal data.",
        },
        failureKind: { type: "string", enum: ["site", "network", "internal"] },
        retryable: { type: "boolean" },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
];
