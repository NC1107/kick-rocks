import { describe, expect, it } from "vitest";
import { createTestContext } from "../../test-utils/index.js";
import { createPasswordHasher } from "./passwords.js";

const CHEAP = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

describe("password hashing cost", () => {
  it("uses the library's full cost unless a cost is given", async () => {
    const hash = await createPasswordHasher().hash("correct horse battery");
    expect(hash).toMatch(/\$m=65536,p=4,t=3\$/);
  });

  it("uses the given cost, and does not call a hash of that cost out of date", async () => {
    const hasher = createPasswordHasher(CHEAP);
    const hash = await hasher.hash("correct horse battery");
    expect(hash).toMatch(/\$m=1024,p=1,t=1\$/);
    expect(await hasher.verify(hash, "correct horse battery")).toBe(true);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(createPasswordHasher().needsRehash(hash)).toBe(true);
  });

  it("makes the test context hash cheaply so login-heavy tests stay fast", async () => {
    const ctx = await createTestContext();
    try {
      expect(await ctx.services.passwords.hash("correct horse battery")).toMatch(/\$m=1024,/);
    } finally {
      await ctx.close();
    }
  });
});
