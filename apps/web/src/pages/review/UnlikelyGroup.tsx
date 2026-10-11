import { API_ROUTES, type Match } from "@kickrocks/shared";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { Button, ConfirmDialog, Icon, InlineError, useToast } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { pluralize } from "../../lib/format.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** Marks every given record Not me, one at a time so a failure stops with the rest still waiting. */
function useMarkAllNotMine(matches: readonly Match[]) {
  const toast = useToast();
  const decide = useApiMutation(API_ROUTES.matchDecide, { invalidates: REVIEW_INVALIDATES });
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const run = async (done: () => void) => {
    setPending(true);
    setError(undefined);
    try {
      for (const match of matches) {
        await decide.mutateAsync({
          params: { id: match.id },
          body: { decision: "not_mine", rights: ["opt_out", "delete"] },
        });
      }
      done();
      toast.success("Marked as not you");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error, clearError: () => setError(undefined) };
}

/**
 * The records the score says are not the person, behind one toggle. A score never decides, so the
 * single action here still asks first. The group opens by itself when something inside is selected.
 */
export function UnlikelyGroup(props: UnlikelyGroupProps) {
  return props.matches.length === 0 ? null : <Group {...props} />;
}

interface UnlikelyGroupProps {
  matches: readonly Match[];
  forceOpen?: boolean;
  children: ReactNode;
}

function Group({ matches, forceOpen = false, children }: UnlikelyGroupProps) {
  const [toggled, setToggled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const all = useMarkAllNotMine(matches);
  const open = toggled || forceOpen;
  const close = () => {
    setConfirming(false);
    all.clearError();
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-row items-center gap-2 pr-2 pl-3.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setToggled(!open)}
          className="marked flex min-h-row min-w-0 flex-1 items-center gap-2 text-left text-meta text-ink-2 focus-visible:-outline-offset-2"
        >
          <Icon
            icon={ChevronRight}
            className={cn("transition-transform duration-100", open && "rotate-90")}
          />
          {matches.length} unlikely
        </button>
        <Button
          size="sm"
          aria-label={`Mark ${pluralize(matches.length, "unlikely record")} as not you`}
          onClick={() => setConfirming(true)}
        >
          All not me
        </Button>
      </div>
      {open ? children : null}
      <ConfirmDialog
        open={confirming}
        onClose={close}
        title={`Mark ${pluralize(matches.length, "record")} as not you`}
        description="They look unlikely to be you. Nothing is removed from those sites."
        confirmLabel="Not me"
        loading={all.pending}
        onConfirm={() => void all.run(close)}
      >
        {all.error ? <InlineError>{all.error}</InlineError> : null}
      </ConfirmDialog>
    </div>
  );
}
