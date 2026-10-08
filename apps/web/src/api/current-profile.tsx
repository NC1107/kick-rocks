import { API_ROUTES, type ProfileSummary } from "@kickrocks/shared";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "../lib/storage.js";
import type { ApiRequestError } from "./errors.js";
import { useApiQuery } from "./hooks.js";

interface CurrentProfileState {
  /** The profile every profile-scoped page works on; null while loading or when none exist. */
  profile: ProfileSummary | null;
  profiles: readonly ProfileSummary[];
  isLoading: boolean;
  error: ApiRequestError | null;
  /** Switches the profile and remembers the choice in this browser. */
  setProfileId: (id: string) => void;
}

const CurrentProfileContext = createContext<CurrentProfileState | null>(null);

/**
 * Keeps the current profile id in localStorage. When the stored id no longer exists, such as after
 * a profile is deleted, the first profile takes over rather than leaving pages with nothing.
 */
export function CurrentProfileProvider({ children }: { children: ReactNode }) {
  const query = useApiQuery(API_ROUTES.profilesList);
  const [storedId, setStoredId] = useState<string | null>(() =>
    readStorage(STORAGE_KEYS.profileId),
  );

  const setProfileId = useCallback((id: string) => {
    setStoredId(id);
    writeStorage(STORAGE_KEYS.profileId, id);
  }, []);

  const value = useMemo<CurrentProfileState>(() => {
    const profiles = query.data?.profiles ?? [];
    const profile = profiles.find((item) => item.id === storedId) ?? profiles[0] ?? null;
    return {
      profile,
      profiles,
      isLoading: query.isPending,
      error: query.error,
      setProfileId,
    };
  }, [query.data, query.isPending, query.error, storedId, setProfileId]);

  return <CurrentProfileContext value={value}>{children}</CurrentProfileContext>;
}

export function useCurrentProfile(): CurrentProfileState {
  const value = useContext(CurrentProfileContext);
  if (!value) throw new Error("useCurrentProfile needs the app layout above it");
  return value;
}
