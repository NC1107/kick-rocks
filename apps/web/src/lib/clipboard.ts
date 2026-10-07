/**
 * Copies text. navigator.clipboard only exists on secure origins, and this app is often opened
 * over plain http on a home network, so a hidden textarea and execCommand cover that case.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.navigator?.clipboard && globalThis.isSecureContext) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path, which works without permission prompts.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const doc = globalThis.document;
  if (!doc) return false;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  doc.body.append(area);
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  area.select();
  try {
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus();
  }
}
