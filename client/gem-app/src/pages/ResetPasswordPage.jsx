import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import "./LoginPage.css";

export default function ResetPasswordPage() {
  const { token } = useParams();
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
    try {
      const res = await API.post("/reset-password", { token, password });
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
            <span>Deutsch Learning</span>
          </div>
          <div className="brand-text">
            <h2>Nouveau mot de passe</h2>
            <p>Le lien est temporaire et ne peut être utilisé qu'une seule fois.</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <Link className="auth-back-home" to="/login">← Retour connexion</Link>
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
