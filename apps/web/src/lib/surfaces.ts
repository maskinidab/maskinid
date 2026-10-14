/**
 * The public site (maskinid.se) and the app (app.maskinid.se) are two deployments of the same code (ADR 0035).
 *
 * Each build is told where both live through VITE_SITE_URL and VITE_APP_URL. Unset – local development, the e2e
 * suite, the self-contained demo – both are the current origin and everything behaves as one app, as before.
 *
 * Printed QR codes and share links must always point at the site: a label is printed once and lives on the machine
 * for years, so it must never carry the app's address.
 */
const trim = (u: string | undefined) => (u ?? "").trim().replace(/\/+$/, "");
const SITE = trim(import.meta.env.VITE_SITE_URL);
const APP = trim(import.meta.env.VITE_APP_URL);

/** Which deployment this build is. */
export const SURFACE: "site" | "app" = import.meta.env.VITE_SURFACE === "site" ? "site" : "app";

const origin = () => (typeof location === "undefined" ? "" : location.origin);

/** Absolute URL on the public site – for QR codes, share links and anything printed. */
export function siteUrl(path = ""): string {
  return `${SITE || origin()}${path}`;
}

/** Absolute URL in the app. */
export function appUrl(path = ""): string {
  return `${APP || origin()}${path}`;
}

/** True when the site and the app are separate deployments, so some paths belong to the other one. */
export function isSplit(): boolean {
  return !!SITE && !!APP && SITE !== APP;
}

/**
 * Public paths that stay in the app even when split: they need a signed-in session, which lives on the app's
 * domain (/verify shows a lender's financing status to a signed-in user).
 */
export const APP_PUBLIC_PATHS = ["verify"] as const;

/** Paths that only exist in the app: anything signed in, plus sign-up and sign-in themselves. */
export const APP_ONLY_PREFIXES = ["login", "signup", "auth", "invite", "onboarding", "profile", "app", "dashboard", "admin", "go", "transfer", "o", "verify", "design"] as const;
