import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dataSource } from "../lib/api";
import { resetMockDatabase } from "../lib/api/mockApi";
import { ORG_TYPE_LABEL } from "../lib/permissions";
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";
import { Wordmark } from "./Logo";

function Header() {
  const { user, signOut } = useAuth();
  const { isDark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <header className="sidhuvud">
      <div className="behallare sidhuvud-inre">
        <Link to="/" className="sidhuvud-logo" aria-label="MaskinID – till startsidan">
          <Wordmark height={22} />
        </Link>
        <button
          type="button"
          className="mid-knapp mid-knapp-kontur mid-knapp-liten meny-knapp"
          aria-expanded={open}
          aria-controls="huvudmeny"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "stang" : "meny"} />
          Meny
        </button>
        <nav
          id="huvudmeny"
          className={`sidhuvud-nav${open ? " is-oppen" : ""}`}
          aria-label="Huvudmeny"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <NavLink to="/" end>
            Sök
          </NavLink>
          <NavLink to="/sa-fungerar-det">Så fungerar det</NavLink>
          {user && <NavLink to="/mina-sidor">Mina sidor</NavLink>}
          {user?.isAdmin && <NavLink to="/admin">Administration</NavLink>}
          {user ? (
            <>
              <span className="anvandare">
                <strong>{user.fullName}</strong>
                {user.organization.name} · {ORG_TYPE_LABEL[user.organization.type]}
              </span>
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void signOut()}>
                <Icon name="logga-ut" />
                Logga ut
              </button>
            </>
          ) : (
            <Link to="/logga-in" className="mid-knapp mid-knapp-sekundar mid-knapp-liten">
              Logga in
            </Link>
          )}
          <button
            type="button"
            className="tema-knapp"
            onClick={toggle}
            aria-label={isDark ? "Byt till ljust tema" : "Byt till mörkt tema"}
            title={isDark ? "Ljust tema" : "Mörkt tema"}
          >
            <Icon name={isDark ? "sol" : "mane"} />
          </button>
        </nav>
      </div>
    </header>
  );
}

function DemoBar() {
  if (dataSource !== "mock") return null;
  return (
    <div className="demo-rad">
      <div className="behallare">
        Demoläge: exempeldata sparas bara i din webbläsare.{" "}
        <button
          type="button"
          className="mid-lank mid-lank-knapp"
          onClick={() => {
            resetMockDatabase();
            window.location.reload();
          }}
        >
          Återställ exempeldata
        </button>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="sidfot">
      <div className="behallare">
        <div className="sidfot-inre">
          <div className="stack-4">
            <Wordmark height={24} variant="negativ" />
            <p style={{ maxWidth: 420 }}>
              Registret där maskinhandlare, maskinägare, långivare och försäkringsgivare ser vem som äger en maskin, om den är
              belånad och vem som försäkrar den.
            </p>
          </div>
          <div>
            <h2>Registret</h2>
            <ul>
              <li><Link to="/">Sök i registret</Link></li>
              <li><Link to="/sa-fungerar-det">Så fungerar det</Link></li>
              <li><Link to="/mina-sidor">Mina sidor</Link></li>
            </ul>
          </div>
          <div>
            <h2>Om MaskinID</h2>
            <ul>
              <li><Link to="/sa-fungerar-det#uppgifter">Uppgifternas källa</Link></li>
              <li><Link to="/sa-fungerar-det#aktorer">För långivare och försäkringsgivare</Link></li>
              <li><Link to="/profil">Grafisk profil</Link></li>
            </ul>
          </div>
        </div>
        <div className="sidfot-botten">MaskinID · Uppgifterna kommer från registrerade ägare, långivare och försäkringsgivare.</div>
      </div>
    </footer>
  );
}

export function Layout() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  return (
    <div className="sida">
      <a className="hoppa-till" href="#innehall">
        Hoppa till innehållet
      </a>
      <DemoBar />
      <Header />
      <main id="innehall" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
