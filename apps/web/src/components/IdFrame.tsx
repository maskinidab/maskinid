import type { ReactNode } from "react";

/**
 * ID-ramen – fyra hörnvinklar runt det som är identifierat. En gång per vy,
 * runt det viktigaste verifierade värdet. `animate` drar in hörnen vid sökträff (200 ms).
 */
export function IdFrame({
  children,
  size = "normal",
  yellow = false,
  animate = false,
}: {
  children: ReactNode;
  size?: "normal" | "stor";
  yellow?: boolean;
  animate?: boolean;
}) {
  const cls = ["mid-ram", size === "stor" && "mid-ram-stor", yellow && "mid-ram-gul", animate && "mid-ram-traff"]
    .filter(Boolean)
    .join(" ");
  return <span className={cls}>{children}</span>;
}

/** Identifierare i mono, versaler, med valfritt prefix (PIN, Serienr). */
export function IdNumber({ value, prefix, size = "normal" }: { value: string; prefix?: string; size?: "normal" | "stor" }) {
  return (
    <span className={size === "stor" ? "mid-id mid-id-stor" : "mid-id"}>
      {prefix && <span className="mid-id-prefix">{prefix}</span>}
      {value.toUpperCase()}
    </span>
  );
}
