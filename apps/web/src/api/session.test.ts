import { API_ROUTES, type ReviewQueue } from "@kickrocks/shared";
import { describe, expect, it, vi } from "vitest";
import { prefetchProfiles } from "./current-profile.js";
import { routeKey } from "./hooks.js";
import { createQueryClient } from "./query-client.js";
import { prefetchAuthState, reviewCount } from "./session.js";

describe("reviewCount", () => {
  it("adds every tab: blocked tasks, pending matches, verifications, failed tasks, and messages", () => {
    const queue = {
      blockedTasks: [{}, {}],
      matches: [{ decision: "pending" }, { decision: "mine" }, { decision: "pending" }],
      verifications: [{}],
      failedTasks: [{}, {}, {}],
      agentTasks: [{}, {}],
      messages: [{}],
    } as unknown as ReviewQueue;
    expect(reviewCount(queue)).toBe(2 + 2 + 1 + 3 + 2 + 1);
  });

  it("is zero for an empty queue", () => {
    expect(
      reviewCount({
        blockedTasks: [],
        matches: [],
        verifications: [],
        failedTasks: [],
        agentTasks: [],
        messages: [],
      }),
    ).toBe(0);
  });
});

describe("prefetchAuthState", () => {
  it("fills the cache the auth gate reads, so the gate does not wait for its own request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ setupRequired: false, authenticated: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createQueryClient();
    await prefetchAuthState(client);
    expect(client.getQueryData(routeKey(API_ROUTES.authState))).toEqual({
      setupRequired: false,
      authenticated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("prefetchProfiles", () => {
  const profilesBody = { profiles: [] };
  const stubFetch = () => {
    const fetchMock = vi.fn(async () => Response.json(profilesBody));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("asks for the profile list ahead of React in a browser that has signed in before", async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("localStorage", { getItem: () => "prf_0001" });
    const client = createQueryClient();
    prefetchProfiles(client);
    await vi.waitFor(() =>
      expect(client.getQueryData(routeKey(API_ROUTES.profilesList))).toEqual(profilesBody),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("does not ask in a browser with no remembered profile, so a first visit sees no failed request", () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("localStorage", { getItem: () => null });
    prefetchProfiles(createQueryClient());
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
