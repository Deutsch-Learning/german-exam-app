import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./LoginPage.css";
import logo from "../assets/images/logo.png";
import API from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import { storeAuthSession } from "../utils/access";
import BackButton from "../components/BackButton";
import GoogleAuthButton from "../components/GoogleAuthButton";

export default function LoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const googleLabel = t.auth.googleContinue || "Continue with Google";
  const intendedPath = typeof location.state?.from === "string" ? location.state.from : "";

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    if (errors[name])
      setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleGoogleSuccess = (data) => {
    if (!data?.ok || !data.user || !(data.accessToken || data.token)) {
      setErrors({ submit: "Google authentication failed. Please try again." });
      return;
    }
    storeAuthSession(
      {
        user: data.user,
        token: data.accessToken ?? data.token,
        expiresIn: data.expiresIn,
      },
      true
    );
    navigate(intendedPath || data.redirectTo || (data.user?.role === "admin" ? "/admin/dashboard" : "/dashboard"), { replace: true });
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
      const res = await API.post("/api/auth/login", {
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
      setErrors({ submit: err.response?.data?.error ?? "Identifiants incorrects. Réessayez." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-brand-panel">
        <div className="brand-content">
          <Link className="brand-logo-placeholder" to="/">
            <img src={logo} alt="" width={32} height={32} />
            <span>Deutsch Prüfungen</span>
          </Link>
          <div className="brand-text">
            <h2>{t.auth.loginBrandTitle}</h2>
            <p>{t.auth.loginBrandText}</p>
          </div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="form-container">
          <BackButton fallback="/" label={t.auth.backHome} className="auth-back-home" />

          <div className="form-header">
            <h1>{t.auth.loginTitle}</h1>
            <p>{t.auth.loginIntro}</p>
          </div>

          <div className="social-login">
            <GoogleAuthButton
              label={googleLabel}
              onSuccess={handleGoogleSuccess}
              onError={(message) => setErrors((previous) => ({ ...previous, submit: message }))}
            />
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
