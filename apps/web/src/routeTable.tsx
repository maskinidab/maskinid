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
const ImportPage = L(() => import("./pages/app/import/ImportPage"), "ImportPage");
const NewEncumbrancePage = L(() => import("./pages/app/encumbrances/NewEncumbrancePage"), "NewEncumbrancePage");

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
];
