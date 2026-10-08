import { API_ROUTES, type ProfileDetail, profileExportFileName } from "@kickrocks/shared";
import { useMutation } from "@tanstack/react-query";
import { callRoute, errorMessage } from "../../../api/index.js";
import { Button, Callout, RowGroup, Section, useToast } from "../../../components/ui/index.js";
import { downloadTextFile } from "../../../lib/download.js";
import { ActionRow } from "../../settings/rows.js";

/** The file is built in the browser from the JSON the API returns, so the download needs no second route. */
export function DataCard({ profile }: { profile: ProfileDetail }) {
  const toast = useToast();
  const exportFile = useMutation({
    mutationFn: () => callRoute(API_ROUTES.profilesExport, { params: { id: profile.id } }),
    onSuccess: (file) => {
      downloadTextFile(
        profileExportFileName(file.profile.displayName, file.exportedAt),
        `${JSON.stringify(file, null, 2)}\n`,
      );
      toast.success("Export ready", "The file was saved to your downloads.");
    },
  });

  return (
    <Section label="Your data">
      <RowGroup>
        <ActionRow
          title="Export profile data"
          description="One JSON file: identities, requests, scans, and matches. No mailbox password or reply text."
        >
          <Button onClick={() => exportFile.mutate()} loading={exportFile.isPending}>
            Export profile data
          </Button>
        </ActionRow>
      </RowGroup>
      {exportFile.error ? (
        <Callout intent="danger" title="Could not export" className="mt-3">
          {errorMessage(exportFile.error)}
        </Callout>
      ) : null}
    </Section>
  );
}
