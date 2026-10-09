import { expect, it } from "vitest";
import type { InboxSource } from "../mail/types.js";

/** What the contract needs from a mail server, whether a scripted one or a real one. */
export interface InboxHarness {
  source: InboxSource;
  /** Delivers one plain message, the sender being a broker, and resolves once the server holds it. */
  deliver(mail: {
    subject: string;
    text: string;
    from?: string;
    headers?: string[];
  }): Promise<void>;
  /** Waits until the folder shows this many messages. */
  settle(count: number): Promise<void>;
}

/**
 * What every `InboxSource` must do the same way, so the poll's decisions do not depend on which
 * server is behind it. Run once against the scripted mailbox and once against GreenMail.
 */
export function defineInboxContract(setup: () => InboxHarness): void {
  const scanAll = (source: InboxSource) =>
    source.withFolder("INBOX", (session) => session.scan(null, null, { since: null, limit: 100 }));

  it("scans decoded headers without downloading a body", async () => {
    const { source, deliver, settle } = setup();
    await deliver({
      subject: "Re: Opt-out request KR-7K3M9Q",
      text: "A body that a header scan must not need.",
      from: "Privacy Team <privacy@broker.test>",
      headers: ["List-Unsubscribe: <mailto:unsub@broker.test>", "Auto-Submitted: auto-replied"],
    });
    await settle(1);
    const scan = await scanAll(source);
    expect(scan.messages).toHaveLength(1);
    expect(scan.messages[0]).toMatchObject({
      subject: "Re: Opt-out request KR-7K3M9Q",
      from: { address: "privacy@broker.test" },
      isDeliveryReport: false,
    });
    expect(scan.messages[0]?.headers["list-unsubscribe"]).toContain("unsub@broker.test");
    expect(scan.messages[0]?.headers["auto-submitted"]).toBe("auto-replied");
    expect(scan.highestUid).toBe(scan.messages[0]?.uid);
  });

  it("finds a reference that only the body holds", async () => {
    const { source, deliver, settle } = setup();
    await deliver({ subject: "Case update", text: "This is about KR-7K3M9Q." });
    await deliver({ subject: "Newsletter", text: "Nothing to see." });
    await settle(2);
    const outcome = await source.withFolder("INBOX", async (session) => {
      const scan = await session.scan(null, null, { since: null, limit: 100 });
      return {
        scan,
        found: await session.searchBodies(
          scan.messages.map((message) => message.uid),
          ["KR-"],
        ),
      };
    });
    const [first, second] = outcome.scan.messages;
    expect(outcome.found).not.toBeNull();
    expect(outcome.found?.has(first?.uid as number)).toBe(true);
    expect(outcome.found?.has(second?.uid as number)).toBe(false);
  });

  it("matches terms regardless of case and any one of several", async () => {
    const { source, deliver, settle } = setup();
    await deliver({ subject: "A", text: "Please opt-out me from SPOKEO." });
    await settle(1);
    const found = await source.withFolder("INBOX", async (session) => {
      const scan = await session.scan(null, null, { since: null, limit: 100 });
      return session.searchBodies(
        scan.messages.map((message) => message.uid),
        ["nothing here", "spokeo"],
      );
    });
    expect(found?.size).toBe(1);
  });

  it("downloads exactly the messages it is asked for", async () => {
    const { source, deliver, settle } = setup();
    await deliver({ subject: "One", text: "first" });
    await deliver({ subject: "Two", text: "second" });
    await settle(2);
    const fetched = await source.withFolder("INBOX", async (session) => {
      const scan = await session.scan(null, null, { since: null, limit: 100 });
      return session.fetchMessages([scan.messages[1]?.uid as number]);
    });
    expect(fetched.map((message) => message.subject)).toEqual(["Two"]);
    expect(fetched[0]?.text).toContain("second");
  });
}
