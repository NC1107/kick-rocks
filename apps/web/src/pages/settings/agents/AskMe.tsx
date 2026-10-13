import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  InlineError,
  RadioGroup,
  type RadioOption,
  Section,
  useToast,
} from "../../../components/ui/index.js";

type AskMode = "check" | "autopilot";

const OPTIONS: readonly RadioOption<AskMode>[] = [
  {
    value: "check",
    label: "Check with me",
    description: "Each send and each likely match waits for your OK in the Inbox.",
  },
  {
    value: "autopilot",
    label: "Just do it",
    description:
      "Sends without asking and treats likely matches as you. A CAPTCHA, a code or an ID check still comes to you.",
  },
];

/**
 * Whether the agent asks before it acts. One switch for the two places it would otherwise stop:
 * a send from a model the gate has not cleared, and a record a scan scored as likely the person's.
 */
export function AskMe({ as }: { as?: "h2" | "h3" }) {
  const toast = useToast();
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet, API_ROUTES.settingsAgentSetup, API_ROUTES.reviewQueue],
    onSuccess: (_view, { body }) =>
      toast.success(
        body.agent?.autopilot ? "Nothing waits for your OK now" : "Each send waits for you again",
      ),
  });
  const value: AskMode | null = settings.data
    ? settings.data.agent.autopilot
      ? "autopilot"
      : "check"
    : null;

  return (
    <Section label="Checking with you" {...(as ? { as } : {})}>
      <RadioGroup
        legend="How much to ask you"
        hideLegend
        rows
        flat
        value={value}
        onValueChange={(next) =>
          save.mutate({ body: { agent: { autopilot: next === "autopilot" } } })
        }
        options={OPTIONS.map((option) => ({
          ...option,
          disabled: save.isPending || !settings.data,
        }))}
      />
      {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
    </Section>
  );
}
