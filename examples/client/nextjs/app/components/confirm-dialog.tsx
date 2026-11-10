"use client"

import { useEffect, useId, useRef } from "react"

/**
 * ConfirmDialog
 *
 * A small in-app confirmation dialog built on the native `<dialog>` element,
 * used instead of the browser's blocking confirm box.
 *
 * - Opened with `showModal()`, so focus is trapped and Esc closes it.
 * - Esc and a click on the backdrop both count as "Cancel" (the safe choice).
 * - Initial focus lands on the Cancel button.
 * - Labelled and described for assistive technology.
 * - Uses logical CSS properties, so it lays out correctly in RTL pages.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        // Esc: let React state drive closing so open/close stays in sync.
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => {
        // A click on the backdrop targets the dialog element itself.
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <style jsx>{`
        .confirm-dialog {
          max-inline-size: min(420px, calc(100vw - 32px));
          padding: 0;
          border: none;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          font-family: inherit;
          color: #111827;
          background: #ffffff;
        }

        .confirm-dialog::backdrop {
          background: rgba(0, 0, 0, 0.45);
        }

        @media (prefers-color-scheme: dark) {
          .confirm-dialog {
            color: #f9fafb;
            background: #1f2937;
          }
        }

        .confirm-body {
          padding: 20px;
        }

        .confirm-title {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 600;
        }

        .confirm-description {
          margin: 0;
          font-size: 14px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-block: 12px;
          padding-inline: 20px;
          border-block-start: 1px solid rgba(127, 127, 127, 0.25);
        }

        .confirm-btn {
          padding-block: 8px;
          padding-inline: 14px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
        }

        .confirm-btn-cancel {
          background: transparent;
          color: inherit;
          border: 1px solid rgba(127, 127, 127, 0.5);
        }

        .confirm-btn-confirm {
          border: none;
          background: #3b82f6;
          color: #ffffff;
        }

        .confirm-btn-danger {
          background: #dc2626;
        }

        .confirm-btn:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
      `}</style>
      <div className="confirm-body">
        <h2 id={titleId} className="confirm-title">
          {title}
        </h2>
        <p id={descriptionId} className="confirm-description">
          {description}
        </p>
      </div>
      <div className="confirm-actions">
        <button
          ref={cancelRef}
          type="button"
          className="confirm-btn confirm-btn-cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirm-btn confirm-btn-confirm${destructive ? " confirm-btn-danger" : ""}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
