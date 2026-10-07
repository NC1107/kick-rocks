import { describe, expect, it } from "vitest";
import { FakeClock, MINUTE, SECOND } from "../../test-utils/index.js";
import { LoginThrottle } from "./throttle.js";

function setup() {
  const clock = new FakeClock("2026-10-07T12:00:00Z");
  return { clock, throttle: new LoginThrottle(clock) };
}

describe("LoginThrottle", () => {
  it("allows five tries and locks on the fifth for thirty seconds", () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i += 1) expect(throttle.attempt("a").allowed).toBe(true);
    expect(throttle.attempt("a")).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("doubles the lock with each further miss up to fifteen minutes", () => {
    const { clock, throttle } = setup();
    const locks: number[] = [];
    for (let i = 0; i < 5; i += 1) throttle.attempt("a");
    for (let round = 0; round < 8; round += 1) {
      const blocked = throttle.attempt("a");
      if (blocked.allowed) throw new Error("expected a lock");
      locks.push(blocked.retryAfterSeconds);
      clock.advance(blocked.retryAfterSeconds * SECOND);
      throttle.attempt("a");
    }
    expect(locks).toEqual([30, 60, 120, 240, 480, 900, 900, 900]);
  });

  it("does not extend a lock by refusing attempts made during it", () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i += 1) throttle.attempt("a");
    clock.advance(10 * SECOND);
    for (let i = 0; i < 20; i += 1) throttle.attempt("a");
    expect(throttle.attempt("a")).toEqual({ allowed: false, retryAfterSeconds: 20 });
  });

  it("keeps keys apart and forgets a key after a quiet hour or a success", () => {
    const { clock, throttle } = setup();
    for (let i = 0; i < 5; i += 1) throttle.attempt("a");
    expect(throttle.attempt("b").allowed).toBe(true);
    throttle.succeed("a");
    expect(throttle.attempt("a").allowed).toBe(true);

    for (let i = 0; i < 5; i += 1) throttle.attempt("c");
    clock.advance(61 * MINUTE);
    expect(throttle.attempt("c").allowed).toBe(true);
  });

  it("stays bounded under many distinct keys", () => {
    const { throttle } = setup();
    for (let i = 0; i < 10_500; i += 1) throttle.attempt(`ip-${i}`);
    expect(throttle.attempt("ip-new").allowed).toBe(true);
    expect(
      (throttle as unknown as { records: Map<string, unknown> }).records.size,
    ).toBeLessThanOrEqual(10_001);
  });
});
