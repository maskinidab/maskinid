import { scrubText } from "@maskinid/shared/scrub.ts";
import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/shell.css";

// Sentry without PII (SPEC §11.6): no default PII, no request bodies, reg/serial-like strings scrubbed.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      const scrub = (s?: string) => scrubText(s);
      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) ex.value = scrub(ex.value);
      if (event.request) delete event.request.data;
      if (event.user) event.user = { id: event.user.id };
      for (const b of event.breadcrumbs ?? []) b.message = scrub(b.message);
      return event;
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
