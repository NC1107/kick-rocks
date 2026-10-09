import type { OutgoingRequest } from "@kickrocks/shared";
import { silentLogger } from "@kickrocks/worker/dist/logger.js";
import { describe, expect, it } from "vitest";
import { FakeSends } from "../../test/fake-sends.js";
import { SendDesk } from "./held.js";

function request(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return {
    method: "POST",
    scheme: "https",
    host: "broker.test",
    path: "/optout",
    resourceType: "Document",
    isDocument: true,
    target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
    party: "target",
    bodyKind: "form",
    query: [],
    body: [{ path: "email", value: "{{email}}", class: "profile", fields: ["email"] }],
    headers: [],
    bodyBytes: 10,
    bodyDigest: "d".repeat(64),
    carries: ["email"],
    ...overrides,
  };
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function desk(
  sends: FakeSends,
  gate: Partial<{
    mode: "hold" | "record";
    holdMs: number;
    approved: never[];
    declined: OutgoingRequest[];
  }> = {},
) {
  const notes: string[] = [];
  const held: number[] = [];
  const instance = new SendDesk({
    api: sends,
    gate: { mode: "hold", holdMs: 400, approved: [], declined: [], ...gate },
    logger: silentLogger,
    signal: new AbortController().signal,
    capture: async () => undefined,
    note: (text) => notes.push(text),
    onHeld: (ms) => held.push(ms),
    callTimeoutMs: 60,
  });
  return { instance, notes, held };
}

describe("the desk that holds a send", () => {
  it("releases a request once a person says send, and counts the release", async () => {
    const sends = new FakeSends(() => "send");
    const { instance, notes } = desk(sends);
    const outcome = await instance.decide(request());
    expect(outcome).toMatchObject({ kind: "release" });
    expect(instance.released).toBe(1);
    expect(notes.join(" ")).toContain("approved POST broker.test/optout");
  });

  it("refuses a request a person declined, and says not to try again", async () => {
    const { instance } = desk(new FakeSends(() => "dont_send"));
    const outcome = await instance.decide(request());
    expect(outcome).toMatchObject({ kind: "refuse" });
    expect("note" in outcome && outcome.note).toContain("Do not try it again");
    expect(instance.released).toBe(0);
  });

  it("lapses when nobody answers in time", async () => {
    const { instance } = desk(new FakeSends(() => "nobody"));
    expect(await instance.decide(request())).toMatchObject({ kind: "lapse" });
  });

  it("lapses at once when the hold is zero, which defers every send to the next run", async () => {
    const { instance } = desk(new FakeSends(() => "send"), { holdMs: 0 });
    expect(await instance.decide(request())).toMatchObject({ kind: "lapse" });
  });

  it("refuses a request the person declined in an earlier run, without holding it", async () => {
    const sends = new FakeSends(() => "send");
    const { instance } = desk(sends, { declined: [request()] });
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
    await instance.flush();
    expect(sends.held).toEqual([]);
    expect(sends.registered.map((item) => item.kind)).toEqual(["refused"]);
  });

  it("spends an approval from an earlier run at most once", async () => {
    const approvedRequest = request();
    const sends = new FakeSends(() => "nobody", [{ id: "approved-1", request: approvedRequest }]);
    const { instance } = desk(sends, {
      approved: [{ id: "approved-1", request: approvedRequest, resend: false }] as never[],
    });
    expect(await instance.decide(request())).toMatchObject({ kind: "release" });
    expect(await instance.decide(request())).toMatchObject({ kind: "lapse" });
    expect(sends.releases).toHaveLength(1);
  });

  it("asks a person about a request that differs from the approved one", async () => {
    const sends = new FakeSends(() => "nobody", [{ id: "approved-1", request: request() }]);
    const { instance } = desk(sends, {
      approved: [{ id: "approved-1", request: request(), resend: false }] as never[],
    });
    const changed = request({
      body: [
        { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
        { path: "extra", value: "1", class: "literal" },
      ],
    });
    expect(await instance.decide(changed)).toMatchObject({ kind: "lapse" });
    expect(sends.held).toHaveLength(1);
  });

  it("writes down a cleared model's send before it is let go", async () => {
    const sends = new FakeSends();
    const { instance } = desk(sends, { mode: "record" });
    const outcome = await instance.decide(request());
    expect(outcome).toMatchObject({ kind: "release" });
    expect(sends.registered.map((item) => item.kind)).toEqual(["released"]);
  });

  it("refuses rather than releases when the server cannot be reached", async () => {
    const sends = new FakeSends(() => "send");
    sends.registerSends = async () => {
      throw new Error("down");
    };
    const { instance } = desk(sends);
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
    expect(instance.released).toBe(0);
  });

  it("refuses rather than releases when the server will not accept the release", async () => {
    const sends = new FakeSends(() => "send");
    sends.releaseSend = async () => {
      throw new Error("down");
    };
    const { instance } = desk(sends);
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
  });

  it("refuses when the server never answers the registration of a hold", async () => {
    const sends = new FakeSends(() => "send");
    sends.registerSends = never;
    const { instance } = desk(sends);
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
    expect(instance.released).toBe(0);
    expect(instance.waiting).toBe(0);
  });

  it("refuses when the server never answers the release of an approved send", async () => {
    const sends = new FakeSends(() => "send");
    sends.releaseSend = never;
    const { instance } = desk(sends);
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
    expect(instance.released).toBe(0);
  });

  it("refuses when the server never answers a wait for the decision", async () => {
    const sends = new FakeSends(() => "nobody");
    sends.awaitDecision = never;
    const { instance } = desk(sends, { holdMs: 100 });
    expect(await instance.decide(request())).toMatchObject({ kind: "refuse" });
  });

  it("holds a send without a picture when taking it never ends", async () => {
    const sends = new FakeSends(() => "send");
    const instance = new SendDesk({
      api: sends,
      gate: { mode: "hold", holdMs: 400, approved: [], declined: [] },
      logger: silentLogger,
      signal: new AbortController().signal,
      capture: never,
      note: () => undefined,
      onHeld: () => undefined,
      callTimeoutMs: 20,
    });
    expect(await instance.decide(request())).toMatchObject({ kind: "release" });
  });

  it("stops waiting for a person once the run is over", async () => {
    const sends = new FakeSends(() => "nobody");
    const { instance } = desk(sends, { holdMs: 30_000 });
    const pending = instance.decide(request());
    await new Promise((resolve) => setTimeout(resolve, 50));
    instance.stop();
    expect(await pending).toMatchObject({ kind: "refuse" });
  });

  it("is settled only when no request is waiting", async () => {
    const sends = new FakeSends(() => "nobody");
    const { instance } = desk(sends);
    const pending = instance.decide(request());
    let settled = false;
    const wait = instance.settled().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    await pending;
    await wait;
    expect(settled).toBe(true);
  });

  it("reports how long it held, for the run's time budget to leave out", async () => {
    const { instance, held } = desk(new FakeSends(() => "nobody"));
    await instance.decide(request());
    expect(held[0]).toBeGreaterThanOrEqual(300);
  });
});

describe("recording what the gate decided", () => {
  it("loses only the row the server rejects, and writes down that it did", async () => {
    const sends = new FakeSends(() => "nobody");
    const accepted: string[] = [];
    const api = Object.assign(Object.create(sends) as FakeSends, {
      async registerSends(items: Parameters<FakeSends["registerSends"]>[0]) {
        if (items.some((item) => item.kind === "refused" && item.reason === "bad")) {
          throw new Error("rejected");
        }
        for (const item of items)
          accepted.push(`${item.kind}:${"reason" in item ? item.reason : ""}`);
        return sends.registerSends(items);
      },
    });
    const instance = new SendDesk({
      api,
      gate: { mode: "hold", holdMs: 0, approved: [], declined: [] },
      logger: silentLogger,
      signal: new AbortController().signal,
      capture: async () => undefined,
      note: () => undefined,
      onHeld: () => undefined,
    });
    instance.log({ kind: "lookup", request: request({ method: "GET" }) });
    instance.log({ kind: "refused", request: request(), reason: "bad" });
    instance.log({ kind: "lookup", request: request({ method: "GET" }) });
    await instance.flush();
    await instance.flush();
    expect(accepted).toEqual(["lookup:", "lookup:", "guard_event:unrecorded"]);
  });
});
