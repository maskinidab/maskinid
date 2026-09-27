import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { CompanyLookupField, type CompanyInfo } from "../../../components/CompanyLookupField";
import { DocumentDropzone } from "../../../components/DocumentDropzone";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { rpc, useRpc } from "../../../lib/api/query";
import type { DocumentItem, MachineListItem, MachineView, OrgBrief, Transfer } from "../../../lib/api/types";
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
  const financiers = useRpc<OrgBrief[]>("list_partner_orgs", { p_type: "financier" });
  const [mode, setMode] = useState<"org" | "email">("org");
  const [orgNr, setOrgNr] = useState("");
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [email, setEmail] = useState("");
  const [saleDate, setSaleDate] = useState(todayIso());
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [fin, setFin] = useState({ holder: "", type: "ownership_reservation", ref: "", end: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const m = machine.data;
  const newSaleEligible = !!m && !m.first_sale_date && m.owner_ordinal <= 1;
  const [newSale, setNewSale] = useState(true);
  const hasInvoice = docs.some((d) => d.type === "invoice");

  async function submit() {
    setFieldErr(null);
    setError(null);
    if (mode === "org" && !company) return setFieldErr(t("actions.transfer.buyer_required"));
    if (mode === "email" && !/^\S+@\S+\.\S+$/.test(email)) return setFieldErr(t("actions.transfer.email_invalid"));
    if (newSaleEligible && newSale && !hasInvoice) return setFieldErr(t("dealer.invoice_required"));
    if (fin.holder && fin.type === "ownership_reservation" && !fin.end) return setFieldErr(t("actions.encumbrance.end_required"));
    setBusy(true);
    try {
      const r = await rpc<{ transfer: Transfer }>("sell_machine", {
        p_org_id: orgId, p_machine_id: m!.id, p_sale_date: saleDate, p_new_sale: newSaleEligible && newSale, p_document_ids: docs.map((d) => d.id),
        p_buyer: mode === "org" ? (company!.existing_org ? { org_id: company!.existing_org.id } : { org_number: company!.org_number }) : { email },
        p_new_financing: fin.holder ? { holder_org_id: fin.holder, type: fin.type, contract_ref: fin.ref || null, end_date: fin.end || null } : null,
      });
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
          {m.financing?.has_active && <Notice kind="info" title={t("actions.transfer.financier_first", { holder: m.financing.active?.holder.name ?? "" })} />}
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
              <FormField className="kol-6" label={t("actions.encumbrance.holder")}>
                <select className="mid-select" value={fin.holder} onChange={(e) => setFin({ ...fin, holder: e.target.value })}>
                  <option value="">{t("common.none")}</option>
                  {(financiers.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </FormField>
              {fin.holder && <>
                <FormField className="kol-6" label={t("common.type")}>
                  <select className="mid-select" value={fin.type} onChange={(e) => setFin({ ...fin, type: e.target.value })}>
                    {["ownership_reservation", "leasing"].map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
                  </select>
                </FormField>
                <FormField className="kol-6" label={t("actions.encumbrance.contract_ref")} optional>
                  <input className="mid-input is-id" value={fin.ref} onChange={(e) => setFin({ ...fin, ref: e.target.value })} />
                </FormField>
                <FormField className="kol-6" label={t("actions.encumbrance.end")} optional={fin.type !== "ownership_reservation"}>
                  <input className="mid-input" type="date" min={saleDate} value={fin.end} onChange={(e) => setFin({ ...fin, end: e.target.value })} />
                </FormField>
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
