import {
  type EgressPatch,
  type EgressSettings,
  ProxyUrl,
  type ScanningPatch,
  type ScanningSettings,
} from "@kickrocks/shared";

type ScanningKey = "minGapMinutes" | "dailyCapPerSite" | "hourlyCapTotal" | "reuseHours";

export interface ScanningField {
  key: ScanningKey;
  label: string;
  help: string;
  unit: string;
  min: number;
  max: number;
}

export const SCANNING_FIELDS: readonly ScanningField[] = [
  {
    key: "minGapMinutes",
    label: "Wait between visits to one site",
    help: "A random extra wait of up to half of this is added, so visits never fall on a clock.",
    unit: "minutes",
    min: 0,
    max: 1440,
  },
  {
    key: "dailyCapPerSite",
    label: "Visits to one site per day",
    help: "Scans, removals, and checks all count. Sister sites owned by one company share a count.",
    unit: "visits",
    min: 1,
    max: 100,
  },
  {
    key: "hourlyCapTotal",
    label: "Visits to all sites per hour",
    help: "Keeps a large campaign from looking like a burst from your home address.",
    unit: "visits",
    min: 1,
    max: 500,
  },
  {
    key: "reuseHours",
    label: "Reuse a finished search for",
    help: "A repeat search for the same person on the same site inside this time uses the earlier answer. Zero turns it off.",
    unit: "hours",
    min: 0,
    max: 336,
  },
];

export type ScanningDraft = Record<ScanningKey, string>;

export function scanningDraftOf(scanning: ScanningSettings): ScanningDraft {
  return {
    minGapMinutes: String(scanning.minGapMinutes),
    dailyCapPerSite: String(scanning.dailyCapPerSite),
    hourlyCapTotal: String(scanning.hourlyCapTotal),
    reuseHours: String(scanning.reuseHours),
  };
}

export interface ScanningCheck {
  errors: Partial<Record<ScanningKey, string>>;
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
