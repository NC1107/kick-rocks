import { useEffect, useState } from "react";
import { PageHeader, RadioGroup } from "../../../components/ui/index.js";
import { Controls } from "./controls.js";
import { DataDisplay } from "./data.js";
import { Feedback } from "./feedback.js";
import { Navigation } from "./navigation.js";
import { Tokens } from "./tokens.js";

type Accent = "indigo" | "cyan";

/** Only this page sets the accent; the app itself always renders indigo. */
function useGalleryAccent(): [Accent, (next: Accent) => void] {
  const [accent, setAccent] = useState<Accent>("indigo");
  useEffect(() => {
    const root = document.documentElement;
    if (accent === "cyan") root.setAttribute("data-accent", "cyan");
    else root.removeAttribute("data-accent");
    return () => root.removeAttribute("data-accent");
  }, [accent]);
  return [accent, setAccent];
}

/**
 * A living style guide, only in development: every component and its states in one place, in the
 * current theme. Open /dev/ui under `pnpm --filter @kickrocks/web dev:mock`.
 */
export function Component() {
  const [accent, setAccent] = useGalleryAccent();
  return (
    <>
      <PageHeader
        title="Components"
        description="Every primitive in every state"
        actions={
          <RadioGroup
            legend="Accent"
            hideLegend
            inline
            value={accent}
            onValueChange={setAccent}
            options={[
              { value: "indigo", label: "Indigo" },
              { value: "cyan", label: "Cyan" },
            ]}
          />
        }
      />
      <Tokens />
      <Controls />
      <DataDisplay />
      <Feedback />
      <Navigation />
    </>
  );
}
