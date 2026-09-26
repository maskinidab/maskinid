import { Link } from "react-router-dom";
import { LookupField } from "../components/LookupField";
import { dataSource } from "../lib/api";

/** Omslagsbildens geometri ur profilen: gul platta, djup yta med ID-ram, tonad platta och ett verifierat chip. */
function HeroArt() {
  return (
    <svg className="hjalte-konst" viewBox="0 0 480 288" aria-hidden="true">
      <rect className="gul" x="32" y="0" width="144" height="224" />
      <rect className="ton" x="208" y="0" width="128" height="40" />
      <rect className="djup" x="208" y="64" width="272" height="160" />
      <path className="gul" d="M240 96L264 96L264 100L244 100L244 120L240 120ZM448 96L424 96L424 100L444 100L444 120L448 120ZM240 192L264 192L264 188L244 188L244 168L240 168ZM448 192L424 192L424 188L444 188L444 168L448 168Z" />
      <rect className="ok" x="32" y="248" width="48" height="16" rx="2" />
      <path className="djup" d="M24 240L36 240L36 242L26 242L26 252L24 252ZM88 240L76 240L76 242L86 242L86 252L88 252ZM24 272L36 272L36 270L26 270L26 260L24 260ZM88 272L76 272L76 270L86 270L86 260L88 260Z" />
    </svg>
  );
}

const EXEMPEL = [
  { q: "7KX0L2T4003198", text: "Hjullastare, belånad" },
  { q: "1FG5H3R8002741", text: "Grävmaskin utan belåning" },
  { q: "9DM2T7A5000452", text: "Dumper, anmäld stulen" },
];

export function HomePage() {
  return (
    <>
      <section className="hjalte">
        <div className="behallare hjalte-inre">
          <div className="stack-6">
            <div className="stack-4">
              <h1 className="t-display">Kolla maskinen innan affären</h1>
              <p className="t-ingress">
                Se vem som äger maskinen, om den är belånad och vem som försäkrar den – i ett uppslag.
              </p>
            </div>
            <LookupField />
            {dataSource === "mock" && (
              <p className="t-liten t-sekundar">
                Prova med exempeldata:{" "}
                {EXEMPEL.map((e, i) => (
                  <span key={e.q}>
                    {i > 0 && " · "}
                    <Link className="mid-lank" to={`/sok?q=${e.q}`}>
                      {e.text}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
          <HeroArt />
        </div>
      </section>

      <section className="sektion">
        <div className="behallare stack-6">
          <h2 className="t-rubrik-2">Tre uppgifter om varje maskin</h2>
          <div className="fakta">
            <div>
              <h3 className="t-rubrik-4">Registrerad ägare</h3>
              <p className="t-brodtext t-sekundar">Vilket företag som äger maskinen och sedan när. Ägarbyten registreras av säljaren.</p>
            </div>
            <div>
              <h3 className="t-rubrik-4">Belåning</h3>
              <p className="t-brodtext t-sekundar">Om maskinen är belånad och hos vilken långivare. Uppgiften kommer från långivaren.</p>
            </div>
            <div>
              <h3 className="t-rubrik-4">Försäkring</h3>
              <p className="t-brodtext t-sekundar">Vem som försäkrar maskinen och hur länge. Uppgiften kommer från försäkringsgivaren.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sektion sektion-yta2">
        <div className="behallare stack-6">
          <h2 className="t-rubrik-2">Så går en kontroll till</h2>
          <ol className="steg">
            <li>
              <h3 className="t-rubrik-4">Hitta numret</h3>
              <p className="t-brodtext t-sekundar">PIN eller serienummer står på maskinens typskylt. Registernumret står på tidigare registerutdrag.</p>
            </li>
            <li>
              <h3 className="t-rubrik-4">Sök i registret</h3>
              <p className="t-brodtext t-sekundar">Registerposten visar ägare, belåning, försäkring och om maskinen är spärrad.</p>
            </li>
            <li>
              <h3 className="t-rubrik-4">Hämta registerutdrag</h3>
              <p className="t-brodtext t-sekundar">Utdraget har ett eget nummer och sigill. Spara det tillsammans med affärens övriga handlingar.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="sektion" id="aktorer">
        <div className="behallare stack-6">
          <h2 className="t-rubrik-2">Ett register för hela affären</h2>
          <div className="aktorer">
            <div className="stack-2">
              <h3 className="t-rubrik-4">Maskinhandlare</h3>
              <p className="t-liten t-sekundar">Kontrollera inbytesmaskiner och registrera ägarbyte vid försäljning.</p>
            </div>
            <div className="stack-2">
              <h3 className="t-rubrik-4">Maskinägare</h3>
              <p className="t-liten t-sekundar">Registrera maskinparken, visa köpare att maskinen är fri och anmäl stöld.</p>
            </div>
            <div className="stack-2">
              <h3 className="t-rubrik-4">Långivare</h3>
              <p className="t-liten t-sekundar">Registrera och avsluta belåning. Se när en belånad maskin byter ägare.</p>
            </div>
            <div className="stack-2">
              <h3 className="t-rubrik-4">Försäkringsgivare</h3>
              <p className="t-liten t-sekundar">Registrera försäkring och se om en maskin är anmäld stulen.</p>
            </div>
          </div>
          <p>
            <Link className="mid-knapp mid-knapp-kontur" to="/logga-in">
              Logga in för att registrera uppgifter
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
