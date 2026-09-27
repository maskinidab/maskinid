# 0001 – Build on the existing code base

**Context.** CLAUDE.md prescribes a pnpm monorepo with React 18, Tailwind and shadcn/ui ("ändra inte"). The repository
already contained a working MaskinID app (npm, React 19, React Router 7, hand-written CSS generated from the MaskinID
graphic profile) and a Supabase project. The product owner decided (2026-09-26) to build on the existing code.

**Decision.**
- Monorepo layout from SPEC §14 (`apps/web`, `apps/ingest`, `packages/shared`, `supabase/`) using **npm workspaces**
  instead of pnpm. `npm run <script>` replaces `pnpm <script>` (e.g. `npm run test:db`).
- React 19 and React Router 7 are kept. The remaining stack is added as specified: TanStack Query, react-hook-form + zod,
  i18next, vite-plugin-pwa, Playwright, Vitest, Sentry.
- No Tailwind/shadcn: components are built on the profile's `mid-*` CSS classes and tokens (see ADR 0002). The
  component names from SPEC §10 (`RegNumber`, `VerificationBadge`, `StatusBanner`, `Timeline`, …) are kept.

**Consequences.** Commands in CLAUDE.md that say `pnpm` map 1:1 to `npm run`. Lovable output (Tailwind/shadcn) cannot be
merged file-by-file; features are ported by hand.
