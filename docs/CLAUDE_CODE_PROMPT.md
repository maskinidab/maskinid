# Kickoff-prompt till Claude Code

Förberedelser (5 minuter): skapa ett tomt privat repo, lägg `CLAUDE.md` i roten och `SPEC.md` + `LOVABLE_PROMPT.md` + denna fil i `docs/`. Installera Node 20, pnpm, Docker och Supabase CLI. Skapa Supabase-projekten `staging` och `sandbox` (prod senare) och lägg nycklarna i en lokal `.env` (aldrig i repot). Starta `claude` i repo-roten och klistra in texten under strecket. Claude Code läser `CLAUDE.md` automatiskt; specen läser den själv.

Praktiskt under bygget: låt sessionen jobba. Om kontexten komprimeras eller du startar en ny session, skriv bara **"Läs CLAUDE.md och PROGRESS.md och fortsätt där du var."** Granska commits modulvis i GitHub i stället för att avbryta. Godkänn behörigheter för repo-mappen och lokal Supabase; kör inget mot staging/prod från sessionen, det går via CI.

---

Läs `CLAUDE.md` och därefter `docs/SPEC.md` (v1.2) i sin helhet innan du gör något annat. Detta är ett komplett bygge av hela produkten – ingen MVP, ingen fas 1, inget som skjuts på framtiden. Allt i SPEC §1–§21 ska finnas, fungera i `DEMO_MODE` med mock-adaptrar och ha gröna tester enligt SPEC §16 och §21.7 när du är klar.

Gör så här:
1. Skapa `PROGRESS.md` i repo-roten med en checklista över alla 27 steg i CLAUDE.md. Markera status efter varje steg. Den är din arbetslogg och det första du läser efter en komprimering.
2. Sätt upp monorepot, CI och lokal Supabase (steg 1). Verifiera att `pnpm test:db` kan köra RLS-tester mot lokal instans innan du går vidare.
3. Bygg stegen 2–27 i ordning. Ett steg är klart när dess tester är gröna och det är committat; gå då direkt vidare. Avsluta aldrig ett steg med en fråga om du ska fortsätta.
4. När specen är tvetydig: välj det säkraste alternativet, skriv en kort ADR i `docs/adr/` och fortsätt. Fråga mig bara om något är omöjligt att avgöra utan affärsbeslut, och samla i så fall frågorna i `docs/OPEN_QUESTIONS.md` i stället för att stanna.
5. Håll commits små och beskrivande per steg. Uppdatera `PROGRESS.md` i samma commit.
6. Efter steg 27: kör hela e2e-sviten, Lighthouse på publika sidor och maskinsidan, skriv `README.md` (upp och kör på 10 minuter) och en sammanfattning i `PROGRESS.md` av avvikelser från specen med motivering.

Börja nu med steg 1.
