import type { MailFolder } from "@kickrocks/shared";
import type { Clock } from "../core/clock.js";
import { headersOf } from "../mail/intake.js";
import type {
  ClassificationResult,
  ClassifyContext,
  FolderSearch,
  FollowResult,
  InboxMessage,
  InboxSession,
  LinkFollower,
  MailConnection,
  MailServices,
  MessageHeaders,
  OutgoingMail,
  ReplyClassifier,
  ScanOptions,
  ScanResult,
  VerifyResult,
} from "../mail/types.js";
import { noDkim } from "./dkim.js";

export interface SentMail {
  connection: MailConnection;
  mail: OutgoingMail;
}

type DeliverableMessage = Partial<InboxMessage> & { folder?: string };

export interface FakeMailbox {
  /** The folders `listFolders` reports. Replace the array to change them. */
  folders: MailFolder[];
  uidValidity: number;
  /** Simulates the server renumbering the folder: every message stays, under a new uid. */
  resetUidValidity(next?: number): void;
  /** Puts a message in a folder, filling in anything the test does not care about. */
  deliver(message?: DeliverableMessage): InboxMessage;
  /** Makes `searchBodies` and `search` answer as a server that refuses SEARCH. */
  searchSupported: boolean;
  /** Makes body searches match whole words only, as Gmail's and iCloud's word indexes do. */
  wholeWordSearch: boolean;
  /** Whether mail sent to `name+tag@domain` through the fake transport reaches this mailbox. */
  acceptsPlusAddresses: boolean;
  /** Every UID whose full message was fetched, in order, so a test can see what was downloaded. */
  readonly fetched: number[];
  /** Every body search made: the UIDs asked about and the terms. */
  readonly bodySearches: Array<{ uids: number[]; terms: string[] }>;
}

type ClassifyHandler = (
  message: InboxMessage,
  context: ClassifyContext,
) => Partial<ClassificationResult> | null;

export interface ProgrammableClassifier extends ReplyClassifier {
  calls: Array<{ message: InboxMessage; context: ClassifyContext }>;
  /** Newest handler first. A handler returns null to let an older one answer. */
  program(handler: ClassifyHandler): void;
  /** Answers messages whose subject matches. */
  when(subject: string | RegExp, result: Partial<ClassificationResult>): void;
  reset(): void;
}

type FollowHandler = (
  url: string,
  allowedDomains: readonly string[],
) => Partial<FollowResult> | null;

export interface ProgrammableLinkFollower extends LinkFollower {
  calls: Array<{ url: string; allowedDomains: readonly string[] }>;
  program(handler: FollowHandler): void;
  reset(): void;
}

export interface FakeMail {
  services: MailServices;
  /** Every message handed to a transport, oldest first. */
  sent: SentMail[];
  /** What `verify` answers. */
  verifyResult: VerifyResult;
  /** Makes the next `send` throw. */
  failNextSend(error?: Error): void;
  mailbox(address: string): FakeMailbox;
  classifier: ProgrammableClassifier;
  linkFollower: ProgrammableLinkFollower;
}

const UNMATCHED: ClassificationResult = {
  requestId: null,
  correlation: null,
  classification: "unknown",
  confidence: 0,
  rationale: "No fake classifier handler matched",
  links: [],
  requestedFields: [],
};

function createClassifier(): ProgrammableClassifier {
  let handlers: ClassifyHandler[] = [];
  const classifier: ProgrammableClassifier = {
    calls: [],
    program(handler) {
      handlers = [handler, ...handlers];
    },
    when(subject, result) {
      classifier.program((message) =>
        (
          typeof subject === "string"
            ? message.subject.includes(subject)
            : subject.test(message.subject)
        )
          ? result
          : null,
      );
    },
    reset() {
      handlers = [];
      classifier.calls = [];
    },
    async classify(message, context) {
      classifier.calls.push({ message, context });
      for (const handler of handlers) {
        const answer = handler(message, context);
        if (answer) return { ...UNMATCHED, ...answer };
      }
      return UNMATCHED;
    },
  };
  return classifier;
}

