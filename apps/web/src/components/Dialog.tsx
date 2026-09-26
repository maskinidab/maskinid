import { useEffect, useRef, type ReactNode } from "react";

/** Dialog med inbyggt <dialog>-element: fokusfälla, Esc stänger. Skugga-lyft enligt profilen. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="mid-dialog" onClose={onClose} aria-labelledby="dialog-rubrik">
      <div className="mid-dialog-inre">
        <h2 id="dialog-rubrik">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
