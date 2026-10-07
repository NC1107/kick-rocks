import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

/** A malformed stored hash counts as a mismatch instead of an error, so it can never open the door. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash);
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Checks a password against a throwaway hash, so a login attempt costs the same whether or not an
 * instance password exists yet.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("kick-rocks-timing-equalizer");
  await verifyPassword(await dummyHash, password);
}
