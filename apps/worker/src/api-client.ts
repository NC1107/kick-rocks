import {
  API_ROUTES,
  ApiError,
  type BrowserTaskKind,
  buildRoutePath,
  type ClaimedTask,
  type FailureKind,
  type GateEvidence,
  type GateResultResponse,
  type ModelIdentity,
  type OutgoingRequest,
  type RegisteredSend,
  type RouteBodyInput,
  type RouteDef,
  type RouteResponse,
  type SendRegistration,
  type SiteObservation,
  type TaskBlockReport,
  type TaskFailureReport,
  type TaskHeartbeatResponse,
  type TaskSummary,
  type TaskUsage,
  type WorkerClaimer,
  type WorkerDecision,
  type WorkerHeartbeatBody,
  type WorkerHeartbeatResponse,
} from "@kickrocks/shared";

/** A non-2xx answer from the server, with the code and message from its error body. */
export class WorkerApiError extends Error {
  override name = "WorkerApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The server could not be reached, or something other than it answered, so nothing was judged. */
export class ServerUnreachableError extends Error {
  override name = "ServerUnreachableError";
}

type JsonRoute = RouteDef & { response: NonNullable<RouteDef["response"]> };

interface CallInput<R extends RouteDef> {
  params?: Record<string, string>;
  query?: Record<string, string | number>;
  body?: RouteBodyInput<R>;
  signal?: AbortSignal;
}

interface WorkerApiClientOptions {
  serverUrl: string;
  token: string;
  workerId: string;
  /** Which kind of worker this is. The server counts the built-in one unless told otherwise. */
  claimer?: WorkerClaimer;
  /** For a worker that drives a model: which one, asked again whenever the worker speaks. */
  model?: () => Promise<ModelIdentity>;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/** A typed client for every route under /api/worker, so a worker never builds a URL or reads raw JSON. */
export class WorkerApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WorkerApiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async heartbeat(
    status: Omit<WorkerHeartbeatBody, "workerId" | "claimer" | "model">,
  ): Promise<WorkerHeartbeatResponse> {
    return this.call(API_ROUTES.workerHeartbeat, {
      body: {
        workerId: this.options.workerId,
        ...this.claimer(),
        ...(await this.model()),
        ...status,
      },
    });
  }

  private claimer(): { claimer?: WorkerClaimer } {
    return this.options.claimer ? { claimer: this.options.claimer } : {};
  }

  private async model(): Promise<{ model?: ModelIdentity }> {
    return this.options.model ? { model: await this.options.model() } : {};
  }

  /** Sends what a benchmark run measured, and learns whether it was enough to clear the model. */
  gateResult(evidence: GateEvidence): Promise<GateResultResponse> {
    return this.call(API_ROUTES.workerGateResult, { body: evidence });
  }

  /** Without `kinds` the server gives a worker the kinds a recipe can run, and never `agent`. */
  async claim(kinds?: readonly BrowserTaskKind[], leaseMs?: number): Promise<ClaimedTask | null> {
    const response = await this.call(API_ROUTES.workerClaim, {
      body: {
        workerId: this.options.workerId,
        ...this.claimer(),
        ...(await this.model()),
        ...(kinds ? { kinds: [...kinds] } : {}),
        ...(leaseMs ? { leaseMs } : {}),
      },
    });
    return response.task;
  }

