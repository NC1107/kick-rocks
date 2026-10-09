import type { ProfileFields, SubmitGate, TaskScreenshot } from "@kickrocks/shared";
import { describeError } from "@kickrocks/worker/dist/logger.js";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { type NavigationPolicy, withinSites } from "../domains.js";
import { type CdpChannel, guardTargets, type TargetInfo } from "../target-guard.js";
import { ValueDetector } from "./detector.js";
import { bounded, CALL_TIMEOUT_MS, describeRequest, type SendDesk } from "./held.js";
import { decide, isChallengeHost } from "./policy.js";
import {
  type Canonical,
  type Cookie,
  canonicalize,
  headersWithShortReferer,
  MAX_BODY_BYTES,
  type PausedRequest,
  readBody,
  ServedValues,
  type TargetContext,
} from "./request.js";

/** The run was ended because a send waited too long for a person. */
export class ApprovalLapsed extends Error {
  override name = "ApprovalLapsed";

  constructor(readonly sends: string[]) {
    super("A send waited for a person and was not decided in time");
  }
}

/** The page used a channel the gate cannot read. */
export class UnguardedChannel extends Error {
  override name = "UnguardedChannel";

  constructor(
    readonly channel: string,
    /** The run had already typed or chosen something, so a form may have gone out through it. */
    readonly afterTouch: boolean,
  ) {
    super(`The page opened a ${channel}, which the safety gate cannot read`);
  }
}

/**
 * What the toolbox decides about documents, which the gate asks first. A document is judged by the
 * navigation policy before the outgoing rules see it, so a page can never be sent somewhere the
 * policy did not admit.
 */
export interface DocumentHooks {
  /** Why the document may not load, or null. A document that may load is recorded as admitted. */
  refuse(event: PausedRequest, mainFrameId: string): string | null;
  /** The answer to a document, for the site's pushback and a start page's redirect. */
  answered(event: PausedRequest, mainFrameId: string): void;
}

