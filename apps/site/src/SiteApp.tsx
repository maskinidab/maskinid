import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "@web/auth/AuthProvider";
import { ExternalRedirect } from "@web/components/ExternalRedirect";
import { Skeleton } from "@web/components/Feedback";
import { SignatureProvider } from "@web/components/Signature";
import { WebAnalytics } from "@web/components/WebAnalytics";
import { PublicLayout } from "@web/layouts/PublicLayout";
import { queryClient } from "@web/lib/api/query";
import { APP_ONLY_PREFIXES, APP_PUBLIC_PATHS, appUrl } from "@web/lib/surfaces";
import { publicRoutes } from "@web/routeTable";

const NotFoundPage = lazy(() => import("@web/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="behallare sektion"><Skeleton lines={4} /></div>}>{children}</Suspense>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("innehall")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

/**
 * maskinid.se (ADR 0035): the public pages, rendered by the same components as before. Every path that belongs to the
 * app – sign-in, sign-up, anything under /o/ – is sent there with a full page load, so existing links keep working.
 * AuthProvider stays: the pages ask it whether someone is signed in, and on this domain the answer is simply no.
 */
export function SiteApp() {
  const site = publicRoutes.filter((r) => !(APP_PUBLIC_PATHS as readonly string[]).includes(r.path));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SignatureProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              <Route element={<PublicLayout />}>
                {site.map((r) => <Route key={r.path} path={r.path} element={<Page>{r.element}</Page>} />)}
                {APP_ONLY_PREFIXES.map((p) => <Route key={p} path={`${p}/*`} element={<ExternalRedirect base={appUrl} />} />)}
                <Route path="*" element={<Page><NotFoundPage /></Page>} />
              </Route>
            </Routes>
          </BrowserRouter>
          <WebAnalytics />
        </SignatureProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
