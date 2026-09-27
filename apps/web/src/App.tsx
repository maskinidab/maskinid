import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { SignatureProvider } from "./components/Signature";
import { queryClient } from "./lib/api/query";
import { AppRoutes } from "./routes";

/** Hash routing in the self-contained demo build (npm run build:demo), normal URLs otherwise. */
const Router = import.meta.env.VITE_ROUTER === "hash" ? HashRouter : BrowserRouter;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SignatureProvider>
          <Router>
            <AppRoutes />
          </Router>
        </SignatureProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
