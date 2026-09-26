import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";
import { MachineSelect } from "./EquipmentPages";

export interface ChecklistItem { id: string; sv: string; en?: string; critical?: boolean }
interface Template { id: string; name: string; items: ChecklistItem[]; builtin: boolean; categories: string[] }
export interface DailyCheck {
  id: string; machine_id: string; reg_number: string; make: string; model: string; result: "ok" | "remarks" | "failed"; created_at: string;
  template_name: string; items: ChecklistItem[]; answers: { id: string; ok: boolean; note: string | null }[]; hours: number | null;
  note: string | null; operator: string | null; by: string | null;
}

const RESULT_KIND = { ok: "verifierad", remarks: "vantar", failed: "sparr" } as const;

export function CheckResultBadge({ result }: { result: DailyCheck["result"] }) {
  const { t } = useTranslation();
  return <StatusBadge kind={RESULT_KIND[result]}>{t(`daily.result.${result}`)}</StatusBadge>;
}

export function itemLabel(i: ChecklistItem, lang: string) {
  return (lang.startsWith("en") ? i.en : i.sv) || i.sv || i.en || i.id;
}

/** Daglig kontroll: the operator goes through the machine's checklist on the phone; a failed critical item stops the machine. */
export function DailyCheckPage() {
  const { t } = useTranslation();
  const { isAdmin } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "new";
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.daily_check")} lead={t("daily.lead")} />
      <Tabs label={t("nav.daily_check")} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })}
        tabs={[{ id: "new", label: t("daily.tab_new") }, { id: "history", label: t("daily.tab_history") }, ...(isAdmin ? [{ id: "templates", label: t("daily.tab_templates") }] : [])]} />
      {tab === "new" && <NewCheck />}
      {tab === "history" && <History />}
      {tab === "templates" && isAdmin && <Templates />}
    </div>
  );
}

