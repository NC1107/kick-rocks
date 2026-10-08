import { type KickRocksDb, sessions } from "@kickrocks/db";
import { asc, count, eq, lt, ne } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Clock, nowIso } from "../../core/clock.js";
import { generateToken, hashToken } from "../../core/secrets.js";

export const SESSION_COOKIE = "kr_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const MAX_USER_AGENT = 255;
/** Sliding the expiry on every request would turn each read into a write. */
const REFRESH_AFTER_MS = 60_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

interface SessionStore {
  /** Starts a session and returns the token for its cookie, which is never stored. */
  create(userAgent: string | undefined): string;
  /** Whether the token names a live session. A live one has its expiry pushed out. */
  touch(token: string | undefined): boolean;
  destroy(token: string | undefined): void;
  /** Ends every session but the one the token names; with no token, every session. */
  destroyAllExcept(token: string | null): void;
}

export function createSessionStore(deps: { db: KickRocksDb; clock: Clock }): SessionStore {
  const { db, clock } = deps;
  const expiry = (from: Date) => new Date(from.getTime() + SESSION_TTL_MS).toISOString();

  return {
    create(userAgent) {
      const token = generateToken();
      const now = clock.now();
      db.transaction((tx) => {
        tx.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
        const total = tx.select({ n: count() }).from(sessions).get()?.n ?? 0;
        if (total >= MAX_SESSIONS) {
          const oldest = tx
            .select({ id: sessions.id })
            .from(sessions)
            .orderBy(asc(sessions.lastSeenAt))
            .limit(total - MAX_SESSIONS + 1)
            .all();
          for (const { id } of oldest) tx.delete(sessions).where(eq(sessions.id, id)).run();
        }
        tx.insert(sessions)
          .values({
            id: hashToken(token),
            createdAt: now.toISOString(),
            lastSeenAt: now.toISOString(),
            expiresAt: expiry(now),
            userAgent: userAgent?.slice(0, MAX_USER_AGENT) ?? null,
          })
          .run();
      });
      return token;
    },

    touch(token) {
      if (!token || !TOKEN_SHAPE.test(token)) return false;
      const id = hashToken(token);
      const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
      if (!row) return false;
      const now = clock.now();
      if (row.expiresAt <= now.toISOString()) {
        db.delete(sessions).where(eq(sessions.id, id)).run();
        return false;
      }
      if (now.getTime() - Date.parse(row.lastSeenAt) >= REFRESH_AFTER_MS) {
        db.update(sessions)
          .set({ lastSeenAt: nowIso(clock), expiresAt: expiry(now) })
          .where(eq(sessions.id, id))
          .run();
      }
      return true;
    },

    destroy(token) {
      if (!token || !TOKEN_SHAPE.test(token)) return;
      db.delete(sessions)
        .where(eq(sessions.id, hashToken(token)))
        .run();
    },

    destroyAllExcept(token) {
      if (token && TOKEN_SHAPE.test(token)) {
        db.delete(sessions)
          .where(ne(sessions.id, hashToken(token)))
          .run();
      } else {
        db.delete(sessions).run();
      }
    },
  };
}

export function sessionTokenOf(request: FastifyRequest): string | undefined {
  return request.cookies?.[SESSION_COOKIE];
}

interface CookieContext {
  publicUrl: string;
}

function isSecure(request: FastifyRequest, { publicUrl }: CookieContext): boolean {
  return request.protocol === "https" || publicUrl.startsWith("https://");
}

export function setSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  token: string,
  context: CookieContext,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure(request, context),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  context: CookieContext,
): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure(request, context),
  });
}