export interface GuardOptions {
  page: Page;
  /** Aborts when the run is stopped, which refuses every request still waiting for an answer. */
  signal: AbortSignal;
  policy: NavigationPolicy;
  gate: SubmitGate | null;
  desk: SendDesk | null;
  fields: ProfileFields;
  maskValues: readonly string[];
  mask: (text: string) => string;
  documents: DocumentHooks;
  /** Addresses on the target's sites whose stored data is cleared before an uncleared run starts. */
  storageOrigins: readonly string[];
  /** Domains of the target, whose cookies are deleted before an uncleared run starts. */
  cookieDomains: readonly string[];
  /** Tells the model something about what the gate did. */
  note: (text: string) => void;
  /** Reports a frame, worker or request the gate could not check. */
  onProblem: (text: string) => void;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResponseReceived {
  requestId: string;
  type?: string;
  response: { status: number; url: string; mimeType: string };
}

interface SessionContext {
  type: string;
  mainFrameId: string;
  origins: Map<string, string>;
  fallbackOrigin: string;
}

const QUIET_MS = 150;
const MAX_QUIET_ROUNDS = 6;
const MIN_CLOSE_ROUNDS = 4;
/** How long closing waits for requests still being decided before it reports them as unguarded. */
const CLOSE_WAIT_MS = 15_000;

/**
 * The address a page asks for when it tries to open a live connection. It never resolves: the
 * gate sees the request before it leaves the browser and fails it, so it only tells the gate.
 */
const CHANNEL_SIGNAL_HOST = "channel.kickrocks-gate.invalid";
const KEEPALIVE_SIGNAL = "keepalive";

/**
 * Closes the doors the gate has no eyes on. The browser does not let DevTools block a WebSocket,
 * so the constructor itself is replaced by one that tells the gate and throws. WebRTC, WebTransport
 * and shared workers are removed, which a page reads as a browser without them. `window.open`
 * returns null, so a page never gets a handle on a window it could post through.
 *
 * Chrome does not say on a paused request whether it is a keepalive fetch, and it sends a paused
 * keepalive request when DevTools disconnects, where it cancels an ordinary one. So the page is
 * never allowed to make one: `fetch` drops the flag and tells the gate, which then sees an
 * ordinary request it can hold, and `fetchLater` is removed.
 */
const CLOSE_CHANNELS = `(() => {
  const nativeFetch = globalThis.fetch;
  const tell = (kind) => { try { nativeFetch.call(globalThis, "http://${CHANNEL_SIGNAL_HOST}/" + kind, { mode: "no-cors" }).catch(() => undefined); } catch (_) {} };
  if (typeof nativeFetch === "function") {
    const ordinary = function fetch(input, init) {
      let lowered = false;
      let nextInit = init;
      if (init !== undefined && init !== null && init.keepalive) {
        nextInit = Object.assign({}, init, { keepalive: false });
        lowered = true;
      }
      let nextInput = input;
      if (input !== null && typeof input === "object" && input.keepalive === true) {
        try { nextInput = new Request(input, { keepalive: false }); lowered = true; } catch (_) { return Promise.reject(new TypeError("Failed to fetch")); }
      }
      if (lowered) tell("${KEEPALIVE_SIGNAL}");
      return nativeFetch.call(this, nextInput, nextInit);
    };
    try { Object.defineProperty(globalThis, "fetch", { value: ordinary, configurable: false, writable: true }); } catch (_) {}
  }
  try { Object.defineProperty(globalThis, "fetchLater", { value: undefined, configurable: false, writable: false }); } catch (_) {}
  const stop = (name) => {
    const stub = function () { tell("live connection"); throw new DOMException("Blocked by the safety gate", "SecurityError"); };
    try { Object.defineProperty(globalThis, name, { value: stub, configurable: false, writable: false }); } catch (_) {}
  };
  for (const name of ["WebSocket", "WebSocketStream"]) stop(name);
  if (typeof window !== "undefined") {
    try { Object.defineProperty(window, "open", { value: () => null, configurable: false, writable: false }); } catch (_) {}
  }
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "WebTransport", "SharedWorker"]) {
    try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch (_) {}
  }
})();`;

/** Whether two readings of a jar hold the same cookies. A jar that could not be read is never the same. */
function sameCookies(shown: readonly Cookie[] | null, now: readonly Cookie[] | null): boolean {
  if (shown === null || now === null) return false;
  const key = (cookies: readonly Cookie[]): string =>
    JSON.stringify(cookies.map((cookie) => [cookie.name, cookie.value]).sort());
  return key(shown) === key(now);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url.startsWith("blob:") ? url.slice(5) : url);
    return parsed.origin === "null" ? "" : parsed.origin;
  } catch {
    return "";
  }
}

/**
 * The single place that decides what leaves the browser. Every request of the page, of every
 * frame, of every worker, of every resource type and method is paused, read, and either let go,
 * logged, refused or held for a person. Nothing is switched on for one action or for a window of
 * time, and the guard stays attached until the page has closed.
 */
export class OutboundGuard {
  private touched = false;
  private closing = false;
  private lapsed: string[] = [];
  private channel: UnguardedChannel | null = null;
  private activity = 0;
  private cdp: CDPSession | null = null;
  private readonly handling = new Set<Promise<void>>();
  private readonly detector: ValueDetector;
  private readonly served = new ServedValues();
  private readonly releases = new Map<
    string,
    { releaseId: string; digest: string; method: string; url: string }
  >();
  private readonly responses = new Map<string, { url: string; type: string }>();
  /**
   * Every request that was paused and has not been answered, by session and request id. Chrome
   * sends a keepalive request that is still paused when its session detaches, so none may be
   * left paused when the page, a frame or the browser goes away.
   */
  private readonly unanswered = new Map<CdpChannel, Map<string, string>>();

  constructor(private readonly options: GuardOptions) {
    this.detector = new ValueDetector(options.fields, options.maskValues, options.cookieDomains);
    options.signal.addEventListener("abort", () => void this.refuseUnanswered(), { once: true });
  }

  get gated(): boolean {
    return this.options.gate !== null && this.options.desk !== null;
  }

  /** The run touched the page: from now on every request with a body counts as a send. */
  touch(): void {
    this.touched = true;
  }

  get hasTouched(): boolean {
    return this.touched;
  }

