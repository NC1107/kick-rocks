// An SMTP and IMAP server on ports the OS picks. Behaviour is read on every connection, so a
// scenario can break and repair the server while the instance under test keeps running.
import net from "node:net";

const now = () => Date.now();
const REJECTION = "535 5.7.8 Username and Password not accepted\r\n";

export async function startFakeMail() {
  const mode = { smtp: "accept", imap: "ok", delayMs: 6_000 };
  const delivered = [];
  const smtpConnections = [];
  const imapConnections = [];
  const sockets = new Set();

  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  };
  const writeLater = (socket, text) =>
    setTimeout(() => socket.writable && socket.write(text), mode.delayMs);

  const smtp = net.createServer((socket) => {
    track(socket);
    const behavior = mode.smtp;
    smtpConnections.push(now());
    if (behavior === "silent") return;
    if (behavior === "greeting_421") {
      socket.end("421 4.3.2 service shutting down\r\n");
      return;
    }
    socket.write("220 fake ESMTP\r\n");
    let buffer = "";
    let data = null;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) {
            data += buffer;
            buffer = "";
            return;
          }
          data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          const id = /^message-id:\s*(.*)$/im.exec(data)?.[1]?.trim();
          data = null;
          if (id) delivered.push({ id, at: now() });
          if (behavior === "drop_after_data") {
            socket.destroy();
            return;
          }
          if (behavior === "hang_after_data") return;
          if (behavior === "slow_250") writeLater(socket, "250 2.0.0 queued\r\n");
          else socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const line = buffer.slice(0, eol).toUpperCase();
        buffer = buffer.slice(eol + 2);
        if (line.startsWith("EHLO")) socket.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (line.startsWith("AUTH")) {
          if (behavior === "auth_rejected") socket.write(REJECTION);
          else if (behavior === "auth_rejected_late") writeLater(socket, REJECTION);
          else socket.write("235 2.7.0 ok\r\n");
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

  const imap = net.createServer((socket) => {
    track(socket);
    imapConnections.push(now());
    socket.write("* OK IMAP4rev1 fake ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const [tag, verb = ""] = buffer.slice(0, eol).split(" ");
        buffer = buffer.slice(eol + 2);
        const command = verb.toUpperCase();
        if (command === "CAPABILITY") socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
        else if (command === "LOGIN") {
          socket.write(
            mode.imap === "auth_failed"
              ? `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`
              : `${tag} OK logged in\r\n`,
          );
        } else if (command === "LIST") {
          socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK done\r\n`);
        } else if (command === "SELECT" || command === "EXAMINE") {
          socket.write(
            `* 0 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 1] ok\r\n* FLAGS (\\Seen)\r\n${tag} OK [READ-ONLY] done\r\n`,
          );
        } else if (command === "LOGOUT") {
          socket.end(`* BYE\r\n${tag} OK bye\r\n`);
          return;
        } else socket.write(`${tag} OK done\r\n`);
      }
    });
  });

  const listen = (server) =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const smtpPort = await listen(smtp);
  const imapPort = await listen(imap);

  return {
    smtpPort,
    imapPort,
    mode,
    delivered,
    smtpConnections,
    imapConnections,
    deliveriesOf: (id) => delivered.filter((entry) => entry.id === id).length,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [smtp, imap].map((server) => new Promise((resolve) => server.close(() => resolve()))),
      );
    },
  };
}

/** A port that nothing listens on, for a mailbox whose server refuses the connection. */
export async function closedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(() => resolve()));
  return port;
}
