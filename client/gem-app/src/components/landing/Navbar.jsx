import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";
import { aboutTestSections, pageLinks } from "../../data/siteContent";
import { languageOptions } from "../../utils/language";
import { getAuthUser, isLoggedIn } from "../../utils/access";

export default function Navbar({ logo, language = "fr", onChangeLanguage, labels }) {
  const [openLang, setOpenLang] = useState(false);
  const [openDropdown, setOpenDropdown] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loggedIn = isLoggedIn();
  const authUser = getAuthUser();
  const userName = [
    authUser?.first_name,
    authUser?.last_name,
  ].filter(Boolean).join(" ").trim() || authUser?.username || authUser?.email || "User";

  const selected = useMemo(
    () => languageOptions.find((item) => item.id === language) ?? languageOptions[0],
    [language]
  );

  const dropdowns = [
    { id: "about", label: labels.aboutTests ?? "About", items: aboutTestSections },
    { id: "pages", label: labels.pages ?? "Pages", items: pageLinks },
  ];

  const closeMenus = () => {
    setOpenDropdown("");
    setOpenLang(false);
    setMobileOpen(false);
  };

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpenDropdown("");
        setOpenLang(false);
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  const renderLinkDropdown = ({ id, label, items }) => (
    <div
      className={`nav-dropdown ${openDropdown === id ? "is-open" : ""}`}
      onMouseEnter={() => setOpenDropdown(id)}
      onMouseLeave={() => setOpenDropdown("")}
    >
      <button
        type="button"
        className="nav-link nav-dropdown-trigger"
        aria-expanded={openDropdown === id}
        onClick={() => setOpenDropdown((value) => (value === id ? "" : id))}
      >
        {label}
        <ChevronDown className="nav-chevron" size={16} aria-hidden="true" />
      </button>
      <div className="nav-dropdown-menu">
        {items.map((item) => (
          <Link
            key={item.id}
            className="nav-dropdown-item"
            to={item.path}
            onClick={closeMenus}
          >
            <img src={logo} alt="" className="nav-dropdown-logo" />
            <span>
              <strong>{item.label}</strong>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );

  const renderDropdown = (dropdown) =>
    !dropdown.items.length ? (
      <Link key={dropdown.id} className="nav-link" to={dropdown.id === "about" ? "/about" : "/"} onClick={closeMenus}>
        {dropdown.label}
      </Link>
    ) : renderLinkDropdown(dropdown);

  return (
    <>
      <header className={`top-nav ${mobileOpen ? "menu-open" : ""}`}>
        <div className="container nav-container">
          <Link className="logo" to="/" aria-label="Deutsch Prüfungen home" onClick={closeMenus}>
            <img src={logo} alt="Logo" />
          </Link>
          <button
            type="button"
            className="mobile-menu-button"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <nav className={`desktop-nav ${mobileOpen ? "mobile-open" : ""}`}>
            <Link className="nav-link" to="/" onClick={closeMenus}>{labels.home ?? "Home"}</Link>
            {dropdowns.map(renderDropdown)}
            {labels.lessons ? <Link className="nav-link" to="/lessons" onClick={closeMenus}>{labels.lessons}</Link> : null}
            <Link className="nav-link" to="/contact" onClick={closeMenus}>{labels.contact}</Link>
            <div className="language-selector">
              <button
                type="button"
                className="language-button"
                onClick={() => setOpenLang((value) => !value)}
              >
                {selected.flag ? (
                  <img src={selected.flag} alt={selected.label} />
                ) : (
                  <span className="flag-fallback" aria-hidden="true">GL</span>
                )}
                <span>{language.toUpperCase()}</span>
                <ChevronDown className="lang-chevron" size={15} aria-hidden="true" />
              </button>
              {openLang ? (
                <div className="language-menu">
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
            <div className="auth-nav-actions">
              {loggedIn ? (
                <>
                  <span className="nav-user-name" title={userName}>
                    {userName}
                  </span>
                  <Link className="btn-register-nav" to="/dashboard" onClick={closeMenus}>
                    {labels.returnToDashboard ?? "Return to Dashboard"}
                  </Link>
                </>
              ) : (
                <>
                  <Link className="btn-login" to="/login" onClick={closeMenus}>
                    {labels.login}
                  </Link>
                  <Link className="btn-register-nav" to="/register" onClick={closeMenus}>
                    {labels.createAccount ?? "Create an account"}
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>
      {mobileOpen ? <button type="button" className="mobile-nav-scrim" aria-label="Close navigation menu" onClick={closeMenus} /> : null}
    </>
  );
}
