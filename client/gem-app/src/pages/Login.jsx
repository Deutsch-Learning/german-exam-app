import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./LoginPage.css";
import logo from "../assets/images/logo.png";
import API from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { storeAuthSession } from "../utils/access";

export default function LoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    if (errors[name])
      setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.email) {
      newErrors.email = "L'email est requis.";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = "Entrez une adresse email valide.";
    }
    if (!formData.password) {
      newErrors.password = "Le mot de passe est requis.";
    } else if (formData.password.length < 8) {
      newErrors.password = "Au minimum 8 caractères.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      const res = await API.post("/login", {
        email: formData.email,
        password: formData.password,
        rememberMe: formData.rememberMe,
      });
      if (res.data?.ok) {
        storeAuthSession(
          {
            user: res.data.user,
            token: res.data.accessToken ?? res.data.token,
            expiresIn: res.data.expiresIn,
          },
          formData.rememberMe
        );
        navigate(res.data.redirectTo ?? (res.data.user?.role === "admin" ? "/admin/dashboard" : "/dashboard"), { replace: true });
        return;
      }
      setErrors({ submit: res.data?.error ?? "Identifiants incorrects. Réessayez." });
    } catch (err) {
      const apiError = err.response?.data;
      if (apiError?.requiresEmailVerification) {
        navigate(`/verify-email?email=${encodeURIComponent(formData.email)}`, {
          state: {
            message:
              apiError?.error ??
              "Votre email n'est pas encore vérifié. Vérifiez votre boîte mail ou renvoyez un lien.",
          },
        });
        return;
      }
      setErrors({ submit: apiError?.error ?? "Identifiants incorrects. Réessayez." });
    } finally {
      setIsLoading(false);
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
            <h2>{t.auth.loginBrandTitle}</h2>
            <p>{t.auth.loginBrandText}</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <Link className="auth-back-home" to="/">
            ← {t.auth.backHome}
          </Link>

          <div className="form-header">
            <h1>{t.auth.loginTitle}</h1>
            <p>{t.auth.loginIntro}</p>
          </div>

          <div className="social-login">
            <button type="button" className="btn-social">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </button>
            <button type="button" className="btn-social">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub
            </button>
          </div>

          <div className="divider">
            <span>{t.auth.emailLogin}</span>
          </div>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {errors.submit && (
              <div className="error-banner" role="alert">
                {errors.submit}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">{t.auth.email}</label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="vous@exemple.com"
                autoComplete="email"
                aria-invalid={!!errors.email}
                className={errors.email ? "input-error" : ""}
              />
              {errors.email && (
                <span className="error-text">{errors.email}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="password">{t.auth.password}</label>
              <div className="password-input-wrapper">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  className={errors.password ? "input-error" : ""}
                />
                <button
                  type="button"
                  className="btn-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"
                  }
                >
                  {showPassword ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {errors.password && (
                <span className="error-text">{errors.password}</span>
              )}
            </div>

            <div className="form-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleChange}
                />
                <span className="checkbox-custom" />
                {t.auth.remember}
              </label>
              <Link to="/forgot-password" className="link-forgot">
                {t.auth.forgot}
              </Link>
            </div>

            <button type="submit" className="btn-submit" disabled={isLoading}>
              {isLoading ? <div className="spinner" /> : t.auth.loginCta}
            </button>
          </form>

          <p className="form-footer">
            {t.auth.noAccount}
            <Link to="/register">{t.auth.signupHere}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
