import { createHash, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { StealthSession } from "./session.js";

const config = loadConfig();
const session = new StealthSession(config);

const app = Fastify({ logger: { level: config.logLevel } });

const expectedHash = createHash("sha256").update(config.token).digest();

function tokenOk(header: string | undefined): boolean {
  const raw = (header ?? "").startsWith("Bearer ") ? (header ?? "").slice(7) : "";
  if (raw.length !== config.token.length) return false;
  const provided = createHash("sha256").update(raw).digest();
  return timingSafeEqual(provided, expectedHash);
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!tokenOk(request.headers.authorization)) {
    await reply.status(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({ ok: true }));

const NavigateBody = z.object({ url: z.string().min(1).max(2000) });
app.post("/navigate", async (request, reply) => {
  const parsed = NavigateBody.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  try {
    return { ok: true, text: await session.navigate(parsed.data.url) };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

const SnapshotQuery = z.object({ part: z.coerce.number().int().min(1).optional() });
app.get("/snapshot", async (request, reply) => {
  const parsed = SnapshotQuery.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  try {
    return { ok: true, text: await session.snapshot(parsed.data.part ?? 1) };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

const RefBody = z.object({ ref: z.string().regex(/^e\d{1,5}$/) });

app.post("/click", async (request, reply) => {
  const parsed = RefBody.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  try {
    return { ok: true, text: await session.click(parsed.data.ref) };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

const FillBody = z.object({ ref: z.string().regex(/^e\d{1,5}$/), text: z.string().max(10_000) });
app.post("/fill", async (request, reply) => {
  const parsed = FillBody.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  try {
    return { ok: true, text: await session.fill(parsed.data.ref, parsed.data.text) };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

const SelectBody = z.object({ ref: z.string().regex(/^e\d{1,5}$/), value: z.string().max(500) });
app.post("/select", async (request, reply) => {
  const parsed = SelectBody.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  try {
    return { ok: true, text: await session.select(parsed.data.ref, parsed.data.value) };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

app.get("/screenshot", async (_request, reply) => {
  try {
    const png = await session.screenshot();
    return reply.header("content-type", "image/png").send(png);
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

app.post("/reset", async (_request, reply) => {
  try {
    await session.reset();
    return { ok: true };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

app.post("/solve_challenge", async (_request, reply) => {
  try {
    return { ok: true, text: await session.solveTurnstile() };
  } catch (err) {
    return reply.status(500).send({ error: String(err) });
  }
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    session.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
