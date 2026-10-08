import {
  API_ROUTES,
  type Identity,
  type IdentityInput,
  PROFILE_EXPORT_FORMAT,
  PROFILE_EXPORT_VERSION,
  type ProfileDetail,
  type ProfileSummary,
  validateIdentities,
} from "@kickrocks/shared";
import { defineMockDomain, handle, MockHttpError, notFound } from "./core.js";
import type { MockStore } from "./store.js";

/** Fake people only: every name, address, and number here is invented, on reserved example domains. */
function summarize(profile: ProfileDetail): ProfileSummary {
  const { identities: _identities, mailbox: _mailbox, ...summary } = profile;
  return summary;
}

function primaryEmail(identities: readonly Identity[]): string | null {
  const emails = identities.filter((identity) => identity.kind === "email");
  const email = emails.find((identity) => identity.isPrimary) ?? emails[0];
  return email?.kind === "email" ? email.value.address : null;
}

function withIds(store: MockStore, inputs: readonly IdentityInput[]): Identity[] {
  return inputs.map((input) => ({ ...input, id: store.nextId("idn") }) as Identity);
}

/** The server's one date-dependent rule, with the same body-prefixed paths it answers with. */
function checkIdentities(store: MockStore, inputs: readonly IdentityInput[]): void {
  const today = store.clock.now().toISOString().slice(0, 10);
  const issues = validateIdentities(inputs, today).map((issue) => ({
    path: ["body", "identities", ...issue.path],
    message: issue.message,
  }));
  if (issues.length > 0) {
    throw new MockHttpError(400, "invalid_request", "Some details are not valid.", issues);
  }
}

function find(store: MockStore, id: string): ProfileDetail {
  const profile = store.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw notFound("That profile");
  return profile;
}

function seedProfile(
  store: MockStore,
  display: { displayName: string; state: ProfileDetail["state"]; created: { days: number } },
  inputs: IdentityInput[],
): void {
  const identities = withIds(store, inputs);
  store.profiles.push({
    id: store.nextId("prf"),
    displayName: display.displayName,
    state: display.state,
    primaryEmail: primaryEmail(identities),
    mailboxConnected: false,
    createdAt: store.ago(display.created),
    updatedAt: store.ago({ days: 1 }),
    identities,
    mailbox: null,
  });
}

const NO_DATES = { validFrom: null, validTo: null } as const;

