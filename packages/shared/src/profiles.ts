import { z } from "zod";
import { StateCode } from "./geography.js";
import { Identity, IdentityInputList } from "./identities.js";
import { Mailbox } from "./mail.js";

const DisplayName = z.string().trim().min(1).max(80);

export const ProfileSummary = z.object({
  id: z.string(),
  displayName: z.string(),
  state: StateCode,
  primaryEmail: z.email().nullable(),
  mailboxConnected: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProfileSummary = z.infer<typeof ProfileSummary>;

export const ProfileDetail = ProfileSummary.extend({
  identities: z.array(Identity),
  mailbox: Mailbox.nullable(),
});
export type ProfileDetail = z.infer<typeof ProfileDetail>;

/** A profile is created complete, so it always has a primary name and an email. */
export const ProfileCreate = z.object({
  displayName: DisplayName,
  state: StateCode,
  identities: IdentityInputList,
});
export type ProfileCreate = z.infer<typeof ProfileCreate>;

export const ProfilePatch = z
  .object({ displayName: DisplayName, state: StateCode })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to update" });
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const ReplaceIdentitiesBody = z.object({ identities: IdentityInputList });
export type ReplaceIdentitiesBody = z.infer<typeof ReplaceIdentitiesBody>;
