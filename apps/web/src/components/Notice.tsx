import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Besked efter en handling – bekräftelse eller fel. Säger vad som hände och vad man gör. */
export function Notice({ kind = "info", title, children }: { kind?: "ok" | "fel" | "info"; title: string; children?: ReactNode }) {
  const icon = kind === "ok" ? "bock" : kind === "fel" ? "varning" : "dokument";
  return (
    <div className={`mid-besked ${kind === "ok" ? "mid-besked-ok" : kind === "fel" ? "mid-besked-fel" : ""}`} role={kind === "fel" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

export function Loading({ children = "Hämtar uppgifter" }: { children?: string }) {
  return (
    <p className="mid-laddar" role="status">
      {children}
    </p>
  );
}