function NewCheck() {
  const { t, i18n } = useTranslation();
  const { orgId, path } = useOrg();
  const [params] = useSearchParams();
  const [machine, setMachine] = useState(params.get("machine") ?? "");
  const templates = useRpc<Template[]>("list_checklist_templates", machine ? { p_org_id: orgId, p_machine_id: machine } : null);
  const operators = useRpc<{ id: string; name: string; active: boolean }[]>("list_operators", { p_org_id: orgId });
  const [templateId, setTemplateId] = useState("");
  const [answers, setAnswers] = useState<Record<string, { ok: boolean | null; note: string }>>({});
  const [hours, setHours] = useState("");
  const [operator, setOperator] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ result: DailyCheck["result"]; operational_status: string } | null>(null);
  const submit = useRpcMutation<Record<string, unknown>, { result: DailyCheck["result"]; operational_status: string }>("submit_daily_check", { onSuccess: (r) => setDone(r) });
  const tpl = templates.data?.find((x) => x.id === templateId) ?? templates.data?.[0];
  const missing = tpl ? tpl.items.filter((i) => answers[i.id]?.ok == null).length : 0;
  const set = (id: string, v: Partial<{ ok: boolean | null; note: string }>) => setAnswers((a) => ({ ...a, [id]: { ...{ ok: null, note: "" }, ...a[id], ...v } }));

  if (done) {
    return (
      <section className="panel stack-4 smal-bred" aria-live="polite">
        <Notice kind={done.result === "failed" ? "fel" : "ok"} title={t(`daily.done.${done.result}`)}>
          {done.operational_status === "out_of_service" && <p>{t("daily.out_of_service")}</p>}
        </Notice>
        <div className="mid-rad">
          <Link className="mid-knapp mid-knapp-kontur" to={path(`machines/${machine}`)}>{t("wizard.done_open")}</Link>
          <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => { setDone(null); setAnswers({}); setMachine(""); setHours(""); setNote(""); }}>{t("daily.next")}</button>
        </div>
      </section>
    );
  }
  return (
    <form className="stack-5 smal-bred" onSubmit={(e) => {
      e.preventDefault();
      if (!tpl || missing) return;
      submit.mutate({ p_org_id: orgId, p_machine_id: machine, p_template_id: tpl.id, p_hours: hours ? Number(hours.replace(/\s/g, "")) : null,
        p_operator_id: operator || null, p_note: note || null,
        p_answers: tpl.items.map((i) => ({ id: i.id, ok: answers[i.id]!.ok, note: answers[i.id]!.note || null })) });
    }}>
      <FormField label={t("machines.col_machine")}><MachineSelect value={machine} onChange={(v) => { setMachine(v); setTemplateId(""); setAnswers({}); }} /></FormField>
      {machine && templates.isLoading && <Skeleton lines={4} />}
      {tpl && (
        <>
          {(templates.data?.length ?? 0) > 1 && (
            <FormField label={t("daily.template")}>
              <select className="mid-select" value={tpl.id} onChange={(e) => { setTemplateId(e.target.value); setAnswers({}); }}>
                {templates.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </FormField>
          )}
          <div className="rutnat">
            <FormField className="kol-6" label={t("daily.operator")} optional>
              <select className="mid-select" value={operator} onChange={(e) => setOperator(e.target.value)}>
                <option value="">{t("common.none")}</option>
                {(operators.data ?? []).filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </FormField>
            <FormField className="kol-6" label={t("machine.hours")} optional><input className="mid-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></FormField>
          </div>
          <fieldset className="stack-3">
            <legend className="mid-etikett">{tpl.name}</legend>
            <ol className="checklista">
              {tpl.items.map((i) => {
                const a = answers[i.id];
                return (
                  <li key={i.id} className={a?.ok === false ? "is-fel" : a?.ok ? "is-ok" : undefined}>
                    <div className="checklista-rad">
                      <span>{itemLabel(i, i18n.language)}{i.critical && <span className="t-liten t-sekundar"> · {t("daily.critical")}</span>}</span>
                      <span className="checklista-val" role="radiogroup" aria-label={itemLabel(i, i18n.language)}>
                        <button type="button" role="radio" aria-checked={a?.ok === true} className={`mid-knapp mid-knapp-liten ${a?.ok === true ? "mid-knapp-primar" : "mid-knapp-kontur"}`}
                          onClick={() => set(i.id, { ok: true })}><Icon name="bock" />{t("daily.ok")}</button>
                        <button type="button" role="radio" aria-checked={a?.ok === false} className={`mid-knapp mid-knapp-liten ${a?.ok === false ? "mid-knapp-fara" : "mid-knapp-kontur"}`}
                          onClick={() => set(i.id, { ok: false })}><Icon name="varning" />{t("daily.fault")}</button>
                      </span>
                    </div>
                    {a?.ok === false && <input className="mid-input" aria-label={t("daily.fault_note")} placeholder={t("daily.fault_note")} value={a.note}
                      onChange={(e) => set(i.id, { note: e.target.value })} />}
                  </li>
                );
              })}
            </ol>
          </fieldset>
          <FormField label={t("common.notes")} optional><textarea className="mid-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          {submit.error && <ErrorNotice error={submit.error} />}
          <div className="mid-rad">
            <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!!missing || submit.isPending}>
              {missing ? t("daily.missing", { count: missing }) : t("daily.submit")}</button>
            <button type="button" className="mid-knapp mid-knapp-text" onClick={() => setAnswers(Object.fromEntries(tpl.items.map((i) => [i.id, { ok: true, note: "" }])))}>
              {t("daily.all_ok")}</button>
          </div>
        </>
      )}
    </form>
  );
}

