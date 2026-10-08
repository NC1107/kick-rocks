import { z } from "zod";
import { AuthState, ChangePasswordBody, LoginBody, Ok, SetupBody } from "./auth.js";
import { CampaignBody, CampaignCreated, CampaignPreview } from "./campaigns.js";
import { Dashboard } from "./dashboard.js";
import { ProfileExport, ResetBody } from "./data-rights.js";
import { Jurisdiction } from "./legal.js";
import {
  Mailbox,
  MailboxInput,
  MailboxTestBody,
  MailboxTestResult,
  MailFolder,
  MessageDetail,
  MessageSummary,
  ProviderPreset,
} from "./mail.js";
import {
  DigestSendResult,
  NotificationsPatch,
  NotificationsView,
  NotificationTestBody,
  NotificationTestResult,
} from "./notifications.js";
import {
  ProfileCreate,
  ProfileDetail,
  ProfilePatch,
  ProfileSummary,
  ReplaceIdentitiesBody,
} from "./profiles.js";
import { RecipeRecord, RecipeSource, RecipeStatus } from "./recipe.js";
import {
  RequestAction,
  RequestChannel,
  RequestDetail,
  RequestListItem,
  RequestStatus,
  VerificationReplyBody,
} from "./requests.js";
import { MatchDecisionBody, MessageClassificationBody, ReviewQueue } from "./review.js";
import { SitesStatus, TargetSite } from "./scanning.js";
import { Match, ScanStartBody, ScanStartResult, ScanSummary } from "./scans.js";
import { DataSourceInfo, SettingsPatch, SettingsView } from "./settings.js";
import { TargetDetail, TargetFilter, TargetListItem } from "./targets.js";
import {
  SCREENSHOT_BODY_LIMIT_BYTES,
  SCREENSHOT_MIME_TYPES,
  TaskMarkDoneBody,
  TaskSummary,
} from "./tasks.js";
import {
  GateResultBody,
  GateResultResponse,
  TaskBlockBody,
  TaskCompleteBody,
  TaskFailBody,
  TaskHeartbeatBody,
  TaskHeartbeatResponse,
  TaskReleaseBody,
  TaskTransitionResponse,
  WorkerClaimBody,
  WorkerClaimResponse,
  WorkerHeartbeatBody,
  WorkerHeartbeatResponse,
} from "./worker.js";

/** Standard error codes. A module may add its own, always in lower snake case. */
export const API_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "not_implemented",
  "internal_error",
] as const;

/**
 * One validation problem. `path` starts with where the value was read from, `body`, `query`, or
 * `params`, followed by the path inside it, such as `["body", "identities", 0, "value", "address"]`.
 * The server and the mock API both build it with {@link toApiIssues}, and the web client's
 * `fieldErrors` drops a leading `body` so a form can key errors by its own field names.
 */
export const ApiIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof ApiIssue>;

export type IssueLocation = "body" | "query" | "params";

/** The one way a schema failure becomes the issues of an error response. */
export function toApiIssues(error: z.ZodError, location: IssueLocation): ApiIssue[] {
  return error.issues.map((issue) => ({
    path: [location, ...issue.path.filter((p): p is string | number => typeof p !== "symbol")],
    message: issue.message,
  }));
}

/** The body of every non-2xx response under /api. */
export const ApiError = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(ApiIssue).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const PAGE_SIZE = { default: 50, max: 200 } as const;

/** Query parameters shared by every paginated list. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE.max).default(PAGE_SIZE.default),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A query value written as `a,b,c`, split and validated against an enum. */
function csv<T extends z.ZodType<string, string>>(item: T) {
  return z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(item));
}

export const CSRF_HEADER = "x-kick-rocks";
export const CSRF_HEADER_VALUE = "1";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ApiModule =
  | "auth"
  | "profiles"
  | "settings"
  | "notifications"
  | "mailbox"
  | "targets"
  | "campaigns"
  | "requests"
  | "dashboard"
  | "scans"
  | "review"
  | "worker-api"
  | "recipes"
  | "core";

/** `none` routes do their own checking; `session` needs the cookie; `worker` needs the bearer token. */
export type RouteAuth = "none" | "session" | "worker";

