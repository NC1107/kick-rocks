/** Saves text as a file through a temporary link, which is how a browser offers a download without a page load. */
export function downloadTextFile(fileName: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the download in some browsers, so it waits a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
