import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";

export interface DialogProps {
  open: boolean;
  /** Called when the person dismisses the dialog with Escape, the close button, or the backdrop. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons for the bottom edge. Put the main action last. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set false while a request is in flight, so a stray Escape cannot hide it. */
  dismissible?: boolean;
}

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Built on the native modal dialog, which traps focus, makes the page behind inert, closes on
 * Escape, and gives focus back to the control that opened it. Focus starts on the element marked
 * data-autofocus, else the first form control, else the browser's first focusable element.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>(
        "[data-autofocus], input:not([type=hidden]), select, textarea",
      );
      first?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-line-popover bg-popover p-0 text-ink shadow-dialog backdrop:animate-fade backdrop:bg-scrim open:animate-settle",
        SIZES[size],
      )}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div
          className={cn("flex items-start justify-between gap-4 px-5 pt-5", !children && "pb-4")}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-heading font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-ui text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton label="Close" size="sm" onClick={onClose} className="-mt-1 -mr-2">
              <X />
            </IconButton>
          ) : null}
        </div>
        {children ? <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-popover px-5 py-3.5">
            {footer}
          </div>
        ) : (
          <div className="h-4" />
        )}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps
  extends Pick<DialogProps, "open" | "onClose" | "title" | "description" | "children"> {
  confirmLabel: string;
  onConfirm: () => void;
  /** Filled red confirm button, for something that cannot be undone. */
  destructive?: boolean;
  loading?: boolean;
  cancelLabel?: string;
}

/** Ask before doing something that cannot be undone. The cancel button takes focus first. */
export function ConfirmDialog({
  confirmLabel,
  onConfirm,
  destructive = false,
  loading = false,
  cancelLabel = "Cancel",
  onClose,
  ...rest
}: ConfirmDialogProps) {
  return (
    <Dialog
      {...rest}
      size="sm"
      onClose={onClose}
      dismissible={!loading}
      footer={
        <>
          <Button data-autofocus variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger-solid" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
