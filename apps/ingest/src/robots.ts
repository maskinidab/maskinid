/** Minimal robots.txt evaluation (RFC 9309): groups by user-agent, longest-match allow/disallow, `*` and `$`. */
interface Rule {
  allow: boolean;
  pattern: string;
}

export interface Robots {
  isAllowed(path: string): boolean;
  crawlDelaySeconds: number | null;
}

export function parseRobots(txt: string, userAgent: string): Robots {
  const ua = userAgent.toLowerCase();
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(clean);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === "allow" || field === "disallow") {
      if (value === "" && field === "disallow") continue; // "Disallow:" = allow everything
      cur.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) cur.delay = n;
    }
  }
  const token = ua.split("/")[0];
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;
  return {
    crawlDelaySeconds: delay,
    isAllowed(path: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!matches(r.pattern, path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
