import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorNotice, Notice } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { queryClient, rpc, useRpc } from "../lib/api/query";
import { formatDateTime } from "../lib/format";
import { disablePush, enablePush, pushState, pumpLocalPush, type PushState } from "../lib/push";

interface Device { id: string; endpoint_host: string; ua_family: string | null; created_at: string; last_success_at: string | null; failing: boolean }

/** Push notifications on this device (step 24): on/off, test message, list of the user's devices. */
export function PushSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const devices = useRpc<Device[]>("list_my_push_subscriptions", {});
  useEffect(() => { void pushState().then(setState); }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null); setSent(false);
    try { await fn(); setState(await pushState()); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); }
    catch (e) { setError(e instanceof Error && e.message.startsWith("PUSH_") ? new Error(t(`push.error.${e.message}`)) : e); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel stack-3" aria-labelledby="push">
      <h2 id="push" className="t-rubrik-4">{t("push.title")}</h2>
      <p className="t-liten">{t("push.lead")}</p>
      {state === "unsupported" && <Notice title={t("push.unsupported")} />}
      {state === "denied" && <Notice kind="fel" title={t("push.denied")} />}
      {!!error && <ErrorNotice error={error} />}
      {sent && <Notice kind="ok" title={t("push.test_sent")} />}
      <div className="mid-rad">
        {state === "off" && <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void run(enablePush)}><Icon name="klocka" />{t("push.enable")}</button>}
        {state === "on" && <>
          <button type="button" className="mid-knapp mid-knapp-sekundar" disabled={busy}
            onClick={() => void run(async () => { await rpc("send_test_push"); await pumpLocalPush(); setSent(true); })}>{t("push.send_test")}</button>
          <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void run(disablePush)}>{t("push.disable")}</button>
        </>}
      </div>
      {!!devices.data?.length && (
        <ul className="radlista">
          {devices.data.map((d) => (
            <li key={d.id}><span>{d.ua_family ?? d.endpoint_host}{d.failing ? <span className="t-liten t-sekundar"> · {t("push.failing")}</span> : null}</span>
              <span className="t-liten">{t("push.added", { date: formatDateTime(d.created_at) })}</span></li>
          ))}
        </ul>
      )}
      <p className="t-liten t-sekundar">{t("push.what")}</p>
    </section>
  );
}
