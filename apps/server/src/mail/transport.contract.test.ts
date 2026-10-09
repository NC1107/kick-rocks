import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SmtpBehavior,
  type SmtpSocketFake,
  startSmtpSocketFake,
} from "../test-utils/index.js";
import { createMailTransport, MailSendError } from "./transport.js";
import type { MailConnection, OutgoingMail } from "./types.js";

let smtp: SmtpSocketFake;

beforeEach(async () => {
  smtp = await startSmtpSocketFake();
});

afterEach(async () => {
  await smtp.close();
});

const PASSWORD = "revoked-app-password";

const connection = (): MailConnection => ({
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: PASSWORD,
  smtpHost: "127.0.0.1",
  smtpPort: smtp.port,
  smtpSecure: false,
  imapHost: "127.0.0.1",
  imapPort: 1,
});

const mail: OutgoingMail = {
  from: { name: null, address: "jordan@example.com" },
  to: "privacy@broker.test",
  subject: "Opt-out KR-AAAAAA",
  text: "Please remove me.",
  messageId: "<kr.r1.0@example.com>",
};

async function sendFailure(behavior: SmtpBehavior): Promise<MailSendError> {
  smtp.behave(behavior);
  const transport = createMailTransport(connection(), {
    timeouts: { connectionMs: 300, socketMs: 2_000 },
  });
  const error = await transport.send(mail).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MailSendError);
  return error as MailSendError;
}

describe("the real SMTP transport against a socket server", () => {
  it("reports a revoked password as a permanent login failure, without the password", async () => {
    const error = await sendFailure("auth_rejected");
    expect(error).toMatchObject({ code: "EAUTH", responseCode: 535, transient: false });
    expect(error.message).toContain("rejected the username or app password");
    expect(error.message).not.toContain(PASSWORD);
  });

  it("reports a server that shuts down at the greeting as transient with its 421", async () => {
    const error = await sendFailure("greeting_421");
    expect(error).toMatchObject({ responseCode: 421, transient: true });
  });

  it("reports a refused recipient as permanent with its 550", async () => {
    const error = await sendFailure("rcpt_550");
    expect(error).toMatchObject({ code: "EENVELOPE", responseCode: 550, transient: false });
  });

  it("reports a deferred recipient as transient with its 450", async () => {
    const error = await sendFailure("rcpt_450");
    expect(error).toMatchObject({ code: "EENVELOPE", responseCode: 450, transient: true });
  });

  it("reports a refused sender as a MAIL FROM failure that never reached DATA", async () => {
    const error = await sendFailure("mail_from_553");
    expect(error).toMatchObject({ responseCode: 553, command: "MAIL FROM", neverSent: true });
  });

  it("reports a server that never greets as a timeout", async () => {
    const error = await sendFailure("silent");
    expect(error).toMatchObject({ code: "ETIMEDOUT", transient: true, neverSent: true });
  });

  it("reports a connection dropped after DATA as a transient connection failure", async () => {
    const error = await sendFailure("drop_after_data");
    expect(error).toMatchObject({ code: "ECONNECTION", transient: true });
    expect(error.responseCode).toBeUndefined();
    expect(error.neverSent).toBe(false);
  });

  it("reports a socket timeout while waiting for the reply to DATA as possibly sent", async () => {
    const error = await sendFailure("stall_after_data");
    expect(error).toMatchObject({ code: "ETIMEDOUT", neverSent: false });
  });

  it("tells a drop in the middle of the body from a drop after all of it", async () => {
    const bigMail = { ...mail, text: "Please remove me.\n".repeat(1_000_000) };
    const transport = createMailTransport(connection(), {
      timeouts: { connectionMs: 5_000, socketMs: 5_000 },
    });

    smtp.behave("drop_mid_body");
    const midBody: string[] = [];
    await transport
      .send(bigMail, {
        onData: () => midBody.push("data"),
        onBodyEnd: () => midBody.push("end"),
      })
      .catch(() => undefined);
    expect(midBody).toEqual(["data"]);
    expect(smtp.received).toEqual([]);

    smtp.behave("drop_after_data");
    const afterBody: string[] = [];
    await transport
      .send(mail, {
        onData: () => afterBody.push("data"),
        onBodyEnd: () => afterBody.push("end"),
      })
      .catch(() => undefined);
    expect(afterBody).toEqual(["data", "end"]);
  });

  it("delivers when the server accepts", async () => {
    smtp.behave("accept");
    const result = await createMailTransport(connection()).send(mail);
    expect(result.accepted).toEqual(["privacy@broker.test"]);
    expect(smtp.received).toEqual([mail.messageId]);
  });
});
