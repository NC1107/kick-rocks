import { PageHeader } from "../../../components/ui/index.js";
import { Controls } from "./controls.js";
import { DataDisplay } from "./data.js";
import { Feedback } from "./feedback.js";
import { Navigation } from "./navigation.js";
import { Tokens } from "./tokens.js";

/**
 * A living style guide, only in development: every component and its states in one place, in the
 * current theme. Open /dev/ui under `pnpm --filter @kickrocks/web dev:mock`.
 */
export function Component() {
  return (
    <>
      <PageHeader title="Components" description="Every primitive in every state" />
      <Tokens />
      <Controls />
      <DataDisplay />
      <Feedback />
      <Navigation />
    </>
  );
}
