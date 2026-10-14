# Testguide – MaskinID på staging

Allt i den här guiden är provkört mot staging 2026-10-11, och rundorna 8–13 igen 2026-10-14 (automatiskt,
se slutet av avsnitt 5), efter att databasen seedats om med den committade demoseeden. Den beskriver vilka konton som finns och varför, vilka maskiner som är förberedda
för vilka scenarier, och hur du testar varje funktion.

| | |
|---|---|
| Adress | https://maskinid-git-staging-maskinid.vercel.app |
| Lösenord, alla konton | `demo1234` |
| Signering | Demo-BankID – klicka bara **Signera** |
| Databas | Supabase `okgwcmgjdvtmbgjhvwwt` (eu-west-1), demodata |
| Guiden som delbar sida | https://claude.ai/code/artifact/a10950eb-4271-46a2-b393-35731f8d14aa |

Den här filen är originalet. Webbsidan är satt i MaskinIDs grafiska profil och är till för att skickas
vidare – ändrar du här får den byggas om.

Staging kör i demoläge. Det betyder mockad BankID, mockad företagsslagning, mockad dokumentavläsning och
att e-post inte skickas på riktigt. En gul **DEMO**-banner ligger överst på varje sida. Inga uppgifter är
riktiga – bankerna heter "(demo)" just för att ingen verklig aktör ska framstå som kund.

Snabbaste vägen till en maskin: sökrutan högst upp (**Ctrl+K**) tar både regnr och serienummer.

---

## 1. Konton

Lösenordet är `demo1234` för samtliga. Varje organisation har en administratör; några har fler användare
för att kunna visa behörigheter.

### Operatören – MaskinID själv

| Konto | Person | Varför det finns |
|---|---|---|
| `admin@demo.se` | Alva Admin | Superadmin hos MaskinID Sverige AB. Godkänner nya organisationer, hanterar konflikter, märkesbatcher, händelselogg, API-användning och feature flags. Det här är "vår" vy av registret. |
| `verifier@demo.se` | Viktor Verifierare | Samma organisation men bara verifieringsrollen. Finns för att visa att operatörsbehörighet är uppdelad – en verifierare kan granska verifieringar utan att komma åt allt annat. |

### Maskinägare

| Konto | Person | Organisation | Varför det finns |
|---|---|---|---|
| `berg@demo.se` | Bengt Berg | Bergs Schakt & Entreprenad AB (556701-2009) | Huvudexemplet på ett vanligt företagarkonto: äger 12 maskiner, flera med finansiering, en stulen, en skrotad, ett pågående ägarbyte. Använd det här kontot för att visa hur en entreprenör ser registret. |
| `platschef@berg.demo.se` | Petra Platschef | samma organisation, roll *medlem* | Visar att flera personer kan dela ett företagskonto, och vad en medlem får göra jämfört med en administratör. |
| `lena@demo.se` | Lena Lind | Lena Grävmaskin (780512-1238) | **Enskild firma.** Finns för att visa att personnumret maskeras i gränssnittet och krypteras i databasen – organisationsnumret för en enskild firma är ju ett personnummer. |
| `kommun@demo.se` | Karin Kommun | Kommunfastigheter Väst (212000-2007) | Offentlig beställare. Äger de två maskinerna som har pågående lösenärenden, och har även rollen *client* så att delade flottrapporter kan visas. |

### Handlare

| Konto | Person | Organisation | Varför det finns |
|---|---|---|---|
| `nordmaskin@demo.se` | Nils Nordin | Nordmaskin AB (556701-1001) | Huvudhandlaren. Lager, inbyten, försäljningar, märkesbeställningar, leads och kunder. Det är härifrån du kör handlarflödena. |
| `saljare@nordmaskin.demo.se` | Sara Säljare | samma organisation, roll *medlem* | En säljare som kan arbeta i lagret men inte administrera organisationen. |
| `verkstad@nordmaskin.demo.se` | Vilhelm Verkstad | samma organisation, roll **endast läs** | Finns för att visa läsbehörighet: han ser allt men varje knapp som ändrar något är borta. Bra att visa för kunder som undrar om verkstadspersonal kan råka ändra uppgifter. |
| `syd@demo.se` | Selma Syd | Entreprenadcenter Syd AB (556701-1019) | Andra handlaren – behövs för att visa affärer *mellan* handlare. Äger den exporterade maskinen. |
| `norr@demo.se` | Nora Norr | Skogsmaskiner Norr AB (556701-1027) | Tredje handlaren, skogsmaskiner. Ger bredd i marknadsbevakning och statistik. |