export interface RouteDef {
  readonly method: HttpMethod;
  /** Relative to /api, with `:name` parameters. */
  readonly path: string;
  readonly module: ApiModule;
  readonly auth: RouteAuth;
  readonly status?: 200 | 201;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response?: z.ZodType;
  /** Content types of a binary response, used instead of `response`. */
  readonly binary?: readonly string[];
  /** Largest request body in bytes, for a route that must accept more than the server default. */
  readonly bodyLimit?: number;
}

function defineRoute<const D extends RouteDef>(definition: D): D {
  return definition;
}

type Output<S> = S extends z.ZodType ? z.output<S> : undefined;
type Input<S> = S extends z.ZodType ? z.input<S> : undefined;

export type RouteParams<R extends RouteDef> = Output<R["params"]>;
export type RouteQuery<R extends RouteDef> = Output<R["query"]>;
export type RouteBody<R extends RouteDef> = Output<R["body"]>;
export type RouteResponse<R extends RouteDef> = Output<R["response"]>;
/** What a client may send, before defaults are applied. */
export type RouteQueryInput<R extends RouteDef> = Input<R["query"]>;
export type RouteBodyInput<R extends RouteDef> = Input<R["body"]>;

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request must carry the {@link CSRF_HEADER} header, which a cross-site form cannot
 * send. Every method that changes state needs it, the auth routes included; a worker call
 * authenticates with a bearer token a browser never attaches by itself, so it does not.
 */
export function requiresCsrfHeader(route: { method: string; auth: RouteAuth | "mcp" }): boolean {
  return (
    !SAFE_METHODS.has(route.method.toUpperCase()) && route.auth !== "worker" && route.auth !== "mcp"
  );
}

/** Fills `:name` parameters, encoding each value. Throws when one is missing. */
export function buildRoutePath(
  path: string,
  params: Readonly<Record<string, string>> = {},
): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_whole, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

const IdParam = z.object({ id: z.string().min(1) });
const Count = z.number().int().nonnegative();
const Facet = z.array(z.object({ value: z.string(), count: Count }));

export const TargetsQuery = PageQuery.extend(TargetFilter.shape);
export type TargetsQuery = z.infer<typeof TargetsQuery>;

export const TargetFacets = z.object({
  kind: Facet,
  category: Facet,
  contactMethod: Facet,
  requirement: Facet,
  priority: Facet,
  difficulty: Facet,
});
export type TargetFacets = z.infer<typeof TargetFacets>;

export const RequestsQuery = PageQuery.extend({
  status: csv(RequestStatus).optional(),
  channel: RequestChannel.optional(),
  targetId: z.string().min(1).optional(),
  q: z.string().trim().max(100).optional(),
});
export type RequestsQuery = z.infer<typeof RequestsQuery>;

export const ScansQuery = PageQuery;
export const ReviewQuery = z.object({ profileId: z.string().min(1).optional() });
export const RecipesQuery = z.object({
  status: RecipeStatus.optional(),
  /** Bundled recipes the app ships, recipes an agent proposed, or recipes the person installed. */
  source: RecipeSource.optional(),
});

