/**
 * Feature flags in the client (ADR 0033).
 *
 * This is the app's first flag read. The flags live in `public.app_config`, which `get_app_config` exposes to
 * `anon` as well, so this works on the public pages where nobody is signed in and `my_context` is null.
 *
 * Two shapes, because hiding and redirecting need different answers while the query is in flight:
 *
 * - `useFlag` answers from the build-time default straight away. Use it to show or hide something. Waiting would
 *   make a flag-gated link flash in and out on every cold load of the public site, which is worse than being
 *   briefly wrong in the direction of the configured default.
 * - `useFlagState` also reports `loading`. Use it when the answer decides a redirect or a destructive action:
 *   acting on the default before the database has answered would send a visitor away from a page that is in fact
 *   turned on.
 */
import { FEATURE_DEFAULTS, resolveFlags, type FeatureFlag } from "@maskinid/shared/config.ts";
import { useRpc } from "./api/query";

/** Defaults plus any VITE_<FLAG> set at build time. Computed once; import.meta.env never changes at runtime. */
const envFlags: Record<FeatureFlag, boolean> = resolveFlags(
  import.meta.env as unknown as Record<string, string | boolean | undefined>,
);

export function flagDefault(flag: FeatureFlag): boolean {
  return envFlags[flag] ?? FEATURE_DEFAULTS[flag];
}

function isOn(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

/** All public flags from the database over the build-time defaults, plus whether the read has landed. */
export function useFlagState(): { flags: Record<FeatureFlag, boolean>; loading: boolean } {
  // Cached for the session: flags change from the operator's flag page, not while someone is reading a page.
  const q = useRpc<Record<string, unknown>>("get_app_config", {}, { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: false });
  if (!q.data) return { flags: envFlags, loading: q.isLoading };
  const flags = { ...envFlags };
  for (const key of Object.keys(flags) as FeatureFlag[]) {
    const raw = q.data[key];
    if (raw !== undefined && raw !== null) flags[key] = isOn(raw);
  }
  return { flags, loading: false };
}

export function useFlags(): Record<FeatureFlag, boolean> {
  return useFlagState().flags;
}

/** One flag, answered from the configured default while the read is in flight – see the note above. */
export function useFlag(flag: FeatureFlag): boolean {
  return useFlagState().flags[flag];
}
