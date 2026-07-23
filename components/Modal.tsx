"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

const EXIT_MS = 150;

type ModalProps = {
  open: boolean;
  onClose: () => void;
  className?: string;
  role?: "dialog" | "alertdialog";
  "aria-label"?: string;
  children: ReactNode;
};

/**
 * Shared backdrop + panel shell for every modal in the app (trip create/edit,
 * delete confirmation). Owns enter/exit animation, Escape-to-close, and
 * backdrop-click-to-close in one place instead of each call site
 * reimplementing them slightly differently.
 *
 * Exit is asymmetric on purpose: closing is a system response to a click the
 * user already made, so it should feel immediate -- faster than the entrance,
 * which is inviting the user's attention to something new.
 */
export function Modal({ open, onClose, className, role = "dialog", "aria-label": ariaLabel, children }: ModalProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timeout = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted, onClose]);

  if (!mounted) return null;

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  const state = open ? "open" : "closed";

  return (
    <div className="modal-backdrop" data-state={state} onClick={onBackdropClick}>
      <section
        className={`panel modal${className ? ` ${className}` : ""}`}
        data-state={state}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </section>
    </div>
  );
}
