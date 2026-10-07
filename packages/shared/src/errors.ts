/**
 * Thrown by a placeholder that a later module replaces. Failing loudly beats returning something
 * plausible, because a stub that quietly "works" would be shipped by mistake.
 */
export class NotImplementedError extends Error {
  override name = "NotImplementedError";

  constructor(what: string) {
    super(`${what} is not implemented yet`);
  }
}
