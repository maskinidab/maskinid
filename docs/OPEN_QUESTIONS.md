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
