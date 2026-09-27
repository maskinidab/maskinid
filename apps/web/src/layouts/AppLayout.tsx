import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { OrgProvider, useOrg } from "../auth/OrgContext";
import { Dialog } from "../components/Dialog";
import { Skeleton } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { RegNumber } from "../components/RegNumber";
import { ScanButton } from "../components/Scanner";
import { MachineStatusBadge } from "../components/StatusBadge";
import { useRpc } from "../lib/api/query";
import type { MachineView } from "../lib/api/types";
import { backend } from "../lib/backend";
import { DemoBanner, LanguageSwitch, LogoLink, SkipLink, ThemeSwitch } from "./Chrome";
import { LegalGate, ViewAsBanner } from "../components/AccountGuards";
import { bottomNav, navGroups, type NavItem } from "./nav";

/** Guards the /o/:orgSlug area: signed in, member of the org; otherwise redirects sensibly. */
export function AppLayout() {
  const { ready, session, context, contextLoading } = useAuth();
  const { orgSlug } = useParams();
  const location = useLocation();
  if (!ready || contextLoading) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!context) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  const m = context.memberships.find((x) => x.org.slug === orgSlug);
  if (!m) {
    const first = context.memberships.find((x) => x.org.id === context.last_active_org_id) ?? context.memberships[0];
    return <Navigate to={first ? `/o/${first.org.slug}/dashboard` : "/onboarding"} replace />;
  }
  return (
    <OrgProvider membership={m}>
      <Shell />
    </OrgProvider>
  );
}

function Badge({ kind }: { kind: NavItem["badge"] }) {
  const { orgId } = useOrg();
  const { context } = useAuth();
  const inbox = useRpc<{ count: number }>("get_inbox", kind === "inbox" ? { p_org_id: orgId } : null, { refetchInterval: 20_000 });
  const n = kind === "inbox" ? inbox.data?.count ?? 0 : kind === "notifications" ? context?.unread_notifications ?? 0 : 0;
  if (!n) return null;
  return <span className="raknare" aria-label={String(n)}>{n > 99 ? "99+" : n}</span>;
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { types, isAdmin, path, canWrite } = useOrg();
  const { context } = useAuth();
  const groups = navGroups(types, isAdmin, !!context?.operator_role, canWrite);
  return (
    <nav className="sidomeny" aria-label={t("nav.main")} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      {groups.map((g) => (
        <div key={g.label} className="sidomeny-grupp">
          <h2>{t(g.label)}</h2>
          <ul>
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to.startsWith("/") ? i.to : path(i.to)} end={i.to === "machines" || i.to === "admin"}>
                  <Icon name={i.icon} />
                  <span>{t(i.label)}</span>
                  {i.badge && <Badge kind={i.badge} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function OrgSwitcher() {
  const { t } = useTranslation();
  const { context } = useAuth();
  const { org } = useOrg();
  const navigate = useNavigate();
  if (!context) return null;
  return (
    <label className="org-vaxlare">
      <span className="visually-hidden">{t("nav.org_switcher")}</span>
      <Icon name="bygg" />
      <select className="mid-select" value={org.slug} onChange={(e) => {
        const target = e.target.value;
        if (target === "__new") return navigate("/onboarding?new=1");
        const m = context.memberships.find((x) => x.org.slug === target);
        if (m) void backend.rpc("update_profile", { p_last_active_org_id: m.org.id }).catch(() => undefined);
        navigate(`/o/${target}/dashboard`);
      }}>
        {context.memberships.map((m) => <option key={m.org.id} value={m.org.slug}>{m.org.name}</option>)}
        <option value="__new">+ {t("org.create_new")}</option>
      </select>
    </label>
  );
}

/** Global exact search by reg number or serial (Ctrl/Cmd+K, SPEC §9.3). */
function GlobalSearch() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const res = useRpc<MachineView[]>("lookup_machine", submitted ? { p_org_id: orgId, p_query: submitted } : null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" className="global-sok-knapp" onClick={() => setOpen(true)}>
        <Icon name="sok" /><span>{t("nav.global_search")}</span><kbd>{t("nav.global_search_hint")}</kbd>
      </button>
      <Dialog open={open} onClose={() => { setOpen(false); setSubmitted(null); setQ(""); }} title={t("nav.global_search")}>
        <form className="mid-sok-rad" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setSubmitted(q.trim()); }}>
          <label htmlFor="global-sok" className="visually-hidden">{t("nav.global_search")}</label>
          <input id="global-sok" className="mid-input is-id" autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" spellCheck={false} />
          <button className="mid-knapp mid-knapp-primar" type="submit">{t("common.search")}</button>
        </form>
        {res.isFetching && <Skeleton lines={2} />}
        {res.data && (res.data.length === 0 ? <p className="t-sekundar">{t("search.no_hits", { q: submitted })}</p> : (
          <ul className="sokresultat">
            {res.data.map((m) => (
              <li key={m.id}>
                <button type="button" className="sokresultat-rad" onClick={() => { setOpen(false); navigate(path(`machines/${m.id}`)); }}>
                  <RegNumber value={m.reg_number} /> <span>{m.make} {m.model}</span> <MachineStatusBadge status={m.status} />
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Dialog>
    </>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { context, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <details className="anvandarmeny">
      <summary aria-label={t("nav.profile")}><Icon name="personer" /><span className="bara-desktop">{context?.full_name ?? context?.email}</span></summary>
      <div className="anvandarmeny-panel">
        <Link to="/profile">{t("nav.profile")}</Link>
        <button type="button" className="mid-lank-knapp" onClick={async () => { await signOut(); navigate("/"); }}>
          <Icon name="logga-ut" />{t("nav.sign_out")}
        </button>
      </div>
    </details>
  );
}

function Shell() {
  const { t } = useTranslation();
  const { path, types } = useOrg();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [location.pathname]);
  const bottom = useMemo(() => bottomNav(types), [types]);
  return (
    <div className="app">
      <SkipLink />
      <DemoBanner />
      <ViewAsBanner />
      <LegalGate />
      <header className="app-huvud">
        <LogoLink to={path("dashboard")} />
        <OrgSwitcher />
        <GlobalSearch />
        <div className="app-huvud-hoger">
          <span className="bara-desktop"><ScanButton /></span>
          <NavLink className="ikon-lank" to={path("notifications")} aria-label={t("nav.notifications")}><Icon name="klocka" /><Badge kind="notifications" /></NavLink>
          <LanguageSwitch />
          <ThemeSwitch />
          <UserMenu />
        </div>
      </header>
      <div className="app-kropp">
        <aside className="app-sida bara-desktop"><SideNav /></aside>
        <main id="innehall" tabIndex={-1} className="app-innehall">
          <Outlet />
        </main>
      </div>
      <nav className="bottennav bara-mobil" aria-label={t("nav.main")}>
        {bottom.slice(0, 2).map((i) => <BottomItem key={i.to} item={i} />)}
        <ScanButton variant="nav" />
        {bottom.slice(2, 3).map((i) => <BottomItem key={i.to} item={i} />)}
        <button type="button" className="bottennav-knapp" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
          <Icon name="meny" /><span>{t("common.more")}</span>
        </button>
      </nav>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t("common.menu")}>
        <SideNav onNavigate={() => setMoreOpen(false)} />
      </Dialog>
    </div>
  );
}

function BottomItem({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const { path } = useOrg();
  return (
    <NavLink to={path(item.to)} className="bottennav-knapp">
      <Icon name={item.icon} /><span>{t(item.label)}</span>{item.badge && <Badge kind={item.badge} />}
    </NavLink>
  );
}
