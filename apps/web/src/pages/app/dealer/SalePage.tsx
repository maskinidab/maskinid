import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { CompanyLookupField, type CompanyInfo } from "../../../components/CompanyLookupField";
import { DocumentDropzone } from "../../../components/DocumentDropzone";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FinancierPicker, type FinancierProfile, type PickedFinancier } from "../../../components/FinancierPicker";
import { EMPTY_TERMS, FinancingTermsFields, termsError, termsPayload, type TermsForm } from "../../../components/FinancingTerms";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { rpc, useRpc } from "../../../lib/api/query";
import type { DocumentItem, MachineListItem, MachineView, Transfer } from "../../../lib/api/types";
import { todayIso } from "../../../lib/format";

/**
 * Sell a machine (SPEC §6.3 / §6.7): pick a stock machine (or register a new one), buyer by org number or e-mail,
 * invoice, optional financier for the buyer. A first sale from stock with invoice is a new sale ⇒ level 2 when the
 * buyer accepts.
 */
export function SalePage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const machineId = params.get("machine") ?? "";
  const stock = useRpc<{ items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: "stock", p_limit: 500 });
  const machine = useRpc<MachineView>("get_machine", machineId ? { p_org_id: orgId, p_machine_id: machineId } : null);
  const [mode, setMode] = useState<"org" | "email">("org");
  const [orgNr, setOrgNr] = useState("");
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [email, setEmail] = useState("");
  const [saleDate, setSaleDate] = useState(todayIso());
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [fin, setFin] = useState({ holder: "", type: "ownership_reservation", ref: "", end: "" });
  // The buyer's bank may be one we know or one named by organisation number (ADR 0027).
  const [holder, setHolder] = useState<PickedFinancier | null>(null);
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS);
  const setTerm = <K extends keyof TermsForm>(k: K, v: TermsForm[K]) => setTerms((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const m = machine.data;
  const newSaleEligible = !!m && !m.first_sale_date && m.owner_ordinal <= 1;
  const [newSale, setNewSale] = useState(true);
  const hasInvoice = docs.some((d) => d.type === "invoice");
  const [askPayoff, setAskPayoff] = useState(true);

  async function submit() {
    setFieldErr(null);
    setError(null);
    if (mode === "org" && !company) return setFieldErr(t("actions.transfer.buyer_required"));
    if (mode === "email" && !/^\S+@\S+\.\S+$/.test(email)) return setFieldErr(t("actions.transfer.email_invalid"));
    if (newSaleEligible && newSale && !hasInvoice) return setFieldErr(t("dealer.invoice_required"));
    if (holder && fin.type === "ownership_reservation" && !fin.end) return setFieldErr(t("actions.encumbrance.end_required"));
    // Mandatory as soon as a bank is named: the lender has to be able to tie the machine to the right financing
    // agreement. app.require_contract_ref enforces it again when the financing reaches the bank.
    if (holder && !fin.ref.trim()) return setFieldErr(t("actions.encumbrance.contract_ref_required"));
    if (holder) {
      const badTerms = termsError(terms, t);
      if (badTerms) return setFieldErr(badTerms);
    }
    setBusy(true);
    try {
      const r = await rpc<{ transfer: Transfer }>("sell_machine", {
        p_org_id: orgId, p_machine_id: m!.id, p_sale_date: saleDate, p_new_sale: newSaleEligible && newSale, p_document_ids: docs.map((d) => d.id),
        p_buyer: mode === "org" ? (company!.existing_org ? { org_id: company!.existing_org.id } : { org_number: company!.org_number }) : { email },
        // The terms travel with the request and app.open_new_financing copies them onto the encumbrance and then
        // strips them off the transfer row – open_transfer is visible to the authority and to a dealer at
        // trade-in, and the terms are for the owner and the lender only (ADR 0029).
        p_new_financing: holder
          ? { holder_org_id: holder.holder_org_id, holder_org_number: holder.holder_org_number, holder_name: holder.holder_name,
              type: fin.type, contract_ref: fin.ref, end_date: fin.end || null, ...(termsPayload(terms) ?? {}) }
          : null,
      });
      if (askPayoff && m!.financing?.active) {
        await rpc("request_payoff", {
          p_org_id: orgId, p_encumbrance_id: m!.financing.active.id, p_purpose: "sale",
          p_transfer_id: r.transfer.id, p_message: null,
        }).catch(() => undefined); // The sale is done either way; the payoff can be asked for again from the machine.
      }
      nav(path(`transfers/${r.transfer.id}`));
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("nav.sales_new")} lead={t("dealer.sale_lead")} />
      <section className="panel stack-3">
        <label className="mid-etikett" htmlFor="salj-maskin">{t("machines.col_machine")}</label>
        {stock.isLoading ? <Skeleton lines={1} /> : (
          <select id="salj-maskin" className="mid-select" value={machineId} onChange={(e) => setParams(e.target.value ? { machine: e.target.value } : {}, { replace: true })}>
            <option value="">{t("common.select")}</option>
            {(stock.data?.items ?? []).filter((x) => !x.open_transfer_status).map((x) => <option key={x.id} value={x.id}>{x.reg_number} · {x.make} {x.model}{x.year ? ` ${x.year}` : ""}</option>)}
          </select>
        )}
        <p className="t-liten">{t("dealer.not_in_stock")} <Link className="mid-lank" to={path("machines/new")}>{t("nav.register")}</Link></p>
      </section>
      {m && (
        <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p><RegNumber value={m.reg_number} framed /> <strong>{m.make} {m.model}</strong></p>
          {m.financing?.has_active && (
            <Notice kind="info" title={t("actions.transfer.financier_first", { holder: m.financing.active?.holder.name ?? "" })}>
              <label className="mid-kryss">
                <input type="checkbox" checked={askPayoff} onChange={(e) => setAskPayoff(e.target.checked)} />
                <span>{t("payoff.request_with_sale", { holder: m.financing.active?.holder.name ?? "" })}</span>
              </label>
            </Notice>
          )}
          <fieldset className="stack-3">
            <legend className="mid-etikett">{t("actions.transfer.buyer")}</legend>
            <div className="mid-val">
              <label><input type="radio" checked={mode === "org"} onChange={() => setMode("org")} /> {t("actions.transfer.by_org")}</label>
              <label><input type="radio" checked={mode === "email"} onChange={() => setMode("email")} /> {t("actions.transfer.by_email")}</label>
            </div>
            {mode === "org" ? <CompanyLookupField value={orgNr} onChange={setOrgNr} onFound={setCompany} label={t("common.org_number")} />
              : <input className="mid-input" type="email" aria-label={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} />}
          </fieldset>
          <FormField label={t("actions.transfer.sale_date")}>
            <input className="mid-input" type="date" max={todayIso()} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </FormField>
          {newSaleEligible && (
            <label className="mid-kryss"><input type="checkbox" checked={newSale} onChange={(e) => setNewSale(e.target.checked)} />
              <span><strong>{t("dealer.new_sale")}</strong><br /><span className="t-liten t-sekundar">{t("dealer.new_sale_hint")}</span></span></label>
          )}
          <section className="stack-2">
            <p className="mid-etikett">{t("dealer.invoice")}{!(newSaleEligible && newSale) && <span className="t-sekundar"> ({t("common.optional")})</span>}</p>
            {docs.map((d) => <p key={d.id} className="t-liten"><Icon name="bock" className="ikon-inline" /> {d.filename}</p>)}
            <DocumentDropzone orgId={orgId} machineId={m.id} type="invoice" visibility="owner_and_financier" onUploaded={(d) => setDocs((x) => [...x, d])} />
          </section>
          <fieldset className="stack-3">
            <legend className="mid-etikett">{t("dealer.buyer_financing")} <span className="t-sekundar">({t("common.optional")})</span></legend>
            <div className="rutnat">
              <div className="kol-12">
                <FinancierPicker value={holder} onChange={setHolder} onProfile={(p: FinancierProfile | null) => {
                  const d = p?.financing_defaults;
                  if (d?.default_type) setFin((x) => ({ ...x, type: d.default_type! }));
                }} />
              </div>
              {holder && <>
                <FormField className="kol-6" label={t("common.type")}>
                  <select className="mid-select" value={fin.type} onChange={(e) => setFin({ ...fin, type: e.target.value })}>
                    {["ownership_reservation", "leasing"].map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
                  </select>
                </FormField>
                <FormField className="kol-6" label={t("actions.encumbrance.contract_ref")} hint={t("actions.encumbrance.contract_ref_hint")}>
                  <input className="mid-input is-id" value={fin.ref} onChange={(e) => setFin({ ...fin, ref: e.target.value })} />
                </FormField>
                <FormField className="kol-6" label={t("actions.encumbrance.end")} optional={fin.type !== "ownership_reservation"}>
                  <input className="mid-input" type="date" min={saleDate} value={fin.end} onChange={(e) => setFin({ ...fin, end: e.target.value })} />
                </FormField>
                <div className="kol-12"><FinancingTermsFields form={terms} set={setTerm} /></div>
              </>}
            </div>
          </fieldset>
          {fieldErr && <p className="mid-fel" role="alert">{fieldErr}</p>}
          {error != null && <ErrorNotice error={error} />}
          <p className="t-liten t-sekundar">{t("dealer.sale_next")}</p>
          <div className="mid-rad mid-rad-slut"><button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{busy ? t("common.loading") : t("actions.transfer.submit")}</button></div>
        </form>
      )}
    </div>
  );
}
