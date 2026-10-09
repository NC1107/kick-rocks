import type { InboxSource, ScanOptions, ScanResult } from "../mail/types.js";

/** One header scan of a folder in its own session, for tests that look at what a scan reports. */
export function scanFolder(
  inbox: InboxSource,
  folder: string,
  afterUid: number | null,
  uidValidity: number | null,
  options: ScanOptions,
): Promise<ScanResult> {
  return inbox.withFolder(folder, (session) => session.scan(afterUid, uidValidity, options));
}