  /** `mayHaveSubmitted` tells the server a removal has clicked, so it is held for a person if the lease is lost. */
  taskHeartbeat(
    taskId: string,
    leaseMs?: number,
    mayHaveSubmitted?: boolean,
  ): Promise<TaskHeartbeatResponse> {
    return this.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: taskId },
      body: {
        workerId: this.options.workerId,
        ...(leaseMs ? { leaseMs } : {}),
        ...(mayHaveSubmitted ? { mayHaveSubmitted } : {}),
      },
    });
  }

  async complete(
    taskId: string,
    result: unknown,
    usage?: TaskUsage,
    site?: SiteObservation,
  ): Promise<TaskSummary> {
    const response = await this.call(API_ROUTES.workerTaskComplete, {
      params: { id: taskId },
      body: {
        workerId: this.options.workerId,
        result,
        ...(usage ? { usage } : {}),
        ...(site ? { site } : {}),
      },
    });
    return response.task;
  }

  /** Hands a task back unfinished, such as at shutdown, without costing it an attempt. */
  async release(taskId: string, retryAfterMs?: number): Promise<TaskSummary> {
    const response = await this.call(API_ROUTES.workerTaskRelease, {
      params: { id: taskId },
      body: {
        workerId: this.options.workerId,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
    });
    return response.task;
  }

  async block(taskId: string, report: TaskBlockReport): Promise<TaskSummary> {
    const response = await this.call(API_ROUTES.workerTaskBlock, {
      params: { id: taskId },
      body: { workerId: this.options.workerId, ...report },
    });
    return response.task;
  }

  /** Tells the server what the outgoing gate decided, and holds the requests that wait for a person. */
  async registerSends(
    taskId: string,
    attempt: number,
    items: SendRegistration[],
  ): Promise<RegisteredSend[]> {
    const response = await this.call(API_ROUTES.workerSends, {
      params: { id: taskId },
      body: { workerId: this.options.workerId, attempt, items },
    });
    return response.sends;
  }

  /** Waits up to `waitMs` for a person to decide a held request. */
  awaitDecision(
    taskId: string,
    sendId: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<WorkerDecision> {
    return this.call(API_ROUTES.workerSendDecision, {
      params: { id: taskId, sendId },
      query: { workerId: this.options.workerId, waitMs },
      ...(signal ? { signal } : {}),
    });
  }

  /** Rejects with a 409 `WorkerApiError` when the server does not accept the request as approved. */
  async releaseSend(
    taskId: string,
    sendId: string,
    request: OutgoingRequest,
  ): Promise<{ releaseId: string }> {
    const response = await this.call(API_ROUTES.workerSendRelease, {
      params: { id: taskId, sendId },
      body: { workerId: this.options.workerId, request },
    });
    return { releaseId: response.releaseId };
  }

  async sendResult(
    taskId: string,
    sendId: string,
    outcome: { status: number | null; error?: string | undefined },
  ): Promise<void> {
    await this.call(API_ROUTES.workerSendResult, {
      params: { id: taskId, sendId },
      body: {
        workerId: this.options.workerId,
        status: outcome.status,
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
      },
    });
  }

  /** A `recipe` failure is never retried by the server, whatever `retryable` says. */
  async fail(
    taskId: string,
    report: Omit<TaskFailureReport, "kind"> & { kind?: FailureKind },
  ): Promise<TaskSummary> {
    const response = await this.call(API_ROUTES.workerTaskFail, {
      params: { id: taskId },
      body: { workerId: this.options.workerId, ...report },
    });
    return response.task;
  }

  private async call<R extends JsonRoute>(
    route: R,
    input: CallInput<R> = {},
  ): Promise<RouteResponse<R>> {
    const search = input.query
      ? `?${new URLSearchParams(Object.fromEntries(Object.entries(input.query).map(([k, v]) => [k, String(v)])))}`
      : "";
    const url = `${this.options.serverUrl}/api${buildRoutePath(route.path, input.params)}${search}`;
    // Serialised here so a body that cannot be serialised is not mistaken for a network failure.
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    let payload: unknown;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: route.method,
        ...(input.signal ? { signal: input.signal } : {}),
        headers: {
          authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      });
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new ServerUnreachableError(`Could not reach the server: ${describeCause(error)}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const error = ApiError.safeParse(payload);
      throw new WorkerApiError(
        response.status,
        error.success ? error.data.error : "unknown_error",
        (error.success && error.data.message) || `Server answered ${response.status}`,
      );
    }
    return route.response.parse(payload) as RouteResponse<R>;
  }
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
