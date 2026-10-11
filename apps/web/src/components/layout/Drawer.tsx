import { type ReactNode, useEffect, useRef } from "react";

/**
 * A panel that slides in from the left on a phone. It is the native modal dialog, so focus is
 * trapped, the page behind is inert, and Escape closes it.
 */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first control, the close button, and a browser may count that as
      // keyboard focus and ring it after a tap. The panel takes focus instead, so Tab starts at the top.
      // It keeps the default :focus-visible ring, so a keyboard opener still sees where focus is.
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] overflow-hidden border-0 border-r border-line bg-rail p-0 text-ink shadow-dialog backdrop:bg-scrim focus-visible:-outline-offset-2 open:animate-settle"
    >
      {children}
    </dialog>
  );
}
