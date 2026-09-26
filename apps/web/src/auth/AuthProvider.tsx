import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import i18n from "../i18n";
import { queryClient } from "../lib/api/query";
import type { MyContext } from "../lib/api/types";
import { backend, type Session } from "../lib/backend";

interface AuthState {
  ready: boolean;
  session: Session | null;
  context: MyContext | null;
  contextLoading: boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    backend.auth.getSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setReady(true);
    }).catch(() => setReady(true));
    const off = backend.auth.onChange((s) => {
      setSession(s);
      void queryClient.invalidateQueries();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const ctxQuery = useQuery({
    queryKey: ["rpc", "my_context", session?.userId ?? null, session?.aal ?? null],
    queryFn: () => backend.rpc<MyContext | null>("my_context"),
    enabled: ready && !!session,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // The profile's language wins after sign-in.
  const locale = ctxQuery.data?.locale;
  useEffect(() => {
    if (locale && locale !== i18n.language) void i18n.changeLanguage(locale);
  }, [locale]);

  const refresh = useCallback(async () => {
    await ctxQuery.refetch();
  }, [ctxQuery]);

  const signOut = useCallback(async () => {
    await backend.auth.signOut();
    queryClient.clear();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      context: session ? (ctxQuery.data ?? null) : null,
      contextLoading: !!session && ctxQuery.isLoading,
      refresh,
      signOut,
    }),
    [ready, session, ctxQuery.data, ctxQuery.isLoading, refresh, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
