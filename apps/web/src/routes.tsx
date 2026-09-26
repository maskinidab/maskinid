import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { Skeleton } from "./components/Feedback";
import { AppLayout } from "./layouts/AppLayout";
import { PublicLayout } from "./layouts/PublicLayout";
import { NotFoundPage } from "./pages/NotFoundPage";
import { appRoutes, publicRoutes } from "./routeTable";

const LoginPage = lazy(() => import("./pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./pages/auth/SignupPage").then((m) => ({ default: m.SignupPage })));
const AuthCallbackPage = lazy(() => import("./pages/auth/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })));
const InvitePage = lazy(() => import("./pages/auth/InvitePage").then((m) => ({ default: m.InvitePage })));
const OnboardingPage = lazy(() => import("./pages/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const DesignProfilePage = lazy(() => import("./pages/DesignProfilePage").then((m) => ({ default: m.DesignProfilePage })));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="behallare sektion"><Skeleton lines={4} /></div>}>{children}</Suspense>;
}

/** /app → the last used org's dashboard (or onboarding). */
function AppEntry() {
  const { ready, session, context } = useAuth();
  if (!ready || (session && !context)) return <div className="behallare sektion"><Skeleton lines={4} /></div>;
  if (!session) return <Navigate to="/login" replace />;
  const m = context!.memberships.find((x) => x.org.id === context!.last_active_org_id) ?? context!.memberships[0];
  if (context!.operator_role && !m) return <Navigate to="/admin" replace />;
  return <Navigate to={m ? `/o/${m.org.slug}/dashboard` : "/onboarding"} replace />;
}

/** New page ⇒ start at the top and move focus to the content (screen readers announce the new page). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("innehall")?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}

export function AppRoutes() {
  return (
    <>
    <ScrollToTop />
    <Routes>
      <Route element={<PublicLayout />}>
        {publicRoutes.map((r) => <Route key={r.path} path={r.path} element={<Page>{r.element}</Page>} />)}
        <Route path="login" element={<Page><LoginPage /></Page>} />
        <Route path="signup" element={<Page><SignupPage /></Page>} />
        <Route path="auth/callback" element={<Page><AuthCallbackPage /></Page>} />
        <Route path="invite/:token" element={<Page><InvitePage /></Page>} />
        <Route path="onboarding" element={<Page><OnboardingPage /></Page>} />
        <Route path="profile" element={<Page><ProfilePage /></Page>} />
        <Route path="design" element={<Page><DesignProfilePage /></Page>} />
        <Route path="app" element={<AppEntry />} />
        <Route path="dashboard" element={<AppEntry />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="o/:orgSlug" element={<AppLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        {appRoutes.map((r) => <Route key={r.path} path={r.path} element={<Page>{r.element}</Page>} />)}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </>
  );
}
