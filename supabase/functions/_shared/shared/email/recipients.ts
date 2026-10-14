/**
 * Addresses e-mail must never be sent to (ADR 0036). The demo seed and the tests use made-up addresses such as
 * berg@demo.se – but demo.se is a real domain owned by someone else. Once the demo environment sends real e-mail
 * to the testers it invites, everything queued for a demo account would otherwise reach a stranger (and bounce, which
 * hurts the sender's reputation). Subdomains count: platschef@berg.demo.se is blocked too.
 */
export const BLOCKED_RECIPIENT_DOMAINS = ["demo.se", "e2e.se", "acme-test.se", "example.com", "example.org", "example.net"] as const;
const BLOCKED_TLDS = ["invalid", "test", "example", "localhost"] as const;

export function isBlockedRecipient(email: string, extraDomains: readonly string[] = []): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return true;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return true;
  const tld = domain.split(".").pop() ?? "";
  if ((BLOCKED_TLDS as readonly string[]).includes(tld)) return true;
  return [...BLOCKED_RECIPIENT_DOMAINS, ...extraDomains.map((d) => d.trim().toLowerCase()).filter(Boolean)]
    .some((d) => domain === d || domain.endsWith(`.${d}`));
}
