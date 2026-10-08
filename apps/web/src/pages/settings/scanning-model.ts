import {
  type EgressPatch,
  type EgressSettings,
  isValidTimeZone,
  ProxyUrl,
  type ScanningPatch,
  type ScanningSettings,
} from "@kickrocks/shared";

type ScanningKey =
  | "minGapMinutes"
  | "dailyCapPerSite"
  | "hourlyCapTotal"
  | "dailyCapTotal"
  | "quietStartHour"
  | "quietEndHour"
  | "reuseHours";

export interface ScanningField {
  key: ScanningKey;
  /** Five words or fewer; the unit goes in the suffix, not here. */
  label: string;
  /** Only where the label alone leaves the value ambiguous, as one clause. */
  help?: string;
  unit: string;
  min: number;
  max: number;
}

export const SCANNING_FIELDS: readonly ScanningField[] = [
  { key: "minGapMinutes", label: "Wait between site visits", unit: "min", min: 0, max: 1440 },
  { key: "dailyCapPerSite", label: "Daily visits per site", unit: "visits", min: 1, max: 100 },
  { key: "hourlyCapTotal", label: "Hourly visits, all sites", unit: "visits", min: 1, max: 500 },
  { key: "dailyCapTotal", label: "Daily visits, all sites", unit: "visits", min: 1, max: 2000 },
  {
    key: "quietStartHour",
    label: "Quiet hours begin",
    help: "The same hour for both turns quiet hours off",
    unit: "h",
    min: 0,
    max: 23,
  },
  { key: "quietEndHour", label: "Quiet hours end", unit: "h", min: 0, max: 23 },
  {
    key: "reuseHours",
    label: "Reuse a finished search for",
    help: "0 turns reuse off",
    unit: "h",
    min: 0,
    max: 336,
  },
];

export type ScanningDraft = Record<ScanningKey, string> & { timeZone: string };

/** The zone this browser reports, which is the person's own when they have not chosen one. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

export const TIME_ZONE_LABEL = "Quiet hours time zone";
export const TIME_ZONE_HELP = "A name such as America/Los_Angeles";

export const PROXY_LABEL = "Send visits through a proxy";
export const PROXY_HELP = "An http:// address with no user name or password";

export const PROXY_SITES_LABEL = "Only for these sites";
export const PROXY_SITES_HELP = "One per line; empty covers every site";

export function scanningDraftOf(
  scanning: ScanningSettings,
  fallbackZone: string = browserTimeZone(),
): ScanningDraft {
  return {
    timeZone: scanning.timeZone ?? fallbackZone,
    minGapMinutes: String(scanning.minGapMinutes),
    dailyCapPerSite: String(scanning.dailyCapPerSite),
    hourlyCapTotal: String(scanning.hourlyCapTotal),
    dailyCapTotal: String(scanning.dailyCapTotal),
    quietStartHour: String(scanning.quietStartHour),
    quietEndHour: String(scanning.quietEndHour),
    reuseHours: String(scanning.reuseHours),
  };
}

export interface ScanningCheck {
  errors: Partial<Record<ScanningKey | "timeZone", string>>;
  /** Only the fields that differ from what is saved. */
  patch: ScanningPatch;
}

export function checkScanning(draft: ScanningDraft, saved: ScanningSettings): ScanningCheck {
  const errors: ScanningCheck["errors"] = {};
  const patch: ScanningPatch = {};
  for (const field of SCANNING_FIELDS) {
    const text = draft[field.key].trim();
    const value = Number(text);
    if (text === "" || !Number.isInteger(value)) {
      errors[field.key] = "Enter a whole number.";
    } else if (value < field.min || value > field.max) {
      errors[field.key] = `Enter ${field.min} to ${field.max}.`;
    } else if (value !== saved[field.key]) {
      patch[field.key] = value;
    }
  }
  const zone = draft.timeZone.trim();
  if (zone === "" || !isValidTimeZone(zone)) {
    errors.timeZone = "Use a time zone name such as America/Los_Angeles.";
  } else if (zone !== saved.timeZone) {
    patch.timeZone = zone;
  }
  return { errors, patch };
}

export interface EgressDraft {
  proxyUrl: string;
  /** One site per line or separated by commas. */
  domains: string;
}

export function egressDraftOf(egress: EgressSettings): EgressDraft {
  return { proxyUrl: egress.proxyUrl ?? "", domains: egress.domains.join("\n") };
}

function domainsOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export interface EgressCheck {
  errors: Partial<Record<keyof EgressDraft, string>>;
  patch: EgressPatch;
}

export function checkEgress(draft: EgressDraft, saved: EgressSettings): EgressCheck {
  const errors: EgressCheck["errors"] = {};
  const patch: EgressPatch = {};
  const proxy = draft.proxyUrl.trim();
  if (proxy === "") {
    if (saved.proxyUrl !== null) patch.proxyUrl = null;
  } else if (!ProxyUrl.safeParse(proxy).success) {
    errors.proxyUrl = "Use an http:// address without a user name or password.";
  } else if (proxy !== saved.proxyUrl) {
    patch.proxyUrl = proxy;
  }
  const domains = domainsOf(draft.domains);
  const bad = domains.find((domain) => !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(domain));
  if (bad !== undefined) errors.domains = `"${bad}" is not a site name such as spokeo.com.`;
  else if (domains.join(",") !== saved.domains.join(",")) patch.domains = domains;
  return { errors, patch };
}
