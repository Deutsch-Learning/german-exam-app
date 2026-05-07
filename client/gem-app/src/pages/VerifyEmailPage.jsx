import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import "./LoginPage.css";

export default function VerifyEmailPage() {
  const { token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [status, setStatus] = useState(token ? "loading" : "idle");
  const [message, setMessage] = useState(location.state?.message ?? "");
  const [devLink, setDevLink] = useState(location.state?.devVerificationUrl ?? "");

  useEffect(() => {
    if (!token) return;
    let active = true;

    API.get(`/verify-email/${token}`)
      .then((res) => {
        if (!active) return;
        setStatus(res.data?.ok ? "success" : "error");
        setMessage(res.data?.ok ? "Email confirmé. Vous pouvez maintenant vous connecter." : "Lien invalide ou expiré.");
      })
      .catch((err) => {
        if (!active) return;
        setStatus("error");
        setMessage(err.response?.data?.error ?? "Lien invalide ou expiré.");
      });

    return () => {
      active = false;
    };
  }, [token]);

  const resend = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    setDevLink("");
    try {
      const res = await API.post("/resend-verification", { email });
      setStatus("success");
      setMessage(res.data?.message ?? "Si une vérification est nécessaire, un email a été envoyé.");
      setDevLink(res.data?.devVerificationUrl ?? "");
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.error ?? "Impossible d'envoyer l'email de confirmation.");
    }
  };

  return (
    <div className="login-layout">
      <div className="login-brand-panel">
        <div className="brand-content">
          <div className="brand-logo-placeholder">
            <img src={logo} alt="" width={32} height={32} />
            <span>Deutsch Learning</span>
          </div>
          <div className="brand-text">
            <h2>Vérification email</h2>
            <p>Votre compte devient utilisable après confirmation de votre adresse email.</p>
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
                : "Ouvrez le lien reçu par email ou demandez un nouvel envoi."}
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

          {!token ? (
            <form className="auth-form" onSubmit={resend}>
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
              <button type="submit" className="btn-submit" disabled={status === "loading"}>
                {status === "loading" ? <div className="spinner" /> : "Renvoyer l'email"}
              </button>
            </form>
          ) : null}

          {status === "success" && token ? (
            <p className="form-footer">
              <Link to="/login">Se connecter</Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