export default defineMockDomain({
  name: "profiles",

  seed(store) {
    seedProfile(store, { displayName: "Jordan Example", state: "CA", created: { days: 96 } }, [
      {
        kind: "name",
        value: { first: "Jordan", middle: "Q", last: "Example" },
        isPrimary: true,
        ...NO_DATES,
      },
      { kind: "alias", value: { first: "Jordie", last: "Example" }, isPrimary: false, ...NO_DATES },
      { kind: "email", value: { address: "jordan@example.com" }, isPrimary: true, ...NO_DATES },
      { kind: "email", value: { address: "j.example@example.org" }, isPrimary: false, ...NO_DATES },
      { kind: "phone", value: { number: "+15555550123" }, isPrimary: true, ...NO_DATES },
      {
        kind: "address",
        value: {
          street: "100 Example Street",
          unit: "Apt 4",
          city: "Sampleton",
          state: "CA",
          zip: "90000",
        },
        isPrimary: true,
        validFrom: "2022-03-01",
        validTo: null,
      },
      {
        kind: "address",
        value: { street: "22 Placeholder Lane", city: "Testville", state: "CA", zip: "90001" },
        isPrimary: false,
        validFrom: "2017-06-01",
        validTo: "2022-02-28",
      },
      { kind: "dob", value: { date: "1990-04-12" }, isPrimary: true, ...NO_DATES },
    ]);

    seedProfile(store, { displayName: "Riley Sample", state: "NY", created: { days: 41 } }, [
      { kind: "name", value: { first: "Riley", last: "Sample" }, isPrimary: true, ...NO_DATES },
      { kind: "email", value: { address: "riley@example.net" }, isPrimary: true, ...NO_DATES },
      {
        kind: "address",
        value: { street: "7 Sample Avenue", city: "Examplebury", state: "NY", zip: "10001" },
        isPrimary: true,
        ...NO_DATES,
      },
    ]);

    seedProfile(
      store,
      {
        displayName: "Alexandria Montgomery-Fitzgerald Example the Third",
        state: "WA",
        created: { days: 9 },
      },
      [
        {
          kind: "name",
          value: { first: "Alexandria", middle: "Montgomery", last: "Fitzgerald-Example" },
          isPrimary: true,
          ...NO_DATES,
        },
        {
          kind: "email",
          value: { address: "alexandria.montgomery-fitzgerald.example@subdomain.example.com" },
          isPrimary: true,
          ...NO_DATES,
        },
      ],
    );
  },

  routes: (store) => [
    handle(API_ROUTES.profilesList, () => ({ profiles: store.profiles.map(summarize) })),

    handle(API_ROUTES.profilesGet, ({ params }) => find(store, params.id)),

    handle(API_ROUTES.profilesCreate, ({ body }) => {
      checkIdentities(store, body.identities);
      const identities = withIds(store, body.identities);
      const profile: ProfileDetail = {
        id: store.nextId("prf"),
        displayName: body.displayName,
        state: body.state,
        primaryEmail: primaryEmail(identities),
        mailboxConnected: false,
        createdAt: store.clock.now().toISOString(),
        updatedAt: store.clock.now().toISOString(),
        identities,
        mailbox: null,
      };
      store.profiles.push(profile);
      return profile;
    }),

    handle(API_ROUTES.profilesUpdate, ({ params, body }) => {
      const profile = find(store, params.id);
      if (body.displayName !== undefined) profile.displayName = body.displayName;
      if (body.state !== undefined) profile.state = body.state;
      profile.updatedAt = store.clock.now().toISOString();
      return profile;
    }),

    handle(API_ROUTES.profilesReplaceIdentities, ({ params, body }) => {
      const profile = find(store, params.id);
      checkIdentities(store, body.identities);
      profile.identities = withIds(store, body.identities);
      profile.primaryEmail = primaryEmail(profile.identities);
      profile.updatedAt = store.clock.now().toISOString();
      return profile;
    }),

    handle(API_ROUTES.profilesExport, ({ params }) => {
      const profile = find(store, params.id);
      const requests = store.requests.filter((request) => request.profileId === profile.id);
      const requestIds = new Set(requests.map((request) => request.id));
      return {
        format: PROFILE_EXPORT_FORMAT,
        version: PROFILE_EXPORT_VERSION,
        exportedAt: store.clock.now().toISOString(),
        profile: {
          id: profile.id,
          displayName: profile.displayName,
          state: profile.state,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
        identities: profile.identities,
        mailbox: profile.mailbox
          ? {
              provider: profile.mailbox.provider,
              address: profile.mailbox.address,
              username: profile.mailbox.username,
              smtpHost: profile.mailbox.smtpHost,
              smtpPort: profile.mailbox.smtpPort,
              smtpSecure: profile.mailbox.smtpSecure,
              imapHost: profile.mailbox.imapHost,
              imapPort: profile.mailbox.imapPort,
              replyFolder: profile.mailbox.replyFolder,
              dailyCap: profile.mailbox.dailyCap,
              createdAt: profile.mailbox.createdAt,
            }
          : null,
        requests: requests.map(({ events, target, ...request }) => ({
          id: request.id,
          reference: request.reference,
          target: { id: target.id, name: target.name, domain: target.domain, kind: target.kind },
          rights: request.rights,
          legalBasis: request.legalBasis,
          channel: request.channel,
          status: request.status,
          recordUrl: request.recordUrl,
          followUps: request.followUps,
          sentAt: request.sentAt,
          dueAt: request.dueAt,
          followUpAt: request.followUpAt,
          lastError: request.lastError,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
          events,
        })),
        messages: store.messages
          .filter((message) => message.requestId !== null && requestIds.has(message.requestId))
          .map((message) => ({
            id: message.id,
            requestId: message.requestId,
            fromAddress: message.fromAddress,
            subject: message.subject,
            receivedAt: message.receivedAt,
            classification: message.classification,
            confidence: message.confidence,
            requestedFields: message.requestedFields,
            reviewed: message.reviewed,
          })),
        scans: store.scans
          .filter((scan) => scan.profileId === profile.id)
          .map((scan) => ({
            id: scan.id,
            targetId: scan.targetId,
            targetName: scan.targetName,
            startedAt: scan.startedAt,
            finishedAt: scan.finishedAt,
            error: scan.error,
            candidates: null,
          })),
        matches: store.matches
          .filter((match) => match.profileId === profile.id)
          .map(({ profileId: _profileId, targetName: _targetName, ...match }) => match),
      };
    }),

    handle(API_ROUTES.profilesDelete, ({ params }) => {
      const profile = find(store, params.id);
      const requestIds = new Set(
        store.requests.filter((request) => request.profileId === profile.id).map((r) => r.id),
      );
      store.profiles = store.profiles.filter((candidate) => candidate.id !== profile.id);
      store.requests = store.requests.filter((request) => request.profileId !== profile.id);
      store.messages = store.messages.filter(
        (message) => message.requestId === null || !requestIds.has(message.requestId),
      );
      store.tasks = store.tasks.filter((task) => task.profileId !== profile.id);
      store.scans = store.scans.filter((scan) => scan.profileId !== profile.id);
      store.matches = store.matches.filter((match) => match.profileId !== profile.id);
      return { ok: true as const };
    }),
  ],
});
