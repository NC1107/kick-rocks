import type { NeedsYouItem, RequestRight } from "@kickrocks/shared";
import { createContext, useContext } from "react";

/** What every card needs from the page around it. */
export interface FocusContext {
  profileId: string;
  mailboxConnected: boolean;
  progress: { done: number; total: number; position: number };
  /** More than one item is waiting, so previous and next mean something. */
  canMove: boolean;
  /** The item whose return prompt is showing. */
  promptKey: string | null;
  setPrompt: (key: string | null) => void;
  /** Tells the server the page was opened, then opens it in a new tab. */
  openPage: (item: NeedsYouItem) => void;
  /** Counts the item as dealt with and clears its prompt. The queue moves on once it refetches. */
  resolved: () => void;
  next: () => void;
  previous: () => void;
  /** Leaves the item for later without saying anything to the server. */
  skip: () => void;
  openSnooze: () => void;
  openList: () => void;
  /**
   * Decides a record after a few seconds, with a toast to take it back, because "mine" asks a
   * broker for a removal and the server cannot undo that.
   */
  decideRecord: (
    item: NeedsYouItem,
    decision: "mine" | "not_mine",
    rights: readonly RequestRight[],
  ) => void;
}

export const FocusState = createContext<FocusContext | null>(null);

export function useFocus(): FocusContext {
  const value = useContext(FocusState);
  if (!value) throw new Error("useFocus needs the Needs you page above it");
  return value;
}