### Långivare

Fyra banker med konto, så att samma maskin kan finansieras av olika långivare och så att du kan visa
konflikten som stoppar en andra finansiering.

| Konto | Person | Organisation | Varför det finns |
|---|---|---|---|
| `bank@demo.se` | Björn Bank | Demo Bank Finans (516401-3004) | Standardlångivaren. Avtalsprefix `DBF-`, förvald typ *äganderättsförbehåll*, 60 månader. |
| `finans@demo.se` | Frida Finans | Nordisk Maskinfinans (516401-3012) | Andra banken. Avtalsprefix `NMF-`, förvald typ *leasing*, 48 månader. Använd den för att visa att det blir rätt när man byter bank. |
| `dnb@demo.se` | Dagny Nordbank | DNB Finans (demo) (516401-3020) | Har ett **besvarat** lösenärende – de har redan skickat lösenbesked. Avtalsprefix `DNB-`, leasing, 60 månader, lösenbesked med 14 dagars giltighet. |
| `santander@demo.se` | Sixten Sander | Santander Consumer (demo) (516406-0138) | Har ett **obesvarat** lösenärende liggande i inkorgen. Avtalsprefix `SC-`, äganderättsförbehåll, 72 månader. |
| `nordic@demo.se` | Nina Nordic | Nordic Finance (demo) (516401-3038) | Femte långivaren, tillagd på Rikards begäran. Avtalsprefix `NF-`, leasing, 60 månader. Håller ett aktivt leasingförbehåll på `CAT0D606695` med fullständiga finansieringsuppgifter, så finanssnurran har något att visa. |

### Banker utan konto – platshållare

Två långivare finns bara i företagsregistret, utan konto och utan användare. De finns för att visa att en
handlare kan registrera finansiering mot en bank som ännu inte anslutit sig, och att banken hittar sina
maskiner på plats den dag de skaffar konto.

| Organisation | Orgnr | Varför det finns |
|---|---|---|
| LF Finans (demo) | 516406-0120 | Scenariot "handlaren scannar en bankbeställning från en bank som inte är kund". |
| BNP Paribas Leasing (demo) | 516401-9845 | Samma sak, för att visa att det inte är ett specialfall för en enda bank. |

### Övriga roller

| Konto | Person | Organisation | Varför det finns |
|---|---|---|---|
| `forsakring@demo.se` | Fredrik Försäkring | Demo Försäkring (516401-4002) | Försäkringsportalen: ser maskiner de försäkrar, får notis vid stöldanmälan, kan lägga in länk för skadeanmälan. |
| `polisen@demo.se` | Paula Polis | Polisen (demo) (202100-0068) | Myndighetsportalen: partiell sökning på ofullständigt serienummer, efterlysning, beslag, spärr, registerutdrag. |
| `tull@demo.se` | Tove Tull | Tullverket (demo) (202100-4730) | Exportkontroll – slår upp en maskin vid gränsen och ser om den är belånad, efterlyst eller spärrad. |
| `kontroll@demo.se` | Kurt Kontroll | Maskinkontroll Sverige AB (556701-5002) | Besiktningsorgan. Skriver besiktningar direkt i registret och kan höja verifieringsnivån till fysiskt verifierad. |
| `tillverkare@demo.se` | Tina Tillverkare | Volvo CE (demo) (556701-6000) | Tillverkarportalen: leveransdata via import eller API, så att en maskin kan vara känd redan innan första ägaren registrerar den. |
| `marknad@demo.se` | Max Marknad | Maskinmarknaden (demo) (556701-7008) | Marknadsplats – visar annonsflödet och marknadsbevakningen. |