function createLinkFollower(): ProgrammableLinkFollower {
  let handlers: FollowHandler[] = [];
  const follower: ProgrammableLinkFollower = {
    calls: [],
    program(handler) {
      handlers = [handler, ...handlers];
    },
    reset() {
      handlers = [];
      follower.calls = [];
    },
    async follow(url, allowedDomains) {
      follower.calls.push({ url, allowedDomains });
      const base: FollowResult = {
        ok: true,
        finalUrl: url,
        status: 200,
        needsBrowser: false,
        reason: null,
      };
      for (const handler of handlers) {
        const answer = handler(url, allowedDomains);
        if (answer) return { ...base, ...answer };
      }
      return base;
    },
  };
  return follower;
}

const RENUMBER_OFFSET = 1000;

class ScriptedMailbox implements FakeMailbox {
  folders: MailFolder[] = [
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
    { path: "Junk", name: "Junk", specialUse: "\\Junk" },
  ];
  uidValidity = 1;
  searchSupported = true;
  wholeWordSearch = false;
  acceptsPlusAddresses = true;
  readonly fetched: number[] = [];
  readonly bodySearches: Array<{ uids: number[]; terms: string[] }> = [];
  private readonly byFolder = new Map<string, InboxMessage[]>();
  private nextUid = new Map<string, number>();

  constructor(
    readonly address: string,
    private readonly clock: Clock,
  ) {}

  resetUidValidity(next = this.uidValidity + 1): void {
    this.uidValidity = next;
    for (const [folder, held] of this.byFolder) {
      this.byFolder.set(
        folder,
        held.map((message) => ({ ...message, uid: message.uid + RENUMBER_OFFSET })),
      );
      this.nextUid.set(folder, (this.nextUid.get(folder) ?? 1) + RENUMBER_OFFSET);
    }
  }

  deliver({ folder = "INBOX", ...overrides }: DeliverableMessage = {}): InboxMessage {
    const uid = overrides.uid ?? this.nextUid.get(folder) ?? 1;
    this.nextUid.set(folder, Math.max(uid + 1, this.nextUid.get(folder) ?? 1));
    const message: InboxMessage = {
      uid,
      messageId: `<fake-${folder}-${uid}@mail.test>`,
      inReplyTo: null,
      references: [],
      from: { name: null, address: "privacy@broker.test" },
      to: [this.address],
      subject: "Re: your request",
      date: this.clock.now(),
      text: "",
      html: null,
      isBounce: false,
      autoSubmitted: false,
      headers: {},
      originalMessageIds: [],
      verifyDkim: noDkim,
      ...overrides,
    };
    this.byFolder.set(folder, [...(this.byFolder.get(folder) ?? []), message]);
    return message;
  }

  scan(
    folder: string,
    afterUid: number | null,
    uidValidity: number | null,
    { since, limit }: ScanOptions = { since: null, limit: Number.POSITIVE_INFINITY },
  ): ScanResult {
    const reset = uidValidity !== null && uidValidity !== this.uidValidity;
    const floor = reset ? 0 : (afterUid ?? 0);
    const inFolder = this.inFolder(folder);
    const matching = inFolder.filter(
      (message) =>
        message.uid > floor &&
        (since === null || message.date === null || message.date.getTime() >= since.getTime()),
    );
    const page = matching.slice(0, limit);
    return {
      uidValidity: this.uidValidity,
      reset,
      messages: page.map(headersOf),
      hasMore: matching.length > page.length,
      highestUid:
        inFolder.length === 0 ? null : (inFolder[inFolder.length - 1] as InboxMessage).uid,
    };
  }

  private inFolder(folder: string): InboxMessage[] {
    return (this.byFolder.get(folder) ?? []).sort((a, b) => a.uid - b.uid);
  }

  private bodyHas(body: string, term: string): boolean {
    if (!this.wholeWordSearch) return body.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(body);
  }

