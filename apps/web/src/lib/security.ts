import { backend } from "./backend";

/** Browser family for the account security log (never the full user agent). */
export function uaFamily(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return [br, os].filter(Boolean).join(" · ");
}

/** Best effort: a failed log write never blocks sign-in. */
export async function recordSecurityEvent(type: "sign_in" | "sign_out" | "sign_out_everywhere" | "mfa_enrolled" | "mfa_removed") {
  await backend.rpc("record_security_event", { p_type: type, p_ua_family: uaFamily() }).catch(() => undefined);
}
