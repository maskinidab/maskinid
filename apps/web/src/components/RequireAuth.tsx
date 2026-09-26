import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Loading } from "./Notice";

/** Skyddar vyer som kräver inloggning. Skickar vidare till inloggningen och tillbaka efteråt. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="behallare sektion">
        <Loading>Kontrollerar inloggning</Loading>
      </div>
    );
  }
  if (!user) return <Navigate to="/logga-in" replace state={{ fran: location.pathname + location.search }} />;
  return <>{children}</>;
}
