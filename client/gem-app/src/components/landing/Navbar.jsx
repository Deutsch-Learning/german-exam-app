import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { aboutTestSections, currentTopics, pageLinks } from "../../data/siteContent";
import { languageOptions } from "../../utils/language";
import { isLoggedIn } from "../../utils/access";

export default function Navbar({ logo, language = "fr", onChangeLanguage, labels }) {
  const [openLang, setOpenLang] = useState(false);
  const [openDropdown, setOpenDropdown] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loggedIn = isLoggedIn();

  const selected = useMemo(
    () => languageOptions.find((item) => item.id === language) ?? languageOptions[0],
    [language]
  );

  const dropdowns = [
    { id: "topics", label: labels.currentTopics ?? "Current topics", items: currentTopics },
    { id: "about", label: labels.aboutTests ?? "About TestDaF/DSH", items: aboutTestSections },
    { id: "pages", label: labels.pages ?? "Pages", items: pageLinks },
  ];

  const closeMenus = () => {
    setOpenDropdown("");
    setOpenLang(false);
    setMobileOpen(false);
  };

  const renderTopicDropdown = ({ id, label, items }) => {
    const topicOpen = openDropdown === id || items.some((item) => item.id === openDropdown);

    return (
    <div
      className={`nav-dropdown ${topicOpen ? "is-open" : ""}`}
      onMouseEnter={() => setOpenDropdown((value) => value || id)}
      onMouseLeave={() => setOpenDropdown("")}
    >
      <button
        type="button"
        className="nav-link nav-dropdown-trigger"
        aria-expanded={topicOpen}
        onClick={() => setOpenDropdown((value) => (value === id ? "" : id))}
      >
        {label}
        <span className="nav-chevron">v</span>
      </button>
      <div className="nav-dropdown-menu">
        {items.map((item) => (
          <Link
            className="nav-dropdown-item nav-topic-link"
            key={item.id}
            to={item.path}
            onClick={closeMenus}
          >
            <img src={logo} alt="" className="nav-dropdown-logo" />
            <span>
              <strong>{item.label}</strong>
              <small>{item.seriesTitle}</small>
            </span>
          </Link>
        ))}
      </div>
    </div>
    );
  };

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
        <span className="nav-chevron">v</span>
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
    dropdown.id === "topics" ? renderTopicDropdown(dropdown) : renderLinkDropdown(dropdown);

  return (
    <header className="top-nav">
      <div className="container nav-container">
        <Link className="logo" to="/" aria-label="Deutsch Learning home">
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
              <span className="lang-chevron">v</span>
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
              <Link className="btn-register-nav" to="/dashboard" onClick={closeMenus}>
                {labels.dashboard ?? "Dashboard"}
              </Link>
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
  );
}
