import { Link } from "react-router-dom";

export function AboutPage() {
  return (
    <div className="behallare sektion stack-7">
      <div className="stack-4">
        <h1 className="t-rubrik-1">Så fungerar MaskinID</h1>
        <p className="t-ingress">
          MaskinID är registret där maskinhandlare, maskinägare, långivare och försäkringsgivare ser vem som äger en maskin,
          om den är belånad och vem som försäkrar den.
        </p>
      </div>

      <section className="rutnat" id="uppgifter">
        <div className="kol-4"><h2 className="t-rubrik-3">Uppgifternas källa</h2></div>
        <div className="kol-8 stack-4">
          <p className="t-brodtext">
            Varje uppgift registreras av den som ansvarar för den. Registrerad ägare anges av ägaren eller av säljaren vid ett
            ägarbyte. Belåning registreras och avslutas av långivaren. Försäkring registreras av försäkringsgivaren.
          </p>
          <p className="t-brodtext">
            I registerposten står alltid vem uppgiften kommer från och när den uppdaterades. Alla ändringar sparas i maskinens
            historik och kan inte tas bort.
          </p>
        </div>
      </section>

      <section className="rutnat">
        <div className="kol-4"><h2 className="t-rubrik-3">Status i registret</h2></div>
        <div className="kol-8">
          <dl className="definitioner">
            <dt>Identitet verifierad</dt>
            <dd>PIN eller serienummer är kontrollerat mot maskinens typskylt.</dd>
            <dt>Ingen registrerad belåning</dt>
            <dd>Ingen långivare har registrerat belåning på maskinen.</dd>
            <dt>Belånad</dt>
            <dd>En långivare har registrerat belåning. Kontakta långivaren innan maskinen byter ägare.</dd>
            <dt>Spärrad</dt>
            <dd>Maskinen är anmäld stulen eller har en avvikelse som kräver kontroll. Genomför ingen affär förrän spärren är hävd.</dd>
          </dl>
        </div>
      </section>

      <section className="rutnat" id="aktorer">
        <div className="kol-4"><h2 className="t-rubrik-3">Vem gör vad</h2></div>
        <div className="kol-8">
          <div className="mid-tabell-wrap">
            <table className="mid-tabell">
              <thead>
                <tr><th>Aktör</th><th>Kan registrera</th></tr>
              </thead>
              <tbody>
                <tr><td>Maskinägare</td><td>Maskin, ägarbyte, spärr</td></tr>
                <tr><td>Maskinhandlare</td><td>Maskin, ägarbyte, spärr på egna maskiner</td></tr>
                <tr><td>Långivare</td><td>Belåning, avslutad belåning, spärr på belånade maskiner</td></tr>
                <tr><td>Försäkringsgivare</td><td>Försäkring, spärr på försäkrade maskiner</td></tr>
                <tr><td>Registerhållaren (MaskinID)</td><td>Verifierad identitet, organisationer och användarkonton</td></tr>
                <tr><td>Alla</td><td>Sökning och registerutdrag (utdrag kräver inloggning)</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p>
        <Link className="mid-knapp mid-knapp-primar" to="/">Sök i registret</Link>
      </p>
    </div>
  );
}
