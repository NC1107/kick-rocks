import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createMailTransport, provesNeverSent, transportOptions } from "./transport.js";
import type { MailConnection, OutgoingMail } from "./types.js";

const connection = (smtpHost: string): MailConnection => ({
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "app-password",
  smtpHost,
  smtpPort: 587,
  smtpSecure: false,
  imapHost: smtpHost,
  imapPort: 143,
});

describe("transportOptions", () => {
  it("requires STARTTLS for a host that is not this machine, so a password never crosses in the clear", () => {
    expect(transportOptions(connection("smtp.example.com")).requireTLS).toBe(true);
    expect(transportOptions(connection("greenmail")).requireTLS).toBe(true);
  });

  it("allows plain SMTP to this machine and to a host the operator named", () => {
    expect(transportOptions(connection("localhost")).requireTLS).toBe(false);
    expect(
      transportOptions(connection("greenmail"), { plaintextHosts: ["greenmail"] }).requireTLS,
    ).toBe(false);
    expect(
      transportOptions(connection("smtp.example.com"), { plaintextHosts: ["greenmail"] })
        .requireTLS,
    ).toBe(true);
  });
});

describe("provesNeverSent for the errors nodemailer raises while connecting", () => {
  const connectError = (reason: string) =>
    Object.assign(new Error(`connect ${reason} 192.0.2.1:587`), {
      code: "ESOCKET",
      command: "CONN",
      syscall: "connect",
    });

  it.each(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])("accepts %s", (reason) => {
    expect(provesNeverSent(connectError(reason))).toBe(true);
  });

  it("does not trust ESOCKET alone, which nodemailer also uses after DATA", () => {
    const afterData = Object.assign(new Error("read ECONNRESET"), {
      code: "ESOCKET",
      command: "DATA",
    });
    expect(provesNeverSent(afterData)).toBe(false);
  });
});

describe("the point where a send can no longer be called unsent", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  const mail: OutgoingMail = {
    from: { name: null, address: "jordan@example.com" },
    to: "privacy@broker.example",
    subject: "Please delete my data",
    text: "Hello",
    messageId: "<r1.0@example.com>",
  };

  /** A minimal SMTP server on a port the OS picks, with no real host involved. */
  async function listen(greet: boolean): Promise<number> {
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      if (!greet) return;
      let inData = false;
      socket.write("220 fixture ESMTP\r\n");
      socket.on("data", (chunk) => {
        for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
          if (inData) {
            if (line === ".") {
              inData = false;
              socket.write("250 queued\r\n");
            }
          } else if (line.startsWith("EHLO")) socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
          else if (line.startsWith("AUTH")) socket.write("235 ok\r\n");
          else if (line === "DATA") {
            inData = true;
            socket.write("354 go\r\n");
          } else if (line === "QUIT") socket.end("221 bye\r\n");
          else socket.write("250 ok\r\n");
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return typeof address === "object" && address ? address.port : 0;
  }

  const to = (port: number) => ({ ...connection("127.0.0.1"), smtpPort: port });

  it("is announced once the server has taken the envelope and before the send is answered", async () => {
    const port = await listen(true);
    const seen: string[] = [];
    const sending = createMailTransport(to(port)).send(mail, { onData: () => seen.push("data") });
    seen.push("started");
    await sending;
    seen.push("answered");
    expect(seen).toEqual(["started", "data", "answered"]);
  });

  it("is never announced for a send stuck waiting for the greeting", async () => {
    const port = await listen(false);
    let announced = false;
    const transport = createMailTransport(to(port), {
      timeouts: { connectionMs: 100, socketMs: 100 },
    });
    await expect(
      transport.send(mail, {
        onData: () => {
          announced = true;
        },
      }),
    ).rejects.toThrow();
    expect(announced).toBe(false);
  });
});
