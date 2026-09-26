import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, backend } from "../lib/backend";
import { Dialog } from "./Dialog";
import { useErrorMessage } from "./Feedback";
import { Icon } from "./Icon";

type Sign = (orgId: string, action: string, subjectId: string, params?: Record<string, unknown>) => Promise<string>;
const Ctx = createContext<Sign | null>(null);

interface Pending {
  id: string;
  provider: "bankid" | "mock";
  signed_text: string;
  resolve(id: string): void;
  reject(e: unknown): void;
}

/**
 * Signing (SPEC §11.1): the server builds the text to sign; the user confirms with BankID (or Demo-BankID in DEMO_MODE).
 * Legal steps are always "summary + signature", never just OK (SPEC §10).
 */
export function SignatureProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancelled = useRef(false);

  const sign = useCallback<Sign>(async (orgId, action, subjectId, params = {}) => {
    const s = await backend.rpc<{ id: string; provider: "bankid" | "mock"; signed_text: string }>("start_signature", {
      p_org_id: orgId, p_action: action, p_subject_id: subjectId, p_params: params,
    });
    setError(null);
    cancelled.current = false;
    return new Promise<string>((resolve, reject) => setPending({ ...s, resolve, reject }));
  }, []);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.provider === "mock") {
        await backend.rpc("complete_mock_signature", { p_signature_id: pending.id });
      } else {
        const { url } = await backend.invoke<{ url: string }>("bankid-sign", { signature_id: pending.id, return_to: location.href });
        window.open(url, "_blank", "noopener");
        for (;;) {
          if (cancelled.current) throw new ApiError("SIGNATURE_REQUIRED");
          await new Promise((r) => setTimeout(r, 2000));
          const st = await backend.rpc<{ status: string }>("get_signature_status", { p_signature_id: pending.id });
          if (st.status === "completed") break;
          if (st.status !== "pending") throw new ApiError("SIGNATURE_REQUIRED", st);
        }
      }
      pending.resolve(pending.id);
      setPending(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    cancelled.current = true;
    pending?.reject(new ApiError("SIGNATURE_REQUIRED"));
    setPending(null);
  }

  return (
    <Ctx.Provider value={sign}>
      {children}
      <Dialog open={!!pending} onClose={cancel} title={pending?.provider === "mock" ? t("bankid.demo_title") : t("bankid.title")}>
        {pending && (
          <div className="stack-4">
            <div className="signeringstext">
              <p className="mid-etikett">{t("bankid.you_sign")}</p>
              <blockquote>{pending.signed_text}</blockquote>
            </div>
            <p className="mid-hjalp">{pending.provider === "mock" ? t("bankid.demo_hint") : t("bankid.open_app")}</p>
            {!!error && <p className="mid-fel" role="alert"><Icon name="varning" />{msg(error)}</p>}
            <div className="mid-rad">
              <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void confirm()} disabled={busy}>
                <Icon name="skold" />{busy ? t("bankid.signing") : t("bankid.sign")}
              </button>
              <button type="button" className="mid-knapp mid-knapp-kontur" onClick={cancel}>{t("common.cancel")}</button>
            </div>
          </div>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useSign(): Sign {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSign outside SignatureProvider");
  return v;
}
