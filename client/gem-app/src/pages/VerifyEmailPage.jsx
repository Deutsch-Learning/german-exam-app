import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import "./LoginPage.css";

const normalizeCode = (value) => String(value || "").replace(/\D/g, "").slice(0, 6);

export default function VerifyEmailPage() {
  const { token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get("email") || location.state?.email || "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(token ? "loading" : "idle");
  const [message, setMessage] = useState(location.state?.message || "");
  const [devLink, setDevLink] = useState(location.state?.devVerificationUrl || "");
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef(null);

  const codeDigits = useMemo(() => {
    const digits = code.split("");
    return Array.from({ length: 6 }, (_, index) => digits[index] || "");
  }, [code]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;

    API.get(`/api/auth/verify-email/${token}`)
      .then((res) => {
        if (!active) return;
        setStatus(res.data?.ok ? "success" : "error");
        setMessage(res.data?.ok ? "Email confirmé. Vous pouvez maintenant vous connecter." : "Lien invalide ou expiré.");
      })
      .catch((err) => {
        if (!active) return;
        setStatus("error");
        setMessage(err.response?.data?.error || "Lien invalide ou expiré.");
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const verifyCode = async (event) => {
    event.preventDefault();
    const safeCode = normalizeCode(code);
    if (!email || safeCode.length !== 6) {
      setStatus("error");
      setMessage("Entrez votre email et le code à 6 chiffres.");
      return;
    }

    setStatus("loading");
    setMessage("");
    try {
      const res = await API.post("/api/auth/verify-email", { email, code: safeCode });
      setStatus("success");
      setMessage(res.data?.ok ? "Email confirmé. Bienvenue sur N-Deutschprüfungen." : "Code invalide ou expiré.");
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.error || "Code invalide ou expiré.");
    }
  };

  const resend = async () => {
    if (!email || cooldown || status === "loading") return;
    setStatus("loading");
    setMessage("");
    setDevLink("");
    try {
      const res = await API.post("/api/auth/resend-verification", { email });
      setStatus("idle");
      setMessage(res.data?.message || "Si une vérification est nécessaire, un nouveau code a été envoyé.");
      setDevLink(res.data?.devVerificationUrl || "");
      setCooldown(Number(res.data?.cooldownSeconds) || 60);
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.error || "Impossible d'envoyer un nouveau code.");
      if (err.response?.status === 429) setCooldown(60);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-brand-panel">
        <div className="brand-content">
          <div className="brand-logo-placeholder">
            <img src={logo} alt="" width={32} height={32} />
            <span>N-Deutschprüfungen</span>
          </div>
          <div className="brand-text">
            <h2>Vérification email</h2>
            <p>Confirmez votre adresse pour sécuriser votre compte et recevoir les emails importants.</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <Link className="auth-back-home" to="/login">← Retour connexion</Link>
          <div className="form-header">
            <h1>{token ? "Confirmation du compte" : "Vérifiez votre email"}</h1>
            <p>
              {token
                ? "Nous validons votre lien de confirmation."
                : "Entrez le code à 6 chiffres reçu par email."}
            </p>
          </div>

          {message ? (
            <div className={status === "error" ? "error-banner" : "success-banner"} role="status">
              {message}
            </div>
          ) : null}

          {devLink ? (
            <p className="dev-link-note">
              Dev link: <a href={devLink}>{devLink}</a>
            </p>
          ) : null}

          {!token && status !== "success" ? (
            <form className="auth-form" onSubmit={verifyCode}>
              <div className="form-group">
                <label htmlFor="verify-email">Email</label>
                <input
                  id="verify-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="vous@exemple.com"
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="verify-code">Code de vérification</label>
                <input
                  ref={codeInputRef}
                  id="verify-code"
                  className="code-input-hidden"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(normalizeCode(event.target.value))}
                  aria-label="Code de vérification à 6 chiffres"
                />
                <div className="code-box-row" aria-hidden="true" onClick={() => codeInputRef.current?.focus()}>
                  {codeDigits.map((digit, index) => (
                    <span key={index} className={digit ? "filled" : ""}>{digit}</span>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn-submit" disabled={status === "loading"}>
                {status === "loading" ? <div className="spinner" /> : "Vérifier le code"}
              </button>
              <button
                type="button"
                className="btn-secondary-auth"
                onClick={resend}
                disabled={!email || cooldown > 0 || status === "loading"}
              >
                {cooldown > 0 ? `Renvoyer dans ${cooldown}s` : "Renvoyer le code"}
              </button>
            </form>
          ) : null}

          {status === "success" ? (
            <p className="form-footer">
              <Link to="/login">Se connecter</Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
