import { lazy, type ReactNode } from "react";

// Route tables. Pages are lazy-loaded so public pages (scan) stay small.
const L = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const HomePage = L(() => import("./pages/public/HomePage"), "HomePage");
const MachinePublicPage = L(() => import("./pages/public/MachinePublicPage"), "MachinePublicPage");
const SharePage = L(() => import("./pages/public/SharePage"), "SharePage");
const ScanPage = L(() => import("./pages/public/ScanPage"), "ScanPage");
const VerifyPage = L(() => import("./pages/public/VerifyPage"), "VerifyPage");
const SecurityPage = L(() => import("./pages/public/SecurityPage"), "SecurityPage");
const HowPage = L(() => import("./pages/public/HowPage"), "HowPage");
const ApiDocsPage = L(() => import("./pages/public/ApiDocsPage"), "ApiDocsPage");
const AdPage = L(() => import("./pages/public/AdPage"), "AdPage");
const ReceiptVerifyPage = L(() => import("./pages/public/ReceiptVerifyPage"), "ReceiptVerifyPage");
const DashboardPage = L(() => import("./pages/app/DashboardPage"), "DashboardPage");
const InboxPage = L(() => import("./pages/app/InboxPage"), "InboxPage");
const NotificationsPage = L(() => import("./pages/app/NotificationsPage"), "NotificationsPage");
const SettingsPage = L(() => import("./pages/app/SettingsPage"), "SettingsPage");
const MachinesPage = L(() => import("./pages/app/machines/MachinesPage"), "MachinesPage");
const MachinePage = L(() => import("./pages/app/machines/MachinePage"), "MachinePage");
const RegisterWizard = L(() => import("./pages/app/machines/RegisterWizard"), "RegisterWizard");
const ReportErrorPage = L(() => import("./pages/app/machines/ReportErrorPage"), "ReportErrorPage");
const TransferPage = L(() => import("./pages/app/transfers/TransferPage"), "TransferPage");
const CheckPage = L(() => import("./pages/app/check/CheckPage"), "CheckPage");
const ReceiptsPage = L(() => import("./pages/app/check/CheckPage"), "ReceiptsPage");
const FleetPage = L(() => import("./pages/app/fleet/FleetPage"), "FleetPage");
const RentalsPage = L(() => import("./pages/app/fleet/RentalsPage"), "RentalsPage");
const ClientReportsPage = L(() => import("./pages/app/fleet/ClientReportsPage"), "ClientReportsPage");
const InspectionNewPage = L(() => import("./pages/app/fleet/InspectionNewPage"), "InspectionNewPage");
const StockPage = L(() => import("./pages/app/dealer/StockPage"), "StockPage");
const SalePage = L(() => import("./pages/app/dealer/SalePage"), "SalePage");
const TradeInPage = L(() => import("./pages/app/dealer/TradeInPage"), "TradeInPage");
const LeadsPage = L(() => import("./pages/app/dealer/LeadsPage"), "LeadsPage");
const CustomersPage = L(() => import("./pages/app/dealer/LeadsPage"), "CustomersPage");
const LabelsPage = L(() => import("./pages/app/dealer/LabelsPage"), "LabelsPage");
const PortfolioPage = L(() => import("./pages/app/roles/PortfolioPage"), "PortfolioPage");
const AlertsPage = L(() => import("./pages/app/roles/AlertsPage"), "AlertsPage");
const WatchlistPage = L(() => import("./pages/app/roles/WatchlistPage"), "WatchlistPage");
const VerifyQueuePage = L(() => import("./pages/app/roles/VerifyQueuePage"), "VerifyQueuePage");
const VerifyReviewPage = L(() => import("./pages/app/roles/VerifyQueuePage"), "VerifyReviewPage");
const AuthoritySearchPage = L(() => import("./pages/app/roles/AuthorityPages"), "AuthoritySearchPage");
const FlagsPage = L(() => import("./pages/app/roles/AuthorityPages"), "FlagsPage");
const ExportCheckPage = L(() => import("./pages/app/roles/AuthorityPages"), "ExportCheckPage");
const ExportsPage = L(() => import("./pages/app/roles/AuthorityPages"), "ExportsPage");
const OemPage = L(() => import("./pages/app/roles/OemPage"), "OemPage");
const ImportPage = L(() => import("./pages/app/import/ImportPage"), "ImportPage");
const NewEncumbrancePage = L(() => import("./pages/app/encumbrances/NewEncumbrancePage"), "NewEncumbrancePage");
const AdminHomePage = L(() => import("./pages/app/admin/AdminQueues"), "AdminHomePage");
const AdminConflictsPage = L(() => import("./pages/app/admin/AdminQueues"), "AdminConflictsPage");
const AdminCorrectionsPage = L(() => import("./pages/app/admin/AdminQueues"), "AdminCorrectionsPage");
const AdminOrgsPage = L(() => import("./pages/app/admin/AdminOrgs"), "AdminOrgsPage");
const AdminOrgPage = L(() => import("./pages/app/admin/AdminOrgs"), "AdminOrgPage");
const AdminLabelsPage = L(() => import("./pages/app/admin/AdminTools"), "AdminLabelsPage");
const AdminEventsPage = L(() => import("./pages/app/admin/AdminTools"), "AdminEventsPage");
const AdminMarketPage = L(() => import("./pages/app/admin/AdminTools"), "AdminMarketPage");
const AdminApiPage = L(() => import("./pages/app/admin/AdminTools"), "AdminApiPage");
const AdminSupportPage = L(() => import("./pages/app/admin/AdminTools"), "AdminSupportPage");
const AdminFlagsPage = L(() => import("./pages/app/admin/AdminTools"), "AdminFlagsPage");
const AdminHealthPage = L(() => import("./pages/app/admin/AdminTools"), "AdminHealthPage");

