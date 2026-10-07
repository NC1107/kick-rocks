import { randomUUID } from "node:crypto";

/** Ids are random UUIDs, which are safe inside a Message-ID and a URL. */
export function newId(): string {
  return randomUUID();
}
