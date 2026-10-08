import net from "node:net";

export type SmtpBehavior =
  | "accept"
  | "auth_rejected"
  | "greeting_421"
  | "rcpt_550"
  | "rcpt_450"
  | "mail_from_553"
  | "silent"
  | "drop_after_data"
  | "drop_mid_body"
  | "stall_after_data";

export interface SmtpSocketFake {
  readonly port: number;
  /** What the server does for connections from now on. */
  behave(behavior: SmtpBehavior): void;
  /** Message-ID headers of mail the server kept, including mail whose acknowledgement it then withheld. */
  readonly received: string[];
  /** How many connections were opened, to show that a held mailbox is not dialed again. */
  connections(): number;
  close(): Promise<void>;
}

/** A real socket speaking just enough SMTP for nodemailer, so the production transport is what fails. */
export async function startSmtpSocketFake(
  initial: SmtpBehavior = "accept",
): Promise<SmtpSocketFake> {
  let behavior = initial;
  let opened = 0;
  const received: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    opened += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const mode = behavior;
    if (mode === "silent") return;
    if (mode === "greeting_421") {
      socket.end("421 4.3.2 service shutting down\r\n");
      return;
    }
    socket.write("220 fake ESMTP\r\n");

    let buffer = "";
    let data: string | null = null;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (data !== null) {
          if (mode === "drop_mid_body") {
            // Reading stops so the sender's buffers fill and the connection dies with the body unfinished.
            socket.pause();
            setTimeout(() => socket.destroy(), 100);
            return;
          }
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) {
            data += buffer;
            buffer = "";
            return;
          }
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          const id = /^message-id:\s*(.*)$/im.exec(data)?.[1]?.trim();
          if (id) received.push(id);
          data = null;
          if (mode === "drop_after_data") {
            socket.destroy();
            return;
          }
          if (mode === "stall_after_data") return;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const line = buffer.slice(0, eol).toUpperCase();
        buffer = buffer.slice(eol + 2);
        if (line.startsWith("EHLO")) socket.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (line.startsWith("AUTH")) {
          socket.write(
            mode === "auth_rejected"
              ? "535 5.7.8 Username and Password not accepted\r\n"
              : "235 2.7.0 ok\r\n",
          );
        } else if (line.startsWith("MAIL FROM")) {
          socket.write(
            mode === "mail_from_553"
              ? "553 5.7.1 Sender address rejected: not owned by user\r\n"
              : "250 ok\r\n",
          );
        } else if (line.startsWith("RCPT TO")) {
          const refusal =
            mode === "rcpt_550"
              ? "550 5.1.1 no such user\r\n"
              : mode === "rcpt_450"
                ? "450 4.2.0 greylisted, try again later\r\n"
                : "250 ok\r\n";
          socket.write(refusal);
        } else if (line === "DATA") {
          data = "";
          socket.write("354 go\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
          return;
        } else socket.write("250 ok\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    behave: (next) => {
      behavior = next;
    },
    received,
    connections: () => opened,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
