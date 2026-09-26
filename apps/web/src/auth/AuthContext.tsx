import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { UserProfile } from "../lib/types";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  signInWithPassword(email: string, password: string): Promise<UserProfile>;
  requestSignInLink(email: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .getCurrentUser()
      .then((u) => active && setUser(u))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    const unsubscribe = api.onAuthChange((u) => active && setUser(u));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const u = await api.signInWithPassword(email, password);
    setUser(u);
    return u;
  }, []);

  const requestSignInLink = useCallback((email: string) => api.requestSignInLink(email), []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signInWithPassword, requestSignInLink, signOut }),
    [user, loading, signInWithPassword, requestSignInLink, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth måste användas inom <AuthProvider>");
  return ctx;
}
