import { scrubText } from "@maskinid/shared/scrub.ts";
import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@web/i18n";
import "@web/styles/fonts.css";
import "@web/styles/tokens.css";
import "@web/styles/components.css";
import "@web/styles/app.css";
import "@web/styles/shell.css";
import { SiteApp } from "./SiteApp";

// Same Sentry rules as the app (SPEC §11.6): no PII, reg/serial-like strings scrubbed.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: `site-${import.meta.env.MODE}`,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      if (event.message) event.message = scrubText(event.message);
      for (const ex of event.exception?.values ?? []) ex.value = scrubText(ex.value);
      if (event.request) delete event.request.data;
      if (event.user) event.user = { id: event.user.id };
      for (const b of event.breadcrumbs ?? []) b.message = scrubText(b.message);
      return event;
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SiteApp />
  </StrictMode>,
);
