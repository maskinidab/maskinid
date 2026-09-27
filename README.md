# MaskinID

Ett fristående register för tunga arbetsmaskiner: vem som äger maskinen, om den är belånad, vem som försäkrar den, hela historiken och stöldskydd med QR-märke. Handlare, ägare, långivare, försäkringsgivare, myndigheter och kontrollorgan arbetar i samma register, var och en med sin behörighet.

Allt skrivs via databasfunktioner med behörighetskontroll, varje ändring blir en händelse i en hashkedja som inte går att ändra i efterhand, och inga belopp eller personnummer lagras i klartext. Sanningskällan för vad som ska finnas är [docs/SPEC.md](docs/SPEC.md). Byggloggen finns i [PROGRESS.md](PROGRESS.md).

## Kom igång på 10 minuter

Du behöver [Node.js](https://nodejs.org) 20.19 eller senare. Inget konto, ingen databas och ingen nyckel behövs för att prova.

```bash
git clone https://github.com/maskinidab/maskinid.git
cd maskinid
npm install
npm run dev              # öppna http://localhost:5173
```

Appen startar i **demoläge**: hela registret (samma migrationer och exempeldata som i produktion) körs som en riktig Postgres-databas i webbläsaren. Första sidladdningen tar några sekunder medan databasen packas upp. Allt du gör sparas bara i din webbläsare, och "Återställ demodata" i den gula demoraden börjar om från början. BankID, bolagsuppslag, OCR, betalning och e-post är ersatta av tydligt märkta demoversioner.

Logga in med något av demokontona, lösenord `demo1234`:

| Konto | Organisation | Prova |
| --- | --- | --- |
| `berg@demo.se` | Bergs Schakt & Entreprenad AB (ägare) | Registrera en maskin med typskyltsfoto, daglig kontroll, anmäl stöld, dela en köparrapport |
| `nordmaskin@demo.se` | Nordmaskin AB (handlare) | Importera lager, sälj en maskin med finansiering, beställ märken, kommission |
| `bank@demo.se` | Demo Bank Finans (långivare) | Portfölj, registrera och bekräfta förbehåll, kontroll med kvitto |
| `finans@demo.se` | Nordisk Maskinfinans (långivare) | Se att en andra finansiering stoppas |
| `forsakring@demo.se` | Demo Försäkring | Försäkringsportalen |
| `polisen@demo.se` | Polisen (demo) | Partiell sökning, efterlysning, beslag |
| `kontroll@demo.se` | Maskinkontroll Sverige AB | Besiktningar och verifieringskö |
| `admin@demo.se` | MaskinID Sverige AB (operatör) | Godkännanden, konflikter, händelseutforskare, schemalagda jobb, "Visa som organisation" |

På startsidan finns genvägar till en fysiskt verifierad maskin, en belånad maskin, en anmäld stulen maskin och en skrotad maskin.

### Kör testerna

```bash
npm run lint
npm run typecheck
npm test                 # enhetstester (Vitest)
npm run check:functions  # Edge Functions: deno check + deno test
```

Databastesterna kör varje RLS-policy och varje RPC-funktion med en testanvändare per roll. De behöver en lokal PostgreSQL 16 på port 54322, till exempel:

```bash
docker run -d --name maskinid-pg -p 54322:5432 -e POSTGRES_PASSWORD=postgres postgres:16
npm run db:reset         # alla migrationer + seed
npm run test:db
```

Med Supabase CLI fungerar `supabase start` i stället, kör då `SUPABASE_LOCAL=1 npm run test:db` (se [ADR 0008](docs/adr/0008-test-database.md)).

End-to-end-testerna startar appen själva och kör i Chromium mot demodatabasen i webbläsaren:

```bash
npx playwright install chromium
npm run test:e2e         # alla flöden, mobil och tillgänglighet (axe)
npm run test:a11y        # bara tillgänglighet
```

Lighthouse mäts mot ett produktionsbygge (se kommentaren i [scripts/lighthouse.mjs](scripts/lighthouse.mjs)):

```bash
npm run build && npm run preview &
npm run lighthouse -- --no-performance   # demobygget; utelämna flaggan för Supabase-bygget
```

## Skript

| Kommando | Vad |
| --- | --- |
| `npm run dev` | Utvecklingsserver med demodatabasen i webbläsaren |
| `npm run build` / `npm run preview` | Produktionsbygge av webbappen och förhandsgranskning |
| `npm run lint` / `npm run typecheck` | Oxlint och TypeScript (alla paket, API-funktionen och e2e) |
| `npm test` | Enhetstester |
| `npm run test:db` | RLS- och RPC-tester mot lokal Postgres |
| `npm run db:reset` / `npm run db:types` | Återskapa lokal databas / generera `packages/shared/src/database.types.ts` |
| `npm run test:e2e` / `npm run test:a11y` | Playwright-sviten / bara axe-granskningen |
| `npm run lighthouse` | Lighthouse-budget för de publika sidorna |
| `npm run check:functions` / `npm run sync:functions` | Kontrollera Edge Functions / kopiera delad kod till dem |
| `npm run ingest` | Marknadsbevakningen (annonsflöden) |
| `npm run tokens` | Designtokens från `design-system/tokens.json` |

## Struktur

```
apps/web/              Webbappen (Vite, React 19, TypeScript) – PWA, sv/en, MaskinIDs grafiska profil
apps/ingest/           Marknadsbevakning: connectors, matchning, juridiska räcken
packages/shared/       Delad kod: regnr, identifierare, i18n (sv/en), adaptrar med mockar, PDF, API-kontrakt
supabase/migrations/   Schema, RLS, RPC-funktioner, hashkedja, jobb – en migration per steg
supabase/seed/         Demoregistret (SPEC §17)
supabase/functions/    Edge Functions (Deno): BankID, OCR, e-post, API v1, webhooks, telematik, betalning …
supabase/tests/        Databastester per roll
api/                   Vercel-funktion för PDF:er på serversidan
e2e/                   Playwright: flöden, mobil, tillgänglighet
docs/                  SPEC, ADR:er, runbooks, öppna frågor
design-system/         Den grafiska profilen (tokens, typsnitt, logotyper)
```

## Driftsättning

Uppsättning av Supabase, Vercel, hemligheter, schemalagda jobb, övervakning och backupövning beskrivs steg för steg i [docs/runbooks/setup.md](docs/runbooks/setup.md). Alla inställningar finns samlade i [.env.example](.env.example). Migrationer mot staging och produktion körs bara via GitHub Actions (`deploy.yml`), aldrig från en utvecklares dator.

För att köra webbappen mot ett Supabase-projekt: kopiera `.env.example` till `.env`, sätt `VITE_DATA_SOURCE=supabase` och fyll i `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Dokumentation

- [docs/WORKFLOW.md](docs/WORKFLOW.md) – så arbetar du lokalt, mot staging och mot produktion (pipeline, tester, miljöer)
- [docs/SPEC.md](docs/SPEC.md) – kravspecifikationen
- [docs/adr/](docs/adr/) – arkitekturbeslut, ett per vägval
- [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) – antaganden som bör bekräftas
- [docs/runbooks/](docs/runbooks/) – drift, incidenter, backup, hemligheter, integrationer
- [docs/DESIGN.md](docs/DESIGN.md) – hur den grafiska profilen används i koden
- `/api-docs` i appen – API v1 med OpenAPI-specifikation och sandlåda
