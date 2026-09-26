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
