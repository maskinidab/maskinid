# Öppna frågor

Frågor som kräver affärsbeslut. Bygget stannar inte för dem; det säkraste alternativet är valt och står under
"Antagande". Svara gärna direkt i filen.

## Specifikation
1. **SPEC v1.2 (§20–§21) saknas.** Den bifogade SPEC-filen är v1.1. Steg 20–27 byggs utifrån CLAUDE.md (ADR 0003).
   *Antagande:* varje tolkning listas nedan under respektive steg när den görs.

## Varumärke och juridik
2. **Namn och domän.** `APP_NAME = "MaskinID"`, domän `maskinid.se` (antagen). *Bekräfta domänen.*
3. **BankID-broker.** Criipto eller Signicat (SPEC §11.1). *Antagande:* adaptern är broker-neutral (OIDC); mock används
   i DEMO_MODE.

## Marknadsbevakning (steg 16)
4. **Villkor per källa.** Mascus, Blocket och övriga marknadsplatser har inte granskats juridiskt. *Antagande:* alla
   källor levereras avstängda (`enabled = false`, `tos_status = unknown`); en superadmin aktiverar efter granskning.
   Partnerflöden (avtal) föredras framför scraping.
5. **Adaptrarnas selektorer.** Standardvärdena för Mascus och Blocket (sökvägar, URL-mönster för annonser) är
   antaganden och måste verifieras mot de riktiga sajterna innan aktivering. De kan justeras i
   `market_sources.config` utan ny release (ADR 0014).
6. **Annonspris.** Annonsens utropspris lagras bara i `market_observations` (för `price_anomaly`) och visas aldrig på
   maskinsidan eller i kontrollkvitton. *Antagande:* det är förenligt med regeln "inga belopp i registret". *Bekräfta.*

## PDF:er och e-post (steg 18)
7. **Ägarbevis i e-post.** SPEC §6.3 säger att ägarbeviset "mejlas till köparen". *Antagande:* e-posten innehåller
   ägarbevisets nummer, kontrollänk och länk till maskinsidan där PDF:en laddas ner – ingen bilaga, så att dokumentet
   bara lämnar registret till inloggad ägare. *Bekräfta om PDF-bilaga önskas.*
8. **SMS-leverantör.** Twilio eller 46elks (SPEC §13). *Antagande:* SMS-rader i utkorgen markeras "skipped" tills en
   `Sms`-adapter och leverantör är valda; flaggan `FEATURE_SMS` är av.
9. **Dokumentnummer.** B-/R-/U-/F-/K-nummer är unika men kan hoppa över värden (databassekvenser). *Antagande:* det är
   acceptabelt eftersom nummer + kontrollsumma verifieras mot registret.

## Redskap, förare, daglig kontroll, klimat (steg 20, tolkat – SPEC §20.1–20.4 saknas)
10. **Emissionsfaktorer.** Standardvärden (kg CO2e, källa-till-hjul): diesel 2,95/l, HVO100 0,52/l, RME 1,10/l,
    bensin 2,80/l, biogas 0,60/kg, el 0,04/kWh. *Antagande* – ska ersättas med faktorer från vald källa
    (t.ex. Energimyndigheten/Naturvårdsverket) innan kunder använder rapporten. Ändras i `app_config` utan release.
11. **Daglig kontroll och driftstopp.** *Antagande:* fel på kritisk punkt ställer maskinen ur drift automatiskt och
    meddelar ägare/brukare; ingen blockering av registeråtgärder (ägarbyte m.m.) sker på grund av driftstatus.
12. **Förarbehörigheter.** Typlistan (förarbevis, truckkort, kranförarbevis, lift, heta arbeten m.fl.) är ett urval.
    Påminnelse vid utgång visas i listan (60 dagar); e-postpåminnelse ingår inte ännu.

## Fullmakter, risksignaler, koncern (steg 21, tolkat – SPEC §20.5–20.7 saknas)
13. **Fullmaktens omfattning.** *Antagande:* behörigheterna är sälja, se all information och sköta drift/service.
    Förbehåll, flaggor och avregistrering kan aldrig göras med fullmakt. Längsta giltighet två år.
14. **Risksignalernas trösklar** (t.ex. 3 ägarbyten på 2 år, 3 kreditgivare på 30 dagar, ägarbyte inom 90 dagar)
    är antaganden och bör stämmas av med finansiärer.
15. **Koncern.** *Antagande:* en nivå (moderbolag–dotterbolag) och endast läsbehörighet för moderbolaget.

## Tips, support, juridik, "Visa som" (steg 22, tolkat – SPEC §20.8, 20.10, 20.11 saknas)
16. **Juridiska texter.** Villkor, integritetspolicy, biträdesavtal och kakpolicy (v1) är utkast skrivna utifrån
    produktens funktion. *Måste granskas av jurist* innan lansering; nya versioner publiceras under Admin → Juridiska dokument.
