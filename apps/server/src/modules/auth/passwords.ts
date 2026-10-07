import argon2 from "argon2";

/** The argon2id cost settings. Only a test supplies its own, to keep login-heavy suites fast. */
export interface PasswordCost {
  timeCost: number;
  memoryCost: number;
  parallelism: number;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** A malformed stored hash counts as a mismatch instead of an error, so it can never open the door. */
  verify(hash: string, password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
  /**
   * Checks a password against a throwaway hash, so a login attempt costs the same whether or not an
   * instance password exists yet.
   */
  verifyAgainstDummy(password: string): Promise<void>;
}

export function createPasswordHasher(cost?: PasswordCost): PasswordHasher {
  const options = { type: argon2.argon2id, ...cost } as const;
  let dummyHash: Promise<string> | null = null;
  const hash = (password: string) => argon2.hash(password, options);
  const verify = async (stored: string, password: string) => {
    try {
      return await argon2.verify(stored, password);
    } catch {
      return false;
    }
  };

  return {
    hash,
    verify,
    needsRehash(stored) {
      try {
        return argon2.needsRehash(stored, cost);
      } catch {
        return true;
      }
    },
    async verifyAgainstDummy(password) {
      dummyHash ??= hash("kick-rocks-timing-equalizer");
      await verify(await dummyHash, password);
    },
  };
}
