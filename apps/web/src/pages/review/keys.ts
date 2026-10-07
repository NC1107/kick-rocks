const TYPING = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/**
 * A shortcut key means something only when the person is not typing, not holding a modifier,
 * and no dialog is covering the page.
 */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable)) {
    return false;
  }
  return document.querySelector("dialog[open]") === null;
}
