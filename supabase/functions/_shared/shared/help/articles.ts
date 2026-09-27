/**
 * Help centre (step 22): articles in Swedish and English. Content, not UI chrome – kept here so the web app, e-mail and
 * tests share it. Paragraphs are plain text; lines starting with "- " are list items.
 */
export interface HelpArticle {
  slug: string;
  category: "start" | "owner" | "dealer" | "financier" | "security" | "api";
  sv: { title: string; summary: string; body: string };
  en: { title: string; summary: string; body: string };
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "kom-igang", category: "start",
    sv: { title: "Kom igång med MaskinID", summary: "Konto, BankID, organisation och första maskinen.",
      body: `Du loggar in med din e-postadress. Innan du kan göra ändringar i registret bekräftar du din identitet med BankID – det görs en gång.

Skapa eller gå med i en organisation. Organisationsnumret slås upp automatiskt. Ägare godkänns direkt; handlare, finansiärer, försäkringsbolag och myndigheter granskas av oss först.

Registrera din första maskin under Registrera maskin:
- Fotografera typskylten så läses serienumret av automatiskt.
- Kontrollera uppgifterna och spara.
- Maskinen får ett registreringsnummer direkt. Sätt på ett QR-märke så kan vem som helst kontrollera maskinen med mobilen.` },
    en: { title: "Getting started with MaskinID", summary: "Account, BankID, organisation and your first machine.",
      body: `You sign in with your e-mail address. Before you can change anything in the register you confirm your identity with BankID – once.

Create or join an organisation. The organisation number is looked up automatically. Owners are approved at once; dealers, lenders, insurers and authorities are reviewed by us first.

Register your first machine under Register machine:
- Photograph the nameplate and the serial number is read automatically.
- Check the details and save.
- The machine gets a registration number at once. Attach a QR label so anyone can check the machine with a phone.` },
  },
  {
    slug: "verifieringsnivaer", category: "start",
    sv: { title: "Verifieringsnivåer", summary: "Vad självregistrerad, dokumentverifierad och fysiskt verifierad betyder.",
      body: `Varje maskin har en nivå som visar hur väl uppgifterna är kontrollerade:
- Självregistrerad: ägaren har lagt in maskinen utan granskat underlag.
- Dokumentverifierad: faktura eller köpeavtal och foton är granskade av oss, en handlare, finansiär eller ett kontrollorgan.
- Fysiskt verifierad: någon har sett maskinen och kontrollerat typskylten, eller maskinen såldes ny av en handlare.

Höj nivån under Höj verifieringsnivå på maskinsidan. Långivare och försäkringsbolag kan kräva en viss nivå.` },
    en: { title: "Verification levels", summary: "What self-registered, document-verified and physically verified mean.",
      body: `Every machine has a level that shows how well its data has been checked:
- Self-registered: the owner entered the machine without reviewed documents.
- Document-verified: an invoice or purchase agreement and photos were reviewed by us, a dealer, a lender or an inspection body.
- Physically verified: someone saw the machine and checked the nameplate, or it was sold new by a dealer.

Raise the level under Raise verification level on the machine page. Lenders and insurers may require a certain level.` },
  },
  {
    slug: "agarbyte", category: "owner",
    sv: { title: "Ägarbyte", summary: "Så överlåter du en maskin och vad köparen gör.",
      body: `Säljaren påbörjar ägarbytet på maskinsidan och anger köparens organisationsnummer eller e-post. Köparen får ett meddelande, granskar maskinen, historiken och om det finns förbehåll, och accepterar med BankID.

Finns ett förbehåll måste långivaren först godkänna eller lösa det. Ett ägarbyte som inte accepteras inom 14 dagar avbryts.

När ägarbytet är klart får köparen ett ägarbevis. Säljaren ser maskinen under Tidigare maskiner, med historiken fram till överlåtelsen.` },
    en: { title: "Transferring ownership", summary: "How to transfer a machine and what the buyer does.",
      body: `The seller starts the transfer on the machine page and enters the buyer's organisation number or e-mail. The buyer is notified, reviews the machine, its history and any encumbrances, and accepts with BankID.

If there is an encumbrance, the lender must approve or settle it first. A transfer not accepted within 14 days is cancelled.

When the transfer is complete the buyer receives an ownership certificate. The seller sees the machine under Previous machines, with the history up to the transfer.` },
  },
  {
    slug: "qr-marken", category: "owner",
    sv: { title: "QR-märken", summary: "Beställa, sätta på och byta märken.",
      body: `Ett QR-märke kopplar maskinen till registret. Den som skannar ser maskinens status – aldrig ägarens kontaktuppgifter.

Beställ märken under Märken. Koppla ett märke genom att skanna det på maskinsidan. Sätt det synligt nära typskylten och gärna ett extra märke på ett dolt ställe.

Om ett märke skadas: återkalla det och koppla ett nytt. Återkallade märken visar att de inte längre gäller.` },
    en: { title: "QR labels", summary: "Ordering, attaching and replacing labels.",
      body: `A QR label links the machine to the register. Whoever scans it sees the machine's status – never the owner's contact details.

Order labels under Labels. Bind a label by scanning it on the machine page. Place it visibly near the nameplate and preferably a second label somewhere hidden.

If a label is damaged: revoke it and bind a new one. Revoked labels show that they are no longer valid.` },
  },
  {
    slug: "stold", category: "security",
    sv: { title: "Om maskinen blir stulen", summary: "Anmäl, flagga och vad som händer sedan.",
      body: `Polisanmäl stölden först. Flagga sedan maskinen som stulen på maskinsidan och ange polisens diarienummer.

Därefter:
- Den som skannar maskinens QR-märke ser att den är stulen och uppmanas ringa polisen på 114 14.
- Du får en notis direkt om maskinen skannas, med ungefärlig plats.
- Vi larmar om maskinen dyker upp i annonser.
- Du kan välja att visa maskinen i den publika stöldlistan.

När maskinen är återfunnen tar du bort flaggan.` },
    en: { title: "If your machine is stolen", summary: "Report, flag and what happens next.",
      body: `Report the theft to the police first. Then flag the machine as stolen on the machine page and enter the police reference.

After that:
- Anyone scanning the QR label sees that it is stolen and is asked to call the police on 114 14.
- You are notified at once if the machine is scanned, with an approximate location.
- We alert you if the machine appears in listings.
- You can choose to show the machine in the public stolen list.

When the machine is recovered, remove the flag.` },
  },
  {
    slug: "forbehall-for-finansiarer", category: "financier",
    sv: { title: "Förbehåll för finansiärer", summary: "Kontrollera, registrera och släppa förbehåll.",
      body: `Kontrollera maskinen före kreditbeslut under Kontroll. Varje kontroll ger ett tidsstämplat kvitto som kan verifieras av vem som helst.

Registrera ägarförbehåll eller leasing med BankID. En maskin kan bara ha ett aktivt finansieringsförbehåll; ett andra blockeras och båda parter meddelas.

Släpp förbehållet när avtalet är slutbetalt. Registret innehåller aldrig belopp.

Bevaka maskinen efter kontrollen så meddelas ni om den får nytt förbehåll, flaggas, byter ägare eller annonseras.` },
    en: { title: "Encumbrances for lenders", summary: "Check, register and release encumbrances.",
      body: `Check the machine before a credit decision under Check. Every check produces a time-stamped receipt that anyone can verify.

Register a retention of title or leasing with BankID. A machine can have only one active financing encumbrance; a second is blocked and both parties are notified.

Release the encumbrance when the contract is paid off. The register never contains amounts.

Watch the machine after the check to be notified if it gets a new encumbrance, is flagged, changes owner or is listed.` },
  },
  {
    slug: "handlare-lager-och-forsaljning", category: "dealer",
    sv: { title: "Lager, försäljning och kommission", summary: "För handlare: lager, sälj-flödet och maskiner i kommission.",
      body: `Lagret visar maskiner ni äger med status lager, inbyte eller demo, och maskiner ni säljer i kommission.

Sälj en maskin från lagret: ange köpare, bifoga faktura och eventuell ny finansiering. Nyförsäljning ger maskinen högsta verifieringsnivå och köparen får ett ägarbevis.

Kommission: ägaren ger er fullmakt att sälja en maskin. Ni påbörjar ägarbytet men ägaren är fortfarande säljare och meddelas.` },
    en: { title: "Stock, sales and consignment", summary: "For dealers: stock, the sales flow and machines on consignment.",
      body: `Stock shows machines you own with status stock, trade-in or demo, and machines you sell on consignment.

Sell a machine from stock: enter the buyer, attach the invoice and any new financing. A new sale gives the machine the highest verification level and the buyer receives an ownership certificate.

Consignment: the owner authorises you to sell one machine. You start the transfer but the owner remains the seller and is notified.` },
  },
  {
    slug: "delning-och-rapporter", category: "owner",
    sv: { title: "Dela maskinrapport och flottrapport", summary: "Tidsbegränsade länkar och verifierbara PDF:er.",
      body: `Dela en maskinrapport med en köpare via en tidsbegränsad länk. Rapporten visar historik, verifieringar, service och om det finns förbehåll. Varje visning loggas.

Flottrapporten sammanställer era maskiner, till exempel inför en upphandling, och kan delas med en beställare.

Alla PDF:er har ett dokumentnummer och en kontrollsumma som kan kontrolleras på maskinid.se/verify-document.` },
    en: { title: "Sharing machine and fleet reports", summary: "Time-limited links and verifiable PDFs.",
      body: `Share a machine report with a buyer through a time-limited link. The report shows history, verifications, service and whether there is an encumbrance. Every view is logged.

The fleet report summarises your machines, for example for a tender, and can be shared with a client.

All PDFs have a document number and a checksum that can be checked at maskinid.se/verify-document.` },
  },
  {
    slug: "kontosakerhet", category: "security",
    sv: { title: "Kontosäkerhet", summary: "BankID, tvåstegsverifiering och inloggningar.",
      body: `Rättsliga åtgärder signeras alltid med BankID. Finansiärer, myndigheter och registerhållaren måste dessutom använda tvåstegsverifiering.

Under Profil ser du dina senaste inloggningar och kan logga ut från alla enheter.

Vi ringer eller mejlar aldrig och ber om din kod. Om du misstänker att någon annan använt ditt konto: logga ut överallt och kontakta support.` },
    en: { title: "Account security", summary: "BankID, two-step verification and sign-ins.",
      body: `Legal actions are always signed with BankID. Lenders, authorities and the register keeper must also use two-step verification.

Under Profile you see your recent sign-ins and can sign out of all devices.

We never call or e-mail to ask for your code. If you suspect someone else has used your account: sign out everywhere and contact support.` },
  },
  {
    slug: "api-och-integrationer", category: "api",
    sv: { title: "API och integrationer", summary: "API-nycklar, webhooks och dokumentation.",
      body: `Administratörer skapar API-nycklar under Inställningar → API. Nyckeln visas en gång; ge den bara de behörigheter som behövs.

Webhooks skickar händelser, till exempel nytt förbehåll eller stöldflagga, till ert system. Varje anrop är signerat.

Fullständig dokumentation finns på maskinid.se/api-docs. Använd sandlådenycklar när ni testar.` },
    en: { title: "API and integrations", summary: "API keys, webhooks and documentation.",
      body: `Admins create API keys under Settings → API. The key is shown once; give it only the permissions it needs.

Webhooks send events, such as a new encumbrance or a theft flag, to your system. Every call is signed.

Full documentation is at maskinid.se/api-docs. Use sandbox keys when testing.` },
  },
];

export function helpArticle(slug: string) {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}
