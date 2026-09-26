import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExtractPage, RequestExtractPage } from "./pages/ExtractPages";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MachinePage } from "./pages/machine/MachinePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RegisterMachinePage } from "./pages/RegisterMachinePage";
import { SearchPage } from "./pages/SearchPage";

/** Hash-routing används i den fristående demobyggnaden (npm run build:demo), annars vanliga URL:er. */
const Router = import.meta.env.VITE_ROUTER === "hash" ? HashRouter : BrowserRouter;

export function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="sok" element={<SearchPage />} />
            <Route path="maskin/:id" element={<MachinePage />} />
            <Route path="maskin/:id/utdrag" element={<RequireAuth><RequestExtractPage /></RequireAuth>} />
            <Route path="utdrag/:extractId" element={<ExtractPage />} />
            <Route path="logga-in" element={<LoginPage />} />
            <Route path="mina-sidor" element={<RequireAuth><DashboardPage /></RequireAuth>} />
            <Route path="mina-sidor/registrera-maskin" element={<RequireAuth><RegisterMachinePage /></RequireAuth>} />
            <Route path="admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
            <Route path="sa-fungerar-det" element={<AboutPage />} />
            <Route path="profil" element={<ProfilePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}
