"use client";

import { useEffect, useRef } from "react";
import { Modal } from "@/components/Modal";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} className="confirm-dialog" role="alertdialog" aria-label={title}>
      <div className="panel-header">
        <strong>{title}</strong>
      </div>
      <div className="panel-body grid">
        {description ? <p className="hint">{description}</p> : null}
        <div className="form-actions">
          <button className="button" onClick={onCancel} type="button" disabled={confirmDisabled}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`button ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
            type="button"
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
