# Runbook – miljöerna dev, demo och produktion (ADR 0036)

| | Adress | Gren | Supabase | Data |
|---|---|---|---|---|
| Dev | https://dev.maskinid.se | `dev` | `okgwcmgjdvtmbgjhvwwt` (delas med demo) | demodata |
| Demo | https://demo.maskinid.se | `staging` | `okgwcmgjdvtmbgjhvwwt` | demodata |
| Produktion | https://app.maskinid.se, webbplats https://maskinid.se | `main` | `ogpqatvgamzgwwhgtlcr` | riktig data |

Arbetsgång: utveckla på `dev` → PR till `staging` (demo) → PR till `main` (produktion, godkännande krävs).
Obs: `dev` och demo delar backend. Det som pushas till `dev` gäller direkt i demons databas – pusha inte till `dev`
under en pågående demo.

Ordningen nedan spelar roll: Vercel först (så att domänerna finns), sedan DNS, sedan Resend och Supabase.

## 1. Vercel (Hobby räcker)

### Appen – befintliga projektet `maskinid`
1. **Settings → Domains**
   - `app.maskinid.se` → Production.
   - `demo.maskinid.se` → *Git branch* `staging`.
   - `dev.maskinid.se` → *Git branch* `dev`.
2. **Settings → Environment Variables**
   - *Production*: `VITE_DATA_SOURCE=supabase`, `VITE_SUPABASE_URL=https://ogpqatvgamzgwwhgtlcr.supabase.co`,
     `VITE_SUPABASE_PUBLISHABLE_KEY=<prod-nyckeln>`, `VITE_DEMO_MODE=false`,
     `VITE_SITE_URL=https://maskinid.se`, `VITE_APP_URL=https://app.maskinid.se`.
   - *Preview* (gäller både demo och dev): `VITE_DATA_SOURCE=supabase`,
     `VITE_SUPABASE_URL=https://okgwcmgjdvtmbgjhvwwt.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY=<staging-nyckeln>`.
     Inga `VITE_SITE_URL`/`VITE_APP_URL`: i demo och dev ligger de publika sidorna på samma adress som appen, så
     demomärkenas QR-koder fungerar där.
3. Gör om senaste deployen av `main` (*Redeploy*) när variablerna är satta – de byggs in vid bygget.

### Webbplatsen – nytt projekt `maskinid-site`
1. **Add New → Project** → samma GitHub-repo.
2. **Root Directory**: `apps/site`. Slå på *Include files outside the Root Directory in the Build Step*.
   Framework: Vite. Install-, bygg- och utkatalog läses från `apps/site/vercel.json`.
3. **Environment Variables** (*Production*): samma som appens Production ovan.
4. **Domains**: `maskinid.se` (Production) och `www.maskinid.se` med *Redirect to* `maskinid.se`.
   Projektet bygger bara `main` – webbplatsen visar alltid produktion.

## 2. DNS hos Loopia

Loopia Kundzon → Domäner → `maskinid.se` → DNS-editor. I dag pekar `@`, `www` och `*` på Loopias parkeringssida
(`194.9.94.85` / `194.9.94.86`). **Rör inte MX-posterna eller SPF-posten** (`v=spf1 include:spf.loopia.se -all`) – det
är e-posten på domänen.

| Värd | Typ | Värde | Kommentar |
|---|---|---|---|
| `@` | A | det Vercel visar för `maskinid.se` (normalt `76.76.21.21`) | ersätter båda Loopia-A-posterna |
| `www` | CNAME | det Vercel visar (normalt `cname.vercel-dns.com.`) | ta bort `www`:s A-poster |
| `app` | CNAME | det Vercel visar | |
| `demo` | CNAME | det Vercel visar | |
| `dev` | CNAME | det Vercel visar | |
| `*` | A | – | kan ligga kvar; egna poster ovan går före jokertecknet |

Om Vercel visar en TXT-post `_vercel` för verifiering, lägg in den också. Ändringar hos Loopia slår igenom inom
någon timme; Vercel skapar SSL-certifikaten själv när posterna syns.

## 3. Resend – e-post från `maskinid.se`

1. Resend → Domains → Add `maskinid.se` (region EU).
2. Lägg in posterna Resend visar hos Loopia – de krockar inte med Loopias e-post:
   - TXT `resend._domainkey` (DKIM),
   - MX `send` (studsar, prio 10) och TXT `send` (SPF för `send.maskinid.se`),
   - rekommenderat: TXT `_dmarc` = `v=DMARC1; p=none;`.
3. När domänen är *Verified*: skapa en API-nyckel (*Sending access*). Gratisplanen räcker i piloten (100 mejl/dag).

## 4. GitHub – miljöerna

Settings → Environments.

**production**: variablerna och hemligheten i `go-live.md` steg 2.

**staging** (demo och dev):

| Variabel | Värde |
|---|---|
| `OPERATOR_EMAIL` | `maskinidab@gmail.com` |
| `FUNCTIONS_DEMO_MODE` | `false` (riktig e-post till testare; databasen stannar i demoläge) |
| `IDENTITY_PROVIDER`, `SIGNATURE_PROVIDER`, `COMPANY_LOOKUP_PROVIDER`, `VEHICLE_REGISTRY_PROVIDER`, `THEFT_REGISTRY_PROVIDER`, `OCR_PROVIDER` | `mock` |
| `EMAIL_FROM` | `MaskinID Demo <demo@maskinid.se>` |
| `PUBLIC_APP_URL` | `https://demo.maskinid.se` |

Hemlighet: `RESEND_API_KEY`. Under *Deployment branches* för `staging`: tillåt både `staging` och `dev`.

## 5. Supabase Auth

**Staging-projektet** `okgwcmgjdvtmbgjhvwwt` → Authentication:
- URL Configuration: Site URL `https://demo.maskinid.se`; Redirect URLs `https://demo.maskinid.se/**`,
  `https://dev.maskinid.se/**`, `https://*-maskinid.vercel.app/**`.
- SMTP via Resend som i `go-live.md` steg 3, avsändare `demo@maskinid.se`. Utan det kan inbjudna testare inte
  bekräfta sina konton.

**Produktionsprojektet**: `go-live.md` steg 3, Site URL `https://app.maskinid.se`, Redirect URLs `https://app.maskinid.se/**`.

## 6. Operatören i alla tre

Skapa kontot `maskinidab@gmail.com` på `demo.maskinid.se` och på `app.maskinid.se` (dev delar demos konton).
Nästa deploy till respektive miljö gör kontot till superadmin. Utanför demoläge krävs tvåstegsverifiering för
operatören – i produktion ber appen dig slå på den första gången.

## 7. Nollställa demo

GitHub → Actions → **Reseed demo** → Run workflow → skriv `demo`. Tömmer demo (och dev), läser in demodatan igen och
kör Deploy. Vägrar produktionsprojektet.