  async install(): Promise<void> {
    const { page } = this.options;
    const context: BrowserContext = page.context();
    if (this.gated) await page.addInitScript(CLOSE_CHANNELS);
    const cdp = await context.newCDPSession(page);
    this.cdp = cdp;
    const channel = this.channelOf(cdp);
    const { frameTree } = await cdp.send("Page.getFrameTree");
    if (this.gated) await this.clearStorage(channel);
    await this.attach(channel, {
      type: "page",
      mainFrameId: frameTree.frame.id,
      origins: new Map([[frameTree.frame.id, originOf(frameTree.frame.url)]]),
      fallbackOrigin: "",
    });
    await guardTargets(
      channel,
      (target, info) => this.attach(target, this.contextOf(info)),
      (error, info) => {
        this.options.onProblem(
          `${info?.type ? `A ${info.type}` : "A target"} could not be checked and was held back: ${describeError(error)}`,
        );
        if (this.gated) this.recordProblem("unguarded_target", info);
      },
    );
  }

  private channelOf(cdp: CDPSession): CdpChannel {
    return {
      send: (method, params) => cdp.send(method as never, params as never),
      on: (event, handler) => cdp.on(event as never, handler as never),
    };
  }

  private contextOf(info: TargetInfo): SessionContext {
    return {
      type: info.type,
      mainFrameId: "",
      origins: new Map(),
      fallbackOrigin: originOf(info.url ?? ""),
    };
  }

  /**
   * Uncleared runs start from a browser that holds nothing of the target's: a profile that was
   * used for an earlier run may keep the person's email in a cookie or in storage, in any
   * encoding, and a page could send it back without the run typing anything.
   */
  private async clearStorage(channel: CdpChannel): Promise<void> {
    for (const origin of this.options.storageOrigins) {
      await channel
        .send("Storage.clearDataForOrigin", { origin, storageTypes: "all" })
        .catch(() => undefined);
    }
    const all = (await channel.send("Network.getAllCookies").catch(() => ({ cookies: [] }))) as {
      cookies: { name: string; domain: string; path: string }[];
    };
    for (const cookie of all.cookies) {
      const domain = cookie.domain.replace(/^\./, "");
      const ours = this.options.cookieDomains.some(
        (target) => domain === target || domain.endsWith(`.${target}`),
      );
      if (!ours) continue;
      await channel
        .send("Network.deleteCookies", {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
        })
        .catch(() => undefined);
    }
  }

