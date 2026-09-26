import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native <dialog>: focus trap, Esc closes. Shadow "lyft" per the profile. */
export function Dialog({ open, onClose, title, children, wide = false }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? "mid-dialog mid-dialog-bred" : "mid-dialog"} onClose={onClose} aria-labelledby={`${id}-rubrik`}>
      {open && (
        <div className="mid-dialog-inre">
          <h2 id={`${id}-rubrik`}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
