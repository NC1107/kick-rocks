import type { KickRocksDb } from "@kickrocks/db";
import { mailboxes, profiles } from "@kickrocks/db";
import type { LegalApi, RenderRequestEmailInput } from "@kickrocks/legal";
import {
  currentIdentity,
  type EmailKind,
  formatFullName,
  type ProfileField,
  type RenderedEmail,
  type RequestRecord,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { type Clock, nowIso } from "./clock.js";
import { conflict, notFound } from "./errors.js";
import { loadIdentities } from "./identities.js";
import type { TargetsService } from "./targets.js";

/** What an email is composed from, which a preview can build before any request exists. */
export type ComposableRequest = Pick<
  RequestRecord,
  | "profileId"
  | "targetId"
  | "rights"
  | "legalBasis"
  | "reference"
  | "sentAt"
  | "followUps"
  | "mailboxId"
>;

export interface ComposeOptions {
  /** For a verification reply: the identifiers the person approved. */
  requestedFields?: readonly ProfileField[] | undefined;
}

export interface ComposedEmail {
  email: RenderedEmail;
  /** Exactly what the template was given, so a test or an audit can see what was disclosed. */
  input: RenderRequestEmailInput;
  /** The address it goes to. */
  to: string;
  /** The mailbox it is sent from. */
  mailboxId: string;
}

/**
 * The one place that decides how a request becomes an email: which legal basis it cites, who the
 * sender is, which identifiers it discloses, and what a follow-up or a verification reply adds.
 * The campaign preview and the email runner both call it, so the preview a person reads is the
 * mail that goes out.
 */
export interface Composer {
  requestEmail(
    request: ComposableRequest,
    kind: EmailKind,
    options?: ComposeOptions,
  ): ComposedEmail;
}

export interface ComposerDeps {
  db: KickRocksDb;
  clock: Clock;
  legal: LegalApi;
  targets: TargetsService;
}

export function createComposer({ db, clock, legal, targets }: ComposerDeps): Composer {
  return {
    requestEmail(request, kind, options = {}) {
      const now = clock.now();
      const asOf = nowIso(clock).slice(0, 10);
      const profile = db.select().from(profiles).where(eq(profiles.id, request.profileId)).get();
      if (!profile) throw notFound(`Profile ${request.profileId} not found`, "profile_not_found");
      const mailbox = db
        .select()
        .from(mailboxes)
        .where(
          request.mailboxId
            ? eq(mailboxes.id, request.mailboxId)
            : eq(mailboxes.profileId, request.profileId),
        )
        .get();
      if (!mailbox)
        throw conflict("mailbox_required", "Connect a mailbox before sending an email request");

      const row = targets.getOrThrow(request.targetId);
      if (!row.privacyEmail) {
        throw conflict("no_email_address", `${row.name} has no email address to send to`);
      }
      const target = targets.toSummary(row);
      const identities = loadIdentities(db, request.profileId);

      // A follow-up cites the law the first request cited, even if a newer one has taken effect.
      const basis =
        legal.getLegalBasis(request.legalBasis, profile.state) ??
        legal.resolveLegalBasis({
          state: profile.state,
          target,
          rights: request.rights,
          asOf: now,
        });

      const requestedFields = options.requestedFields ?? [];
      if ((kind === "verification_reply") !== requestedFields.length > 0) {
        throw conflict(
          "verification_fields_required",
          "A verification reply discloses the fields the person approved, and no other email does",
        );
      }
      if (kind === "follow_up" && request.sentAt === null) {
        throw conflict("not_sent_yet", "A follow-up needs a first request that went out");
      }

      const name = currentIdentity(identities, "name", asOf)?.value;
      const input: RenderRequestEmailInput = {
        kind,
        rights: request.rights,
        reference: request.reference,
        basis,
        target,
        sender: {
          name: name ? formatFullName(name) : profile.displayName,
          address: mailbox.address,
        },
        identifiers: legal.identifiersFor(target, identities, "email", requestedFields, now),
        ...(kind === "follow_up" && request.sentAt
          ? { followUp: { number: request.followUps + 1, originalSentAt: request.sentAt } }
          : {}),
        ...(kind === "verification_reply" ? { verification: { requestedFields } } : {}),
      };
      return {
        email: legal.renderRequestEmail(input),
        input,
        to: row.privacyEmail,
        mailboxId: mailbox.id,
      };
    },
  };
}