export const API_ROUTES = {
  /** Open to anyone, so it says only that the server is up. */
  health: defineRoute({
    method: "GET",
    path: "/health",
    module: "core",
    auth: "none",
    response: z.object({ ok: z.literal(true), version: z.string() }),
  }),
  /** What the instance holds, behind the session because it reveals who uses it. */
  status: defineRoute({
    method: "GET",
    path: "/status",
    module: "core",
    auth: "session",
    response: z.object({
      profiles: Count,
      brokers: z.object({
        available: z.boolean(),
        total: Count,
        generatedAt: z.string().optional(),
      }),
      targets: z.object({ brokers: Count, companies: Count }),
    }),
  }),

  authState: defineRoute({
    method: "GET",
    path: "/auth/state",
    module: "auth",
    auth: "none",
    response: AuthState,
  }),
  authSetup: defineRoute({
    method: "POST",
    path: "/auth/setup",
    module: "auth",
    auth: "none",
    body: SetupBody,
    response: Ok,
  }),
  authLogin: defineRoute({
    method: "POST",
    path: "/auth/login",
    module: "auth",
    auth: "none",
    body: LoginBody,
    response: Ok,
  }),
  authLogout: defineRoute({
    method: "POST",
    path: "/auth/logout",
    module: "auth",
    auth: "none",
    response: Ok,
  }),
  authPassword: defineRoute({
    method: "POST",
    path: "/auth/password",
    module: "auth",
    auth: "session",
    body: ChangePasswordBody,
    response: Ok,
  }),

  profilesList: defineRoute({
    method: "GET",
    path: "/profiles",
    module: "profiles",
    auth: "session",
    response: z.object({ profiles: z.array(ProfileSummary) }),
  }),
  profilesCreate: defineRoute({
    method: "POST",
    path: "/profiles",
    module: "profiles",
    auth: "session",
    status: 201,
    body: ProfileCreate,
    response: ProfileDetail,
  }),
  profilesGet: defineRoute({
    method: "GET",
    path: "/profiles/:id",
    module: "profiles",
    auth: "session",
    params: IdParam,
    response: ProfileDetail,
  }),
  profilesUpdate: defineRoute({
    method: "PATCH",
    path: "/profiles/:id",
    module: "profiles",
    auth: "session",
    params: IdParam,
    body: ProfilePatch,
    response: ProfileDetail,
  }),
  profilesDelete: defineRoute({
    method: "DELETE",
    path: "/profiles/:id",
    module: "profiles",
    auth: "session",
    params: IdParam,
    response: Ok,
  }),
  profilesExport: defineRoute({
    method: "GET",
    path: "/profiles/:id/export",
    module: "profiles",
    auth: "session",
    params: IdParam,
    response: ProfileExport,
  }),
  profilesReplaceIdentities: defineRoute({
    method: "PUT",
    path: "/profiles/:id/identities",
    module: "profiles",
    auth: "session",
    params: IdParam,
    body: ReplaceIdentitiesBody,
    response: ProfileDetail,
  }),

  mailProviders: defineRoute({
    method: "GET",
    path: "/mail/providers",
    module: "mailbox",
    auth: "session",
    response: z.object({ providers: z.array(ProviderPreset) }),
  }),
  mailboxTest: defineRoute({
    method: "POST",
    path: "/profiles/:id/mailbox/test",
    module: "mailbox",
    auth: "session",
    params: IdParam,
    body: MailboxTestBody,
    response: MailboxTestResult,
  }),
  mailboxSave: defineRoute({
    method: "PUT",
    path: "/profiles/:id/mailbox",
    module: "mailbox",
    auth: "session",
    params: IdParam,
    body: MailboxInput,
    response: Mailbox,
  }),
  mailboxDelete: defineRoute({
    method: "DELETE",
    path: "/profiles/:id/mailbox",
    module: "mailbox",
    auth: "session",
    params: IdParam,
    response: Ok,
  }),
  mailboxPoll: defineRoute({
    method: "POST",
    path: "/profiles/:id/mailbox/poll",
    module: "mailbox",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary }),
  }),
  mailboxFolders: defineRoute({
    method: "GET",
    path: "/profiles/:id/mailbox/folders",
    module: "mailbox",
    auth: "session",
    params: IdParam,
    response: z.object({ folders: z.array(MailFolder) }),
  }),

  targetsList: defineRoute({
    method: "GET",
    path: "/targets",
    module: "targets",
    auth: "session",
    query: TargetsQuery,
    response: pageOf(TargetListItem),
  }),
  targetsFacets: defineRoute({
    method: "GET",
    path: "/targets/facets",
    module: "targets",
    auth: "session",
    response: TargetFacets,
  }),
  targetsGet: defineRoute({
    method: "GET",
    path: "/targets/:id",
    module: "targets",
    auth: "session",
    params: IdParam,
    response: TargetDetail,
  }),
  targetsSite: defineRoute({
    method: "GET",
    path: "/targets/:id/site",
    module: "targets",
    auth: "session",
    params: IdParam,
    response: TargetSite,
  }),

  campaignsPreview: defineRoute({
    method: "POST",
    path: "/profiles/:id/campaigns/preview",
    module: "campaigns",
    auth: "session",
    params: IdParam,
    body: CampaignBody,
    response: CampaignPreview,
  }),
  campaignsCreate: defineRoute({
    method: "POST",
    path: "/profiles/:id/campaigns",
    module: "campaigns",
    auth: "session",
    status: 201,
    params: IdParam,
    body: CampaignBody,
    response: CampaignCreated,
  }),

  requestsList: defineRoute({
    method: "GET",
    path: "/profiles/:id/requests",
    module: "requests",
    auth: "session",
    params: IdParam,
    query: RequestsQuery,
    response: pageOf(RequestListItem),
  }),
  requestsGet: defineRoute({
    method: "GET",
    path: "/requests/:id",
    module: "requests",
    auth: "session",
    params: IdParam,
    response: RequestDetail,
  }),
  requestsAct: defineRoute({
    method: "POST",
    path: "/requests/:id/actions",
    module: "requests",
    auth: "session",
    params: IdParam,
    body: z.object({ action: RequestAction }),
    response: RequestDetail,
  }),

  requestsVerification: defineRoute({
    method: "POST",
    path: "/requests/:id/verification",
    module: "requests",
    auth: "session",
    params: IdParam,
    body: VerificationReplyBody,
    response: RequestDetail,
  }),

  dashboardGet: defineRoute({
    method: "GET",
    path: "/profiles/:id/dashboard",
    module: "dashboard",
    auth: "session",
    params: IdParam,
    response: Dashboard,
  }),

  scansStart: defineRoute({
    method: "POST",
    path: "/profiles/:id/scans",
    module: "scans",
    auth: "session",
    status: 201,
    params: IdParam,
    body: ScanStartBody,
    response: ScanStartResult,
  }),
  scansList: defineRoute({
    method: "GET",
    path: "/profiles/:id/scans",
    module: "scans",
    auth: "session",
    params: IdParam,
    query: ScansQuery,
    response: pageOf(ScanSummary),
  }),

  reviewQueue: defineRoute({
    method: "GET",
    path: "/review",
    module: "review",
    auth: "session",
    query: ReviewQuery,
    response: ReviewQueue,
  }),
  taskResume: defineRoute({
    method: "POST",
    path: "/tasks/:id/resume",
    module: "review",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary }),
  }),
  taskApproveSubmit: defineRoute({
    method: "POST",
    path: "/tasks/:id/approve-submit",
    module: "review",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary }),
  }),
  taskCancel: defineRoute({
    method: "POST",
    path: "/tasks/:id/cancel",
    module: "review",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary }),
  }),
  taskMarkDone: defineRoute({
    method: "POST",
    path: "/tasks/:id/mark-done",
    module: "review",
    auth: "session",
    params: IdParam,
    body: TaskMarkDoneBody,
    response: z.object({ task: TaskSummary }),
  }),
  /** Takes a blocked scan, form, or agent task away from the built-in worker and gives it to an agent. */
  taskHandOff: defineRoute({
    method: "POST",
    path: "/tasks/:id/hand-off",
    module: "review",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary }),
  }),
  /** Dispatches the request of a task that failed for good again, which the queue never does itself. */
  taskRetry: defineRoute({
    method: "POST",
    path: "/tasks/:id/retry",
    module: "review",
    auth: "session",
    params: IdParam,
    response: z.object({ task: TaskSummary.nullable() }),
  }),
  taskScreenshot: defineRoute({
    method: "GET",
    path: "/tasks/:id/screenshot",
    module: "review",
    auth: "session",
    params: IdParam,
    binary: SCREENSHOT_MIME_TYPES,
  }),
  matchDecide: defineRoute({
    method: "POST",
    path: "/matches/:id/decision",
    module: "review",
    auth: "session",
    params: IdParam,
    body: MatchDecisionBody,
    response: Match,
  }),
  messageGet: defineRoute({
    method: "GET",
    path: "/messages/:id",
    module: "review",
    auth: "session",
    params: IdParam,
    response: MessageDetail,
  }),
  messageClassify: defineRoute({
    method: "POST",
    path: "/messages/:id/classification",
    module: "review",
    auth: "session",
    params: IdParam,
    body: MessageClassificationBody,
    response: MessageSummary,
  }),

  recipesList: defineRoute({
    method: "GET",
    path: "/recipes",
    module: "recipes",
    auth: "session",
    query: RecipesQuery,
    response: z.object({ recipes: z.array(RecipeRecord) }),
  }),
  recipesApprove: defineRoute({
    method: "POST",
    path: "/recipes/:id/approve",
    module: "recipes",
    auth: "session",
    params: IdParam,
    response: RecipeRecord,
  }),
  recipesReject: defineRoute({
    method: "POST",
    path: "/recipes/:id/reject",
    module: "recipes",
    auth: "session",
    params: IdParam,
    response: RecipeRecord,
  }),

  settingsGet: defineRoute({
    method: "GET",
    path: "/settings",
    module: "settings",
    auth: "session",
    response: SettingsView,
  }),
  settingsPatch: defineRoute({
    method: "PATCH",
    path: "/settings",
    module: "settings",
    auth: "session",
    body: SettingsPatch,
    response: SettingsView,
  }),
  settingsReset: defineRoute({
    method: "POST",
    path: "/settings/reset",
    module: "settings",
    auth: "session",
    body: ResetBody,
    response: Ok,
  }),
  notificationsGet: defineRoute({
    method: "GET",
    path: "/notifications",
    module: "notifications",
    auth: "session",
    response: NotificationsView,
  }),
  notificationsPatch: defineRoute({
    method: "PATCH",
    path: "/notifications",
    module: "notifications",
    auth: "session",
    body: NotificationsPatch,
    response: NotificationsView,
  }),
  /** Sends one test message through a saved channel. */
  notificationsTest: defineRoute({
    method: "POST",
    path: "/notifications/test",
    module: "notifications",
    auth: "session",
    body: NotificationTestBody,
    response: NotificationTestResult,
  }),
  /** Sends the digest now, covering the time since the last one. */
  notificationsDigestSend: defineRoute({
    method: "POST",
    path: "/notifications/digest/send",
    module: "notifications",
    auth: "session",
    response: DigestSendResult,
  }),

  settingsMcpToken: defineRoute({
    method: "POST",
    path: "/settings/mcp-token",
    module: "settings",
    auth: "session",
    /** The token is shown once; only its hash is stored. */
    response: z.object({ token: z.string() }),
  }),
  settingsJurisdictions: defineRoute({
    method: "GET",
    path: "/settings/jurisdictions",
    module: "settings",
    auth: "session",
    response: z.object({ jurisdictions: z.array(Jurisdiction) }),
  }),
  settingsDataSources: defineRoute({
    method: "GET",
    path: "/settings/data-sources",
    module: "settings",
    auth: "session",
    response: z.object({ sources: z.array(DataSourceInfo) }),
  }),

  settingsSites: defineRoute({
    method: "GET",
    path: "/settings/sites",
    module: "settings",
    auth: "session",
    response: SitesStatus,
  }),

  workerHeartbeat: defineRoute({
    method: "POST",
    path: "/worker/heartbeat",
    module: "worker-api",
    auth: "worker",
    body: WorkerHeartbeatBody,
    response: WorkerHeartbeatResponse,
  }),
  workerClaim: defineRoute({
    method: "POST",
    path: "/worker/claim",
    module: "worker-api",
    auth: "worker",
    body: WorkerClaimBody,
    response: WorkerClaimResponse,
  }),
  workerGateResult: defineRoute({
    method: "POST",
    path: "/worker/gate-results",
    module: "worker-api",
    auth: "worker",
    body: GateResultBody,
    response: GateResultResponse,
  }),
  workerTaskHeartbeat: defineRoute({
    method: "POST",
    path: "/worker/tasks/:id/heartbeat",
    module: "worker-api",
    auth: "worker",
    params: IdParam,
    body: TaskHeartbeatBody,
    response: TaskHeartbeatResponse,
  }),
  workerTaskComplete: defineRoute({
    method: "POST",
    path: "/worker/tasks/:id/complete",
    module: "worker-api",
    auth: "worker",
    params: IdParam,
    body: TaskCompleteBody,
    response: TaskTransitionResponse,
  }),
  workerTaskBlock: defineRoute({
    method: "POST",
    path: "/worker/tasks/:id/block",
    module: "worker-api",
    auth: "worker",
    bodyLimit: SCREENSHOT_BODY_LIMIT_BYTES,
    params: IdParam,
    body: TaskBlockBody,
    response: TaskTransitionResponse,
  }),
  workerTaskRelease: defineRoute({
    method: "POST",
    path: "/worker/tasks/:id/release",
    module: "worker-api",
    auth: "worker",
    params: IdParam,
    body: TaskReleaseBody,
    response: TaskTransitionResponse,
  }),
  workerTaskFail: defineRoute({
    method: "POST",
    path: "/worker/tasks/:id/fail",
    module: "worker-api",
    auth: "worker",
    params: IdParam,
    body: TaskFailBody,
    response: TaskTransitionResponse,
  }),
} as const;

export type ApiRouteName = keyof typeof API_ROUTES;

export function routesOfModule(module: ApiModule): RouteDef[] {
  return Object.values(API_ROUTES).filter((route) => route.module === module);
}