function History() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<DailyCheck[]>("list_daily_checks", { p_org_id: orgId, p_limit: 300 });
  const [open, setOpen] = useState<DailyCheck | null>(null);
  if (q.isLoading) return <Skeleton lines={6} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  return (
    <>
      <DataTable caption={t("daily.tab_history")} rows={q.data!} getKey={(c) => c.id} exportName="dagliga-kontroller"
        empty={<EmptyState icon="lista" title={t("daily.none")} />}
        filters={[{ id: "result", label: t("daily.result_label"), options: (["ok", "remarks", "failed"] as const).map((r) => ({ value: r, label: t(`daily.result.${r}`) })), match: (c, v) => c.result === v }]}
        columns={[
          { id: "at", header: t("admin.health.when"), value: (c) => c.created_at, sortable: true, cell: (c) => formatDateTime(c.created_at) },
          { id: "machine", header: t("machines.col_machine"), value: (c) => c.reg_number,
            cell: (c) => <><Link to={path(`machines/${c.machine_id}`)}><RegNumber value={c.reg_number} /></Link><br /><span className="t-liten">{c.make} {c.model}</span></> },
          { id: "result", header: t("daily.result_label"), value: (c) => c.result, cell: (c) => <CheckResultBadge result={c.result} /> },
          { id: "who", header: t("admin.health.who"), value: (c) => c.operator ?? c.by ?? "", hideOnMobile: true, cell: (c) => c.operator ?? c.by ?? "–" },
          { id: "open", header: "", value: () => "", cell: (c) => <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setOpen(c)}>{t("common.view")}</button> },
        ]} />
      {open && <CheckDialog c={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function CheckDialog({ c, onClose }: { c: DailyCheck; onClose(): void }) {
  const { i18n } = useTranslation();
  return (
    <Dialog open onClose={onClose} title={`${c.template_name} · ${formatDateTime(c.created_at)}`}>
      <div className="stack-3">
        <CheckResultBadge result={c.result} />
        <ul className="stack-1">
          {c.items.map((i) => {
            const a = c.answers.find((x) => x.id === i.id);
            return <li key={i.id}><Icon name={a?.ok ? "bock" : "varning"} className="ikon-inline" /> {itemLabel(i, i18n.language)}{a?.note ? ` – ${a.note}` : ""}</li>;
          })}
        </ul>
        {c.note && <p className="t-liten">{c.note}</p>}
        <p className="t-liten t-sekundar">{[c.operator, c.by, c.hours != null && `${c.hours} h`].filter(Boolean).join(" · ")}</p>
      </div>
    </Dialog>
  );
}

function Templates() {
  const { t, i18n } = useTranslation();
  const { orgId } = useOrg();
  const q = useRpc<Template[]>("list_checklist_templates", { p_org_id: orgId });
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  if (q.isLoading) return <Skeleton lines={4} />;
  return (
    <section className="stack-4">
      <p className="t-liten">{t("daily.templates_lead")}</p>
      <ul className="radlista">
        {q.data?.map((x) => (
          <li key={x.id}>
            <span><strong>{x.name}</strong>{x.builtin && <> <StatusBadge kind="neutral">{t("daily.builtin")}</StatusBadge></>}
              <br /><span className="t-liten t-sekundar">{t("daily.items_count", { count: x.items.length })}{x.categories.length ? ` · ${x.categories.map((c) => t(`enum.category.${c}`)).join(", ")}` : ""}</span></span>
            <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setEdit(x.builtin ? { ...x, id: "", name: `${x.name} (${t("daily.copy")})`, builtin: false } : x)}>
              {x.builtin ? t("daily.copy_edit") : t("common.edit")}</button>
          </li>
        ))}
      </ul>
      <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setEdit("new")}><Icon name="plus" />{t("daily.new_template")}</button></div>
      {edit && <TemplateDialog tpl={edit === "new" ? null : edit} lang={i18n.language} onClose={() => setEdit(null)} />}
    </section>
  );
}

function TemplateDialog({ tpl, lang, onClose }: { tpl: Template | null; lang: string; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [name, setName] = useState(tpl?.name ?? "");
  const [text, setText] = useState((tpl?.items ?? []).map((i) => `${i.critical ? "! " : ""}${itemLabel(i, lang)}`).join("\n"));
  const m = useRpcMutation<{ p_org_id: string; p_template_id: string | null; p_data: Record<string, unknown> }>("save_checklist_template", { onSuccess: onClose });
  // One item per line; a leading "!" marks a critical item (a fault stops the machine).
  const items = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l, n) => ({ id: `i${n + 1}`, sv: l.replace(/^!\s*/, ""), critical: l.startsWith("!") }));
  return (
    <Dialog open onClose={onClose} title={tpl?.id ? t("daily.edit_template") : t("daily.new_template")} wide>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: orgId, p_template_id: tpl?.id || null, p_data: { name, items, categories: tpl?.categories ?? [] } }); }}>
        <FormField label={t("common.name")}><input className="mid-input" value={name} onChange={(e) => setName(e.target.value)} required /></FormField>
        <FormField label={t("daily.items")} hint={t("daily.items_hint")}><textarea className="mid-input" rows={12} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!items.length || !name.trim() || m.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
