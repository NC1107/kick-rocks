import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A local HTTP server that stands in for ntfy and the Telegram Bot API. */
export interface FakePushServer {
  /** Base address, such as http://127.0.0.1:41234. */
  url: string;
  requests: RecordedRequest[];
  /** What every request is answered with from now on. */
  respondWith(status: number, body?: string, headers?: Record<string, string>): void;
  /** Holds the next answer for this long, to exercise the client's timeout. */
  stallFor(ms: number): void;
  close(): Promise<void>;
}

export async function startFakePushServer(): Promise<FakePushServer> {
  const requests: RecordedRequest[] = [];
  let answer = { status: 200, body: "{}", headers: {} as Record<string, string> };
  let stall = 0;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const delay = stall;
      stall = 0;
      setTimeout(() => {
        response.writeHead(answer.status, {
          "content-type": "application/json",
          ...answer.headers,
        });
        response.end(answer.body);
      }, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith(status, body = "{}", headers = {}) {
      answer = { status, body, headers };
    },
    stallFor(ms) {
      stall = ms;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