---

## 2. Maskiner som är förberedda för specifika scenarier

Registreringsnumren slumpas vid varje omseedning, men **serienumren är stabila**. Sök på serienumret i
rutan högst upp. Numren inom parentes är de som gällde 2026-10-11.

| Serienummer | Maskin | Ägare | Scenario |
|---|---|---|---|
| `JCB3CX04278` | JCB 3CX 2023 | Bergs Schakt | Leasing hos Demo Bank Finans. Den självklara maskinen att köra inbytes- och lösenflödet på. |
| `CAT0950GC62002` | Caterpillar 950 GC 2021 | Kommunfastigheter | DNB Finans, lösen **redan besvarad** – lösenbeskedet ligger och väntar hos ägaren (B4Z-9WK9). |
| `KMTPCPC210L63003` | Komatsu PC210LCi-11 2023 | Kommunfastigheter | Santander, lösen **begärd men obesvarad** – ligger i bankens inkorg (E67-U65A). |
| `VCEL120H61001` | Volvo L120H 2021 | Nordmaskin | Finansierad mot LF Finans, som inte är ansluten till MaskinID. |
| `HTCZX21064004` | Hitachi ZX210 2016 | Entreprenadcenter Syd | **Exporterad** till Norge, med märket kvar och historiken intakt (UA9-R6U9). |
| `CAT0950GC78397` | Caterpillar 950 GC 2018 | Bergs Schakt | Anmäld **stulen** – syns för alla som skannar märket. |
| `ACXXAS18822319` | Atlas Copco XAS 188 | Kommunfastigheter | **Spärrad** av myndighet. |
| `CAT032074563` | Caterpillar 320 2015 | Bergs Schakt | Pågående ägarbyte. |
| `VCEL120H93778` | Volvo L120H 2022 | Bergs Schakt | **Dubblett** av ett annat serienummer – ett konfliktärende hos operatören. |
| `JCB3CX17361` | JCB 3CX 2018 | Lena Grävmaskin | Nyförsäljning med äganderättsförbehåll. |
| `CAT032013280` | Caterpillar 320 2015 | Bergs Schakt | **Skrotad** – avregistrerad, märket förstört. |

Totalt ligger 64 maskiner och 200 QR-märken i staging.

| Serienummer | Maskin | Ägare | Scenario |
|---|---|---|---|
| `CAT0D606695` | Caterpillar D6 2023 | Bergs Schakt | Leasing hos **Nordic Finance (demo)** med ifyllda finansieringsuppgifter – belopp, kontantinsats, restvärde, amorteringstid och ränta. Maskinen att visa finanssnurran på. |
| `VCEECR25E45597` | Volvo ECR25 Electric | Bergs Schakt | **Uthyrd** till Kommunfastigheter. Uthyrning ligger hos en ägare, inte hos handlaren (se runda 11). |

---

## 3. Testrundor

Varje runda går att köra fristående. Byt konto genom att klicka på ditt namn uppe till höger och
**Logga ut**.

### Runda 1 – Handlaren lägger in finansiering, banken bekräftar

Visar att finansiering automatiskt hamnar hos rätt bank och dyker upp där för godkännande.

1. Logga in som `nordmaskin@demo.se`. Öppna en maskin i lagret utan belåning, välj fliken **Förbehåll**.
2. Klicka **Lägg in finansiering manuellt**. Välj långivare – prova `DNB Finans (demo)`. Notera att
   avtalsprefix och löptid fylls i automatiskt från bankens egna uppgifter.
3. Signera. Maskinen ska **omedelbart** visa **"Belåning anmäld"** – inte "ej belånad".
4. Logga ut, logga in som `dnb@demo.se`. Under **Väntar på mig** ligger *Förbehåll att bekräfta*.
5. Klicka **Hantera** → **Bekräfta förbehållet**. Maskinen byter till **"Belånad"**.

