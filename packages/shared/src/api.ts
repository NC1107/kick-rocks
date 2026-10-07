import { z } from "zod";
import { AuthState, ChangePasswordBody, LoginBody, Ok, SetupBody } from "./auth.js";
import { BrokerCategory, ContactMethod, Requirement, TargetPriority } from "./broker.js";
import { CampaignBody, CampaignCreated, CampaignPreview } from "./campaigns.js";
import { Dashboard } from "./dashboard.js";
import { Jurisdiction } from "./legal.js";
import {
  Mailbox,
  MailboxConnection,
  MailboxInput,
  MailboxTestResult,
  MailFolder,
  MessageSummary,
  ProviderPreset,
} from "./mail.js";
import {
  ProfileCreate,
  ProfileDetail,
  ProfilePatch,
  ProfileSummary,
  ReplaceIdentitiesBody,
} from "./profiles.js";
import { RecipeRecord, RecipeStatus } from "./recipe.js";
import {
  RequestAction,
  RequestChannel,
  RequestDetail,
  RequestListItem,
  RequestStatus,
} from "./requests.js";
import { MatchDecisionBody, MessageClassificationBody, ReviewQueue } from "./review.js";
import { Match, ScanStartBody, ScanStartResult, ScanSummary } from "./scans.js";
import { DataSourceInfo, SettingsPatch, SettingsView } from "./settings.js";
import { CompanyCategory, TargetDetail, TargetKind, TargetSummary } from "./targets.js";
import { SCREENSHOT_BODY_LIMIT_BYTES, SCREENSHOT_MIME_TYPES, TaskSummary } from "./tasks.js";
import {
  TaskBlockBody,
  TaskCompleteBody,
  TaskFailBody,
  TaskHeartbeatBody,
  TaskHeartbeatResponse,
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

export const ApiIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof ApiIssue>;

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

/** Whether a route must carry the {@link CSRF_HEADER} header, which a cross-site form cannot send. */
export function requiresCsrfHeader(route: Pick<RouteDef, "method" | "auth">): boolean {
  return route.method !== "GET" && route.auth !== "worker";
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

export const TargetsQuery = PageQuery.extend({
  kind: TargetKind.optional(),
  category: z.union([BrokerCategory, CompanyCategory]).optional(),
  contactMethod: ContactMethod.optional(),
  requirement: Requirement.optional(),
  priority: TargetPriority.optional(),
  q: z.string().trim().max(100).optional(),
});
export type TargetsQuery = z.infer<typeof TargetsQuery>;

export const TargetFacets = z.object({
  kind: Facet,
  category: Facet,
  contactMethod: Facet,
  requirement: Facet,
  priority: Facet,
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
export const RecipesQuery = z.object({ status: RecipeStatus.optional() });

export const API_ROUTES = {
  health: defineRoute({
    method: "GET",
    path: "/health",
    module: "core",
    auth: "none",
    response: z.object({
      ok: z.literal(true),
      version: z.string(),
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
    body: MailboxConnection,
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
    response: pageOf(TargetSummary),
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
    response: z.object({ task: TaskSummary }),
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
