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