Prova gärna samma sak med `santander@demo.se` – poängen är att det blir rätt bank oavsett vilken man väljer.

### Runda 2 – Inbyte av en belånad maskin, med lösen

Den längsta rundan och den som visar hela kedjan handlare → MaskinID → bank.

1. `nordmaskin@demo.se` → **Ta emot inbyte** i menyn.
2. Prova alla tre ingångarna på samma maskin – de ska landa på samma svar:
   - **Lägg in serienummer manuellt**: `JCB3CX04278`
   - **Fota VIN/serienummer**: ta ett foto av märkskylten (i demoläge läses ett förifyllt värde)
   - **Skanna märke**: skriv maskinens regnr i rutan
3. Du ser historiken, att maskinen är belånad och **vilken bank** som håller förbehållet.
4. Klicka **Begär inbyte**. Lösenförfrågan går till banken **direkt** – innan ägaren godkänt något.
5. Logga in som `bank@demo.se`. Under **Väntar på mig**: *Lösen att besvara*. Klicka **Hantera**.
6. Klicka **Skicka lösenbesked**, bifoga en PDF, ange referens och **Giltigt t.o.m.** Beloppet står i
   dokumentet – registret lagrar aldrig belopp.
7. Tillbaka som `nordmaskin@demo.se` → samma sökning. Nu står **"Lösenbesked mottaget"** med
   giltighetsdatum och knappen **Öppna lösenbesked**.
8. Klicka **Ladda upp lösenbevis** och bifoga ett kvitto. **Kontrollera att spärren ligger kvar** – en
   handlare kan inte släppa den själv.
9. `bank@demo.se` → **Lösenbevis att godkänna** → **Godkänn lösen och släpp spärren** → signera. Nu först
   släpps spärren.
10. `berg@demo.se` → **Inbyte att godkänna** → **Godkänn inbytet**.
11. `nordmaskin@demo.se` → **Ta emot maskin** → **Signera och godkänn**. Maskinen står nu i Nordmaskins
    lager, utan belåning.

### Runda 3 – Sälja en maskin och koppla köparens finansiering

Det här var felet som gjorde att en maskin inte visades som belånad när man valde en annan bank.

1. `nordmaskin@demo.se` → **Ny försäljning**.
2. Välj maskin, slå upp köparen på `556701-2009` (Bergs Schakt), ladda upp en faktura.
3. Under **Köparens finansiering**, välj en annan bank än den förvalda – t.ex. `Nordisk Maskinfinans`.
   Sätt slutdatum. Klicka **Skicka till köparen**.
4. Gå tillbaka till maskinen. Den ska stå som **"Belåning anmäld"** redan nu, innan köparen rört ärendet.
5. `finans@demo.se` → **Förbehåll att bekräfta** → bekräfta → **"Belånad"**.
6. Vill du köra hela affären i mål: `berg@demo.se` → ägarbytet → **Signera och godkänn** → ägarbevis som PDF.

### Runda 4 – Bank som inte använder MaskinID, och övertagandet

1. `nordmaskin@demo.se` → en maskin utan belåning → fliken **Förbehåll** → **Bifoga dokument**.
2. Ladda upp eller fota en bankbeställning. MaskinID läser dokumentet och fyller i bank, avtalstyp,
   löptid och avtalsnummer.
3. Pekar dokumentet på en bank som inte är kund står det **"… använder inte MaskinID än. Finansieringen
   registreras ändå och väntar på banken."** Signera – förbehållet registreras mot banken i alla fall.
4. Visa övertagandet: klicka på organisationsväljaren uppe till vänster → **+ Lägg till ny organisation** →
   verifiera med Demo-BankID → slå upp `516406-0120`. Du får beskedet att LF Finans redan är upplagd men
   att ingen tagit över kontot, och erbjuds **Ta över organisationen**. Finns det redan maskiner eller
   finansieringar kräver övertagandet firmatecknare.

### Runda 5 – Export

