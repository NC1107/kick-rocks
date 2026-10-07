import { z } from "zod";

/** Profile fields a recipe may ask for. Each recipe declares the subset it needs. */
export const ProfileField = z.enum([
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "city",
  "state",
  "zip",
  "street",
  "birth_year",
  "date_of_birth",
  "record_url",
]);
export type ProfileField = z.infer<typeof ProfileField>;

const Selector = z.object({
  role: z.string().optional(),
  label: z.string().optional(),
  testId: z.string().optional(),
  css: z.string().optional(),
  text: z.string().optional(),
});

const Goto = z.object({ kind: z.literal("goto"), url: z.string() });
const Fill = z.object({ kind: z.literal("fill"), target: Selector, field: ProfileField });
const Click = z.object({ kind: z.literal("click"), target: Selector });
const Select = z.object({ kind: z.literal("select"), target: Selector, field: ProfileField });
const WaitFor = z.object({
  kind: z.literal("wait_for"),
  target: Selector,
  timeoutMs: z.number().int().positive().optional(),
});
const Extract = z.object({
  kind: z.literal("extract"),
  target: Selector,
  as: z.enum(["candidates", "record_url", "confirmation_text"]),
});
const ExpectText = z.object({ kind: z.literal("expect_text"), text: z.string() });
const CaptchaCheckpoint = z.object({ kind: z.literal("captcha_checkpoint") });
const EmailConfirmation = z.object({
  kind: z.literal("email_confirmation"),
  fromDomain: z.string(),
  linkTextPattern: z.string().optional(),
});

export const RecipeStep = z.discriminatedUnion("kind", [
  Goto,
  Fill,
  Click,
  Select,
  WaitFor,
  Extract,
  ExpectText,
  CaptchaCheckpoint,
  EmailConfirmation,
]);
export type RecipeStep = z.infer<typeof RecipeStep>;

export const Recipe = z.object({
  brokerId: z.string(),
  version: z.number().int().positive(),
  purpose: z.enum(["scan", "remove"]),
  entryUrl: z.url(),
  fields: z.array(ProfileField),
  steps: z.array(RecipeStep).min(1),
  canary: z.object({
    url: z.url(),
    selectors: z.array(Selector).min(1),
  }),
});
export type Recipe = z.infer<typeof Recipe>;
