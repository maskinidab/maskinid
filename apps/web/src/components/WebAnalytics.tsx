import { Analytics } from "@vercel/analytics/react";
import { analyticsUrl } from "../lib/analyticsUrl";

/**
 * Vercel Web Analytics: page views only, no cookies. Every URL is stripped of tokens, codes, registration numbers,
 * organisation slugs, ids and query strings before it is sent (lib/analyticsUrl.ts). Only on a Vercel deployment –
 * the script is served by Vercel itself, so local development and the self-contained demo send nothing.
 */
export function WebAnalytics() {
  if (import.meta.env.VITE_DATA_SOURCE !== "supabase") return null;
  return (
    <Analytics
      beforeSend={(event) => {
        const url = analyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
