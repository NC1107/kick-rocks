export interface Crumb {
  label: string;
  /** Present on every crumb but the last, which is the page itself. */
  to?: string;
  /** References and identifiers read as data, so they are set in mono. */
  mono?: boolean;
}

const PROFILES_LIST = "/settings/profiles";

const SETTINGS_PAGES: Record<string, string> = {
  advanced: "Advanced",
  recipes: "Recipes",
  agents: "Agents",
  notifications: "Notifications",
  profiles: "Profiles",
  about: "About",
};

const REVIEW_PAGES: Record<string, string> = {
  mail: "Mail",
  agents: "Agents",
  problems: "Problems",
  scans: "Scans",
};

/**
 * Where the current path sits in the app, as a trail. A detail page's own name is not known from
 * the path, so `tail` replaces its generic noun once the page has loaded it.
 */
export function breadcrumbTrail(pathname: string, tail?: Crumb): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  const [area, second, third] = parts;
  const leaf = (fallback: string): Crumb => tail ?? { label: fallback };

  switch (area) {
    case undefined:
      return [{ label: "Home" }];
    case "review": {
      const page = second ? REVIEW_PAGES[second] : undefined;
      return page ? [{ label: "Inbox", to: "/review" }, { label: page }] : [{ label: "Inbox" }];
    }
    case "findings":
      return [{ label: "Findings" }];
    case "dev":
      return [{ label: "Component gallery" }];
    case "requests":
      return second
        ? [{ label: "Removals", to: "/requests" }, leaf("Request")]
        : [{ label: "Removals" }];
    case "targets":
      if (second && third === "remove") {
        return [
          { label: "Sites", to: "/targets" },
          tail
            ? { ...tail, to: `/targets/${second}` }
            : { label: "Site", to: `/targets/${second}` },
          { label: "Remove my data" },
        ];
      }
      return second ? [{ label: "Sites", to: "/targets" }, leaf("Site")] : [{ label: "Sites" }];
    case "campaigns":
      return [{ label: "Removals", to: "/requests" }, { label: "Send requests" }];
    case "profiles":
      if (!second) return [{ label: "Settings", to: "/settings" }, { label: "Profiles" }];
      if (second === "new") return [{ label: "Profiles", to: PROFILES_LIST }, { label: "New" }];
      if (third === "mailbox") {
        return [
          { label: "Profiles", to: PROFILES_LIST },
          tail
            ? { ...tail, to: `/profiles/${second}` }
            : { label: "Profile", to: `/profiles/${second}` },
          { label: "Mailbox" },
        ];
      }
      return [{ label: "Profiles", to: PROFILES_LIST }, leaf("Profile")];
    case "settings": {
      const page = second ? SETTINGS_PAGES[second] : undefined;
      return page
        ? [{ label: "Settings", to: "/settings" }, { label: page }]
        : [{ label: "Settings" }];
    }
    default:
      return [{ label: "Not found" }];
  }
}
