import { HELP_ARTICLES, helpArticle } from "@maskinid/shared/help/articles.ts";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { EmptyState, ErrorNotice, Notice, Skeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { Icon } from "../../components/Icon";
import { RegNumber } from "../../components/RegNumber";
import { useRpc } from "../../lib/api/query";
import { backend } from "../../lib/backend";
import { formatDate } from "../../lib/format";
import { NotFoundPage } from "../NotFoundPage";

/** Plain-text body → paragraphs and lists ("- " lines). No HTML is ever injected. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  text.split(/\n{2,}/).forEach((para, i) => {
    const lines = para.split("\n");
    const intro = lines.filter((l) => !l.startsWith("- "));
    const items = lines.filter((l) => l.startsWith("- "));
    if (intro.length) blocks.push(<p key={`p${i}`} className="t-brodtext">{intro.join(" ")}</p>);
    if (items.length) blocks.push(<ul key={`u${i}`} className="lista-punkter">{items.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>);
  });
  return <>{blocks}</>;
}

interface StolenRow { reg_number: string; make: string; model: string; year: number | null; category: string; color: string | null; stolen_at: string; place: string | null; label: boolean }

/** Publik stöldlista: only machines whose owner or the police chose to publish; never the owner (step 22). */
export function StolenListPage() {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  const q = useRpc<StolenRow[]>("public_stolen_list", { p_category: category || null, p_county: null });
  const categories = [...new Set((q.data ?? []).map((r) => r.category))];
  return (
    <div className="behallare sektion stack-5">
      <div className="stack-3 smal-bred">
        <h1 className="t-rubrik-1">{t("stolen.title")}</h1>
        <p className="t-ingress">{t("stolen.lead")}</p>
        <p><a className="mid-knapp mid-knapp-primar" href="tel:11414"><Icon name="varning" />{t("public.call_police")}</a>{" "}
          <Link className="mid-knapp mid-knapp-kontur" to="/tips">{t("tips.link")}</Link></p>
      </div>
      {categories.length > 1 && (
        <FormField label={t("wizard.category")}>
          <select className="mid-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("common.all")}</option>
            {categories.map((c) => <option key={c} value={c}>{t(`enum.category.${c}`)}</option>)}
          </select>
        </FormField>
      )}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : !q.data?.length ? <EmptyState icon="bock" title={t("stolen.none")} /> : (
        <ul className="stold-lista">
          {q.data.map((r) => (
            <li key={r.reg_number}>
              <Link to={`/r/${r.reg_number}`}>
                <RegNumber value={r.reg_number} />
                <strong>{r.make} {r.model}{r.year ? ` · ${r.year}` : ""}</strong>
                <span className="t-liten">{t(`enum.category.${r.category}`)}{r.color ? ` · ${r.color}` : ""}</span>
                <span className="t-liten t-sekundar">{t("stolen.since", { date: formatDate(r.stolen_at) })}{r.place ? ` · ${r.place}` : ""}{r.label ? ` · ${t("stolen.has_label")}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="t-liten t-sekundar smal-bred">{t("stolen.privacy")}</p>
    </div>
  );
}

/** Tips: anyone can report a sighting, a suspicious listing or sale. Contact details are optional (step 22). */
export function TipPage() {
  const { t } = useTranslation();
  const [d, setD] = useState({ kind: "seen_machine", reg_or_serial: "", message: "", listing_url: "", contact: "", city: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setState("busy");
    setError(null);
    try {
      await backend.invoke("tip", { ...d, location: d.city ? { city: d.city } : null }, { anonymous: true });
      setState("sent");
    } catch (e) {
      setError(e);
      setState("idle");
    }
  }
  if (state === "sent") return <div className="behallare sektion smal-bred"><Notice kind="ok" title={t("tips.sent")}><p>{t("tips.sent_body")}</p></Notice></div>;
  return (
    <div className="behallare sektion stack-5 smal-bred">
      <h1 className="t-rubrik-1">{t("tips.title")}</h1>
      <p className="t-ingress">{t("tips.lead")}</p>
      <Notice kind="info" title={t("tips.emergency")} />
      <form className="panel stack-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("tips.kind_label")}</legend>
          {["seen_machine", "suspicious_listing", "suspicious_sale", "other"].map((k) => (
            <label key={k} className="mid-kryss"><input type="radio" name="kind" checked={d.kind === k} onChange={() => setD({ ...d, kind: k })} />{t(`tips.kind.${k}`)}</label>
          ))}
        </fieldset>
        <FormField label={t("tips.reg_or_serial")} hint={t("tips.reg_hint")} optional>
          <input className="mid-input is-id" value={d.reg_or_serial} onChange={(e) => setD({ ...d, reg_or_serial: e.target.value })} /></FormField>
        {d.kind === "suspicious_listing" && (
          <FormField label={t("tips.listing_url")} optional><input className="mid-input" type="url" value={d.listing_url} onChange={(e) => setD({ ...d, listing_url: e.target.value })} /></FormField>
        )}
        <FormField label={t("tips.message")}><textarea className="mid-input" rows={4} value={d.message} onChange={(e) => setD({ ...d, message: e.target.value })} required minLength={5} /></FormField>
        <FormField label={t("tips.city")} optional><input className="mid-input" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} /></FormField>
        <FormField label={t("tips.contact")} hint={t("tips.contact_hint")} optional><input className="mid-input" value={d.contact} onChange={(e) => setD({ ...d, contact: e.target.value })} /></FormField>
        {!!error && <ErrorNotice error={error} />}
        <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={state === "busy" || d.message.trim().length < 5}>{t("tips.submit")}</button></div>
      </form>
    </div>
  );
}

/** Hjälpcenter: searchable articles in the user's language. */
export function HelpPage() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const en = i18n.language.startsWith("en");
  const needle = q.trim().toLowerCase();
  const list = HELP_ARTICLES.filter((a) => {
    const l = en ? a.en : a.sv;
    return !needle || `${l.title} ${l.summary} ${l.body}`.toLowerCase().includes(needle);
  });
  return (
    <div className="behallare sektion stack-5 smal-bred">
      <h1 className="t-rubrik-1">{t("nav.help")}</h1>
      <p className="t-ingress">{t("help.lead")}</p>
      <FormField label={t("help.search")}><input className="mid-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></FormField>
      {!list.length ? <EmptyState icon="sok" title={t("help.none")} /> : (
        <ul className="handlingar">
          {list.map((a) => {
            const l = en ? a.en : a.sv;
            return <li key={a.slug}><Link className="handling" to={`/help/${a.slug}`}><strong>{l.title}</strong><span>{l.summary}</span></Link></li>;
          })}
        </ul>
      )}
      <Notice kind="info" title={t("help.not_found_title")}>
        <p><Link className="mid-lank" to="/contact">{t("help.contact")}</Link></p>
      </Notice>
    </div>
  );
}

export function HelpArticlePage() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const a = helpArticle(slug ?? "");
  if (!a) return <NotFoundPage />;
  const l = i18n.language.startsWith("en") ? a.en : a.sv;
  return (
    <article className="behallare sektion stack-4 smal-bred">
      <p><Link className="mid-lank" to="/help">{t("nav.help")}</Link></p>
      <h1 className="t-rubrik-1">{l.title}</h1>
      <p className="t-ingress">{l.summary}</p>
      <RichText text={l.body} />
      <p className="t-liten t-sekundar"><Link className="mid-lank" to="/contact">{t("help.contact")}</Link></p>
    </article>
  );
}

/** Kontakt: support form for people without an account (signed-in users use Support in the app). */
export function ContactPage() {
  const { t } = useTranslation();
  const [d, setD] = useState({ email: "", category: "other", subject: "", body: "" });
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await backend.invoke<{ number: number }>("support", d, { anonymous: true });
      setSent(r.number);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (sent !== null) return <div className="behallare sektion smal-bred"><Notice kind="ok" title={t("support.sent", { number: sent })} /></div>;
  return (
    <div className="behallare sektion stack-5 smal-bred">
      <h1 className="t-rubrik-1">{t("support.contact_title")}</h1>
      <p className="t-ingress">{t("support.contact_lead")}</p>
      <form className="panel stack-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <FormField label={t("common.email")}><input className="mid-input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} required /></FormField>
        <SupportFields<typeof d> d={d} setD={setD} />
        {!!error && <ErrorNotice error={error} />}
        <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{t("support.send")}</button></div>
      </form>
    </div>
  );
}

export const SUPPORT_CATEGORIES = ["account", "machine", "transfer", "financing", "labels", "api", "billing", "privacy", "other"] as const;

export function SupportFields<T extends { category: string; subject: string; body: string }>({ d, setD }: { d: T; setD(v: T): void }) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t("support.category")}>
        <select className="mid-select" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
          {SUPPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`support.categories.${c}`)}</option>)}
        </select>
      </FormField>
      <FormField label={t("support.subject")}><input className="mid-input" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} required minLength={3} /></FormField>
      <FormField label={t("support.message")}><textarea className="mid-input" rows={6} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} required /></FormField>
    </>
  );
}

interface LegalDoc { key: string; version: number; locale: string; title: string; body: string; published_at: string; latest: number; versions: number[] }

/** Juridiska dokument: villkor, integritetspolicy, biträdesavtal, kakor – with version history. */
export function LegalPage() {
  const { t, i18n } = useTranslation();
  const { key } = useParams();
  const [version, setVersion] = useState<number | null>(null);
  const q = useRpc<LegalDoc | null>("get_legal_document", { p_key: key, p_locale: i18n.language.startsWith("en") ? "en" : "sv", p_version: version });
  if (q.isLoading) return <div className="behallare sektion"><Skeleton lines={8} /></div>;
  if (!q.data) return <NotFoundPage />;
  const d = q.data;
  return (
    <article className="behallare sektion stack-4 smal-bred">
      <h1 className="t-rubrik-1">{d.title}</h1>
      <p className="t-liten t-sekundar">{t("legal.version", { version: d.version, date: formatDate(d.published_at) })}
        {d.versions.length > 1 && <> · <select className="mid-select mid-select-liten" aria-label={t("legal.versions")} value={d.version}
          onChange={(e) => setVersion(Number(e.target.value))}>{[...d.versions].sort((a, b) => b - a).map((v) => <option key={v} value={v}>{t("legal.version_short", { version: v })}</option>)}</select></>}</p>
      {d.version !== d.latest && <Notice kind="info" title={t("legal.old_version")} />}
      <RichText text={d.body} />
      <nav className="mid-rad t-liten" aria-label={t("legal.other")}>
        {["terms", "privacy", "dpa", "cookies"].filter((k) => k !== key).map((k) => <Link key={k} className="mid-lank" to={`/legal/${k}`}>{t(`legal.keys.${k}`)}</Link>)}
      </nav>
    </article>
  );
}
