import { openApiDocument, ROUTES } from "@maskinid/shared/api/routes.ts";
import { APP_DOMAIN } from "@maskinid/shared/config.ts";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon";
import { downloadBytes } from "../../lib/pdf/receipt";

const BASE = `https://api.${APP_DOMAIN}/v1`;

/** /api-docs – the OpenAPI 3.1 document for the public API, generated from the same route table as the gateway. */
export function ApiDocsPage() {
  const { t } = useTranslation();
  const doc = openApiDocument(BASE);
  return (
    <div className="behallare sektion stack-6">
      <header className="stack-3">
        <h1 className="t-rubrik-2">{t("apidocs.title")}</h1>
        <p className="t-brodtext">{t("apidocs.lead")}</p>
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => downloadBytes(new TextEncoder().encode(JSON.stringify(doc, null, 2)), "maskinid-openapi.json", "application/json")}>
            <Icon name="nedladdning" />{t("apidocs.download")}</button>
        </div>
      </header>
      <section className="panel stack-3" aria-labelledby="auth">
        <h2 id="auth" className="t-rubrik-3">{t("apidocs.auth_title")}</h2>
        <p className="t-brodtext">{t("apidocs.auth_body")}</p>
        <pre className="kodblock">{`curl ${BASE}/machines/lookup?reg=ABC1234 \\
  -H "Authorization: Bearer mk_live_…"

curl -X POST ${BASE}/checks \\
  -H "Authorization: Bearer mk_live_…" -H "Idempotency-Key: 7f1c…" \\
  -H "Content-Type: application/json" \\
  -d '{"query":{"type":"serial","value":"VCE0EC220E00012345"},"purpose":"Ärende 4711"}'`}</pre>
      </section>
      <section className="stack-3" aria-labelledby="endpoints">
        <h2 id="endpoints" className="t-rubrik-3">{t("apidocs.endpoints")}</h2>
        <div className="mid-tabell-wrap">
          <table className="mid-tabell">
            <thead><tr><th scope="col">{t("apidocs.method")}</th><th scope="col">Path</th><th scope="col">Scope</th><th scope="col">{t("apidocs.description")}</th></tr></thead>
            <tbody>{ROUTES.map((r) => (
              <tr key={`${r.method} ${r.path}`}><td className="mid-id">{r.method}</td><td className="mid-id">{r.path}</td><td className="mid-id">{r.scope}</td><td>{t(`apidocs.op.${r.method}_${r.rpc}`, { defaultValue: r.summary })}</td></tr>
            ))}
              <tr><td className="mid-id">GET</td><td className="mid-id">/embed/badge/:reg.svg</td><td>–</td><td>{t("apidocs.badge")}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack-3" aria-labelledby="errors">
        <h2 id="errors" className="t-rubrik-3">{t("apidocs.errors_title")}</h2>
        <p className="t-brodtext">{t("apidocs.errors_body")}</p>
        <pre className="kodblock">{`HTTP/1.1 409 Conflict
{ "code": "ACTIVE_ENCUMBRANCE_EXISTS", "holder": "Nordisk Maskinfinans", "conflict_id": "…" }`}</pre>
      </section>
      <section className="panel stack-3" aria-labelledby="webhooks">
        <h2 id="webhooks" className="t-rubrik-3">{t("apidocs.webhooks_title")}</h2>
        <p className="t-brodtext">{t("apidocs.webhooks_body")}</p>
        <pre className="kodblock">{`MaskinID-Signature: t=1790000000,v1=<hex HMAC-SHA256(secret, "1790000000." + body)>

// Node
const [t, v1] = header.split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected)) && Date.now() / 1000 - Number(t) < 300;`}</pre>
      </section>
    </div>
  );
}
