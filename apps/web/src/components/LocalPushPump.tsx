import { useEffect } from "react";
import { dataSource } from "../lib/backend";
import { pumpLocalPush } from "../lib/push";

/** Local demo only: every 15 s, show push messages queued for this device (step 24). Renders nothing. */
export function LocalPushPump() {
  useEffect(() => {
    if (dataSource !== "local") return;
    const tick = () => void pumpLocalPush().catch(() => undefined);
    const id = window.setInterval(tick, 15_000);
    tick();
    return () => window.clearInterval(id);
  }, []);
  return null;
}
