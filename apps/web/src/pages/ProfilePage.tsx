import tokens from "../../../../design-system/tokens.json";
import appikonGul from "../assets/logo/maskinid-appikon-gul.svg";
import appikon from "../assets/logo/maskinid-appikon.svg";
import ordmarkeNegativ from "../assets/logo/maskinid-ordmarke-negativ.svg";
import ordmarke from "../assets/logo/maskinid-ordmarke.svg";
import symbolNegativ from "../assets/logo/maskinid-symbol-negativ.svg";
import symbol from "../assets/logo/maskinid-symbol.svg";
import { IdFrame, IdNumber } from "../components/IdFrame";
import { Icon, type IconName } from "../components/Icon";
import { Seal } from "../components/Seal";
import { StatusBadge } from "../components/StatusBadge";

/**
 * Levande referens för den grafiska profilen i appen: logotyper, färger, typografi och komponenter.
 * Källan är design-system/ (exporterad från MaskinIDs grafiska profil).
 */
const LOGOS = [
  { src: ordmarke, wordmark: true, text: "Primärt ordmärke, ljus botten", dark: false },
  { src: ordmarkeNegativ, wordmark: true, text: "Negativt ordmärke, mörk botten", dark: true },
  { src: symbol, wordmark: false, text: "Symbolen, ljus botten", dark: false },
  { src: symbolNegativ, wordmark: false, text: "Symbolen, mörk botten", dark: true },
  { src: appikon, wordmark: false, text: "Appikon", dark: false },
  { src: appikonGul, wordmark: false, text: "Appikon, gul", dark: false },
];

const ICONS: IconName[] = ["bock", "hanglas", "varning", "sok", "nedladdning", "dokument", "skold", "byt", "plus", "skrivare"];

export function ProfilePage() {
  const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => ({ ...s, family: g.family })));
  return (
    <div className="behallare sektion stack-8">
      <div className="stack-3">
        <h1 className="t-rubrik-1">Grafisk profil</h1>
        <p className="t-ingress">Byggstenarna som gränssnittet använder. Ändra tokens i design-system/tokens.json och kör npm run tokens.</p>
      </div>

      <section className="stack-5">
        <h2 className="t-rubrik-2">Logotyper</h2>
        <div className="handlingar">
          {LOGOS.map((l) => (
            <figure key={l.text} className="panel stack-3" style={{ margin: 0, background: l.dark ? "var(--maskin-svart)" : "var(--vit)" }}>
              <img src={l.src} alt="" style={{ height: l.wordmark ? 32 : 64, width: "auto" }} />
              <figcaption className="t-liten" style={{ color: l.dark ? "#a3abb3" : "#4e565e" }}>{l.text}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="stack-5">
        <h2 className="t-rubrik-2">Färg</h2>
        <div className="mid-tabell-wrap">
          <table className="mid-tabell">
            <thead><tr><th>Token</th><th>Ljust</th><th>Mörkt</th><th>Användning</th></tr></thead>
            <tbody>
              {tokens.color.tokens.map((c) => (
                <tr key={c.name}>
                  <td><span className="mid-id">{c.name}</span></td>
                  {(["ljust", "morkt"] as const).map((t) => (
                    <td key={t} style={{ whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 16, height: 16, verticalAlign: "-3px", marginRight: 8, background: c.value[t], border: "1px solid var(--linje)" }} />
                      <span className="mid-id">{c.value[t]}</span>
                    </td>
                  ))}
                  <td className="t-liten">{c.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack-5">
        <h2 className="t-rubrik-2">Typografi</h2>
        <div className="stack-4">
          {styles.map((s) => (
            <div key={s.name} className="rutnat" style={{ alignItems: "baseline", borderTop: "1px solid var(--linje)", paddingTop: 12 }}>
              <div className="kol-4 t-liten t-sekundar"><span className="mid-id" style={{ fontSize: 13 }}>{s.name}</span> · {s.fontSize}/{s.lineHeight}</div>
              <div className="kol-8" style={{ fontFamily: `var(--font-${s.family})`, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, letterSpacing: "letterSpacing" in s ? s.letterSpacing : undefined, overflowWrap: "anywhere" }}>
                {s.sample}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-5">
        <h2 className="t-rubrik-2">Komponenter</h2>
        <div className="stack-6">
          <div className="mid-rad">
            <button className="mid-knapp mid-knapp-primar"><Icon name="sok" />Sök i registret</button>
            <button className="mid-knapp mid-knapp-sekundar"><Icon name="nedladdning" />Hämta registerutdrag</button>
            <button className="mid-knapp mid-knapp-kontur">Avbryt</button>
            <button className="mid-knapp mid-knapp-primar" disabled>Sök i registret</button>
          </div>
          <div className="mid-rad">
            <StatusBadge kind="verifierad">Identitet verifierad</StatusBadge>
            <StatusBadge kind="verifierad">Ingen registrerad belåning</StatusBadge>
            <StatusBadge kind="belanad">Belånad</StatusBadge>
            <StatusBadge kind="sparr">Anmäld stulen</StatusBadge>
          </div>
          <div className="mid-rad" style={{ gap: 32 }}>
            <IdFrame size="stor"><IdNumber value="7KX0L2T4003198" prefix="PIN" size="stor" /></IdFrame>
            <Seal size={112} />
          </div>
          <div className="mid-rad" style={{ gap: 16 }}>
            {ICONS.map((n) => (
              <span key={n} title={n} style={{ display: "inline-flex", width: 24, height: 24 }}><Icon name={n} /></span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
