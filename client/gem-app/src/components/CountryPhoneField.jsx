import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { allCountries } from "country-telephone-data";

const countryFlag = (iso2) =>
  String(iso2 || "")
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)));

const countries = allCountries
  .map((country) => ({
    code: country.iso2.toUpperCase(),
    name: country.name.replace(/\s*\([^)]*\)\s*/g, " ").trim(),
    dialCode: `+${country.dialCode}`,
    flag: countryFlag(country.iso2),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function CountryPhoneField({ countryCode, phone, error, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closeTimerRef = useRef(null);
  const selected = countries.find((country) => country.code === countryCode) || null;
  const filteredCountries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return countries;
    return countries.filter((country) =>
      `${country.name} ${country.code} ${country.dialCode}`.toLowerCase().includes(normalized)
    );
  }, [query]);

  const chooseCountry = (country) => {
    const previousDialCode = selected?.dialCode || "";
    const currentPhone = String(phone || "").trim();
    const nextPhone = !currentPhone || currentPhone === previousDialCode
      ? country.dialCode
      : previousDialCode && currentPhone.startsWith(previousDialCode)
        ? `${country.dialCode}${currentPhone.slice(previousDialCode.length)}`
        : currentPhone;
    onChange({ countryCode: country.code, phone: nextPhone });
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="country-phone-fields">
      <div className="form-group country-select-group">
        <label id="country-label">Pays</label>
        <div
          className="country-combobox"
          onBlur={() => {
            closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onFocus={() => {
            if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
          }}
        >
          <button
            type="button"
            className={`country-trigger ${error ? "input-error" : ""}`}
            aria-labelledby="country-label"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{selected ? `${selected.flag} ${selected.name}` : "Choisir un pays"}</span>
            {selected ? <small>{selected.dialCode}</small> : null}
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {open ? (
            <div className="country-menu">
              <div className="country-search-wrap">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher un pays"
                  aria-label="Rechercher un pays"
                  autoFocus
                />
              </div>
              <div className="country-options" role="listbox" aria-label="Pays disponibles">
                {filteredCountries.map((country) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={country.code === countryCode}
                    className="country-option"
                    key={country.code}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseCountry(country)}
                  >
                    <span className="country-option-flag" aria-hidden="true">{country.flag}</span>
                    <span>{country.name}</span>
                    <small>{country.dialCode}</small>
                    {country.code === countryCode ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                ))}
                {!filteredCountries.length ? <p className="country-empty">Aucun pays trouve.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
        {error ? <span className="error-text">{error}</span> : null}
      </div>

      <div className="form-group">
        <label htmlFor="phone">Numero de telephone</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          value={phone}
          onChange={(event) => onChange({ countryCode, phone: event.target.value })}
          placeholder={selected ? `${selected.dialCode} 6 12 34 56 78` : "+237 6 12 34 56 78"}
          autoComplete="tel"
          className={error ? "input-error" : ""}
          required
        />
      </div>
    </div>
  );
}