1. `syd@demo.se` → sök `HTCZX21064004`. Maskinen är exporterad till Norge.
2. Öppna fliken **Historik** – exporten ligger där som en händelse bland de andra, ingenting är raderat.
3. Öppna det publika kortet: `/r/` plus maskinens regnr, eller skanna QR-koden på maskinsidan med mobilen.
   Det ska stå **EXPORTERAD · Exporterad till NO** och att maskinen behåller registreringsnummer och
   historik.
4. Sök serienumret i registreringsguiden – det hittas fortfarande, till skillnad från tidigare.
5. På maskinsidan finns **Återinför maskinen** om du vill ta tillbaka den i registret.

**Export av en belånad maskin:** välj en maskin med aktiv belåning och klicka **Avregistrera**. Knappen
för att skicka in är låst och du erbjuds **Begär lösen för export** i stället för ett felmeddelande. När
långivaren godkänt lösen är land och tullreferens redan ifyllda när du gör om exporten.

### Runda 6 – QR-märken

1. `nordmaskin@demo.se` → **Märken** i menyn.
2. **Visa QR** på en rad öppnar märkets QR-kod i stor storlek med adressen under.
3. **Skriv ut ark (PDF)** ger ett A4 med 18 dekaler, skärmärken och kod i finstilt.
4. Skanna ett **oanvänt** märke med mobilen. Den publika sidan säger att märket är ledigt och erbjuder
   **Registrera maskinen** – koden följer med genom inloggning och registrering hela vägen.
5. Skanna ett **bundet** märke och du landar på maskinens publika kort.

### Runda 7 – Vanligt företagarkonto och behörigheter

1. `berg@demo.se` → en maskin → fliken **Förbehåll**. Här finns **bara** "Bifoga dokument" – en vanlig
   företagare ska inte behöva fylla i en blankett rätt. Den manuella vägen är handlarens.
2. Logga in som `verkstad@nordmaskin.demo.se`. Samma maskiner, men inga knappar som ändrar något.
3. `lena@demo.se` visar enskild firma: organisationsnumret är maskerat i gränssnittet.

### Bonusrundor

| Vad | Hur |
|---|---|
| Stöld | `berg@demo.se` → sök `CAT0950GC78397` → se stöldflaggan. Skanna märket utloggad – varningen syns publikt. `polisen@demo.se` och `forsakring@demo.se` ser ärendet. |
| Myndighet | `polisen@demo.se` → partiell sökning på en bit av ett serienummer, efterlysning, beslag, registerutdrag som PDF. |
| Exportkontroll | `tull@demo.se` → slå upp en maskin och se belåning, flaggor och exportstatus. |
| Konflikt | `admin@demo.se` → **Konflikter** → dubbletten på `VCEL120H93778`. |
| Besiktning | `kontroll@demo.se` → **Besiktningar** och **Registrera besiktning**, och höj en maskins verifieringsnivå. |
| Flotta | `berg@demo.se` → **Flotta**, **Daglig kontroll**, **Uthyrning**, **Bränsle & klimat**, **Förare**. Samma menyval finns *inte* hos `nordmaskin@demo.se` – se runda 11. |
| Fullmakt och kommission | `berg@demo.se` → maskin → **Fullmakt / kommission** (eller **Fullmakter** i menyn) → ge Nordmaskin rätt att sälja → `nordmaskin@demo.se` accepterar och maskinen dyker upp i deras lager. |
| Operatörsvyn | `admin@demo.se` → godkännandekö, märkesbatcher, händelselogg med ankarverifiering, API-användning. |
| Publika sidor | Utloggad: `/`, `/security`, `/stolen`, `/api-docs`. `/pricing` skickar nu vidare till startsidan – prisinformationen är avstängd, se runda 13. |

### Runda 8 – Finanssnurran och det obligatoriska avtalsnumret

Rikards första punkt: det ska gå att fylla i amorteringstid, restvärde och finansieringsbelopp, och
avtalsnummer ska vara obligatoriskt.

