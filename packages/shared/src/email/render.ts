/**
 * E-mail templates (SPEC §13): one renderer for all messages in the outbox, Swedish and English, plain text + HTML.
 * All wording lives in the i18n files (keys `email.*` and `notifications.<type>.*`), so the forbidden-names check and
 * the i18n check cover e-mail too. Used by the email-send Edge Function (Deno) and by tests (Node).
 */
import { APP_LEGAL_NAME, APP_NAME, SUPPORT_EMAIL } from "../config.ts";
import { translator, type Locale } from "../i18n/index.ts";
import { formatSek } from "../billing.ts";

export const EMAIL_TEMPLATES = ["notification", "invite", "invite_owner", "transfer_invite", "weekly_digest", "ownership_certificate", "support_reply", "invoice", "sms"] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export interface OutboxMessage {
  template: string;
  locale?: string | null;
  data: Record<string, unknown>;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** SMS body (template "sms" only). */
  sms?: string;
}

interface Block {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  list?: string[];
  footnote?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Links in notifications are app paths ("/machines/…"); they open in the recipient's current org via /app. */
function absolute(baseUrl: string, link: unknown): string {
  const base = baseUrl.replace(/\/$/, "");
  if (typeof link !== "string" || !link) return `${base}/app`;
  if (/^https:\/\//.test(link)) return link;
  if (!link.startsWith("/")) return `${base}/app`;
  // Org-relative app paths go through /go?to=…, which resolves the active org after sign-in.
  return link.startsWith("/admin") ? `${base}${link}` : `${base}/go?to=${encodeURIComponent(link)}`;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function renderEmail(msg: OutboxMessage, opts: { baseUrl: string }): RenderedEmail | null {
  const locale: Locale = msg.locale === "en" ? "en" : "sv";
  const t = translator(locale);
  const d = msg.data ?? {};
  const base = opts.baseUrl.replace(/\/$/, "");
  const vars = { app: APP_NAME, ...d };
  let subject: string;
  let block: Block;

  switch (msg.template) {
    case "notification":
    case "sms": {
      const type = str(d.type);
      const inner: Record<string, unknown> = { app: APP_NAME, ...((d.data as Record<string, unknown>) ?? {}) };
      if (typeof inner.type === "string") inner.type = t(`enum.flag_type.${inner.type}`);
      const title = t(`notifications.${type}.title`, inner);
      const known = title !== `notifications.${type}.title`;
      const heading = known ? title : t("email.notification.fallback_title");
      const body = known ? t(`notifications.${type}.body`, inner) : "";
      const url = absolute(base, d.link);
      if (msg.template === "sms") {
        const sms = `${APP_NAME}: ${heading}. ${body === `notifications.${type}.body` ? "" : body} ${url}`.replace(/\s+/g, " ").trim();
        return { subject: heading, text: sms, html: "", sms: sms.slice(0, 320) };
      }
      subject = d.severity === "critical" ? t("email.notification.subject_critical", { title: heading }) : heading;
      block = { heading, paragraphs: body && body !== `notifications.${type}.body` ? [body] : [], button: { label: t("email.notification.open"), url },
        footnote: t("email.notification.preferences", { url: `${base}/go?to=${encodeURIComponent("/settings?tab=notifications")}` }) };
      break;
    }
    case "invite":
      subject = t("email.invite.subject", vars);
      block = { heading: t("email.invite.heading", vars),
        paragraphs: [t("email.invite.body", { ...vars, role: t(`enum.member_role.${str(d.role)}`) }), t("email.invite.bankid")],
        button: { label: t("email.invite.button"), url: `${base}/invite/${encodeURIComponent(str(d.token))}` }, footnote: t("email.invite.expires") };
      break;
    case "invite_owner":
      subject = t("email.invite_owner.subject", vars);
      block = { heading: t("email.invite_owner.heading", vars), paragraphs: [t("email.invite_owner.body", vars), t("email.invite_owner.free")],
        button: { label: t("email.invite_owner.button"), url: `${base}/invite/${encodeURIComponent(str(d.token))}` }, footnote: t("email.invite.expires") };
      break;
    case "transfer_invite":
      subject = t("email.transfer_invite.subject", vars);
      block = { heading: t("email.transfer_invite.heading", vars), paragraphs: [t("email.transfer_invite.body", vars), t("email.transfer_invite.bankid")],
        button: { label: t("email.transfer_invite.button"), url: `${base}/transfer/${encodeURIComponent(str(d.transfer_id))}?token=${encodeURIComponent(str(d.token))}` },
        footnote: t("email.transfer_invite.not_expected") };
      break;
    case "weekly_digest": {
      const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
      subject = t("email.weekly_digest.subject", { ...vars, count: items.length });
      block = { heading: t("email.weekly_digest.heading", vars), paragraphs: [t("email.weekly_digest.body", { count: items.length })],
        list: items.map((i) => [str(i.title), [str(i.make), str(i.model)].filter(Boolean).join(" "), str(i.reg_number),
          i.due_at ? t("email.weekly_digest.due_date", { date: str(i.due_at) }) : "",
          i.due_hours ? t("email.weekly_digest.due_hours", { hours: str(i.due_hours), now: str(i.hour_meter) }) : ""].filter(Boolean).join(" · ")),
        button: { label: t("email.weekly_digest.button"), url: absolute(base, "/fleet") } };
      break;
    }
    case "support_reply":
      subject = t("email.support_reply.subject", vars);
      block = { heading: t("email.support_reply.heading", vars), paragraphs: [str(d.body)], footnote: t("email.support_reply.how_to_answer") };
      break;
    case "invoice": {
      const v = { ...vars, total: formatSek(Number(d.total_ore ?? 0), locale) };
      subject = t("email.invoice.subject", v);
      block = { heading: t("email.invoice.heading", v), paragraphs: [t("email.invoice.body", v)],
        button: { label: t("email.invoice.button"), url: absolute(base, "/settings?tab=billing") } };
      break;
    }
    case "ownership_certificate":
      subject = t("email.ownership_certificate.subject", vars);
      block = { heading: t("email.ownership_certificate.heading", vars),
        paragraphs: [t("email.ownership_certificate.body", vars), t("email.ownership_certificate.number", vars)],
        button: { label: t("email.ownership_certificate.button"), url: absolute(base, `/machines/${str(d.machine_id)}`) },
        footnote: t("email.ownership_certificate.verify", { url: `${base}/verify-document?nr=${encodeURIComponent(str(d.certificate_number))}&hash=${encodeURIComponent(str(d.result_hash))}` }) };
      break;
    default:
      return null;
  }
  const footer = t("email.footer", { app: APP_NAME, legal: APP_LEGAL_NAME, support: SUPPORT_EMAIL });
  return { subject, text: toText(block, footer), html: toHtml(block, footer, locale) };
}

function toText(b: Block, footer: string): string {
  return [b.heading, "", ...b.paragraphs.flatMap((p) => [p, ""]), ...(b.list?.length ? [...b.list.map((l) => `• ${l}`), ""] : []),
    ...(b.button ? [`${b.button.label}: ${b.button.url}`, ""] : []), ...(b.footnote ? [b.footnote, ""] : []), "—", footer].join("\n");
}

function toHtml(b: Block, footer: string, locale: Locale): string {
  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px">${esc(s)}</p>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(b.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f2f3;color:#000;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d5d9dd">
<tr><td style="padding:20px 28px;border-bottom:4px solid #f9a923;font-size:22px;font-weight:800;letter-spacing:-.02em">${esc(APP_NAME)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:28px">${esc(b.heading)}</h1>
${b.paragraphs.map(p).join("\n")}
${b.list?.length ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:22px">${b.list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
${b.button ? `<p style="margin:24px 0"><a href="${esc(b.button.url)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px">${esc(b.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:18px;color:#4e565e;word-break:break-all">${esc(b.button.url)}</p>` : ""}
${b.footnote ? `<p style="margin:16px 0 0;font-size:13px;line-height:18px;color:#4e565e">${esc(b.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #d5d9dd;font-size:12px;line-height:18px;color:#4e565e">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Title/body for a web push message (step 24), same texts as the in-app notification. Links are app-relative. */
export function renderPush(n: { type: string; data?: Record<string, unknown>; link?: string | null; locale?: string | null }):
  { title: string; body: string; url: string; tag: string } {
  const t = translator(n.locale === "en" ? "en" : "sv");
  const inner: Record<string, unknown> = { app: APP_NAME, ...(n.data ?? {}) };
  if (typeof inner.type === "string") inner.type = t(`enum.flag_type.${inner.type}`);
  const key = n.type === "push.test" ? "push.test_message" : `notifications.${n.type}`;
  const title = t(`${key}.title`, inner);
  const body = t(`${key}.body`, inner);
  const known = title !== `${key}.title`;
  return {
    title: known ? title : t("email.notification.fallback_title"),
    body: known && body !== `${key}.body` ? body : "",
    url: absolute("", n.link).replace(/^\/app$/, "/"),
    tag: n.type,
  };
}