  /** Puts the gate on one DevTools session: the page's, a frame's, or a worker's. */
  private async attach(session: CdpChannel, ctx: SessionContext): Promise<void> {
    await session.send("Network.enable", { maxPostDataSize: MAX_BODY_BYTES + 1 });
    await session.send("Network.setBypassServiceWorker", { bypass: true });
    if (this.gated) {
      session.on("Network.webSocketCreated", () => this.onWebSocket(false));
      session.on("Network.responseReceived", (event: ResponseReceived) => this.onResponse(event));
      session.on("Network.loadingFailed", (event: { requestId: string; errorText: string }) =>
        this.onFailed(event),
      );
      session.on("Network.loadingFinished", (event: { requestId: string }) => {
        this.readServed(session, event.requestId)
          .catch(() => undefined)
          .finally(() => this.responses.delete(event.requestId));
      });
      if (ctx.type === "worker") {
        await session
          .send("Runtime.evaluate", { expression: CLOSE_CHANNELS })
          .catch(() => undefined);
      }
    }
    if (ctx.type === "page" || ctx.type === "iframe") {
      await session.send("Page.enable").catch(() => undefined);
      session.on("Page.frameNavigated", (event: { frame: { id: string; url: string } }) => {
        ctx.origins.set(event.frame.id, originOf(event.frame.url));
      });
    }
    if (ctx.type === "page" && this.gated) {
      // A keepalive request outlives the document that made it, and a paused fetch does not say
      // whether it is one, so nothing but the navigation itself stays paused while the page is replaced.
      session.on(
        "Page.frameStartedNavigating",
        (event: { frameId: string; navigationType: string }) => {
          if (event.frameId !== ctx.mainFrameId || event.navigationType.endsWith("ameDocument")) {
            return;
          }
          void this.refuseUnanswered(session, (type) => type !== "Document");
        },
      );
    }
    session.on("Fetch.requestPaused", (event: PausedRequest) => {
      this.activity += 1;
      this.track(session, event);
      // A request still paused when its session goes away is let go by the browser, so every
      // one is tracked until it has been decided, and closing waits for them.
      const handling: Promise<void> = this.onPaused(session, ctx, event)
        .catch(async (error: unknown) => {
          this.options.onProblem(`A request could not be checked: ${describeError(error)}`);
          await this.failRequest(session, event);
        })
        .finally(() => this.handling.delete(handling));
      this.handling.add(handling);
    });
    // A challenge is never answered, so credentials can neither be asked for nor sent after a 401.
    session.on("Fetch.authRequired", (event: { requestId: string }) => {
      session
        .send("Fetch.continueWithAuth", {
          requestId: event.requestId,
          authChallengeResponse: { response: "CancelAuth" },
        })
        .catch(() => undefined);
    });
    await session.send("Fetch.enable", {
      handleAuthRequests: true,
      patterns: this.gated
        ? [
            { urlPattern: "*", requestStage: "Request" },
            { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
          ]
        : [
            { urlPattern: "*", resourceType: "Document", requestStage: "Request" },
            { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
          ],
    });
  }

  /** Fails whatever is still paused, for a caller that is about to leave the page. */
  async refuseHeld(): Promise<void> {
    await this.refuseUnanswered();
  }

  private track(session: CdpChannel, event: PausedRequest): void {
    let ids = this.unanswered.get(session);
    if (ids === undefined) {
      ids = new Map();
      this.unanswered.set(session, ids);
    }
    ids.set(event.requestId, event.resourceType);
  }

  /** True once, for the caller that answers the request first. A late answer finds it gone. */
  private claim(session: CdpChannel, requestId: string): boolean {
    return this.unanswered.get(session)?.delete(requestId) ?? false;
  }

  /** A call the gate waits on, which never takes longer than a few seconds. */
  private ask(session: CdpChannel, method: string, params?: object): Promise<unknown> {
    return bounded(session.send(method, params), CALL_TIMEOUT_MS, method);
  }

  /**
   * Fails the requests that are paused and unanswered, so none is left for the browser to send
   * when a session detaches. Answers that arrive afterwards find nothing to answer.
   */
  private async refuseUnanswered(
    only?: CdpChannel,
    which: (resourceType: string) => boolean = () => true,
  ): Promise<void> {
    const failing: Promise<unknown>[] = [];
    for (const [session, ids] of this.unanswered) {
      if (only !== undefined && session !== only) continue;
      for (const [requestId, resourceType] of ids) {
        if (!which(resourceType)) continue;
        ids.delete(requestId);
        failing.push(
          this.ask(session, "Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(
            () => undefined,
          ),
        );
      }
    }
    await Promise.all(failing);
  }

  private async resume(
    session: CdpChannel,
    event: PausedRequest,
    headers: { name: string; value: string }[] | null = null,
  ): Promise<boolean> {
    if (!this.claim(session, event.requestId)) return false;
    try {
      await this.ask(session, "Fetch.continueRequest", {
        requestId: event.requestId,
        ...(headers === null ? {} : { headers }),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async failRequest(session: CdpChannel, event: PausedRequest): Promise<void> {
    if (!this.claim(session, event.requestId)) return;
    await this.ask(session, "Fetch.failRequest", {
      requestId: event.requestId,
      errorReason: "Aborted",
    }).catch(() => undefined);
  }

  private async onPaused(
    session: CdpChannel,
    ctx: SessionContext,
    event: PausedRequest,
  ): Promise<void> {
    if (event.responseStatusCode !== undefined) {
      this.options.documents.answered(event, ctx.mainFrameId);
      await this.resume(session, event);
      return;
    }
    if (event.resourceType === "Document") {
      const refused = this.options.documents.refuse(event, ctx.mainFrameId);
      if (refused !== null) {
        await this.failRequest(session, event);
        return;
      }
    }
    if (!this.gated) {
      await this.resume(session, event);
      return;
    }
    await this.gate(session, ctx, event);
  }

  private async gate(
    session: CdpChannel,
    ctx: SessionContext,
    event: PausedRequest,
  ): Promise<void> {
    const { policy, desk } = this.options;
    if (desk === null) return;
    const url = event.request.url;
    if (hostOf(url) === CHANNEL_SIGNAL_HOST) {
      if (pathOf(url) === `/${KEEPALIVE_SIGNAL}`) this.onKeepalive();
      else this.onWebSocket(true);
      await this.failRequest(session, event);
      return;
    }
    if (!/^(https?|wss?):/i.test(url)) {
      // A blob, data or file address is local to the browser and loads nothing from the network.
      await this.resume(session, event);
      return;
    }
    const party = withinSites(url, policy) ? "target" : "third";
    const headers = party === "target" ? headersWithShortReferer(event.request.headers) : null;
    const body = await readBody(
      event,
      async (requestId) =>
        (await this.ask(session, "Network.getRequestPostData", { requestId })) as {
          postData: string;
          base64Encoded?: boolean;
        },
    );
    const cookies = await this.cookiesFor(session, url);
    const canonical = canonicalize({
      event,
      body,
      cookies,
      target: this.targetOf(ctx, event),
      party,
      detector: this.detector,
      mask: this.options.mask,
      served: this.served,
    });
    if (
      event.resourceType === "Document" &&
      ctx.type === "page" &&
      event.frameId === ctx.mainFrameId
    ) {
      if (canonical.scan.fields.length > 0 || canonical.unreadable) this.touch();
    }
    const verdict = decide({
      party,
      method: canonical.method,
      hasBody: body.present,
      unreadable: canonical.unreadable,
      truncated: canonical.truncated,
      opaqueBody: canonical.request.bodyKind === "opaque",
      urlCredentials: canonical.urlCredentials,
      carriesContact: canonical.scan.contact,
      carriesLookup: canonical.scan.lookup,
      touched: this.touched,
      challengeHost: isChallengeHost(url),
    });
    if (this.closing) {
      if (verdict.action === "send" || verdict.action === "refuse") {
        desk.log({ kind: "refused", request: canonical.request, reason: "after_run" });
      }
      await this.failRequest(session, event);
      return;
    }
    if (canonical.refererCarries.length > 0) {
      desk.log({
        kind: "guard_event",
        request: {
          note: `The Referer of a request to ${describeRequest(canonical.request)} held ${canonical.refererCarries.map((field) => `{{${field}}}`).join(", ")} and was cut to the site address`,
        },
        reason: "referer_cut",
      });
    }
    if (this.continuesReleasedSend(event, canonical, party)) {
      await this.resume(session, event, headers);
      return;
    }
    switch (verdict.action) {
      case "continue":
        await this.resume(session, event, headers);
        return;
      case "lookup":
        desk.log({ kind: "lookup", request: canonical.request });
        await this.resume(session, event, headers);
        return;
      case "refuse":
        desk.log({ kind: "refused", request: canonical.request, reason: verdict.reason });
        this.options.note(this.refusalNote(verdict.reason, canonical));
        await this.failRequest(session, event);
        return;
      case "send":
        if (ctx.type !== "page" || event.resourceType === "Ping") {
          await this.refuseUnholdable(session, event, canonical);
          return;
        }
        await this.send(session, event, canonical, { headers, cookies });
        return;
    }
  }

  /**
   * A request of a frame or a worker, or a beacon, may be sent by the browser the moment its
   * session detaches, which a page can cause by removing the frame, so holding it for a person
   * would not hold it.
   */
  private async refuseUnholdable(
    session: CdpChannel,
    event: PausedRequest,
    canonical: Canonical,
  ): Promise<void> {
    this.options.desk?.log({ kind: "refused", request: canonical.request, reason: "not_holdable" });
    this.options.note(
      `${describeRequest(canonical.request)} was refused, because it could not be held safely for your approval. A person has to finish this by hand.`,
    );
    await this.failRequest(session, event);
  }

  private refusalNote(reason: string, canonical: Canonical): string {
    const label = describeRequest(canonical.request);
    if (reason === "unreadable_body") {
      return `${label} could not be read, so it cannot be approved and was blocked. A person has to finish this by hand.`;
    }
    if (reason === "url_credentials") {
      return `${label} was blocked, because its address holds a username or password.`;
    }
    if (reason === "method_not_allowed") {
      return `${label} was blocked, because its method is not one a browser form or fetch uses.`;
    }
    return `A request to ${label} was blocked, because it is not to this site or it carries your details.`;
  }

  private targetOf(ctx: SessionContext, event: PausedRequest): TargetContext {
    const origin =
      (event.frameId === undefined ? undefined : ctx.origins.get(event.frameId)) ??
      ctx.fallbackOrigin;
    return {
      type: ctx.type,
      frameOrigin: origin,
      topLevel: ctx.type === "page" && event.frameId === ctx.mainFrameId,
    };
  }

  /** Null when the browser would not say which cookies it attaches, so they cannot be read. */
  private async cookiesFor(session: CdpChannel, url: string): Promise<Cookie[] | null> {
    try {
      const answer = (await this.ask(session, "Network.getCookies", { urls: [url] })) as {
        cookies: Cookie[];
      };
      return answer.cookies;
    } catch {
      return null;
    }
  }

  /**
   * A request that was already released is not asked about again. That is the hop of a redirect
   * that carries the same body to the target's sites (a 307 or 308 sends the approved body again),
   * and the same request met a second time by the session of the worker or frame that made it.
   */
  private continuesReleasedSend(
    event: PausedRequest,
    canonical: Canonical,
    party: "target" | "third",
  ): boolean {
    if (party !== "target" || event.networkId === undefined) return false;
    const earlier = this.releases.get(event.networkId);
    if (earlier === undefined || earlier.method !== canonical.method) return false;
    if (earlier.digest !== canonical.request.bodyDigest) return false;
    const redirectedWithBody = canonical.method !== "GET" && earlier.digest !== "";
    return redirectedWithBody || earlier.url === canonical.url;
  }

  private async send(
    session: CdpChannel,
    event: PausedRequest,
    canonical: Canonical,
    shown: { headers: { name: string; value: string }[] | null; cookies: Cookie[] | null },
  ): Promise<void> {
    const { desk } = this.options;
    if (desk === null) return;
    const outcome = await desk.decide(canonical.request);
    if (outcome.kind === "release") {
      const networkId = event.networkId ?? event.requestId;
      // The browser attaches its cookie jar when the request is continued, so a cookie the page set
      // while the request was held would leave with an approval given for the cookies that were shown.
      const unchanged = sameCookies(
        shown.cookies,
        await this.cookiesFor(session, event.request.url),
      );
      if (!unchanged) {
        desk.log({ kind: "refused", request: canonical.request, reason: "cookies_changed" });
        this.options.note(
          `${describeRequest(canonical.request)} was blocked, because the page changed its cookies after you saw the request. Ask again to review it.`,
        );
        await desk.withdrawn(outcome.heldId, outcome.releaseId).catch(() => undefined);
        await this.failRequest(session, event);
        return;
      }
      this.releases.set(networkId, {
        releaseId: outcome.releaseId,
        digest: canonical.request.bodyDigest,
        method: canonical.method,
        url: canonical.url,
      });
      const letGo = await this.resume(session, event, shown.headers);
      if (!letGo) {
        await desk.withdrawn(outcome.heldId, outcome.releaseId).catch(() => undefined);
        this.releases.delete(networkId);
      }
      return;
    }
    await this.failRequest(session, event);
    if (outcome.kind === "refuse") {
      this.options.note(outcome.note);
      return;
    }
    this.lapsed.push(outcome.note);
    this.options.note(outcome.note);
  }

  private onResponse(event: ResponseReceived): void {
    if (["Document", "XHR", "Fetch"].includes(event.type ?? "")) {
      this.responses.set(event.requestId, {
        url: event.response.url,
        type: event.response.mimeType,
      });
    }
    const release = this.releases.get(event.requestId);
    if (release)
      this.options.desk?.reportResult(release.releaseId, { status: event.response.status });
  }

  private onFailed(event: { requestId: string; errorText: string }): void {
    const release = this.releases.get(event.requestId);
    if (release) {
      this.options.desk?.reportResult(release.releaseId, { status: null, error: event.errorText });
    }
  }

  /** Remembers the fields a target's page or API answer holds, which are expected to change. */
  private async readServed(session: CdpChannel, requestId: string): Promise<void> {
    const meta = this.responses.get(requestId);
    if (meta === undefined || !withinSites(meta.url, this.options.policy)) return;
    const answer = (await session.send("Network.getResponseBody", { requestId })) as {
      body: string;
      base64Encoded: boolean;
    };
    if (answer.base64Encoded || answer.body.length > MAX_BODY_BYTES) return;
    this.served.record(answer.body, meta.type);
  }

  /**
   * The page tried to open a live connection. A stub that caught it threw before anything left the
   * browser, so only a connection the stub did not catch is logged as unguarded.
   */
  private onWebSocket(caught: boolean): void {
    const afterTouch = this.touched;
    this.channel ??= new UnguardedChannel("live connection", afterTouch);
    this.options.desk?.log({
      kind: "guard_event",
      request: { note: "The page opened a WebSocket, which is blocked" },
      reason: afterTouch && !caught ? "unguarded:websocket" : "websocket",
    });
  }

  /** The page asked for a keepalive request, which was made an ordinary one that the gate can hold. */
  private onKeepalive(): void {
    this.options.desk?.log({
      kind: "guard_event",
      request: {
        note: "The page asked for a request that outlives it (keepalive), which was made an ordinary request",
      },
      reason: "keepalive",
    });
  }

  private recordProblem(reason: string, info: TargetInfo | undefined): void {
    this.options.desk?.log({
      kind: "guard_event",
      request: { note: `A ${info?.type || "target"} could not be checked and was held back` },
      reason: this.touched ? `unguarded:${reason}` : reason,
    });
  }

  /**
   * Waits until every request that was paused has been decided, and none is still on its way. A
   * request a click starts reaches the gate a moment later, so the wait covers a quiet stretch too.
   */
  async settled(): Promise<void> {
    const { desk } = this.options;
    if (desk === null) return;
    for (let round = 0; round < MAX_QUIET_ROUNDS; round++) {
      await desk.settled();
      const before = this.activity;
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
      if (this.activity === before && desk.waiting === 0) break;
    }
    await desk.flush();
    if (this.channel !== null) throw this.channel;
    if (this.lapsed.length > 0) throw new ApprovalLapsed(this.lapsed.slice());
  }

  /**
   * A picture of the page for a person deciding about a held send. It goes through DevTools
   * directly, because the page's own screenshot call waits for the navigation a held form post
   * has started, and that one waits for the person. The whole page is tried first, then the area
   * the run acted on, and each is made smaller until it fits.
   */
  async capture(
    limit: number,
    acted: Box | null,
    size: { width: number; height: number } | null,
  ): Promise<TaskScreenshot | undefined> {
    const cdp = this.cdp;
    if (cdp === null) return undefined;
    // Asking the page how large it is waits for the navigation the held send started, so the
    // size is the one the run last read, before it acted.
    const whole: Box = { x: 0, y: 0, ...(size ?? { width: 1366, height: 850 }) };
    const attempts: { area: Box; scales: number[] }[] = [{ area: whole, scales: [1] }];
    attempts.push({ area: acted ?? whole, scales: [1, 0.5, 0.25] });
    for (const { area, scales } of attempts) {
      for (const scale of scales) {
        for (const format of ["png", "jpeg"] as const) {
          const { data } = (await cdp.send("Page.captureScreenshot", {
            format,
            ...(format === "jpeg" ? { quality: 55 } : {}),
            captureBeyondViewport: true,
            clip: { ...area, scale },
          })) as { data: string };
          const bytes = Buffer.from(data, "base64");
          if (bytes.length > 0 && bytes.length <= limit) {
            return { mime: format === "png" ? "image/png" : "image/jpeg", dataBase64: data };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Ends the run's browser. The page is sent to a blank document with the gate still on, so a
   * pagehide handler or a beacon finds it, and only then is the page closed and the gate detached.
   */
  async close(): Promise<void> {
    this.closing = true;
    this.options.desk?.stop();
    const { page, desk } = this.options;
    await this.refuseUnanswered();
    await page.goto("about:blank", { timeout: 5_000 }).catch(() => undefined);
    // What a page sends as it goes away reaches the gate a moment after it is gone, and the
    // browser lets go of whatever is still paused when the page closes.
    const deadline = Date.now() + CLOSE_WAIT_MS;
    for (let round = 0; round < MIN_CLOSE_ROUNDS || this.handling.size > 0; round++) {
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
      if (this.handling.size === 0) break;
      if (Date.now() >= deadline) {
        this.recordProblem("close", undefined);
        break;
      }
      await Promise.race([
        Promise.allSettled([...this.handling]),
        new Promise((resolve) => setTimeout(resolve, QUIET_MS)),
      ]);
    }
    await this.refuseUnanswered();
    await desk?.drain().catch(() => undefined);
    await this.refuseUnanswered();
    await page.close().catch(() => undefined);
    await this.cdp?.detach().catch(() => undefined);
    this.cdp = null;
  }
}