1. `nordmaskin@demo.se` → en maskin i lagret utan belåning → fliken **Förbehåll** → **Lägg in finansiering
   manuellt**. Välj `Nordic Finance (demo)`.
2. Avtalsreferensen fylls i med bankens prefix `NF-`. Klicka **Anmäl finansieringen** utan att skriva något
   mer. Du får **"Avtalsnummer krävs."** – prefixet ensamt är inget avtalsnummer, och det är hela poängen:
   banken måste kunna koppla maskinen till rätt finansieringsavtal.
3. Fyll i avtalsnummer, och sedan finanssnurran: finansieringsbelopp `1 250 000`, kontantinsats `250 000`,
   restvärde `200 000`, amorteringstid `60`, ränta `6,45`. **Månadskostnaden räknas fram till 16 709 kr** och
   totalt kreditbelopp till 1 000 000 kr.
4. **Skriv över månadskostnaden** om du vill – den sparas då som överskriven, så en senare formeländring aldrig
   skriver om bankens siffra.
5. Klicka **Anmäl finansieringen** – handlaren anmäler, banken bekräftar, så här signeras inget. Maskinen står
   direkt som **Belåning anmäld**. Logga in som `nordic@demo.se` → **Väntar på mig** → *Förbehåll att bekräfta*
   → **Hantera** → **Bekräfta förbehållet**. Banken ser samma uppgifter.
6. **Det viktiga provet:** logga in som `syd@demo.se` (en annan handlare) eller `polisen@demo.se` och slå upp
   maskinen. Du ser att den är belånad och vem långivaren är, men **inga belopp**. De syns bara för ägaren och
   för den bank som håller förbehållet.
7. Prova även **Bifoga dokument** på en annan maskin: avläsningen fyller nu i beloppen också, och varje värde
   går att rätta innan du signerar.

### Runda 9 – Inbytestest

1. `nordmaskin@demo.se` → **Inbytestest** i menyn.
2. Skriv serienummer `JCB3CX04278` (Bergs maskin – handlaren äger den inte). Du ser maskinen, att den är
   belånad och vem som håller förbehållet.
3. Samma kontrollpunkter, texter och bockrutor som den dagliga kontrollen dyker upp. **Markera alla OK**, sätt
   sedan **Inga hydraulläckage** till **Fel** och skriv en kommentar. Fyll i timmätare och en bedömning.
4. Spara. Resultatet blir **allvarliga fel** – men maskinen tas **inte** ur drift och ägarens timmätare ändras
   inte. Bedömningen är handlarens egen: `berg@demo.se` ser den inte.
5. Prova också ett serienummer som inte finns i registret, till exempel `OKAND-123`. Testet går att göra ändå
   och sparas mot serienumret – en inbytesmaskin behöver inte vara registrerad.
6. Efteråt erbjuds **Begär inbyte**, som fortsätter in i det vanliga inbytesflödet (runda 2).

### Runda 10 – Enskild firma söker, och ägaren godkänner historiken

Rikards punkter om att enskild firma inte såg historiken, och att alla kontotyper ska kunna söka.

1. `lena@demo.se` (enskild firma) → sökrutan högst upp (**Ctrl+K**) → `JCB3CX04278`.
2. Du ser maskin, modell, status och **Belånad** – men inte vem långivaren är och inte historiken.
3. Klicka **Begär full historik**, skriv en motivering och skicka. Förfrågan går till **maskinens nuvarande
   ägare**. Lena får inte veta vem det är förrän ägaren godkänt – sökningen visar inte ägaren, och förfrågan ska
   inte vara ett sätt att ta reda på det. Sök igen: raden säger nu *"Förfrågan skickad … väntar på ägarens
   godkännande"* med **Dra tillbaka**, och under **Fullmakter** står den som *Från maskinens ägare*.
