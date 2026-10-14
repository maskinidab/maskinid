# 0035 – The public site and the app are two deployments of one codebase

**Context.** The product owner wants the website (maskinid.se: landing, machine cards, search, stolen list, help) apart
from the application (app.maskinid.se), both on the same Supabase production backend. A separate repository was
considered and rejected: the site renders the same machine card, design system, translations and public RPCs as the
app, and two repositories would copy them and let them drift.

Two facts shape the split. A printed QR label encodes `https://<origin>/m/<code>` permanently, so labels must carry
the site's address no matter where they were printed. And a signed-in session lives in the app domain's storage, so
the site cannot know who is signed in.

**Decision.**
- `apps/site` is a second Vite build of `apps/web/src` (aliased as `@web`) with only the public routes. It has no
  service worker, no in-browser database (the backend selector's local import is swapped for a stub at build time) and
  no signed-in shell. Paths that belong to the app – `/login`, `/signup`, `/o/…`, `/admin`, `/go`, … – are redirected
  there with a full page load, so every existing link keeps working.
- `apps/web` stays the app. When split, its public paths redirect to the site, except `/verify`, which needs a session,
  and `/` goes straight to `/app`.
- Both builds read `VITE_SITE_URL` and `VITE_APP_URL` (`apps/web/src/lib/surfaces.ts`). Unset – local development, the
  e2e suite, the self-contained demo – they are the current origin, and the code behaves exactly as before.
- Everything printed or shared – QR codes, label sheets, ad signs, lot tags, share links – is built with `siteUrl()`,
  never `location.origin`. A redirect that would point at its own origin (a misconfigured deployment) shows an error
  instead of reloading forever.
- Two Vercel projects from the same repository: the existing one (root directory = repository root, `api/pdf.ts`) for
  the app, and a new one with root directory `apps/site` and its own `vercel.json`.

**Consequences.** One codebase, one test suite, two domains. The site's build still emits the app's lazy route chunks
(the public route table lives next to the app's), but a visitor never downloads them. A logged-in user visiting the site
is shown as signed out; "Logga in" takes them to the app, where they already are. The e2e suite keeps running on one
origin; the split itself is smoke-tested against a preview build.
