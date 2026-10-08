import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The default one second for findBy queries is shorter than a mock round trip on a loaded CI runner,
// which made page tests fail there while passing everywhere else. A real hang still fails, just later.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  try {
    localStorage.clear();
  } catch {
    // Storage can be unavailable; a test that needs it says so.
  }
});

/*
 * jsdom lacks a few browser APIs the components use. These stand in for them closely enough to
 * test behavior; anything a test depends on that jsdom cannot do, such as layout, is checked in a
 * real browser instead.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/** The native modal dialog is half implemented in jsdom: it has no showModal, close, or Escape. */
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { __patched?: boolean };
  if (!proto.__patched) {
    const openers = new WeakMap<HTMLDialogElement, Element | null>();
    proto.showModal = function showModal(this: HTMLDialogElement) {
      openers.set(this, document.activeElement);
      this.setAttribute("open", "");
    };
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      (openers.get(this) as HTMLElement | null | undefined)?.focus();
      this.dispatchEvent(new Event("close"));
    };
    proto.__patched = true;
  }
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
