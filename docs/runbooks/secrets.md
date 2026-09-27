# Secrets

| Secret | Lives in | Rotation |
|---|---|---|
| `org_number_key` | Vault | Cannot simply rotate: re-encrypt `organizations.org_number_enc` with a migration that decrypts with the old and encrypts with the new key in one transaction. |
| `integration_key` | Vault | Same as above for `telematics_connections.credential_enc`, or ask customers to re-enter credentials. |
| `personal_number_salt` | Vault | Never rotate (hashes would no longer match); treat as permanent. |
| `ip_hash_salt` / `IP_HASH_SALT` | Vault + function secret | Any time; rate-limit windows reset. |
| `cron_secret` / `CRON_SECRET` | Vault + function secret | Change both at once, then `select app.schedule_jobs()`. |
| Service role key | Supabase (functions only) | Supabase → API → rotate; redeploy functions. Never in Vercel or the browser. |
| Stripe, Resend, Roaring, BankID broker, Anthropic, Larmtjänst, Transportstyrelsen | Function secrets | Per provider; set the new key, deploy, revoke the old. |
| VAPID keys | Function secret + `VITE_VAPID_PUBLIC_KEY` | Rotating invalidates all push subscriptions; users turn push on again. |
| API keys of customers | Hash only in `api_keys` | Customers rotate themselves (Settings → API). |

Leaked secret: rotate first, then investigate (incident.md).
