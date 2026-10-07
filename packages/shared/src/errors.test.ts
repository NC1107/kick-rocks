import { describe, expect, it } from "vitest";
import { NotImplementedError } from "./errors.js";

describe("NotImplementedError", () => {
  it("names what is missing", () => {
    const error = new NotImplementedError("renderRequestEmail");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NotImplementedError");
    expect(error.message).toBe("renderRequestEmail is not implemented yet");
  });
});
