import {
  API_ROUTES,
  type ListingDetail,
  type ScanPreferenceBody,
  type ScanStartBody,
} from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { Button, Checkbox, Dialog, type DialogProps, useToast } from "../../components/ui/index.js";
import { describeScanStart } from "../../lib/scan-start.js";

/** The answers a scan or a preference changes, so every view of a site stays in step. */
export const LISTING_INVALIDATES = [
  API_ROUTES.listingsList,
  API_ROUTES.listingsGet,
  API_ROUTES.scansList,
  API_ROUTES.reviewQueue,
  API_ROUTES.dashboardGet,
] as const;

/** How many addresses the profile no longer lives at, which "include past addresses" adds. */
export function usePastAddressCount(profileId: string): number {
  const profile = useApiQuery(API_ROUTES.profilesGet, { params: { id: profileId } });
  const today = new Date().toISOString().slice(0, 10);
  return (
    profile.data?.identities.filter(
      (identity) =>
        identity.kind === "address" && identity.validTo !== null && identity.validTo < today,
    ).length ?? 0
  );
}

type Selection = ScanStartBody extends infer Body
  ? Body extends unknown
    ? Omit<Body, "addresses">
    : never
  : never;

interface ScanDialogProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  selection: Selection;
  title: DialogProps["title"];
  /** Sites in the scan, to say how many visits it makes. */
  siteCount?: number | undefined;
  /** The site's own "include past addresses" choice, which a single-site scan follows. */
  sitePreference?: boolean | undefined;
  confirmLabel?: string;
  onStarted?: () => void;
}

/**
 * The one confirmation before scans start, wherever they start from. It says what a scan costs in
 * visits, because past addresses are separate searches and the sites are visited slowly.
 */
export function ScanDialog({
  open,
  onClose,
  profileId,
  selection,
  title,
  siteCount,
  sitePreference,
  confirmLabel = "Start scans",
  onStarted,
}: ScanDialogProps) {
  const toast = useToast();
  const past = usePastAddressCount(profileId);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const includePast = chosen ?? sitePreference ?? false;
  const dashboard = useApiQuery(API_ROUTES.dashboardGet, { params: { id: profileId } });

  const start = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [...LISTING_INVALIDATES],
    onSuccess: (result) => {
      onClose();
      const summary = describeScanStart(result.items, profileId, dashboard.data?.scanning);
      toast.toast({
        intent: summary.intent,
        title: summary.title,
        description: summary.description,
        action: summary.action,
      });
      onStarted?.();
    },
  });

  const visits = includePast ? 1 + past : 1;
  const per = siteCount === 1 ? "the site" : "each site";
  const cost =
    visits === 1
      ? `Searches ${per} once, slowly; nothing is removed before you confirm.`
      : `Searches ${per} ${visits} times, slowly; nothing is removed before you confirm.`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={cost}
      dismissible={!start.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={start.isPending}
            onClick={() =>
              start.mutate({
                params: { id: profileId },
                // Leaving addresses out lets each site's own setting decide.
                body: {
                  ...selection,
                  ...(chosen === null ? {} : { addresses: chosen ? "all" : "current" }),
                } as ScanStartBody,
              })
            }
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {past > 0 ? (
          <Checkbox
            label="Include past addresses"
            description={`${past === 1 ? "1 past address" : `${past} past addresses`}, each a separate search.`}
            checked={includePast}
            onChange={(event) => setChosen(event.target.checked)}
          />
        ) : null}
        {start.isError ? (
          <p role="alert" className="text-caption text-danger-text">
            {errorMessage(start.error)}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Changes what the person chose about one site, and refreshes everything that shows it. */
export function useSitePreference(profileId: string, targetId: string) {
  const mutation = useApiMutation(API_ROUTES.listingsPreference, {
    invalidates: [...LISTING_INVALIDATES],
  });
  return {
    pending: mutation.isPending,
    error: mutation.isError ? errorMessage(mutation.error) : undefined,
    set: (body: ScanPreferenceBody, then?: (detail: ListingDetail) => void) =>
      mutation.mutate(
        { params: { id: profileId, targetId }, body },
        then ? { onSuccess: then } : {},
      ),
  };
}
