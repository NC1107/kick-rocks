import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Callout,
  Input,
  RowGroup,
  Section,
  Textarea,
  useToast,
} from "../../components/ui/index.js";
import { FieldRow, GroupFooter, GroupNote } from "./rows.js";
import {
  checkEgress,
  checkScanning,
  egressDraftOf,
  PROXY_HELP,
  PROXY_LABEL,
  PROXY_SITES_HELP,
  PROXY_SITES_LABEL,
  SCANNING_FIELDS,
  scanningDraftOf,
  TIME_ZONE_HELP,
  TIME_ZONE_LABEL,
} from "./scanning-model.js";

/**
 * How carefully the browser treats the broker sites it visits, and the optional route it takes
 * there. The defaults are meant to be left alone: they keep a home address from being flagged.
 */
export function ScanPaceCard({
  scanning,
  egress,
  coverage,
}: {
  scanning: SettingsView["scanning"];
  egress: SettingsView["egress"];
  coverage: SettingsView["egressCoverage"];
}) {
  const toast = useToast();
  const [pace, setPace] = useState(() => scanningDraftOf(scanning));
  const [route, setRoute] = useState(() => egressDraftOf(egress));
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => setPace(scanningDraftOf(scanning)), [scanning]);
  useEffect(() => setRoute(egressDraftOf(egress)), [egress]);

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: () => {
      setSubmitted(false);
      toast.success("Scanning settings saved");
    },
  });

  const paceCheck = checkScanning(pace, scanning);
  const routeCheck = checkEgress(route, egress);
  const hasErrors =
    Object.keys(paceCheck.errors).length > 0 || Object.keys(routeCheck.errors).length > 0;
  // A zone nobody has saved yet shows the browser's, and saving it is what makes it apply.
  const dirty =
    scanning.timeZone === null ||
    JSON.stringify([pace, route]) !==
      JSON.stringify([scanningDraftOf(scanning), egressDraftOf(egress)]);
  const sisterNotes = egress.domains
    .map((domain) => ({ domain, sisters: coverage[domain] ?? [] }))
    .filter((note) => note.sisters.length > 0);
  const serverErrors = save.error?.fieldErrors ?? {};

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (hasErrors || !dirty) return;
        save.mutate({
          body: {
            ...(Object.keys(paceCheck.patch).length > 0 ? { scanning: paceCheck.patch } : {}),
            ...(Object.keys(routeCheck.patch).length > 0 ? { egress: routeCheck.patch } : {}),
          },
        });
      }}
    >
      <Section label="Pace and route">
        <RowGroup>
          {SCANNING_FIELDS.flatMap((field) => [
            <FieldRow
              key={field.key}
              label={field.label}
              {...(field.help ? { help: field.help } : {})}
              error={
                (submitted ? paceCheck.errors[field.key] : undefined) ??
                serverErrors[`scanning.${field.key}`]
              }
            >
              <Input
                mono
                type="number"
                inputMode="numeric"
                min={field.min}
                max={field.max}
                step={1}
                unit={field.unit}
                value={pace[field.key]}
                onChange={(event) =>
                  setPace((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </FieldRow>,
            ...(field.key === "quietEndHour"
              ? [
                  <FieldRow
                    key="timeZone"
                    label={TIME_ZONE_LABEL}
                    help={TIME_ZONE_HELP}
                    error={
                      (submitted ? paceCheck.errors.timeZone : undefined) ??
                      serverErrors["scanning.timeZone"]
                    }
                  >
                    <Input
                      mono
                      autoComplete="off"
                      spellCheck={false}
                      value={pace.timeZone}
                      onChange={(event) =>
                        setPace((current) => ({ ...current, timeZone: event.target.value }))
                      }
                    />
                  </FieldRow>,
                ]
              : []),
          ])}
          <FieldRow
            label={PROXY_LABEL}
            help={PROXY_HELP}
            error={
              (submitted ? routeCheck.errors.proxyUrl : undefined) ??
              serverErrors["egress.proxyUrl"]
            }
          >
            <Input
              mono
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="http://10.0.0.100:8888"
              value={route.proxyUrl}
              onChange={(event) =>
                setRoute((current) => ({ ...current, proxyUrl: event.target.value }))
              }
            />
          </FieldRow>
          <FieldRow
            label={PROXY_SITES_LABEL}
            help={PROXY_SITES_HELP}
            error={
              (submitted ? routeCheck.errors.domains : undefined) ?? serverErrors["egress.domains"]
            }
          >
            <Textarea
              mono
              rows={3}
              value={route.domains}
              onChange={(event) =>
                setRoute((current) => ({ ...current, domains: event.target.value }))
              }
            />
          </FieldRow>
          <GroupFooter>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => {
                setPace(scanningDraftOf(scanning));
                setRoute(egressDraftOf(egress));
                setSubmitted(false);
              }}
            >
              Reset
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              Save
            </Button>
          </GroupFooter>
        </RowGroup>
        {sisterNotes.map((note) => (
          <GroupNote key={note.domain}>
            {note.domain} also covers {note.sisters.join(", ")}.
          </GroupNote>
        ))}
        {route.proxyUrl.trim() !== "" ? (
          <Callout
            intent="warning"
            title="A VPN does not make sites trust you more"
            className="mt-3"
          >
            Many broker sites challenge VPN and datacenter addresses more often than a home
            connection, not less. Use a proxy to keep one site's traffic apart, not to hide.
          </Callout>
        ) : null}
        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <Callout intent="danger" title="Could not save the settings" className="mt-3">
            {errorMessage(save.error)}
          </Callout>
        ) : null}
      </Section>
    </form>
  );
}
