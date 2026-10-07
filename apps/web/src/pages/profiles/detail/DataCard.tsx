import { API_ROUTES, type ProfileDetail, profileExportFileName } from "@kickrocks/shared";
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { callRoute, errorMessage } from "../../../api/index.js";
import { Alert, Button, Card, CardHeader, useToast } from "../../../components/ui/index.js";
import { downloadTextFile } from "../../../lib/download.js";

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
    <Card>
      <CardHeader
        title="Export your data"
        description="Everything Kick Rocks holds about this profile as one JSON file: identities, requests with their timelines, reply details, scans, and matches. It leaves out your mailbox password and the text of replies."
      />
      {exportFile.error ? (
        <Alert intent="danger" title="Could not export" className="mb-3">
          {errorMessage(exportFile.error)}
        </Alert>
      ) : null}
      <Button onClick={() => exportFile.mutate()} loading={exportFile.isPending}>
        <Download aria-hidden="true" />
        Export profile data
      </Button>
    </Card>
  );
}
