import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useOrg } from "../../auth/OrgContext";
import { Dialog } from "../../components/Dialog";
import { ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { StatusBadge } from "../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../lib/api/query";
import { settingsTabs } from "./settingsTabs";

interface OrgDetails {
  id: string; name: string; org_number: string | null; email: string | null; phone: string | null; website: string | null;
  address: { street?: string; postal_code?: string; city?: string } | null; vat_number: string | null; settings: Record<string, unknown>;
  status: string; types: string[]; dpa_version: string | null;
}
interface Member { membership_id: string; user_id: string | null; role: string; status: string; full_name: string | null; email: string; identity_verified: boolean }

function OrgTab() {
  const { t } = useTranslation();
  const { orgId, isAdmin, has } = useOrg();
  const q = useRpc<OrgDetails>("get_org", { p_org_id: orgId });
  const save = useRpcMutation<{ p_org_id: string; p_patch: Record<string, unknown> }>("update_org");
  const [form, setForm] = useState<Record<string, string>>({});
  if (q.isLoading || !q.data) return <Skeleton lines={6} />;
  const o = q.data;
  const v = (k: string, fallback: unknown) => form[k] ?? String(fallback ?? "");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="stack-5 formular" onSubmit={(e) => {
      e.preventDefault();
      const patch: Record<string, unknown> = {};
      for (const k of ["email", "phone", "website", "vat_number"]) if (k in form) patch[k] = form[k];
      if ("street" in form || "postal_code" in form || "city" in form) {
        patch.address = { street: v("street", o.address?.street), postal_code: v("postal_code", o.address?.postal_code), city: v("city", o.address?.city) };
      }
      const settings: Record<string, unknown> = {};
      if ("min_trusted_level" in form) settings.min_trusted_level = Number(form.min_trusted_level);
      if ("claims_url" in form) settings.claims_url = form.claims_url;
      if ("show_authority_reads_to_owner" in form) settings.show_authority_reads_to_owner = form.show_authority_reads_to_owner === "true";
      if (Object.keys(settings).length) patch.settings = settings;
      save.mutate({ p_org_id: orgId, p_patch: patch }, { onSuccess: () => setForm({}) });
    }}>
      {save.isSuccess && <Notice kind="ok" title={t("org.saved")} />}
      {save.error && <ErrorNotice error={save.error} />}
      <dl className="definitioner">
        <dt>{t("common.name")}</dt><dd>{o.name}</dd>
        <dt>{t("common.org_number")}</dt><dd className="mid-id">{o.org_number ?? "–"}</dd>
        <dt>{t("common.status")}</dt><dd><StatusBadge kind={o.status === "approved" ? "verifierad" : o.status === "pending" ? "vantar" : "sparr"}>{t(`enum.org_status.${o.status}`)}</StatusBadge></dd>
        <dt>{t("common.type")}</dt><dd>{o.types.map((x) => t(`enum.org_type.${x}`)).join(", ")}</dd>
      </dl>
      <fieldset disabled={!isAdmin} className="formular-rutnat">
        <FormField label={t("common.email")}><input className="mid-input" type="email" value={v("email", o.email)} onChange={set("email")} /></FormField>
        <FormField label={t("common.phone")}><input className="mid-input" value={v("phone", o.phone)} onChange={set("phone")} /></FormField>
        <FormField label={t("org.website")} optional><input className="mid-input" value={v("website", o.website)} onChange={set("website")} /></FormField>
        <FormField label={t("org.vat_number")} optional><input className="mid-input" value={v("vat_number", o.vat_number)} onChange={set("vat_number")} /></FormField>
        <FormField label={t("org.street")} optional><input className="mid-input" value={v("street", o.address?.street)} onChange={set("street")} /></FormField>
        <FormField label={t("org.postal_code")} optional><input className="mid-input" value={v("postal_code", o.address?.postal_code)} onChange={set("postal_code")} /></FormField>
        <FormField label={t("common.city")} optional><input className="mid-input" value={v("city", o.address?.city)} onChange={set("city")} /></FormField>
        <FormField label={t("org.min_trusted_level")} hint={t("org.min_trusted_level_hint")}>
          <select className="mid-select" value={v("min_trusted_level", o.settings.min_trusted_level ?? 0)} onChange={set("min_trusted_level")}>
            {[0, 1, 2].map((l) => <option key={l} value={l}>{t(`level.${l}.name`)}</option>)}
          </select>
        </FormField>
        {has("insurer") && (
          <FormField label={t("org.claims_url")} optional><input className="mid-input" value={v("claims_url", o.settings.claims_url)} onChange={set("claims_url")} /></FormField>
        )}
        {has("authority") && (
          <FormField label={t("org.authority_reads")}>
            <select className="mid-select" value={v("show_authority_reads_to_owner", o.settings.show_authority_reads_to_owner ?? false)} onChange={set("show_authority_reads_to_owner")}>
              <option value="false">{t("common.no")}</option><option value="true">{t("common.yes")}</option>
            </select>
          </FormField>
        )}
      </fieldset>
      {isAdmin && <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!Object.keys(form).length || save.isPending}>{t("common.save")}</button>}
    </form>
  );
}

