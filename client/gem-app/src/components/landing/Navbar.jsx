import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpenText,
  ChevronDown,
  Home,
  Info,
  LayoutList,
  LogIn,
  Menu,
  Newspaper,
  Settings,
  X,
} from "lucide-react";
import { getAuthUser, isLoggedIn } from "../../utils/access";
import { languageOptions } from "../../utils/language";

const navItems = [
  { key: "home", path: "/", icon: Home },
  { key: "exams", path: "/start-preparation", icon: BookOpenText },
  { key: "simulations", path: "/simulations", icon: Settings },
  { key: "aboutTests", path: "/about", icon: Info },
  { key: "blog", path: "/actualites", icon: Newspaper },
  { key: "contact", path: "/contact", icon: LayoutList },
];

export default function Navbar({ logo, language = "fr", onChangeLanguage, labels = {} }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openLang, setOpenLang] = useState(false);
  const location = useLocation();
  const loggedIn = isLoggedIn();
  const authUser = getAuthUser();
  const userName = [
    authUser?.first_name,
    authUser?.last_name,
  ].filter(Boolean).join(" ").trim() || authUser?.username || authUser?.email || "";

  const activePath = useMemo(() => {
    const path = location.pathname;
    if (path === "/") return "/";
    const match = navItems
      .filter((item) => item.path !== "/" && path.startsWith(item.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return match?.path ?? "";
  }, [location.pathname]);

  const selectedLanguage = useMemo(
    () => languageOptions.find((item) => item.id === language) ?? languageOptions[0],
    [language]
  );

  const closeMenu = () => {
    setMobileOpen(false);
    setOpenLang(false);
  };

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setOpenLang(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  const renderLanguageSelector = (className = "") => (
    <div className={`language-selector reference-language-selector ${className}`}>
      <button
        type="button"
        className="language-button reference-language-button"
        aria-label={labels.languageSelector ?? "Changer de langue"}
        aria-expanded={openLang}
        onClick={() => setOpenLang((value) => !value)}
      >
        {selectedLanguage.flag ? (
          <img src={selectedLanguage.flag} alt={selectedLanguage.label} />
        ) : (
          <span className="flag-fallback" aria-hidden="true">GL</span>
        )}
        <span>{language.toUpperCase()}</span>
        <ChevronDown className="lang-chevron" size={15} aria-hidden="true" />
      </button>
      {openLang ? (
        <div className="language-menu reference-language-menu">
          {languageOptions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChangeLanguage?.(item.id);
                setOpenLang(false);
                setMobileOpen(false);
              }}
            >
              <img src={item.flag} alt="" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <header className={`top-nav landing-reference-nav ${mobileOpen ? "menu-open" : ""}`}>
        <div className="container nav-container reference-nav-container">
          <Link className="reference-brand" to="/" aria-label={labels.homeLabel ?? "Deutsch Pruefungen home"} onClick={closeMenu}>
            <img src={logo} alt="" />
            <span>
              <strong>{labels.brandTitle ?? "Préparation"}</strong>
              <small>{labels.brandSubtitle ?? "Examens d'Allemand"}</small>
            </span>
          </Link>
          <div className="reference-mobile-actions">
            {renderLanguageSelector("reference-mobile-language")}
          </div>
          <button
            type="button"
            className="reference-menu-button"
            aria-label={mobileOpen ? labels.closeMenu ?? "Fermer le menu" : labels.openMenu ?? "Ouvrir le menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <nav className={`reference-tabs ${mobileOpen ? "mobile-open" : ""}`} aria-label={labels.primaryNavLabel ?? "Navigation principale"}>
            <div className="reference-nav-links">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activePath === item.path;
                return (
                  <Link
                    key={item.key}
                    className={`reference-tab ${active ? "is-active" : ""}`}
                    to={item.path}
                    onClick={closeMenu}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{labels[item.key] ?? item.key}</span>
                  </Link>
                );
              })}
            </div>
            <div className="reference-auth-actions">
              {renderLanguageSelector("reference-desktop-language")}
              {loggedIn ? (
                <>
                  <span className="reference-user-name" title={userName}>{userName}</span>
                  <Link className="reference-login" to="/dashboard" onClick={closeMenu}>
                    {labels.returnToDashboard ?? "Dashboard"}
                  </Link>
                </>
              ) : (
                <>
                  <Link className="reference-login" to="/login" onClick={closeMenu}>
                    <LogIn size={19} aria-hidden="true" />
                    <span>{labels.login ?? "Se connecter"}</span>
                  </Link>
                  <Link className="reference-register" to="/register" onClick={closeMenu}>
                    {labels.createAccount ?? "S'inscrire"}
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>
      {mobileOpen ? (
        <button
          type="button"
          className="mobile-nav-scrim reference-nav-scrim"
          aria-label={labels.closeMenu ?? "Fermer le menu"}
          onClick={closeMenu}
        />
      ) : null}
    </>
  );
}
