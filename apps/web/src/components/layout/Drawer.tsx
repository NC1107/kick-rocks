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
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
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
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] overflow-hidden border-0 border-r border-line bg-rail p-0 text-ink shadow-dialog backdrop:bg-scrim open:animate-settle"
    >
      {children}
    </dialog>
  );
}
