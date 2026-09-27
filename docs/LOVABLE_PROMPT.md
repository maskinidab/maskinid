# Prompt till Lovable

Klistra in texten nedan som första prompt. Bifoga/klistra sedan in `SPEC.md` i sin helhet i samma meddelande eller som knowledge-fil i projektet. Lovable bygger bäst i iterationer, så prompten ber om skalet + de tre viktigaste flödena först och listar resten som "nästa steg" som du kör en i taget.

---

Läs SPEC.md v1.1 i sin helhet (särskilt §4 datamodell inkl. [v1.1]-fälten och §19). Bygg en komplett webbapplikation (PWA, mobil först) som heter **Maskinpass** (arbetsnamn, lägg som konstant `APP_NAME`): ett digitalt register för tunga arbetsmaskiner (grävmaskiner, hjullastare, dumprar, traktorer, skogsmaskiner). Varje maskin får ett unikt registreringsnummer och ett QR-märke. Registret visar verifierad ägare, historik och om det finns finansieringsförbehåll (avbetalning/leasing/uthyrning). Syftet är att stoppa dubbelfinansiering, bedrägerier och stölder, och att vara ett riktigt bra vardagsverktyg för maskinhandlare och maskinägare. Den fullständiga specifikationen finns i den bifogade `SPEC.md` – följ den exakt (datamodell §4, flöden §6, skärmar §9, design §10, säkerhet §11).

**Stack:** Vite + React + TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, react-hook-form + zod, i18next (svenska default, engelska), QR-skanning via kamera, Supabase (Postgres med RLS, Auth, Storage, Edge Functions).

**Icke förhandlingsbart:**
- RLS på alla tabeller med default deny. All skrivning i registertabeller via Postgres RPC-funktioner (security definer) som kontrollerar behörighet – klienten skriver aldrig direkt.
- `events`-tabellen är append-only (trigger förbjuder update/delete) och hashkedjad.
- Högst ett aktivt finansieringsförbehåll per maskin. Ett andra försök ska blockeras med tydligt fel, skapa en konflikt och notifiera befintlig finansiär och ägaren.
- Inga belopp någonstans i registret.
- Alla UI-texter via i18n. Kod, tabeller och routes på engelska.
- Demo-läge: mock-BankID (tydligt märkt "Demo-BankID"), mock-företagsuppslag, mock-OCR.

**Design:** nordisk, saklig, förtroendeingivande. Inter för UI, JetBrains Mono för registreringsnummer och serienummer. Färgtokens: bakgrund #FAFAF8, yta #FFFFFF, text #14161A, accent #0F4C5C (petrol). Statusfärger låsta: grön = verifierad/aktiv, gul = väntar/nivå 0, röd = stulen/spärrad/konflikt, blå = förbehåll. Inga gradienter, inga dekorativa illustrationer i arbetsvyer. Mobil: bottennavigering med stor central "Skanna"-knapp. Desktop: sidomeny + global sök (Cmd+K). Tomma tillstånd har alltid en primär handling. Skeletons vid laddning. WCAG AA.

**Bygg i denna ordning, och stanna efter varje steg så jag kan granska:**

**Steg 1 – Grund och skal.** Supabase-schema enligt SPEC §4 (alla tabeller, enums, index, RLS, triggers för events), RPC-funktioner för organisationer, maskiner, märken, förbehåll, ägarbyten, flaggor. Auth med signup/login/magic link, "Verifiera identitet" (mock-BankID), skapa organisation med organisationsnummer-uppslag (mock), välj typ (ägare/handlare/finansbolag/försäkringsbolag/myndighet/besiktning). Org-växlare. Navigation per roll. Designtokens och komponenter: `RegNumber`, `VerificationBadge`, `StatusBanner`, `MachineCard`, `Timeline`, `ScanButton`, `SerialInput` (validerar och kollar dubbletter live), `CompanyLookupField`, `DocumentDropzone`. Seed-data enligt SPEC §17.

**Steg 2 – Registrera maskin + publik skanning.** Wizard i fyra steg (identitet med "Fota skylten" → mock-OCR-förslag, maskin med modellkatalog, ägare & finansiering, knyt märke via kameraskanning), autosparade utkast, klart-sida med regnr. Publik sida `/m/:code` och `/r/:regnr` enligt SPEC §5.3 med statusbanner (röd fullskärm vid stulen), verifieringsbadge, maskerat serienummer, "logga in för förbehåll". Maskinsidan med flikar Översikt / Historik (tidslinje från events) / Dokument / Förbehåll / Service / Åtkomst.

**Steg 3 – Pengarna och bedrägeriskyddet.** Finansiärsvy: sök (regnr/serienr), resultat med "aktivt förbehåll: JA/NEJ", kvitto med nummer och PDF, "Registrera förbehåll" med signering (mock), blockering vid befintligt förbehåll med konflikt och notiser, "Släpp förbehåll" (bara holder). Ägarbyte: säljare initierar → finansiär godkänner om förbehåll → köpare accepterar med signering → ägarbevis-PDF. Flaggor: stulen (publik röd sida, skanning loggas och notifierar ägaren), spärrad (myndighet), skrotad/exporterad. Inbox "Väntar på mig".

**Nästa steg (kör en i taget efter granskning):**
4. Handlarverktyg: Lager, "Sälj maskin"-flöde som gör ägarbyte + förbehåll + ägarbevis i ett svep (nivå 2 direkt), "Ta emot inbyte" via skanning, leads från annons-QR, kundlista, beställ märken.
5. Bulkimport: CSV/Excel med automatisk kolumnmappning, validering, förhandsgranskning, felrapport.
6. Verifieringskö (nivå 0→1→2) för operatör och betrodda partner, konfliktkö, duplikathantering.
7. Flotta: timmätare, service och påminnelser, besiktning av kontrollorgan med "Besiktigad t.o.m."-badge, projekt/arbetsplats, dokumentvalv, försäkring, uthyrning, flott-/upphandlingsrapport (PDF och delningslänk med utsläppssteg, bränsle, vikt, effekt, besiktningsstatus per maskin).
8. Delning: tidsbegränsad maskinrapport-länk, annons-badge (SVG), bevakning av serienummer.
9. Portaler: försäkringsbolag, myndighet (partiell sök, efterlysning/beslag, spärr, exportkontroll, aggregerad beredskapsexport, registerutdrag-PDF), besiktning/kontrollorgan, tillverkare (leveransdata som förifyller registrering), beställare (read-only delade flottrapporter).
10. API och webhooks: API-nycklar med scopes, `/v1/checks`, `/v1/machines`, `/v1/encumbrances`, webhooks med signatur och retry, API-dokumentation.
11. Marknadsbevakning: tabeller för källor/observationer/alerts, admin-dashboard, "Vi hittade era annonserade maskiner"-flöde. (Själva insamlingen körs som separat worker – bygg bara datamodell, matchning och UI här.)
12. Operatörsadmin: godkännandekö för organisationer, märkesbatcher, händelselogg-utforskare med ankarverifiering, API-användning, feature flags, publik `/security`-sida.

Börja med steg 1. Visa mig schemat och RLS-policies innan du bygger UI.
