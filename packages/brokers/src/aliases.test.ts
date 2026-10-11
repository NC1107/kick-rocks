import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { applyAliases } from "./aliases.js";

const broker = (id: string) => ({ id, name: id, domain: `${id}.test` }) as Broker;

const file = (id: string, names: string) =>
  `aliases:\n  - broker: ${id}\n    names: [${names}]\n    source: test\n`;

describe("applyAliases", () => {
  it("attaches the names to their broker and leaves the rest alone", () => {
    const [one, two] = applyAliases(
      [broker("one"), broker("two")],
      file("one", "Parent Co, Other Name"),
    );
    expect(one?.aliases).toEqual(["Parent Co", "Other Name"]);
    expect(two).not.toHaveProperty("aliases");
  });

  it("rejects an entry for a broker the dataset does not list", () => {
    expect(() => applyAliases([broker("one")], file("missing", "Parent Co"))).toThrow(
      /missing, which is not in the broker dataset/,
    );
  });
});