17. **Säkerhetsloggen** skrivs av klienten efter inloggning/MFA-ändring och är därför informativ. *Antagande:* en
    server-side-logg via Supabase Auth hooks ersätter den när projektet körs på Supabase Pro.
18. **"Visa som organisation"** är skrivskyddad, 30 minuter och kräver skäl. *Antagande:* ingen förhandsgodkänning från
    kunden krävs; organisationens administratörer meddelas direkt i stället.
19. **Tips till polisen.** *Antagande:* vi vidarebefordrar bara till den myndighet som flaggat maskinen i registret, inte
    till polisens allmänna tipsfunktion.

## Betalning (steg 23, tolkat – SPEC §20.9 saknas)
20. **Prisnivåer.** Planer och priser (t.ex. Handlare 990 kr/mån, Finansiär 4 900 kr/mån, kontroll 49 kr, QR-märke 20 kr,
    alla exkl. moms) är *antaganden* och ändras under Admin → Betalning utan release.
21. **Säljaruppgifter på fakturan** (org.nr, momsreg.nr, adress, bankgiro) saknas och måste fyllas i `BILLING_SELLER`
    innan riktig fakturering. Omvänd skattskyldighet för kunder utanför Sverige hanteras inte (alla kunder antas svenska).
22. **Kortbetalning** är avstängd (`FEATURE_PAYMENTS=false`, SPEC §18) utom i demo; Stripe körs bara i testläge.

## Statistik, export, push, sandlåda, delsökning, sammanslagning (steg 24, tolkat – SPEC §20.12–20.16 saknas)
23. **Statistikens gräns för undertryckning** (1–4 maskiner) och länsindelning efter ägarens ort (inte maskinens plats)
    är antaganden. Naturvårdsverket/Energimyndigheten bör få stämma av miljötabellens kolumner.
24. **Delsökning** är öppen för finansiärer, försäkringsbolag, handlare, besiktningsorgan och myndigheter men inte
    ägare. Minsta längd 5 tecken och 30 sökningar/timme är antaganden.
25. **Sandlådan** svarar från fasta testdata i gatewayn i stället för ett eget sandlådeprojekt. Ett separat
    Supabase-projekt kan läggas till för fullständiga tester.
26. **Sammanslagning** kräver samma ägare; olika ägare hanteras som ägartvist (SPEC §6.7).

## Integrationer och publika sidor (steg 25, tolkat – SPEC §20.17 saknas)
27. **Partneravtal.** Transportstyrelsen (fordonsuppgifter via API) och Larmtjänst kräver avtal; adaptrarnas
    endpoints är konfigurerbara tills formatet är känt.
28. **NFC-skydd.** Kopieringsskyddet bygger på chipets serienummer, som kan förfalskas med specialutrustning.
    *Antagande:* tillräckligt för v1; NTAG 424 DNA med SUN-meddelanden kan införas senare.
29. **Telematikposition.** *Antagande:* endast senaste position sparas och myndighet ser den bara vid stöldflagga.
30. **Publika sidor.** Innehållet på `/for/*`, `/about` och `/integrations` är utkast och bör granskas av produkt/marknad.

## Drift (steg 26, tolkat – SPEC §21 saknas)
31. **Leverantörer för drift.** *Antagande:* Sentry för fel, GitHub Actions + extern tjänst (t.ex. Better Stack) för
    uptime, Slack för larm. Byts utan kodändring utom Sentry-klienten.
32. **Backup-övning.** Veckovis logisk dump till en tillfällig container i GitHub Actions. Kräver en läsbehörig
    databasroll i produktion; alternativt körs övningen i Supabase med PITR till ett nytt projekt (runbook).
33. **Tidszon för jobb.** pg_cron körs i UTC; tiderna är satta så att de hamnar tidigt på morgonen svensk tid.

## Kvalitet (steg 27, tolkat – SPEC §21.7 saknas)
34. **Punkt 18–26 i §21.7** är tolkade från CLAUDE.md steg 20–26 (ADR 0024) och bör stämmas av mot den saknade texten.
35. **Lighthouse-budget.** Prestanda ≥ 75 gäller Supabase-bygget; demobygget (hela registret i webbläsaren) mäts utan
    prestandabudget. CI mäter Supabase-bygget först när `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY` finns som
    repository-variabler.
36. **Push-notiser** testas inte end-to-end: headless Chromium saknar push-tjänst. Kön och renderingen testas i databas-
    och enhetstester.
37. **`npm run build:demo`** (en enda HTML-fil) är från tiden med mock-backend och fungerar inte med demodatabasen i
    webbläsaren. Statisk demo byggs i stället med `VITE_ROUTER=hash npm run build`. Skriptet kan tas bort.
