/**
 * What page-view analytics may see of a URL. Several of our paths carry something that must not leave the browser:
 * a share link's token (it is the credential), an invitation token, a label code or a registration number (they
 * identify a machine and, through it, its owner), an organisation's slug and record ids. Those segments are replaced
 * by a placeholder, and the query string and fragment – next=, token=, code=, q= – are dropped altogether.
 */
const SECRET_SEGMENT: [RegExp, string][] = [
  [/^\/s\/[^/]+/, "/s/[token]"],
  [/^\/invite\/[^/]+/, "/invite/[token]"],
  [/^\/transfer\/[^/]+/, "/transfer/[id]"],
  [/^\/m\/[^/]+/, "/m/[code]"],
  [/^\/r\/[^/]+/, "/r/[reg]"],
  [/^\/ad\/[^/]+/, "/ad/[reg]"],
  [/^\/o\/[^/]+/, "/o/[org]"],
];
const UUID = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

export function analyticsUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  let path = u.pathname;
  for (const [re, to] of SECRET_SEGMENT) path = path.replace(re, to);
  path = path.replace(UUID, "/[id]");
  return `${u.origin}${path}`;
}
