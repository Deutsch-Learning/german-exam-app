import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import "./LoginPage.css";
import BackButton from "../components/BackButton";

export default function ResetPasswordPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const resetToken = token || searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setStatus("error");
      setMessage("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Les mots de passe ne correspondent pas.");
      return;
    }

    setStatus("loading");
    if (!resetToken) {
      setStatus("error");
      setMessage("Lien de réinitialisation manquant ou invalide.");
      return;
    }

    try {
      const res = await API.post("/api/auth/reset-password", { token: resetToken, password });
      setStatus("success");
      setMessage(res.data?.message ?? "Mot de passe mis à jour.");
    } catch (err) {
      setStatus("error");
      setMessage(err.response?.data?.error ?? "Lien invalide ou expiré.");
    }
  };

  return (
    <div className="login-layout">
      <div className="login-brand-panel">
        <div className="brand-content">
          <div className="brand-logo-placeholder">
            <img src={logo} alt="" width={32} height={32} />
            <span>Deutsch Prüfungen</span>
          </div>
          <div className="brand-text">
            <h2>Nouveau mot de passe</h2>
            <p>Le lien est temporaire et ne peut être utilisé qu'une seule fois.</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <BackButton fallback="/login" label="Retour connexion" className="auth-back-home" />
          <div className="form-header">
            <h1>Réinitialiser le mot de passe</h1>
            <p>Choisissez un nouveau mot de passe sécurisé.</p>
          </div>

          {message ? (
            <div className={status === "error" ? "error-banner" : "success-banner"} role="status">
              {message}
            </div>
          ) : null}

          {status === "success" ? (
            <p className="form-footer">
              <Link to="/login">Se connecter</Link>
            </p>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="form-group">
                <label htmlFor="new-password">Nouveau mot de passe</label>
                <input
                  id="new-password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirm-new-password">Confirmer le mot de passe</label>
                <input
                  id="confirm-new-password"
                  name="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" className="btn-submit" disabled={status === "loading"}>
                {status === "loading" ? <div className="spinner" /> : "Mettre à jour"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
