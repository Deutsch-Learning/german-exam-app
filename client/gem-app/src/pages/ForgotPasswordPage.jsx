import { useState } from "react";
import { Link } from "react-router-dom";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import "./LoginPage.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    setDevLink("");
    try {
      const res = await API.post("/forgot-password", { email });
      setStatus("success");
      setMessage(res.data?.message ?? "Si cet email existe, un lien de réinitialisation a été envoyé.");
      setDevLink(res.data?.devResetUrl ?? "");
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.error ?? "Impossible de créer le lien de réinitialisation.");
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
            <h2>Réinitialisation sécurisée</h2>
            <p>Recevez un lien temporaire pour choisir un nouveau mot de passe.</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <Link className="auth-back-home" to="/login">← Retour connexion</Link>
          <div className="form-header">
            <h1>Mot de passe oublié</h1>
            <p>Entrez l'adresse email associée à votre compte.</p>
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

          <form className="auth-form" onSubmit={submit}>
            <div className="form-group">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="vous@exemple.com"
                autoComplete="email"
              />
            </div>
            <button type="submit" className="btn-submit" disabled={status === "loading"}>
              {status === "loading" ? <div className="spinner" /> : "Envoyer le lien"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
