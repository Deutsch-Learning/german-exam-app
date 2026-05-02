import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { languageOptions } from "../../utils/language";

export default function Navbar({ logo, language = "fr", onChangeLanguage, labels }) {
  const [openLang, setOpenLang] = useState(false);

  const selected = useMemo(
    () => languageOptions.find((item) => item.id === language) ?? languageOptions[0],
    [language]
  );

  return (
    <header className="top-nav">
      <div className="container nav-container">
        <div className="logo">
          <img src={logo} alt="Logo" />
        </div>
        <nav className="desktop-nav">
          <a href="#services">{labels.services}</a>
          <a href="#forfaits">{labels.pricing}</a>
          {labels.lessons ? <Link to="/lessons">{labels.lessons}</Link> : null}
          <a href="#contact">{labels.contact}</a>
          <div className="language-selector">
            <button
              type="button"
              className="language-button"
              onClick={() => setOpenLang((v) => !v)}
            >
              {selected.flag ? (
                <img src={selected.flag} alt={selected.label} />
              ) : (
                <span className="flag-fallback" aria-hidden="true">🌐</span>
              )}
              <span>{language.toUpperCase()}</span>
              <span className="lang-chevron">▾</span>
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
                    }}
                  >
                    <img src={item.flag} alt="" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Link className="btn-login" to="/login">
            {labels.login}
          </Link>
        </nav>
      </div>
    </header>
  );
}
