import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { useEffect, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Alert,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Textarea,
  useToast,
} from "../../components/ui/index.js";
import {
  checkEgress,
  checkScanning,
  egressDraftOf,
  SCANNING_FIELDS,
  scanningDraftOf,
  TIME_ZONE_HELP,
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
    <Card>
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
        <CardHeader
          title="Pace and route"
          description="How gently Kick Rocks visits broker sites, so your home address is never flagged for it."
        />
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {SCANNING_FIELDS.flatMap((field) => [
            <Field
              key={field.key}
              label={`${field.label} (${field.unit})`}
              help={field.help}
              error={
                (submitted ? paceCheck.errors[field.key] : undefined) ??
                serverErrors[`scanning.${field.key}`]
              }
            >
              <Input
                type="number"
                inputMode="numeric"
                min={field.min}
                max={field.max}
                step={1}
                value={pace[field.key]}
                onChange={(event) =>
                  setPace((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </Field>,
            ...(field.key === "quietEndHour"
              ? [
                  <Field
                    key="timeZone"
                    label="Time zone for quiet hours"
                    help={TIME_ZONE_HELP}
                    error={
                      (submitted ? paceCheck.errors.timeZone : undefined) ??
                      serverErrors["scanning.timeZone"]
                    }
                  >
                    <Input
                      autoComplete="off"
                      spellCheck={false}
                      value={pace.timeZone}
                      onChange={(event) =>
                        setPace((current) => ({ ...current, timeZone: event.target.value }))
                      }
                    />
                  </Field>,
                ]
              : []),
          ])}
        </div>

        <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6">
          <div>
            <h3 className="text-base font-medium text-ink">Send visits through a proxy</h3>
            <p className="text-sm text-ink-muted">
              Optional. Point this at a proxy you run, such as a VPN container's HTTP port. Off
              unless you set an address.
            </p>
          </div>
          <Field
            label="Proxy address"
            help="For example http://10.0.0.100:8888. No user name or password."
            error={
              (submitted ? routeCheck.errors.proxyUrl : undefined) ??
              serverErrors["egress.proxyUrl"]
            }
          >
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="http://10.0.0.100:8888"
              value={route.proxyUrl}
              onChange={(event) =>
                setRoute((current) => ({ ...current, proxyUrl: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Only for these sites"
            help="One site per line, such as spokeo.com. Leave empty to use the proxy for every site."
            error={
              (submitted ? routeCheck.errors.domains : undefined) ?? serverErrors["egress.domains"]
            }
          >
            <Textarea
              rows={3}
              value={route.domains}
              onChange={(event) =>
                setRoute((current) => ({ ...current, domains: event.target.value }))
              }
            />
          </Field>
          {sisterNotes.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-ink-muted">
              {sisterNotes.map((note) => (
                <li key={note.domain}>
                  <span className="font-medium text-ink">{note.domain}</span> also covers{" "}
                  {note.sisters.join(", ")}.
                </li>
              ))}
            </ul>
          ) : null}
          <Alert intent="warning" title="A VPN does not make sites trust you more">
            Many broker sites challenge VPN and datacenter addresses more often than a home
            connection, not less. Use a proxy to keep one site's traffic apart, not to hide.
          </Alert>
        </div>

        {save.isError && Object.keys(serverErrors).length === 0 ? (
          <div className="mt-4">
            <Alert intent="danger" title="Could not save the settings">
              {errorMessage(save.error)}
            </Alert>
          </div>
        ) : null}
        <CardFooter>
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
        </CardFooter>
      </form>
    </Card>
  );
}
