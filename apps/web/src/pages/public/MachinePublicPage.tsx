import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNotice, Notice, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { MachinePhoto } from "../../components/MachinePhoto";
import { RegNumber } from "../../components/RegNumber";
import { StatusBanner } from "../../components/StatusBanner";
import { MachineStatusBadge, StatusBadge, VerificationBadge } from "../../components/StatusBadge";
import type { PublicCard } from "../../lib/api/types";
import { ApiError, backend } from "../../lib/backend";
import { formatDate, formatDateTime } from "../../lib/format";

type ScanResponse = { found: boolean; reason?: string; card?: PublicCard; nfc?: "match" | "mismatch" | "unknown" };
const CACHE = "maskinid.lastseen.";

function useNoIndex() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);
}

/** Public scan page /m/:code and lookup /r/:reg (SPEC §5.3). Only the fields in the public card, never the owner's name. */
export function MachinePublicPage() {
  const { t } = useTranslation();
  const { code, reg } = useParams();
  const { session, context } = useAuth();
  useNoIndex();
  const key = code ? `c:${code}` : `r:${reg}`;
  const nfcUid = (useLocation().state as { nfcUid?: string } | null)?.nfcUid;
  const q = useQuery<ScanResponse & { offline?: string }, ApiError>({
    queryKey: ["public-card", key],
    queryFn: async () => {
      try {
        const r = await backend.invoke<ScanResponse>("scan-log", code ? { code, ...(nfcUid ? { nfc_uid: nfcUid } : {}) } : { reg }, { anonymous: true });
        if (r.found) localStorage.setItem(CACHE + key, JSON.stringify({ at: new Date().toISOString(), r }));
        return r;
      } catch (e) {
        // Offline-tolerant scanning (SPEC §15): show the last known status if this device saw the machine before.
        const cached = localStorage.getItem(CACHE + key);
        if (cached && !(e instanceof ApiError && e.status < 500)) {
          const c = JSON.parse(cached) as { at: string; r: ScanResponse };
          return { ...c.r, offline: c.at };
        }
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  if (q.isLoading) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  if (q.error) return <div className="behallare sektion"><ErrorNotice error={q.error} /></div>;
  const r = q.data!;
  if (!r.found || !r.card) {
    return (
      <div className="behallare sektion stack-4 smal-bred">
        <h1 className="t-rubrik-2">{t(r.reason === "invalid_reg_number" ? "errors.INVALID_REG" : "public.not_in_register")}</h1>
        <p className="t-brodtext">{t("public.not_in_register_body")}</p>
        <Link className="mid-knapp mid-knapp-sekundar" to="/">{t("common.to_start")}</Link>
      </div>
    );
  }
  const c = r.card;
  const firstOrg = context?.memberships[0]?.org.slug;
  return (
    <div className="publik-maskin">
      {c.status !== "active" && (
        <StatusBanner status={c.status} fullscreen={c.status === "stolen"}>
          {c.status === "stolen" && <Sighting code={code} reg={reg ?? c.reg_number} />}
        </StatusBanner>
      )}
      <div className="behallare sektion stack-6 smal-bred">
        {r.offline && <Notice title={t("public.offline", { date: formatDateTime(r.offline) })} />}
        {r.nfc === "mismatch" && <Notice kind="fel" title={t("nfc.mismatch_title")}><p>{t("nfc.mismatch_body")}</p></Notice>}
        {c.label_status === "replaced" && <Notice title={t("public.label_replaced")}><p><Link className="mid-lank" to={`/r/${c.reg_number}`}>{t("public.label_replaced_link")}</Link></p></Notice>}
        <article className="mid-post">
          <div className="mid-post-huvud">
            <div className="stack-3">
              <p className="t-liten t-sekundar">{t(`enum.category.${c.category}`)}</p>
              <h1 className="mid-post-titel">{c.make} {c.model}{c.year ? ` · ${c.year}` : ""}</h1>
              <RegNumber value={c.reg_number} framed size="stor" animate />
              <span className="badge-rad">
                <MachineStatusBadge status={c.status} />
                <VerificationBadge level={c.verification_level} />
                {c.inspection_valid_until && <StatusBadge kind="verifierad" icon="sigill">{t("public.inspected_until", { date: formatDate(c.inspection_valid_until) })}</StatusBadge>}
              </span>
            </div>
            <MachinePhoto path={c.primary_photo_path} category={c.category} size={160} alt={`${c.make} ${c.model}`} />
          </div>
          <dl className="mid-post-falt">
            <div>
              <dt>{t("public.serial")}</dt>
              <dd className="mid-id" aria-describedby="serie-hjalp">{c.serial_masked}</dd>
              <dd id="serie-hjalp">{t("public.serial_hint")}</dd>
            </div>
            <div>
              <dt>{t("public.owner")}</dt>
              <dd>{c.has_registered_owner ? t("public.owner_exists") : t("public.owner_missing")}</dd>
            </div>
            <div>
              <dt>{t("check.result_financing")}</dt>
              <dd><Link className="mid-lank" to={`/verify?reg=${c.reg_number}`}>{t("public.financing_login")}</Link></dd>
            </div>
          </dl>
          <div className="mid-post-fot">
            <span>{t(`level.${c.verification_level}.desc`)}</span>
          </div>
        </article>
        <div className="handlingar">
          <Link className="handling" to={session && firstOrg ? `/o/${firstOrg}/machines?q=${c.reg_number}` : `/login?next=${encodeURIComponent(`/app`)}`}>
            <strong><Icon name="oga" />{t("public.are_you_owner")}</strong>
            <span>{t("public.are_you_owner_body")}</span>
          </Link>
          <Link className="handling" to={`/verify?reg=${c.reg_number}`}>
            <strong><Icon name="hanglas" />{t("public.check_financing")}</strong>
            <span>{t("public.check_financing_body")}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

/** "Jag har sett maskinen" – shares an approximate location only with explicit consent (SPEC §5.3). */
function Sighting({ code, reg }: { code?: string; reg?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "asking" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  async function send(withLocation: boolean) {
    setState("asking");
    let location: { lat: number; lng: number } | null = null;
    if (withLocation && "geolocation" in navigator) {
      location = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 10_000, maximumAge: 60_000 }));
    }
    try {
      await backend.invoke("scan-log", { code, reg, sighting: true, location, message: message || null }, { anonymous: true });
      setState("sent");
    } catch {
      setState("error");
    }
  }
  if (state === "sent") return <p className="statusbanner-tack"><Icon name="bock" className="ikon-inline" /> {t("public.sighting_sent")}</p>;
  return (
    <div className="stack-3 statusbanner-tips">
      <label className="visually-hidden" htmlFor="tips">{t("public.sighting_message")}</label>
      <textarea id="tips" className="mid-textarea" placeholder={t("public.sighting_message")} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      <div className="mid-rad">
        <button type="button" className="mid-knapp statusbanner-knapp" onClick={() => void send(true)} disabled={state === "asking"}>
          <Icon name="plats" />{t("public.sighting_with_location")}
        </button>
        <button type="button" className="mid-knapp mid-knapp-kontur statusbanner-knapp-kontur" onClick={() => void send(false)} disabled={state === "asking"}>
          {t("public.sighting_without_location")}
        </button>
      </div>
      <p className="t-liten">{t("public.sighting_consent")}</p>
      {state === "error" && <p role="alert">{t("errors.UNKNOWN")}</p>}
    </div>
  );
}