function MembersTab() {
  const { t } = useTranslation();
  const { orgId, isAdmin } = useOrg();
  const { context } = useAuth();
  const q = useRpc<Member[]>("list_org_members", { p_org_id: orgId });
  const invite = useRpcMutation<{ p_org_id: string; p_email: string; p_role: string }>("invite_member");
  const setRole = useRpcMutation<{ p_membership_id: string; p_role: string }>("set_member_role");
  const remove = useRpcMutation<{ p_membership_id: string }>("remove_member");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setR] = useState("member");
  const err = invite.error ?? setRole.error ?? remove.error;
  return (
    <div className="stack-4">
      {isAdmin && <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setOpen(true)}>{t("org.invite")}</button>}
      {invite.isSuccess && <Notice kind="ok" title={t("org.invited", { email: invite.variables?.p_email })} />}
      {err && <ErrorNotice error={err} />}
      {q.isLoading ? <Skeleton /> : (
        <div className="mid-tabell-wrap">
          <table className="mid-tabell">
            <caption className="visually-hidden">{t("org.members_title")}</caption>
            <thead><tr><th>{t("common.name")}</th><th>{t("common.email")}</th><th>{t("org.role")}</th><th>{t("identity.title")}</th><th>{t("common.status")}</th><th><span className="visually-hidden">{t("common.actions")}</span></th></tr></thead>
            <tbody>
              {(q.data ?? []).map((m) => (
                <tr key={m.membership_id}>
                  <td>{m.full_name ?? "–"}</td>
                  <td>{m.email}</td>
                  <td>
                    {isAdmin && m.status === "active" ? (
                      <select className="mid-select" aria-label={t("org.role")} value={m.role} onChange={(e) => setRole.mutate({ p_membership_id: m.membership_id, p_role: e.target.value })}>
                        {["admin", "member", "readonly"].map((r) => <option key={r} value={r}>{t(`enum.member_role.${r}`)}</option>)}
                      </select>
                    ) : t(`enum.member_role.${m.role}`)}
                  </td>
                  <td>{m.identity_verified ? <StatusBadge kind="verifierad">{t("org.identity_ok")}</StatusBadge> : <StatusBadge kind="vantar">{t("org.identity_missing")}</StatusBadge>}</td>
                  <td>{t(`enum.membership_status.${m.status}`)}</td>
                  <td>
                    {(isAdmin || m.user_id === context?.user_id) && (
                      <button type="button" className="mid-lank-knapp mid-lank" onClick={() => remove.mutate({ p_membership_id: m.membership_id })}>
                        {m.user_id === context?.user_id ? t("org.leave") : t("org.remove_member")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("org.invite_title")}>
        <form className="stack-4" onSubmit={(e) => { e.preventDefault(); invite.mutate({ p_org_id: orgId, p_email: email, p_role: role }, { onSuccess: () => { setOpen(false); setEmail(""); } }); }}>
          <FormField label={t("common.email")}><input className="mid-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
          <FormField label={t("org.role")}>
            <select className="mid-select" value={role} onChange={(e) => setR(e.target.value)}>
              {["admin", "member", "readonly"].map((r) => <option key={r} value={r}>{t(`enum.member_role.${r}`)}</option>)}
            </select>
          </FormField>
          <div className="mid-rad">
            <button type="submit" className="mid-knapp mid-knapp-primar" disabled={invite.isPending}>{t("common.send")}</button>
            <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function NotificationsTab() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [mode, setMode] = useState("important");
  const [pushMode, setPushMode] = useState("important");
  const [digest, setDigest] = useState("instant");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const types = (m: string) => (m === "all" ? ["*"] : []);
  return (
    <form className="stack-4 formular" onSubmit={async (e) => {
      e.preventDefault();
      setSaved(false); setError(null);
      try {
        await rpc("set_notification_preferences", { p_org_id: orgId, p_channel: "email", p_event_types: types(mode), p_digest: digest, p_enabled: mode !== "none" });
        await rpc("set_notification_preferences", { p_org_id: orgId, p_channel: "push", p_event_types: types(pushMode), p_digest: "instant", p_enabled: pushMode !== "none" });
        setSaved(true);
      } catch (err) { setError(err); }
    }}>
      {saved && <Notice kind="ok" title={t("org.saved")} />}
      {!!error && <ErrorNotice error={error} />}
      <fieldset className="mid-val">
        <legend className="mid-etikett">{t("org.email_channel")}</legend>
        {["important", "all", "none"].map((m) => (
          <label key={m}><input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} /><span>{t(`org.email_${m}`)}</span></label>
        ))}
      </fieldset>
      <FormField label={t("org.digest")}>
        <select className="mid-select" value={digest} onChange={(e) => setDigest(e.target.value)}>
          {["instant", "daily", "weekly"].map((d) => <option key={d} value={d}>{t(`org.digest_${d}`)}</option>)}
        </select>
      </FormField>
      <fieldset className="mid-val">
        <legend className="mid-etikett">{t("org.push_channel")}</legend>
        {["important", "all", "none"].map((m) => (
          <label key={m}><input type="radio" name="push" checked={pushMode === m} onChange={() => setPushMode(m)} /><span>{t(`org.push_${m}`)}</span></label>
        ))}
      </fieldset>
      <p className="t-liten t-sekundar">{t("org.push_hint")}</p>
      <div><button type="submit" className="mid-knapp mid-knapp-primar">{t("common.save")}</button></div>
    </form>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { isAdmin, has } = useOrg();
  const [params, setParams] = useSearchParams();
  const extra = settingsTabs({ isAdmin, has });
  const tabs = [
    { id: "org", label: t("org.settings_title") },
    { id: "members", label: t("org.members_title") },
    { id: "notifications", label: t("org.notifications_title") },
    ...extra.map((x) => ({ id: x.id, label: t(x.label) })),
  ];
  const tab = params.get("tab") ?? "org";
  const Extra = extra.find((x) => x.id === tab)?.Component;
  return (
    <div className="stack-5">
      <PageHeader title={t("nav.settings")} />
      <Tabs panels label={t("nav.settings")} tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`flik-${tab}`}>
        {tab === "org" && <OrgTab />}
        {tab === "members" && <MembersTab />}
        {tab === "notifications" && <NotificationsTab />}
        {Extra && <Extra />}
      </div>
    </div>
  );
}