  session(folder: string): InboxSession {
    const held = (uids: readonly number[]) =>
      this.inFolder(folder).filter((message) => uids.includes(message.uid));
    return {
      uidValidity: () => this.uidValidity,
      scan: async (afterUid, uidValidity, options) =>
        this.scan(folder, afterUid, uidValidity, options),
      headers: async (uids): Promise<MessageHeaders[]> => held(uids).map(headersOf),
      searchBodies: async (uids, terms) => {
        this.bodySearches.push({ uids: [...uids], terms: [...terms] });
        if (!this.searchSupported) return null;
        const wanted = terms.map((term) => term.toLowerCase());
        return new Set(
          held(uids)
            .filter((message) => {
              const body = `${message.text}\n${message.html ?? ""}`.toLowerCase();
              return wanted.some((term) => this.bodyHas(body, term));
            })
            .map((message) => message.uid),
        );
      },
      search: async (query: FolderSearch) => {
        if (!this.searchSupported) return null;
        const from = (query.from ?? []).map((entry) => entry.toLowerCase());
        const text = (query.text ?? []).map((entry) => entry.toLowerCase());
        return this.inFolder(folder)
          .filter((message) => {
            if (message.date && message.date.getTime() < query.since.getTime()) return false;
            if (query.until && message.date && message.date.getTime() >= query.until.getTime()) {
              return false;
            }
            if (query.messageId && message.messageId !== query.messageId) return false;
            const sender = message.from.address.toLowerCase();
            const fromOk =
              from.length === 0 ||
              from.some(
                (entry) =>
                  sender === entry || sender.endsWith(`@${entry}`) || sender.endsWith(`.${entry}`),
              );
            const haystack = `${message.subject}\n${message.text}`.toLowerCase();
            const textOk = text.length === 0 || text.some((term) => haystack.includes(term));
            return fromOk && textOk;
          })
          .slice(0, query.limit)
          .map((message) => message.uid);
      },
      fetchMessages: async (uids) => {
        this.fetched.push(...uids);
        return held(uids);
      },
    };
  }
}

/** Mail services that record what is sent and serve whatever a test delivers. Nothing leaves the process. */
export function createFakeMail(clock: Clock): FakeMail {
  const mailboxes = new Map<string, ScriptedMailbox>();
  const mailboxFor = (address: string) => {
    let mailbox = mailboxes.get(address);
    if (!mailbox) {
      mailbox = new ScriptedMailbox(address, clock);
      mailboxes.set(address, mailbox);
    }
    return mailbox;
  };

  let failure: Error | null = null;
  const classifier = createClassifier();
  const linkFollower = createLinkFollower();

  const fake: FakeMail = {
    sent: [],
    verifyResult: { ok: true, error: null },
    failNextSend(error = new Error("The fake transport was told to fail")) {
      failure = error;
    },
    mailbox: mailboxFor,
    classifier,
    linkFollower,
    services: {
      transport: (connection) => ({
        verify: async () => fake.verifyResult,
        send: async (mail) => {
          if (failure) {
            const error = failure;
            failure = null;
            throw error;
          }
          fake.sent.push({ connection, mail });
          const plus = /^(.+)\+[^@]+@(.+)$/.exec(mail.to);
          const target = plus ? mailboxFor(`${plus[1]}@${plus[2]}`) : undefined;
          if (target?.acceptsPlusAddresses) {
            target.deliver({
              messageId: mail.messageId,
              to: [mail.to],
              from: { name: mail.from.name, address: mail.from.address },
              subject: mail.subject,
              text: mail.text,
            });
          }
          return { messageId: mail.messageId, accepted: [mail.to], rejected: [] };
        },
      }),
      inbox: (connection) => {
        const mailbox = mailboxFor(connection.address);
        return {
          listFolders: async () => mailbox.folders,
          withFolder: async (folder, work) => work(mailbox.session(folder)),
        };
      },
      classifier,
      linkFollower,
    },
  };
  return fake;
}
