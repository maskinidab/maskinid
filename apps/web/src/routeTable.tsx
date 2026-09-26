import { lazy, type ReactNode } from "react";

// Route tables. Pages are lazy-loaded so public pages (scan) stay small.
const L = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const HomePage = L(() => import("./pages/public/HomePage"), "HomePage");
const DashboardPage = L(() => import("./pages/app/DashboardPage"), "DashboardPage");
const InboxPage = L(() => import("./pages/app/InboxPage"), "InboxPage");
const NotificationsPage = L(() => import("./pages/app/NotificationsPage"), "NotificationsPage");
const SettingsPage = L(() => import("./pages/app/SettingsPage"), "SettingsPage");

export const publicRoutes: { path: string; element: ReactNode }[] = [
  { path: "/", element: <HomePage /> },
];

export const appRoutes: { path: string; element: ReactNode }[] = [
  { path: "dashboard", element: <DashboardPage /> },
  { path: "inbox", element: <InboxPage /> },
  { path: "notifications", element: <NotificationsPage /> },
  { path: "settings", element: <SettingsPage /> },
];
