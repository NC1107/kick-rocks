import { API_ROUTES } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callRoute, onUnauthorized, routeUrl, screenshotUrl, serializeQuery } from "./client.js";
import { ApiContractError, ApiNetworkError, ApiRequestError, errorMessage } from "./errors.js";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("urls", () => {
  it("fills path params and encodes them", () => {
    expect(routeUrl(API_ROUTES.profilesGet, { params: { id: "a b/c" } })).toBe(
      "/api/profiles/a%20b%2Fc",
    );
  });

  it("serializes a query, joining arrays and skipping empty values", () => {
    expect(serializeQuery({ status: ["sent", "queued"], q: "", page: 2, none: undefined })).toBe(
      "?status=sent%2Cqueued&page=2",
    );
    expect(serializeQuery(undefined)).toBe("");
    expect(serializeQuery({})).toBe("");
  });

  it("points a screenshot image at the task route", () => {
    expect(screenshotUrl("t1")).toBe("/api/tasks/t1/screenshot");
  });
});

describe("callRoute", () => {
  it("sends no CSRF header on a read", async () => {
    fetchMock.mockResolvedValue(json({ setupRequired: false, authenticated: true }));
    await callRoute(API_ROUTES.authState);
    expect(lastRequest().init.method).toBe("GET");
    expect(lastRequest().headers).not.toHaveProperty("x-kick-rocks");
    expect(lastRequest().headers).not.toHaveProperty("content-type");
  });

  it("sends X-Kick-Rocks with every state-changing method", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await callRoute(API_ROUTES.authLogin, { body: { password: "x" } });
    expect(lastRequest().headers["x-kick-rocks"]).toBe("1");
    expect(lastRequest().init.body).toBe('{"password":"x"}');
    expect(lastRequest().headers["content-type"]).toBe("application/json");

    await callRoute(API_ROUTES.profilesDelete, { params: { id: "p1" } });
    expect(lastRequest().init.method).toBe("DELETE");
    expect(lastRequest().headers["x-kick-rocks"]).toBe("1");
  });

  it("returns the parsed response", async () => {
    fetchMock.mockResolvedValue(json({ setupRequired: true, authenticated: false }));
    await expect(callRoute(API_ROUTES.authState)).resolves.toEqual({
      setupRequired: true,
      authenticated: false,
    });
  });

  it("rejects a body that breaks the response schema", async () => {
    fetchMock.mockResolvedValue(json({ setupRequired: "yes" }));
    await expect(callRoute(API_ROUTES.authState)).rejects.toBeInstanceOf(ApiContractError);
  });

  it("turns an error body into an ApiRequestError with field errors", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: "invalid_request",
          message: "Some details are not valid.",
          issues: [
            { path: ["identities", 0, "value", "address"], message: "Enter a valid email" },
            { path: ["identities", 0, "value", "address"], message: "second message ignored" },
          ],
        },
        { status: 400 },
      ),
    );
    const error = await callRoute(API_ROUTES.authLogin, { body: { password: "x" } }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    const failure = error as ApiRequestError;
    expect(failure.status).toBe(400);
    expect(failure.code).toBe("invalid_request");
    expect(failure.fieldErrors).toEqual({ "identities.0.value.address": "Enter a valid email" });
    expect(errorMessage(failure)).toBe("Some details are not valid.");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await callRoute(API_ROUTES.profilesList).catch(
      (caught: unknown) => caught,
    )) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("unknown");
    expect(error.message).toMatch(/problem/);
  });

  it("reports an unreachable server as a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(callRoute(API_ROUTES.profilesList)).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it("tells listeners when a signed-in route answers 401", async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    fetchMock.mockImplementation(async () => json({ error: "unauthorized" }, { status: 401 }));

    await expect(callRoute(API_ROUTES.profilesList)).rejects.toBeInstanceOf(ApiRequestError);
    expect(listener).toHaveBeenCalledTimes(1);

    // A wrong password at the login form is a 401 too, but the person is already at /login.
    await expect(
      callRoute(API_ROUTES.authLogin, { body: { password: "nope" } }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    await expect(callRoute(API_ROUTES.profilesList)).rejects.toBeInstanceOf(ApiRequestError);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("types", () => {
  it("requires the params and body a route declares", () => {
    const never = async () => {
      // @ts-expect-error profilesGet needs params
      await callRoute(API_ROUTES.profilesGet);
      // @ts-expect-error authLogin needs a body
      await callRoute(API_ROUTES.authLogin);
      // @ts-expect-error the body is checked against the route's schema
      await callRoute(API_ROUTES.authLogin, { body: { password: 1 } });
      await callRoute(API_ROUTES.requestsList, {
        params: { id: "p" },
        query: { status: ["sent", "queued"], page: 2 },
      });
    };
    expect(never).toBeTypeOf("function");
  });
});