4. `berg@demo.se` → **Väntar på mig** → *Begäran om åtkomst att godkänna* → **Hantera** → **Godkänn åtkomst** →
   signera med Demo-BankID.

   > Kör runda 10 **före** runda 2 och 12, eller nollställ emellan. Runda 2 avslutar inbytet av `JCB3CX04278`,
   > så maskinen ägs därefter av Nordmaskin och har ingen belåning – då går Lenas förfrågan till Nordmaskins
   > inkorg, inte till Bergs. Det var därför flödet såg trasigt ut på staging 2026-10-13.
5. Tillbaka som `lena@demo.se`: maskinen går att öppna och **Historik** är full. Finansieringsbeloppen syns
   fortfarande inte – avtalet mellan Berg och banken är inte Bergs att dela vidare.
6. `berg@demo.se` → **Fullmakter** → **Återkalla**. Historiken stängs igen direkt.

### Runda 11 – Handlarvyn och modulerna

1. `nordmaskin@demo.se`: **Daglig kontroll**, **Uthyrning**, **Bränsle & klimat** och **Förare** är borta ur
   menyn. **Inbytestest** står där i stället.
2. Skriv `/o/nordmaskin-ab/rentals` i adressfältet. Sidan säger att modulen inte är aktiverad – att gömma ett
   menyval räcker inte, så servern vägrar också skrivningen.
3. **Inställningar → Moduler** → slå på **Uthyrning**. Menyvalet kommer tillbaka direkt. Det är så ni aktiverar
   funktionen för de handlare som vill ha den.
4. `berg@demo.se`: alla fyra finns kvar. En vanlig maskinägare påverkas inte.

### Runda 12 – Lösenbeskedet och bekräftelsen (de två rättade felen)

1. Kör runda 2 till och med bankens lösenbesked.
2. Som `nordmaskin@demo.se`: klicka **Öppna lösenbesked**. Det **öppnas** – tidigare stod det "ingen
   behörighet", eftersom handlaren inte har någon relation till maskinen förrän ägaren godkänt inbytet.
3. Ladda upp lösenbevis, och som `bank@demo.se`: **Godkänn lösen och släpp spärren** → signera. Nu kommer en
   **bekräftelse: "Spärren släppt"** med väg vidare till Portföljen – tidigare blev hela sidan ett
   behörighetsfel, eftersom banken tappar sin relation till maskinen i samma ögonblick som den släpper spärren.
4. Banken kan fortfarande se maskinen och sin egen förbehållshistorik i 90 dagar, men inte ägarens övriga
   historik.

### Runda 13 – Bankens insyn i en maskinflotta, och priserna

1. `bank@demo.se` → **Portfölj**. Banken ser bara de maskiner den själv finansierar – så är det utan samtycke.
2. Klicka **Begär insyn i maskinflottan**, ange `556701-2009` (Bergs Schakt) och ett slutdatum.
3. `berg@demo.se` godkänner i inkorgen med Demo-BankID.
4. Tillbaka som `bank@demo.se`: **Maskiner → Delade med oss** listar hela Bergs flotta (även via **Fullmakter**
   → *Alla maskiner · visa maskinerna*, eller **Visa delade maskinflottor** i Portföljen). Varje maskin går att
   öppna med full historik, till och med slutdatumet. Finansieringsvillkoren för andra långivares avtal syns
   fortfarande inte.
5. `berg@demo.se` → **Fullmakter** → **Återkalla**. Listan töms direkt.
6. Priserna: utloggad finns ingen prislänk i sidhuvudet, footern eller på `/for/handlare`, och `/pricing`
   skickar vidare till startsidan. Fliken **Betalning** är borta ur inställningarna och märkesbeställningen
   visar inget pris. Allt finns kvar i koden: `admin@demo.se` → **Funktionsflaggor** → `FEATURE_PRICING` → På.

---

## 4. Vad du inte kan testa på staging

- **Dokumentavläsningen är mockad.** "Bifoga dokument" fyller i förberedda värden i stället för att
  faktiskt läsa en PDF. Vill du läsa riktiga papper i en demo behöver `ANTHROPIC_API_KEY` och
  `OCR_PROVIDER=anthropic` sättas som secrets på staging-projektet. Demo-BankID påverkas inte av det.
