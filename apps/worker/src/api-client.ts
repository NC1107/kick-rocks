import {
  API_ROUTES,
  ApiError,
  type BrowserTaskKind,
  buildRoutePath,
  type ClaimedTask,
  type FailureKind,
  type RouteBodyInput,
  type RouteDef,
  type RouteResponse,
  type TaskBlockReport,
  type TaskFailureReport,
  type TaskHeartbeatResponse,
  type TaskSummary,
  type TaskUsage,
  type WorkerClaimer,
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

type JsonRoute = RouteDef & { response: NonNullable<RouteDef["response"]> };

interface CallInput<R extends RouteDef> {
  params?: Record<string, string>;
  body?: RouteBodyInput<R>;
}

interface WorkerApiClientOptions {
  serverUrl: string;
  token: string;
  workerId: string;
  /** Which kind of worker this is. The server counts the built-in one unless told otherwise. */
  claimer?: WorkerClaimer;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/** A typed client for every route under /api/worker, so a worker never builds a URL or reads raw JSON. */
export class WorkerApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WorkerApiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  heartbeat(
    status: Omit<WorkerHeartbeatBody, "workerId" | "claimer">,
  ): Promise<WorkerHeartbeatResponse> {
    return this.call(API_ROUTES.workerHeartbeat, {
      body: { workerId: this.options.workerId, ...this.claimer(), ...status },
    });
  }

  private claimer(): { claimer?: WorkerClaimer } {
    return this.options.claimer ? { claimer: this.options.claimer } : {};
  }

  /** Without `kinds` the server gives a worker the kinds a recipe can run, and never `agent`. */
  async claim(kinds?: readonly BrowserTaskKind[], leaseMs?: number): Promise<ClaimedTask | null> {
    const response = await this.call(API_ROUTES.workerClaim, {
      body: {
        workerId: this.options.workerId,
        ...this.claimer(),
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

  async complete(taskId: string, result: unknown, usage?: TaskUsage): Promise<TaskSummary> {
    const response = await this.call(API_ROUTES.workerTaskComplete, {
      params: { id: taskId },
      body: { workerId: this.options.workerId, result, ...(usage ? { usage } : {}) },
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
    const url = `${this.options.serverUrl}/api${buildRoutePath(route.path, input.params)}`;
    const response = await this.fetchImpl(url, {
      method: route.method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : null;
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
