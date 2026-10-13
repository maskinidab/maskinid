# 0033 – FEATURE_PRICING, and the client learns to read flags

**Context.** The product owner wants the price information off the product for now: *"Jag tycker att vi tar bort
priserna från startsidan, alternativt tar bort prisinformationen helt tills vidare."* The start page turned out not
to show any prices at all, so "from the start page" was already true and the real ask is the second half — all of it,
for now, reversibly.

Prices live in six places: the public `/pricing` page, the links to it in the public header, the public footer and
the bottom of every `/for/:segment` page, the **Betalning** tab in an organisation's settings, and the price preview
on the dealer's märke order form. Two of those read `list_plans`, which is granted to `anon`.

The feature-flag table `public.app_config` already existed, with `app.flag()`, `admin_set_config` and an operator
page to toggle flags. What did not exist was any client that reads a flag: grepping `apps/web/src` for
`get_app_config` or `resolveFlags` returned nothing. The web app's only global switch was `context.demo_mode`.

**Decision.** A new global flag `FEATURE_PRICING`, default `false`, and the client plumbing to read it.

- **Not OR-ed with demo mode.** Every existing guard is written `app.flag('X') or app.is_demo_mode()`
  (`20260927000026:19,128`, `20260927000024:145`), which turns a feature *on* in demo mode. Staging runs in demo
  mode, and staging is exactly where the prices must be gone, so `app.pricing_enabled()` reads the flag alone.
- **`list_plans` answers, it does not raise.** It is anon-granted and its callers index `price_items` directly
  (`LabelsPage.tsx`), so with pricing off it returns the same shape with `plans: []`, `price_items: {}` and a new
  `pricing_enabled: false`. Raising would have turned the märke order form into an error page, and returning the
  real prices with a flag beside them would have left them one devtools request away.
- **`apps/web/src/lib/flags.ts` exposes two shapes**, because hiding and redirecting need different answers while
  the query is in flight. `useFlag` answers from the build-time default immediately — waiting would make a gated
  link flash in and out on every cold load of the public site. `useFlagState` also reports `loading`, for the cases
  where the answer decides a redirect. `/pricing` uses the second: the first version used `useFlag` and redirected
  on the default before the database had answered, so the page was unreachable even with the flag on. The e2e test
  caught it.
- **Nothing is deleted.** Every page, plan row and price row stays. A superadmin turns it back on from
  **Funktionsflaggor** in the operator view and the whole surface returns.

**Consequences.** The operator's own price editing (`admin_billing_overview`, `admin_set_price`) and invoice
generation are untouched — they do not go through `list_plans` — so billing keeps working behind the scenes while
customers see no prices. `e2e/a11y.spec.ts` no longer audits `/pricing`, since it redirects to `/`, which is
audited anyway.

The pattern established here is the one to copy for the next client-read flag: a default in
`packages/shared/src/config.ts`, a row in `app_config`, an `admin.flags.desc.<FLAG>` key in both languages so the
operator's page does not show a raw key, and `useFlag` / `useFlagState` depending on whether the flag hides
something or decides a navigation.
