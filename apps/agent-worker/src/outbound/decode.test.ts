import { deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readAll } from "./decode.js";

describe("a compressed layer that is damaged", () => {
  const email = "jordan.example@example.com";

  it("marks a zlib body cut short as unreadable and still reads what came before the cut", () => {
    const noise = Array.from({ length: 3000 }, (_, index) => (index * 7919).toString(36)).join(" ");
    const whole = deflateSync(Buffer.from(`email=${email}&${noise}`));
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    const reading = readAll([{ data: cut }]);
    expect(reading.overflow).toBe(true);
    expect(reading.texts.some((text) => text.includes(email))).toBe(true);
  });

  it("marks a gzip body with a broken tail as unreadable", () => {
    const whole = gzipSync(Buffer.from(`email=${email}`));
    const broken = Buffer.concat([whole.subarray(0, whole.length - 8), Buffer.alloc(8, 0xff)]);
    expect(readAll([{ data: broken, contentEncoding: "gzip" }]).overflow).toBe(true);
  });

  it("does not mark an intact layer", () => {
    const reading = readAll([{ data: gzipSync(Buffer.from(`email=${email}`)) }]);
    expect(reading.overflow).toBe(false);
    expect(reading.texts.some((text) => text.includes(email))).toBe(true);
  });
});
