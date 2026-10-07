import { connect, createServer } from "node:net";

// The only container of the development stack that touches a network with a way out. The others sit
// on an internal network, so nothing they run can reach the internet, and this process passes
// the few ports a test needs through to them. EDGE_FORWARDS is "listenPort=host:port,...".

const forwards = (process.env.EDGE_FORWARDS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [listen, target] = entry.split("=");
    const separator = target.lastIndexOf(":");
    return {
      listen: Number(listen),
      host: target.slice(0, separator),
      port: Number(target.slice(separator + 1)),
    };
  });

for (const { listen, host, port } of forwards) {
  const server = createServer((client) => {
    const upstream = connect({ host, port });
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
  });
  server.listen(listen, "0.0.0.0", () => {
    console.log(`forwarding ${listen} to ${host}:${port}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
