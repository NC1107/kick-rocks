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
  .refine((args) => args.field !== undefined || args.option !== undefined, {
    message: "Give field or option",
  })
  // A model that sends both has named the person's own value, which is the safer of the two.
  .transform(({ ref, field, option }) =>
    field === undefined ? { ref, option } : { ref, field },
  ) as z.ZodType<{ ref: string; field?: ProfileField; option?: string }>;
/** Without a ref the record page being read is checked, which is what a model on a record page wants. */
export const CheckRecordArgs = z.object({ ref: Ref.nullish() });
export const CheckArgs = z.object({ ref: Ref, checked: z.boolean().default(true) });
export const WaitArgs = z.object({
  seconds: z.number().min(0.2).max(MAX_WAIT_SECONDS).default(2),
});

export const ReportArgs = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete"), result: z.unknown() }),
  z.object({
    status: z.literal("blocked"),
    // Only the worker stops for approval, so a model cannot ask for it.
    reason: BlockedReason.exclude(["approval_needed", "unapproved_submit"]),
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

/** A tool only a scan is given, because only a scan compares what a page shows with the person. */
export const SCAN_TOOL_NAMES = ["check_record"] as const;

const ref = { type: "string", description: "A ref such as e12 from the latest snapshot." };

function object(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const BLOCK_REASONS = [
  "phone_verification: the site asks for a phone number or sends a code by text or call",
  "id_upload: it asks for an ID or a document",
  "login_required: an account or sign-in",
  "email_verification: a code or link sent by email must be entered first",
  "captcha, bot_detection: a human check",
  "unknown: anything else, naming what it needs",
];

export interface ToolContext {
  /** The names of the task's fields, which are the only ones type and select accept. */
  fieldNames: readonly string[];
  purpose: "scan" | "remove";
}

/**
 * The tools offered to the model for one task. The field list is this task's own, so a model is
 * never shown a field it could not use, and a scan is given the comparison tool a removal has no use for.
 */
export function toolSpecsFor({ fieldNames, purpose }: ToolContext): ToolSpec[] {
  const names: readonly string[] = fieldNames.length > 0 ? fieldNames : ProfileField.options;
  const specs: ToolSpec[] = [
    {
      name: "navigate",
      description:
        "Open a page of the target's own site. Addresses on other domains are refused. Returns the page snapshot.",
      parameters: object({ url: { type: "string", description: "A full https address." } }, [
        "url",
      ]),
    },
    {
      name: "snapshot",
      description:
        "Read the current page again: headings, text, and the controls you can use, each with a ref. A long page is split into parts, and the first is shown. Pass part to read the next one only when the snapshot says there is another part.",
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
      parameters: object({ ref, field: { type: "string", enum: names } }, ["ref", "field"]),
    },
    {
      name: "select",
      description:
        "Choose an option in a dropdown, either the option that matches one of the task's fields (field) or an option shown in the snapshot (option). Give one of them.",
      parameters: object(
        {
          ref,
          field: { type: "string", enum: names },
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
      description: `Finish the task. status complete needs result in the exact shape the instructions give. status blocked stops for a person and needs a reason and detail. The reasons are ${BLOCK_REASONS.join("; ")}. status failed needs error, failureKind (site, network or internal) and retryable. status release hands the task back unchanged.`,
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
          detail: {
            type: "string",
            description: "For blocked: what stopped you and on which page.",
          },
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
  if (purpose !== "scan") return specs;
  const report = specs.pop() as ToolSpec;
  specs.push(
    {
      name: "check_record",
      description:
        "Compare a record with the person's details. Give the ref of a record link from the latest snapshot to read its card, or no ref to read the record page you are on. It tells you per identifier whether it matches, differs or is not shown, never the values, and ends with fits: report it, contradicts: leave it out, or not decided: open the record page.",
      parameters: object(
        {
          ref: {
            type: "string",
            description: "A ref of a record link, or leave out for this page.",
          },
        },
        [],
      ),
    },
    report,
  );
  return specs;
}
