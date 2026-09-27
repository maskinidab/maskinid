/**
 * Web push on this device (step 24). With Supabase the browser subscribes at its push service with our VAPID key and the
 * push-send function delivers. In the local demo there is no push service: the device registers a demo subscription
 * and a small pump in the app shows the queued messages through the service worker, so the flow can be tried end to end.
 */
import { b64urlDecode, b64urlEncode } from "@maskinid/shared/adapters/webpush.ts";
import { rpc } from "./api/query";
import { backend, dataSource } from "./backend";
import { uaFamily } from "./security";

const DEMO_KEY = "maskinid.push.demo-endpoint";

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && (dataSource === "local" || "PushManager" in window);
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

function storedDemoEndpoint(): string | null {
  try { return localStorage.getItem(DEMO_KEY); } catch { return null; }
}

export async function currentEndpoint(): Promise<string | null> {
  if (dataSource === "local") return storedDemoEndpoint();
  const reg = await registration();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await currentEndpoint()) ? "on" : "off";
}

export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("PUSH_DENIED");
  if (dataSource === "local") {
    const endpoint = `https://demo.push.local/${crypto.randomUUID()}`;
    await rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: b64urlEncode(crypto.getRandomValues(new Uint8Array(65))),
      p_auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))), p_ua_family: uaFamily(navigator.userAgent) });
    try { localStorage.setItem(DEMO_KEY, endpoint); } catch { /* per-device convenience only */ }
    return;
  }
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("PUSH_NOT_CONFIGURED");
  const reg = await registration();
  if (!reg) throw new Error("PUSH_NOT_CONFIGURED");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(key) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua_family: uaFamily(navigator.userAgent) });
}

export async function disablePush(): Promise<void> {
  const endpoint = await currentEndpoint();
  if (endpoint) await rpc("delete_push_subscription", { p_endpoint: endpoint });
  if (dataSource === "local") {
    try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
  } else {
    await (await (await registration())?.pushManager.getSubscription())?.unsubscribe();
  }
}

/** Local demo only: deliver queued push messages for this device via the service worker (or a plain Notification). */
export async function pumpLocalPush(): Promise<number> {
  const endpoint = storedDemoEndpoint();
  if (dataSource !== "local" || !endpoint || Notification.permission !== "granted") return 0;
  const r = await backend.invoke<{ messages: { endpoint: string; title: string; body: string; url: string; tag: string }[] }>("push-send", {});
  const reg = await registration();
  let shown = 0;
  for (const m of r.messages.filter((x) => x.endpoint === endpoint)) {
    if (reg) await reg.showNotification(m.title, { body: m.body, tag: m.tag, icon: "/icon-192.png", data: { url: m.url } });
    else new Notification(m.title, { body: m.body, tag: m.tag });
    shown++;
  }
  return shown;
}
