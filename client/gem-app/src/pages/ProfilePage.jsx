/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Award, BarChart3, BookOpenCheck, CalendarClock, Clock3, Flame, History, MailCheck, ShieldCheck, Sparkles, Target, Trophy } from "lucide-react";
import API from "../services/api";
import { fetchDashboardData } from "../services/dashboard";
import styles from "./ProfilePage.module.css";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";
import { getAuthUser, updateStoredUser } from "../utils/access";
import { readSimulationHistory } from "../utils/simulationHistory";

const formatMinutes = (seconds) => {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const formatDate = (value) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "-";
  }
};

export default function ProfilePage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [verificationNotice, setVerificationNotice] = useState("");
  const [resendingVerification, setResendingVerification] = useState(false);
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [localHistory, setLocalHistory] = useState([]);
  const [formData, setFormData] = useState({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    dateOfBirth: "",
    marketingEmailsEnabled: false,
  });

  const auth = useMemo(() => getAuthUser(), []);

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
      const [res, dashboardPayload] = await Promise.all([
        API.get("/api/user/profile"),
        fetchDashboardData().catch(() => null),
      ]);
      if (!res.data?.ok) {
        setError(res.data?.error ?? "Impossible de charger le profil.");
        setUser(null);
        return;
      }
      setUser(res.data.user);
      if (dashboardPayload?.ok) setDashboard(dashboardPayload);
      setLocalHistory(readSimulationHistory());
      setFormData({
        username: res.data.user.username ?? "",
        firstName: res.data.user.first_name ?? "",
        lastName: res.data.user.last_name ?? "",
        email: res.data.user.email ?? "",
        dateOfBirth: res.data.user.date_of_birth ? String(res.data.user.date_of_birth).slice(0, 10) : "",
        marketingEmailsEnabled: Boolean(res.data.user.marketing_emails_enabled),
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
    const { name, value, type, checked } = event.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
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
      const res = await API.put("/api/user/profile", {
        username: formData.username,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        dateOfBirth: formData.dateOfBirth,
        marketingEmailsEnabled: formData.marketingEmailsEnabled,
      });
      if (!res.data?.ok) {
        setError(res.data?.error ?? "Impossible de sauvegarder.");
        return;
      }
      setUser(res.data.user);
      updateStoredUser(res.data.user);
      setSuccess(
        res.data.requiresEmailVerification
          ? "Profil mis à jour. Confirmez votre nouvelle adresse email avant votre prochaine connexion."
          : t.profilePage.saved
      );
    } catch {
      setError("Impossible de sauvegarder le profil.");
    } finally {
      setSaving(false);
    }
  };

  const resendVerificationEmail = async () => {
    if (!user?.email || user?.email_verified) return;
    setVerificationNotice("");
    setError("");
    setResendingVerification(true);
    try {
      const res = await API.post("/api/auth/resend-verification", { email: user.email });
      setVerificationNotice(
        res.data?.message ?? "Un nouvel email de verification a ete envoye."
      );
    } catch (err) {
      setError(
        err.response?.data?.error ??
          "Impossible d'envoyer un nouvel email de verification."
      );
    } finally {
      setResendingVerification(false);
    }
  };

  const profileStats = useMemo(() => {
    const simulations = dashboard?.simulations ?? [];
    const progress = dashboard?.progress ?? {};
    const completedLocal = localHistory.filter((item) => item.completed).length;
    const testsCompleted = Number(progress.totalTests) || simulations.length || completedLocal;
    const avgScore = Number(progress.avgScore) || 0;
    const totalSeconds = simulations.reduce((sum, item) => sum + (Number(item.duration_seconds) || 0), 0);
    const inProgress = localHistory.filter((item) => !item.completed).length;
    return {
      testsCompleted,
      avgScore,
      currentLevel: progress.currentLevel ?? "Not specified",
      targetLevel: progress.targetLevel ?? null,
      progressPercent: Number(progress.percent ?? progress.percentage ?? 0),
      totalTime: formatMinutes(totalSeconds),
      inProgress,
      savedSeries: localHistory.length,
    };
  }, [dashboard, localHistory]);

  const recentActivity = useMemo(() => {
    const server = (dashboard?.simulations ?? []).map((item) => ({
      id: `server-${item.id}`,
      title: item.exam_name,
      meta: `${item.score_pct ?? 0}% score`,
      date: item.created_at ?? item.taken_at,
    }));
    const local = localHistory.slice(0, 4).map((item) => ({
      id: `local-${item.id}`,
      title: item.title,
      meta: `${item.progressPercent ?? 0}% completed`,
      date: item.lastAccessedAt,
    }));
    return [...server, ...local]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [dashboard, localHistory]);

  const achievements = useMemo(() => [
    { label: "First simulation", active: profileStats.testsCompleted > 0, icon: Trophy },
    { label: "Consistent learner", active: profileStats.savedSeries >= 3, icon: Flame },
    { label: "Score builder", active: profileStats.avgScore >= 70, icon: Award },
    { label: "Profile secured", active: Boolean(user?.email_verified), icon: ShieldCheck },
  ], [profileStats.avgScore, profileStats.savedSeries, profileStats.testsCompleted, user?.email_verified]);

  const skillRows = useMemo(() => {
    const skills = dashboard?.skills ?? {};
    return [
      ["Reading", skills.read ?? profileStats.progressPercent],
      ["Listening", skills.listen ?? 0],
      ["Writing", skills.write ?? 0],
      ["Speaking", skills.speak ?? 0],
    ];
  }, [dashboard?.skills, profileStats.progressPercent]);

  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <BackButton fallback="/dashboard" label={t.common.back} />

      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}
      {loading ? (
        <div className={styles.skeletonGrid}>
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {!loading && user ? (
        <>
        <section className={styles.heroCard}>
          <div>
            <p className={styles.eyebrow}>Personal learning space</p>
            <h1>Bonjour {fullName}</h1>
            <p className={styles.heroText}>
              Track your exam readiness, saved series, activity, and account settings from one polished profile.
            </p>
          </div>
          <div className={styles.levelBadge}>
            <Sparkles size={20} />
            <span>Current level</span>
            <strong>{profileStats.currentLevel}</strong>
          </div>
        </section>

        <section className={styles.statsGrid} aria-label="User statistics">
          {[
            ["Tests completed", profileStats.testsCompleted, Trophy],
            ["Average score", `${profileStats.avgScore}%`, BarChart3],
            ["Progression", `${profileStats.progressPercent}%`, Target],
            ["Time spent", profileStats.totalTime, Clock3],
          ].map(([label, value, Icon]) => (
            <article className={styles.statCard} key={label}>
              <Icon size={20} />
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <div className={styles.layout}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Account</p>
                <h2>Profile details</h2>
              </div>
              {user.email_verified ? <span className={styles.verifiedBadge}><MailCheck size={15} /> Verified</span> : null}
            </div>
            <div className={styles.profileFacts}>
              <p><strong>{t.profilePage.fullName}</strong><span>{fullName}</span></p>
              <p><strong>Email</strong><span>{user.email}</span></p>
              <p><strong>{t.profilePage.birthDate}</strong><span>{user.date_of_birth ? new Date(user.date_of_birth).toLocaleDateString("fr-FR") : "-"}</span></p>
              <p><strong>{t.profilePage.createdAt}</strong><span>{formatDate(user.created_at)}</span></p>
            </div>
            {!user.email_verified ? (
              <div className={styles.verificationWarning}>
                <p className={styles.verificationTitle}>
                  Email not verified
                </p>
                <p className={styles.verificationText}>
                  Verifiez votre adresse email pour securiser votre compte et
                  recuperer l'acces plus facilement.
                </p>
                <button
                  type="button"
                  onClick={resendVerificationEmail}
                  disabled={resendingVerification}
                  className={styles.verifyBtn}
                >
                  {resendingVerification
                    ? "Envoi..."
                    : "Renvoyer l'email de verification"}
                </button>
                {verificationNotice ? (
                  <p className={styles.verificationNotice}>
                    {verificationNotice}
                  </p>
                ) : null}
                <Link className={styles.verifyLink} to={`/verify-email?email=${encodeURIComponent(user.email)}`}>
                  Entrer le code de vérification
                </Link>
              </div>
            ) : null}
          </section>

          <form onSubmit={save} className={styles.form}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Settings</p>
                <h2>Edit profile</h2>
              </div>
            </div>
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
            <label className={styles.checkboxRow}>
              <input
                name="marketingEmailsEnabled"
                type="checkbox"
                checked={formData.marketingEmailsEnabled}
                onChange={handleChange}
              />
              <span>
                Recevoir les nouveautés, offres et conseils de préparation par email.
                <small>Les emails de sécurité restent envoyés séparément.</small>
              </span>
            </label>
            <button type="submit" disabled={saving} className={styles.submitBtn}>
              {saving ? t.profilePage.saving : t.profilePage.saveChanges}
            </button>
          </form>
        </div>

        <div className={styles.insightGrid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Performance</p>
                <h2>Skill analytics</h2>
              </div>
              <Target size={22} />
            </div>
            <div className={styles.skillList}>
              {skillRows.map(([label, value]) => (
                <div className={styles.skillRow} key={label}>
                  <span>{label}</span>
                  <div><i style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} /></div>
                  <strong>{Math.round(Number(value) || 0)}%</strong>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Saved work</p>
                <h2>Series and activity</h2>
              </div>
              <History size={22} />
            </div>
            <div className={styles.activityList}>
              {recentActivity.length ? recentActivity.map((item) => (
                <article key={item.id}>
                  <BookOpenCheck size={18} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.meta} · {formatDate(item.date)}</span>
                  </div>
                </article>
              )) : <p className={styles.emptyState}>No activity yet. Start a simulation to build your profile history.</p>}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.eyebrow}>Achievements</p>
                <h2>Badges</h2>
              </div>
              <Award size={22} />
            </div>
            <div className={styles.badgeGrid}>
              {achievements.map(({ label, active, icon: Icon }) => (
                <span key={label} className={active ? styles.badgeActive : ""}>
                  <Icon size={17} />
                  {label}
                </span>
              ))}
            </div>
            <div className={styles.learningMeta}>
              <CalendarClock size={18} />
              <span>{profileStats.inProgress} in-progress module{profileStats.inProgress > 1 ? "s" : ""} · {profileStats.savedSeries} saved series</span>
            </div>
          </section>
        </div>
        </>
      ) : null}
      </div>
    </div>
  );
}
