# 0028 – Märken på skärmen, etikettark, och ett skannat märke som väg in i registret

Datum: 2026-10-10
Status: Antagen

## Problem

QR-märket är produktens fysiska ankare, men det gick inte att *se* någonstans. QR-koder ritades bara in i två
PDF:er (annonsskylten och lagerlappen, `apps/web/src/lib/pdf/adQr.ts`), operatörens "tryckfil" var en CSV med
`code,url`, och ett nytt märke som ingen använt gav "finns inte i registret" när man skannade det. Produktägaren
ville kunna göra precis det demon handlar om: sätta ett märke på en maskin, skanna det med telefonen, och
antingen se maskinen eller registrera den.

Tre hinder, alla verifierade i koden:

1. `public_machine_card` (`20260927000005_machines.sql:1029`) svarade `unknown_label` både för en kod som inte
   är vår och för ett riktigt märke som ingen bundit — en gren, två betydelser. Sidan kunde alltså inte skilja
   dem och kunde inte erbjuda registrering för det ena utan att göra det för det andra.
2. En felaktig eller upptagen kod upptäcktes först av `register_machine`, som *raisar* på `LABEL_NOT_FOUND` och
   `LABEL_ASSIGNED_TO_OTHER_ORG` och därmed river hela registreringen efter fyra ifyllda steg.
3. `register_machine` → `bind_label` returnerar `{ok:false, error:'LABEL_ALREADY_USED'}` **utan** att raisa
   (`machines.sql:932`), men guiden läste aldrig svaret: maskinen skapades, ett konfliktärende hamnade hos
   operatören, och användaren fick ett oreserverat "klart".

## Beslut

### QR på skärmen, men serienumret som enda text

`apps/web/src/components/QrCode.tsx` renderar inline-SVG från `qrcode`, **dynamiskt importerad** inne i
effekten — samma grepp som `Scanner.tsx:36` använder för zxing, så `qrcode` aldrig hamnar i en chunk som de
Lighthouse-budgeterade publika sidorna drar in. SVG i stället för `toDataURL`: en komponent duger då till 96 px
i en tabellrad, 320 px i en dialog och skarp utskrift, utan canvas (och går att enhetstesta utanför en
webbläsare).

Den fullständiga 22-teckenskoden **visas inte längre som text**. Den är bäraren i QR-URL:en, och den stod förut
på varje maskinsida (`MachinePage.tsx:293`). Nu visas `labelSerial()` — de sex tecken som faktiskt är tryckta på
dekalen — och koden lever bara i QR-bilden, bakom ett medvetet klick, ett märke i taget. Kolumnen "Visa QR" i
`LabelsPage` saknar avsiktligt `value()`, vilket utesluter den från både sökning och CSV-exporten
(`DataTable.tsx:55`).

QR visas inte på `/m/:code` eller `/r/:reg`. Besökaren håller dekalen i handen.

### Etikettark med skärmärken, inte en gissad stans

`apps/web/src/lib/pdf/labelSheet.ts` ger A4, 3 × 6 = 18 dekaler per sida, med QR, sexteckensserien, hela koden
i 4,5 pt och en skärlinje. `order_labels` levererar redan fysiska märken, så det finns rimligen en verklig stans
(Avery/Herma) — men en **felgissad** stans trycker 18 dekaler som ser rätt ut och är 2 mm fel överallt, medan
skärmärken bara är obekväma. Byt till en stanskod när den verkliga är känd.

Operatörens CSV behålls (tryckeriet vill ha `code,url`); arket ligger intill. Organisationen skriver ut sina
egna oanvända märken från `LabelsPage` — koderna finns redan i `list_labels`-svaret, så ingen ny RPC och ingen ny
auktoriseringsyta behövs.

### `unbound_label` som eget svar

Migration `20261010000006_label_scan_registration.sql` delar grenen: `unknown_label` när koden inte finns,
`unbound_label` när märket finns men inte är bundet. Exponeringen är medveten och liten — en anonym besökare får
veta att en kod *de redan håller i handen* är ett riktigt oanvänt märke. Koden är 131 bitar CSPRNG från
`app.generate_label_code`, och `log_public_scan` begränsar anonyma uppslag till 30/min och 300/dygn per hashad IP.

Ny `public.check_label(p_org_id, p_code)` svarar, läsbart för `readonly`, om ett märke går att binda och annars
varför — utan att någonsin namnge den organisation ett märke tillhör, och med `machine_id` bara när maskinen är
aktörens egen. Det är den som gör att guiden kan säga "märket är ledigt" innan användaren skrivit något.

`public.scan_label` lämnas orörd: den kan inte skilja obunden från okänd, har noll anropsställen och noll tester.
Antingen adopteras den (med `reason`, anropad från `ScanButton`) eller raderas — en egen fråga.

### Koden rider i URL:en

Den publika sidan länkar en inloggad besökare direkt till `/o/<slug>/machines/new?code=<kod>`, med
organisationens namn i knapptexten så att den som har flera register ser vilket hen är på väg att skriva i. Alla
andra går via `/go?to=…` (`routes.tsx:92`), som redan bär ett mål genom inloggning *och* onboarding. Ingen
localStorage, inget eget tillstånd — och `setParams` i guiden bytte förut ut hela query-strängen, vilket åt upp
`?code=` vid första autosparandet.

### Skiftläge fixas i klienten, aldrig i SQL

Tre ställen versaliserade koden innan den skickades (`RegisterWizard.tsx:89` och `:523`,
`MachineActions.tsx:489` och `:497`, `Scanner.tsx:78`). Alfabetet är base62, så `aB…` och `Ab…` är två olika
giltiga koder: `bind_label` **måste** förbli skiftlägeskänslig, och ett `lower()`/`upper()` där skulle både
krympa nyckelrymden och riskera att träffa fel märke. Ett databastest låser beteendet.

## Konsekvenser

- En utskriven QR bakar in `origin` permanent. `maskinid.se` pekar inte på Vercel ännu, så ett ark utskrivet nu
  säger `maskinid.vercel.app` i tio år. **Skriv inte ut skarpa dekaler förrän domänen står.** Den riktiga fixen
  är ett env-styrt `APP_ORIGIN` i `packages/shared/src/config.ts`.
- Kameran kräver säkert sammanhang. `getUserMedia` vägrar över `http://192.168.x.x`, och `ScannerView` fångar
  felet (`:48`) och faller tillbaka på det manuella fältet — alltså ser det ut som att skannern är trasig.
  Demonstrera mot HTTPS.
- Manuell inmatning är fortfarande i praktiken "klistra in en skannad URL": dekalen visar sex tecken, inte 22.
  Att låta de sex tecknen räcka, upplösta serverside inom `assigned_org_id = actor`, är en egen produktfråga.
- `/go` landar i senast aktiva organisation. Den som har flera register kan registrera i fel. Dämpat av att
  organisationen namnges i knappen, inte eliminerat.
