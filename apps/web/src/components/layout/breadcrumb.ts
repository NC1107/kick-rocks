export interface Crumb {
  label: string;
  /** Present on every crumb but the last, which is the page itself. */
  to?: string;
  /** References and identifiers read as data, so they are set in mono. */
  mono?: boolean;
}

const SETTINGS_PAGES: Record<string, string> = {
  recipes: "Recipes",
  agents: "Agents",
  notifications: "Notifications",
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
      return [{ label: "Dashboard" }];
    case "review":
      return [{ label: "Review" }];
    case "about":
      return [{ label: "About" }];
    case "dev":
      return [{ label: "Component gallery" }];
    case "requests":
      return second
        ? [{ label: "Requests", to: "/requests" }, leaf("Request")]
        : [{ label: "Requests" }];
    case "targets":
      return second
        ? [{ label: "Targets", to: "/targets" }, leaf("Target")]
        : [{ label: "Targets" }];
    case "campaigns":
      return [{ label: "Requests", to: "/requests" }, { label: "New campaign" }];
    case "profiles":
      if (!second) return [{ label: "Profiles" }];
      if (second === "new") return [{ label: "Profiles", to: "/profiles" }, { label: "New" }];
      if (third === "mailbox") {
        return [
          { label: "Profiles", to: "/profiles" },
          tail
            ? { ...tail, to: `/profiles/${second}` }
            : { label: "Profile", to: `/profiles/${second}` },
          { label: "Mailbox" },
        ];
      }
      return [{ label: "Profiles", to: "/profiles" }, leaf("Profile")];
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