- **Nyregistrering kräver e-postbekräftelse.** Skapar du ett konto får du "vi har skickat en
  inloggningslänk" och kommer inte vidare med en påhittad adress. Använd de befintliga kontona, och visa
  övertagandet via **+ Lägg till ny organisation** i stället.
- **E-post skickas inte.** Notiser hamnar i appen, inte i någon inkorg.
- **BankID är Demo-BankID.** Signeringsrutan dyker upp som vanligt, men du klickar bara Signera.
- **Belopp: bara finansieringsvillkoren, bara för två parter.** Finansieringsbelopp, kontantinsats, restvärde,
  amorteringstid och ränta lagras på förbehållet och syns **bara för maskinägaren och för den långivare som
  håller förbehållet** (ADR 0029). Ingen annan ser dem – inte handlaren vid inbyte, inte myndigheten, inte
  försäkringsgivaren, inte operatören, inte publika kort eller delningslänkar. Köpeskilling och restskuld lagras
  fortfarande aldrig, och **lösenbeloppet** finns bara i bankens bifogade lösenbesked.
- **Ingen riktig bank är ansluten.** API-ytan och webhookarna täcker hela lösen- och finansieringsflödet,
  men ingen bankspecifik integration är byggd.

---

## 5. Nollställa demodatan

Har du testat sönder något, eller vill börja om inför en demo:

1. Länka om CLI:t till staging – kontrollera noga, det kan ligga kvar på produktionsprojektet:
   ```
   npx supabase@2.118.0 login
   npx supabase@2.118.0 link --project-ref okgwcmgjdvtmbgjhvwwt
   cat supabase/.temp/project-ref      # måste visa okgwcmgjdvtmbgjhvwwt
   ```
2. Städa schemat i SQL-editorn på
   https://supabase.com/dashboard/project/okgwcmgjdvtmbgjhvwwt/sql/new – `db reset` på ett fjärrprojekt
   tar tabellerna men lämnar fristående sekvenser kvar, och då kraschar omspelningen:
   ```sql
   drop schema if exists public cascade;
   drop schema if exists app cascade;
   drop schema if exists seed cascade;
   create schema public;
   alter schema public owner to pg_database_owner;
   grant usage on schema public to postgres, anon, authenticated, service_role;
   grant all on schema public to postgres, service_role;
   delete from supabase_migrations.schema_migrations;
   ```
3. Kör omseedningen:
   ```
   npx supabase@2.118.0 db reset --linked --yes
   ```
4. Kör **Deploy** mot staging i GitHub Actions (`workflow_dispatch`, target `staging`). Utan det står
   `FUNCTIONS_BASE_URL` tomt och de schemalagda jobben kör inte.
5. Kontrollera: `curl https://okgwcmgjdvtmbgjhvwwt.supabase.co/functions/v1/health` ska svara
   `"ok":true`.

Rundorna 8–13 går att provköra automatiskt mot staging: `npm run test:staging` (`e2e/staging/rounds.staging.ts`)
loggar in med demokontona och klickar igenom dem i en headless webbläsare. Den skriver i staging, men håller sig
borta från guidens scenariomaskiner: runda 8 finansierar `PONBUFFAL12915` och runda 12 löser
`LHRR92630256` (ändra med `R8_SERIAL`/`R12_SERIAL`), och samtyckena i runda 10 och 13 återkallas efteråt.
Nollställ inför en demo.

Samma flöden täcks lokalt av `e2e/`-sviten (`npm run test:e2e`, mot databasen i webbläsaren):
`financier.spec.ts` och `dealer.spec.ts` (finanssnurran och avtalsnumret), `dealer-view.spec.ts` (Inbytestest
och modulerna), `consent.spec.ts` (sök, samtycke och flottinsyn), `payoff.spec.ts` (lösenbeskedet och
bekräftelsen) och `public.spec.ts` (priserna). De tidigare skripten `test-results/staging-walkthrough.mjs` och
`verify-seed.mjs` låg i en katalog som Playwright tömmer vid varje körning och finns inte längre.
