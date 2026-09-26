# MaskinID

Registret där maskinhandlare, maskinägare, långivare och försäkringsgivare ser **vem som äger en maskin, om den är belånad och vem som försäkrar den** – i ett uppslag.

Det här repot innehåller hela frontenden (React + TypeScript + Vite) byggd efter MaskinIDs grafiska profil, samt ett färdigt Supabase-schema som backend kopplas mot. Tills Supabase är uppsatt körs appen mot en mock-backend med exempeldata i webbläsaren.

## Kom igång

Kräver [Node.js](https://nodejs.org) 20.19 eller senare.

```bash
git clone https://github.com/maskinidab/maskinid.git
cd maskinid
npm install
npm run dev          # öppna http://localhost:5173
```

Appen startar i **demoläge** (`VITE_DATA_SOURCE=mock`). Logga in med något av demokontona – lösenord `maskinid`:

| Konto | Organisation | Roll |
| --- | --- | --- |
| `agare@exempel.se` | Exempel Anläggning AB | Maskinägare |
| `handlare@exempel.se` | Maskinhandel Mitt AB | Maskinhandlare |
| `langivare@exempel.se` | Exempelbanken AB | Långivare |
| `forsakring@exempel.se` | Exempelförsäkring AB | Försäkringsgivare |
| `admin@exempel.se` | MaskinID Sverige AB | Registerhållare, administratör |

Prova att söka på `7KX0L2T4003198` (belånad hjullastare), `1FG5H3R8002741` (grävmaskin) eller `9DM2T7A5000452` (anmäld stulen).

## Skript

| Kommando | Vad |
| --- | --- |
| `npm run dev` | Utvecklingsserver |
| `npm run build` | Typkontroll och produktionsbygge till `dist/` |
| `npm run preview` | Förhandsgranska bygget |
| `npm run build:demo` | Fristående demo som en enda HTML-fil (`dist-demo/maskinid-demo.html`) – mock-data, hash-routing |
| `npm run lint` | Oxlint |
| `npm run typecheck` | TypeScript |
| `npm test` | Enhetstester (Vitest): format, identifierare, mock-backend |
| `npm run test:db` | Kör Supabase-migrering, seed och alla RPC-funktioner mot inbäddad Postgres (PGlite) |
| `npm run tokens` | Genererar `src/styles/tokens.css` från `design-system/tokens.json` |

## Vyer

| Sökväg | Vy | Inloggning |
| --- | --- | --- |
| `/` | Startsida med registersök | – |
| `/sok?q=…` | Sökresultat – registerposten | – |
| `/maskin/:id` | Hela registerposten: maskinuppgifter, spärrar, belåning, försäkring, historik och ändringar enligt behörighet | Läsning öppen, ändringar kräver inloggning |
| `/maskin/:id/utdrag` | Hämta registerutdrag | Ja |
| `/utdrag/:utdragsnummer` | Utfärdat registerutdrag med sigill, utskriftsvänligt | – (verifiering) |
| `/logga-in` | Inloggning med lösenord eller e-postlänk | – |
| `/mina-sidor` | Översikt över organisationens maskiner | Ja |
| `/mina-sidor/registrera-maskin` | Registrera ny maskin (ägare och handlare) | Ja |
| `/admin` | Administration: bjud in användare, skapa organisationer | Administratör |
| `/sa-fungerar-det` | Om registret, status och roller | – |
| `/profil` | Levande referens för den grafiska profilen | – |

## Struktur

```
design-system/          Exporterad grafisk profil: tokens.json, profilbok och originalstilar
src/assets/logo/        Logotyper (vektorbanor ur MaskinID.eps) – ritas aldrig om
src/assets/fonts/       Archivo, Archivo Expanded, IBM Plex Mono
src/
  styles/               tokens.css (genererad), components.css (mid-*-klasser), app.css (layout)
  components/           IdFrame, StatusBadge, LookupField, RecordCard, Seal, RegisterExtractHeader, Layout …
  pages/                En fil per vy
  auth/                 AuthContext – inloggningsstatus för hela appen
  lib/
    types.ts            Domänmodellen (speglar databasen)
    api/                MaskinIdApi-kontraktet + mockApi och supabaseApi
    permissions.ts      Behörighetsregler (samma som i databasen)
    format.ts           Datum, tid och belopp enligt profilens tonalitet
  data/seed.ts          Exempeldata för mock-läget
supabase/
  migrations/           Schema, RLS och RPC-funktioner (registret + administration)
  functions/invite-user Edge Function som bjuder in användare
  seed.sql              Samma exempeldata som mock-läget
  tests/                Databastester (PGlite)
docs/
  BACKEND.md            Hur Supabase kopplas på – datamodell, säkerhet, API-kontrakt
  DESIGN.md             Hur den grafiska profilen används i koden
```

## Backend

Se **[docs/BACKEND.md](docs/BACKEND.md)**. Kortversion:

1. `supabase link --project-ref ilutcrqeqgluymgcapqg`, `supabase db push` och `supabase functions deploy invite-user`.
2. Kopiera `.env.example` till `.env`, sätt `VITE_DATA_SOURCE=supabase` och fyll i URL och publishable key.
3. Starta om `npm run dev`. Ingen frontendkod behöver ändras.

## Grafisk profil

Allt utgår från profilen i `design-system/` – se **[docs/DESIGN.md](docs/DESIGN.md)** och vyn `/profil` i appen.
