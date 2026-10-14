# Runbook – produktion som stängd pilot (ADR 0034)

Riktiga konton och riktig e-post, Demo-BankID tills ett BankID-avtal finns, och MaskinID godkänner varje organisation.
Stegen görs en gång. Allt som går att göra i kod görs av deploy-flödet; det här är det som kräver ett konto, en DNS-
post eller en inställning i en extern tjänst.

## 1. Resend – avsändardomän

1. Skapa konto på resend.com och lägg till domänen `maskinid.se` (Domains → Add domain, region EU).
2. Lägg in de DNS-poster Resend visar hos er DNS-leverantör: SPF (TXT på `send`), DKIM (TXT `resend._domainkey`) och
   MX för studsar. Lägg gärna till DMARC: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dmarc@maskinid.se`.
3. Vänta tills domänen står som *Verified*.
4. Skapa en API-nyckel med behörigheten *Sending access*, begränsad till `maskinid.se`. Den används på två ställen
   nedan och ska inte klistras in i någon chatt.

## 2. GitHub – miljön `production`

Settings → Environments → production.

**Variables**

| Namn | Värde |
|---|---|
| `DEMO_MODE` | `false` |
| `MOCK_IDENTITY` | `true` |
| `REQUIRE_ORG_APPROVAL` | `true` |
| `OPERATOR_EMAIL` | `maskinidab@gmail.com` |
| `IDENTITY_PROVIDER` | `mock` |
| `SIGNATURE_PROVIDER` | `mock` |
| `COMPANY_LOOKUP_PROVIDER` | `mock` |
| `VEHICLE_REGISTRY_PROVIDER` | `mock` |
| `THEFT_REGISTRY_PROVIDER` | `mock` |
| `OCR_PROVIDER` | `mock` (eller `anthropic` med nyckel nedan) |
| `EMAIL_FROM` | `MaskinID <noreply@maskinid.se>` |
| `PUBLIC_APP_URL` | `https://app.maskinid.se` |

Sätt **inte** `APP_ORIGIN` under piloten: den begränsar Edge Functions till ett enda ursprung, och både webbplatsen
och appen anropar dem (ADR 0035). Osatt svarar de alla ursprung, som i dag – inloggning krävs ändå där det behövs.

**Secrets**: `RESEND_API_KEY` (från steg 1), valfritt `ANTHROPIC_API_KEY`.

Staging behöver inga av dessa: utan variabler fortsätter staging i demoläge som i dag.

## 3. Supabase – produktionsprojektets Auth-inställningar

Dashboard → projekt `ogpqatvgamzgwwhgtlcr` → Authentication.

- **Sign In / Providers → Email**: *Confirm email* = på. *Secure email change* = på.
- **URL Configuration**: Site URL `https://app.maskinid.se`. Redirect URLs: `https://app.maskinid.se/auth/callback`
  (och tills domänen pekar rätt även `https://maskinid.vercel.app/auth/callback`).
- **Emails → SMTP Settings**: på. Host `smtp.resend.com`, port `465`, användare `resend`, lösenord = Resend-nyckeln,
  avsändare `noreply@maskinid.se`, namn `MaskinID`. Utan detta skickar Supabase bara till projektets egna medlemmar,
  ett par mejl i timmen – en kund får aldrig sitt bekräftelsemejl.
- **Rate limits**: höj *Emails sent per hour* (t.ex. 100) när SMTP är på.
- **Emails → Templates**: svenska texter för *Confirm signup*, *Magic Link* och *Reset password*, t.ex.
  ämne `Bekräfta din e-postadress för MaskinID` och en knapp till `{{ .ConfirmationURL }}`.
- **Multi-Factor**: TOTP på (standard). Långivare, myndigheter och operatören måste använda det utanför demoläget.

## 4. Deploy

Kör **Deploy** mot production (eller slå ihop till `main`). Flödet sätter flaggorna, kopierar schemaläggarens hemlighet
till funktionerna, sätter funktionernas inställningar, schemalägger jobben och gör `maskinidab@gmail.com` till
superadmin – det sista först när kontot finns, och utan risk att köra om.

## 5. Kontroll

1. `curl https://ogpqatvgamzgwwhgtlcr.supabase.co/functions/v1/health` → `"ok":true`.
2. Logga in som `maskinidab@gmail.com` → slå på tvåstegsverifiering (krävs för operatören utanför demoläget) →
   **Admin**. Översikten ska visa *Pilotläge*.
3. Skapa ett testkonto med en annan e-postadress: bekräftelsemejlet ska komma från `noreply@maskinid.se`, ansökan ska
   landa under **Admin → Organisationer** och ett mejl till operatören. Godkänn → testkontot får ett mejl och kan logga in.
4. **Admin → E-postlogg**: inga misslyckade mejl. **Admin → Jobb**: schemaläggaren är klar och jobben körs.

## 6. Webbplats och app på egna domäner (ADR 0035)

Två Vercel-projekt från samma GitHub-repo.

**Appen** – det befintliga projektet (`maskinid`):
- Domän: `app.maskinid.se` för Production.
- Environment Variables, Production: `VITE_SITE_URL=https://maskinid.se`, `VITE_APP_URL=https://app.maskinid.se`
  (utöver de befintliga `VITE_DATA_SOURCE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_DEMO_MODE=false`).
- Preview (staging): `VITE_APP_URL` = appens staging-adress, `VITE_SITE_URL` = webbplatsens staging-adress.

**Webbplatsen** – nytt projekt (`maskinid-site`):
- Import samma repo. Root Directory `apps/site`, och slå på *Include files outside the Root Directory*.
  `apps/site/vercel.json` sköter install, bygge och omskrivningar.
- Production Branch `main`; staging-grenen blir preview.
- Environment Variables: `VITE_DATA_SOURCE=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_DEMO_MODE=false`, `VITE_SITE_URL`, `VITE_APP_URL` – samma värden som appen, per miljö.
- Domän: `maskinid.se`, och `www.maskinid.se` som omdirigering till `maskinid.se`.

**DNS** (hos er DNS-leverantör, värdena Vercel visar när domänerna läggs till):
- `maskinid.se` → A-post till Vercel.
- `www` och `app` → CNAME till Vercel.

**Supabase** (steg 3): Site URL och Redirect URLs ska vara `https://app.maskinid.se/...` – inloggningen sker i appen.
**GitHub** (steg 2): `PUBLIC_APP_URL` = `https://app.maskinid.se` (länkarna i mejlen går till appen).

Kontroll: öppna `https://maskinid.se`, klicka *Logga in* (ska hamna på `app.maskinid.se/login`); skanna ett märke
(ska öppna `maskinid.se/m/…`); skriv ut ett märkesark i appen och kontrollera att QR-koden pekar på `maskinid.se`.
