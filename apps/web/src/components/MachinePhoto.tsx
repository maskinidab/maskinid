import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { Icon } from "./Icon";

/** Primary photo from the public machine-photos bucket; a neutral placeholder otherwise (no decorative art). */
export function MachinePhoto({ path, category, size = 96, alt = "" }: { path: string | null; category?: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    if (!path) return setSrc(null);
    if (backend.kind === "local") {
      void backend.storage.localObjectUrl?.("machine-photos", path).then((u) => {
        revoke = u;
        setSrc(u);
      });
    } else setSrc(backend.storage.publicUrl("machine-photos", path));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);
  if (!src) {
    return <span className="maskinfoto maskinfoto-tom" style={{ width: size, height: size }} data-kategori={category}><Icon name="maskin" /></span>;
  }
  return <img className="maskinfoto" src={src} alt={alt} width={size} height={size} loading="lazy" />;
}
