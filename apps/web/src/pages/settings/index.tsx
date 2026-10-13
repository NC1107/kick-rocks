import type { ReactNode } from "react";
import { Helpers } from "./helpers/Helpers.js";
import { JurisdictionsCard } from "./JurisdictionsCard.js";
import { MailIntakeCard } from "./MailIntakeCard.js";
import { PasswordCard } from "./PasswordCard.js";
import { SETTINGS_WIDTH } from "./rows.js";
import { SettingsHeader } from "./SettingsHeader.js";
import { useScrollToHash } from "./use-scroll-to-hash.js";

/** Sections hold their place under the sticky bar when a link scrolls to them. */
function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-[calc(var(--kr-bar-h)+3.5rem)]">
      {children}
    </div>
  );
}

/** What a new install needs, in the order it needs it. */
export function Component() {
  useScrollToHash();

  return (
    <>
      <SettingsHeader section="Setup" description="Password, mailbox, laws, and helpers" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        <Anchor id="password">
          <PasswordCard />
        </Anchor>
        <Anchor id="mail-intake">
          <MailIntakeCard />
        </Anchor>
        <Anchor id="jurisdictions">
          <JurisdictionsCard />
        </Anchor>
        <Anchor id="helpers">
          <Helpers />
        </Anchor>
      </div>
    </>
  );
}
