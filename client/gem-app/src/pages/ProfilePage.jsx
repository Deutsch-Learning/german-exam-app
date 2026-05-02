/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../services/api";
import styles from "./ProfilePage.module.css";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";

export default function ProfilePage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    dateOfBirth: "",
  });

  const auth = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("auth") ?? "null");
    } catch {
      return null;
    }
  }, []);

  const fullName = useMemo(() => {
    const first = user?.first_name ?? "";
    const last = user?.last_name ?? "";
    const joined = `${first} ${last}`.trim();
    return joined || "Utilisateur";
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!auth?.id) {
        setError("Utilisateur non connecté.");
        setUser(null);
        return;
      }
      const res = await API.get("/me", { headers: { "x-user-id": String(auth.id) } });
      if (!res.data?.ok) {
        setError(res.data?.error ?? "Impossible de charger le profil.");
        setUser(null);
        return;
      }
      setUser(res.data.user);
      setFormData({
        username: res.data.user.username ?? "",
        firstName: res.data.user.first_name ?? "",
        lastName: res.data.user.last_name ?? "",
        email: res.data.user.email ?? "",
        dateOfBirth: res.data.user.date_of_birth ? String(res.data.user.date_of_birth).slice(0, 10) : "",
      });
    } catch {
      setError("Impossible de joindre le serveur.");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [auth?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      if (!auth?.id) {
        setError("Utilisateur non connecté.");
        return;
      }
      const res = await API.put(
        "/me",
        {
          username: formData.username,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          dateOfBirth: formData.dateOfBirth,
        },
        { headers: { "x-user-id": String(auth.id) } }
      );
      if (!res.data?.ok) {
        setError(res.data?.error ?? "Impossible de sauvegarder.");
        return;
      }
      setUser(res.data.user);
      localStorage.setItem("auth", JSON.stringify(res.data.user));
      setSuccess(t.profilePage.saved);
    } catch {
      setError("Impossible de sauvegarder le profil.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <BackButton fallback="/dashboard" label={t.common.back} />
      <h1 className={styles.title}>{t.common.profile}</h1>

      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}
      {loading ? <p className={styles.loading}>{t.common.loading}</p> : null}

      {!loading && user ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <p>
              <strong>{t.profilePage.fullName}</strong>: {fullName}
            </p>
            <p>
              <strong>Email</strong>: {user.email}
            </p>
            <p>
              <strong>{t.profilePage.birthDate}</strong>:{" "}
              {user.date_of_birth ? new Date(user.date_of_birth).toLocaleDateString("fr-FR") : "-"}
            </p>
            <p>
              <strong>{t.profilePage.createdAt}</strong>: {new Date(user.created_at).toLocaleString("fr-FR")}
            </p>
          </div>

          <form onSubmit={save} className={styles.form}>
            <label className={styles.label}>
              {t.profilePage.username}
              <input name="username" value={formData.username} onChange={handleChange} className={styles.input} />
            </label>
            <label className={styles.label}>
              {t.profilePage.firstName}
              <input name="firstName" value={formData.firstName} onChange={handleChange} className={styles.input} />
            </label>
            <label className={styles.label}>
              {t.profilePage.lastName}
              <input name="lastName" value={formData.lastName} onChange={handleChange} className={styles.input} />
            </label>
            <label className={styles.label}>
              Email
              <input name="email" type="email" value={formData.email} onChange={handleChange} className={styles.input} />
            </label>
            <label className={styles.label}>
              {t.profilePage.birthDate}
              <input name="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={handleChange} className={styles.input} />
            </label>
            <button type="submit" disabled={saving} className={styles.submitBtn}>
              {saving ? t.profilePage.saving : t.profilePage.saveChanges}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
