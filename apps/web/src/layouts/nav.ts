import type { IconName } from "../components/Icon";
import type { OrgType } from "../lib/api/types";

export interface NavItem {
  to: string; // relative to /o/:slug
  label: string; // i18n key
  icon: IconName;
  badge?: "inbox" | "notifications";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Sidebar grouped per role (SPEC §9.2, §9.3). Only the org's effective types are shown. */
export function navGroups(types: OrgType[], isAdmin: boolean, isOperator: boolean, canWrite = true): NavGroup[] {
  const has = (t: OrgType) => types.includes(t);
  const register: NavItem[] = [
    { to: "dashboard", label: "nav.dashboard", icon: "hem" },
    { to: "machines", label: "nav.machines", icon: "maskin" },
    { to: "inbox", label: "nav.inbox", icon: "inkorg", badge: "inbox" },
    { to: "notifications", label: "nav.notifications", icon: "klocka", badge: "notifications" },
  ];
  if (canWrite && (has("owner") || has("dealer") || has("financier") || has("inspector"))) {
    register.splice(2, 0, { to: "machines/new", label: "nav.register", icon: "plus" });
  }
  const role: NavItem[] = [];
  if (has("owner")) {
    role.push({ to: "fleet", label: "nav.fleet", icon: "bygg" }, { to: "daily-check", label: "nav.daily_check", icon: "bock" },
      { to: "rentals", label: "nav.rentals", icon: "byt" }, { to: "attachments", label: "nav.attachments", icon: "verktyg" },
      { to: "operators", label: "nav.operators", icon: "personer" }, { to: "climate", label: "nav.climate", icon: "diagram" });
  }
  if (has("dealer")) {
    role.push(
      { to: "stock", label: "nav.stock", icon: "tagg" }, { to: "sales/new", label: "nav.sales_new", icon: "pil-hoger" },
      { to: "trade-in", label: "nav.trade_in", icon: "qr" }, { to: "leads", label: "nav.leads", icon: "personer" },
      { to: "customers", label: "nav.customers", icon: "lista" },
    );
  }
  if (has("financier")) {
    role.push(
      { to: "check", label: "nav.check", icon: "kvitto" }, { to: "portfolio", label: "nav.portfolio", icon: "bank" },
      { to: "encumbrances/new", label: "nav.encumbrances_new", icon: "hanglas" }, { to: "receipts", label: "nav.receipts", icon: "dokument" },
    );
  }
  if (has("insurer") && !has("financier")) role.push({ to: "portfolio", label: "nav.portfolio", icon: "skold" });
  if (has("financier") || has("insurer") || has("dealer") || has("authority")) role.push({ to: "alerts", label: "nav.alerts", icon: "varning" });
  if (has("authority")) {
    role.push(
      { to: "search", label: "nav.search", icon: "sok" }, { to: "flags", label: "nav.flags", icon: "flagga" },
      { to: "export-check", label: "nav.export_check", icon: "extern" }, { to: "exports", label: "nav.exports", icon: "diagram" },
    );
  }
  if (has("dealer") || has("inspector")) role.push({ to: "verify", label: "nav.verify", icon: "sigill" });
  if (has("inspector")) role.push({ to: "inspections/new", label: "nav.inspection_new", icon: "sigill" }, { to: "bookings", label: "nav.bookings", icon: "tid" });
  if (has("manufacturer")) role.push({ to: "oem", label: "nav.oem", icon: "verktyg" });
  if (has("client")) role.push({ to: "client-reports", label: "nav.client_reports", icon: "diagram" });
  if (has("owner")) role.push({ to: "reports", label: "nav.reports", icon: "diagram" });

  const org: NavItem[] = [
    { to: "import", label: "nav.import", icon: "uppladdning" },
    { to: "labels", label: "nav.labels", icon: "qr" },
    { to: "watchlist", label: "nav.watchlist", icon: "oga" },
    { to: "mandates", label: "nav.mandates", icon: "sigill" },
    { to: "support", label: "nav.support", icon: "info" },
    { to: "settings", label: "nav.settings", icon: "installningar" },
  ];
  if (!isAdmin) org.splice(0, 1);
  const groups: NavGroup[] = [{ label: "nav.group_register", items: register }];
  const uniq = role.filter((x, i) => role.findIndex((y) => y.to === x.to) === i);
  if (uniq.length) groups.push({ label: "nav.group_role", items: uniq });
  groups.push({ label: "nav.group_org", items: org });
  if (has("operator")) {
    groups.push({ label: "nav.admin", items: [
      { to: "admin", label: "nav.admin_home", icon: "skold" },
      { to: "admin/organizations", label: "nav.admin_orgs", icon: "personer" },
      { to: "verify", label: "nav.verify", icon: "sigill" },
      { to: "admin/conflicts", label: "nav.admin_conflicts", icon: "varning" },
      { to: "admin/corrections", label: "nav.admin_corrections", icon: "penna" },
      { to: "admin/labels", label: "nav.admin_labels", icon: "qr" },
      { to: "admin/events", label: "nav.admin_events", icon: "lista" },
      { to: "admin/market", label: "nav.admin_market", icon: "sok" },
      { to: "admin/api", label: "nav.admin_api", icon: "diagram" },
      { to: "admin/support", label: "nav.admin_support", icon: "info" },
      { to: "admin/support-tickets", label: "nav.admin_tickets", icon: "inkorg" },
      { to: "admin/tips", label: "nav.admin_tips", icon: "flagga" },
      { to: "admin/legal", label: "nav.admin_legal", icon: "dokument" },
      { to: "admin/flags", label: "nav.admin_flags", icon: "installningar" },
      { to: "admin/health", label: "nav.admin_health", icon: "bock" },
    ] });
  } else if (isOperator) groups.push({ label: "nav.admin", items: [{ to: "/admin", label: "nav.admin", icon: "skold" }] });
  return groups;
}

/** Mobile bottom navigation: four icons around the big central Scan button (SPEC §9.3). */
export function bottomNav(types: OrgType[]): NavItem[] {
  const second: NavItem = types.includes("financier")
    ? { to: "check", label: "nav.check", icon: "kvitto" }
    : types.includes("dealer") ? { to: "stock", label: "nav.stock", icon: "tagg" }
      : types.includes("authority") ? { to: "search", label: "nav.search", icon: "sok" }
        : { to: "machines", label: "nav.machines", icon: "maskin" };
  return [
    { to: "dashboard", label: "nav.dashboard", icon: "hem" },
    second,
    { to: "inbox", label: "nav.inbox", icon: "inkorg", badge: "inbox" },
    { to: "more", label: "common.more", icon: "meny" },
  ];
}