export const publicRoutes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <HomePage /> },
  { path: "m/:code", element: <MachinePublicPage /> },
  { path: "r/:reg", element: <MachinePublicPage /> },
  { path: "s/:token", element: <SharePage /> },
  { path: "scan", element: <ScanPage /> },
  { path: "verify", element: <VerifyPage /> },
  { path: "security", element: <SecurityPage /> },
  { path: "how", element: <HowPage /> },
  { path: "receipt", element: <ReceiptVerifyPage /> },
  { path: "ad/:reg", element: <AdPage /> },
  { path: "api-docs", element: <ApiDocsPage /> },
];

export const appRoutes: { path: string; element: ReactNode }[] = [
  { path: "dashboard", element: <DashboardPage /> },
  { path: "inbox", element: <InboxPage /> },
  { path: "notifications", element: <NotificationsPage /> },
  { path: "settings", element: <SettingsPage /> },
  { path: "machines", element: <MachinesPage /> },
  { path: "machines/new", element: <RegisterWizard /> },
  { path: "machines/:id", element: <MachinePage /> },
  { path: "transfers/:id", element: <TransferPage /> },
  { path: "transfer-request", element: <ReportErrorPage /> },
  { path: "report-error", element: <ReportErrorPage /> },
  { path: "check", element: <CheckPage /> },
  { path: "receipts", element: <ReceiptsPage /> },
  { path: "encumbrances/new", element: <NewEncumbrancePage /> },
  { path: "import", element: <ImportPage /> },
  { path: "fleet", element: <FleetPage /> },
  { path: "stock", element: <StockPage /> },
  { path: "sales/new", element: <SalePage /> },
  { path: "trade-in", element: <TradeInPage /> },
  { path: "leads", element: <LeadsPage /> },
  { path: "customers", element: <CustomersPage /> },
  { path: "labels", element: <LabelsPage /> },
  { path: "rentals", element: <RentalsPage /> },
  { path: "client-reports", element: <ClientReportsPage /> },
  { path: "inspections/new", element: <InspectionNewPage /> },
  { path: "portfolio", element: <PortfolioPage /> },
  { path: "alerts", element: <AlertsPage /> },
  { path: "watchlist", element: <WatchlistPage /> },
  { path: "verify", element: <VerifyQueuePage /> },
  { path: "bookings", element: <VerifyQueuePage /> },
  { path: "verify/:id", element: <VerifyReviewPage /> },
  { path: "search", element: <AuthoritySearchPage /> },
  { path: "flags", element: <FlagsPage /> },
  { path: "export-check", element: <ExportCheckPage /> },
  { path: "exports", element: <ExportsPage /> },
  { path: "oem", element: <OemPage /> },
  { path: "admin", element: <AdminHomePage /> },
  { path: "admin/organizations", element: <AdminOrgsPage /> },
  { path: "admin/organizations/:id", element: <AdminOrgPage /> },
  { path: "admin/verifications", element: <VerifyQueuePage /> },
  { path: "admin/conflicts", element: <AdminConflictsPage /> },
  { path: "admin/corrections", element: <AdminCorrectionsPage /> },
  { path: "admin/labels", element: <AdminLabelsPage /> },
  { path: "admin/events", element: <AdminEventsPage /> },
  { path: "admin/market", element: <AdminMarketPage /> },
  { path: "admin/api", element: <AdminApiPage /> },
  { path: "admin/support", element: <AdminSupportPage /> },
  { path: "admin/flags", element: <AdminFlagsPage /> },
  { path: "admin/health", element: <AdminHealthPage /> },
];
