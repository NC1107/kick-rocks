/**
 * A scan withdrawn because the person paused or skipped the site never searched anything, so it
 * says nothing about whether they are listed there.
 */
export function isTerminalCancellation(scan: { taskStatus: string | null }): boolean {
  return scan.taskStatus === "cancelled";
}
