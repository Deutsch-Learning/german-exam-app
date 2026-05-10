/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./DashboardPage.module.css";
import API from "../services/api";

import logo from "../assets/images/logo.png";
import userIcon from "../assets/images/icon-profile.png";
import { languageOptions } from "../utils/language";
import { useLanguage } from "../context/LanguageContext";
import { clearAuthSession, getAuthUser, isAdmin } from "../utils/access";

const formatDateTimeFr = (iso) => {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const MenuIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" />
  </svg>
);
const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconSimulations = ({ color }) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);
const IconProgress = ({ color }) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconProfile = ({ color }) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
    <circle cx="18" cy="18" r="2" fill={color} stroke="none" />
  </svg>
);
const IconLogout = ({ color }) => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const LanguageDropdown = ({ language, setLanguage }) => {
  const [open, setOpen] = useState(false);
  const selected = languageOptions.find((o) => o.id === language) ?? languageOptions[0];

  return (
    <div className={styles.dropdown}>
      <button className={styles.langBtn} type="button" onClick={() => setOpen((v) => !v)}>
        {selected.flag ? <img src={selected.flag} alt={selected.label} /> : <span className={styles.flagFallback}>🌐</span>}
        <span>{selected.id.toUpperCase()}</span>
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className={styles.dropdownMenu}>
          {languageOptions.map((opt) => (
            <button key={opt.id} type="button" className={styles.dropdownItem} onClick={() => { setLanguage(opt.id); setOpen(false); }}>
              {opt.flag ? <img src={opt.flag} alt="" className={styles.flagIconMenu} /> : null}
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const TopNav = ({ onToggleMenu, onGoHome, onGoDashboard, onGoProfile, onGoActualites, onGoAbout, onGoContact, onGoModule, onGoLessons, onSwitchAdmin, isAdminUser, language, setLanguage, labels }) => {
  const [openFormation, setOpenFormation] = useState(false);

  return (
    <nav className={styles.topNav}>
      <div className={styles.navLeft}>
        <button className={styles.mobileMenuBtn} onClick={onToggleMenu} type="button"><MenuIcon /></button>
        <img src={logo} alt="Deutsch Lernen" className={styles.logo} />
      </div>
      <div className={styles.navLinks}>
        <button type="button" className={styles.linkBtn} onClick={onGoHome}>{labels.home}</button>
        <button type="button" className={styles.linkBtn} onClick={onGoDashboard}>{labels.dashboard}</button>
        <button type="button" className={styles.linkBtn} onClick={onGoActualites}>{labels.news} <ChevronDownIcon /></button>
        <button type="button" className={styles.linkBtn} onClick={onGoAbout}>{labels.about} <ChevronDownIcon /></button>
        <div className={styles.dropdown}>
          <button type="button" className={`${styles.linkBtn} ${styles.withDropdown}`} onClick={() => setOpenFormation((v) => !v)}>{labels.training} <ChevronDownIcon /></button>
          {openFormation ? (
            <div className={styles.dropdownMenu}>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("listen")}>{labels.modules.listen}</button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("read")}>{labels.modules.read}</button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("speak")}>{labels.modules.speak}</button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("write")}>{labels.modules.write}</button>
            </div>
          ) : null}
        </div>
        <button type="button" className={styles.linkBtn} onClick={onGoLessons}>{labels.pages} <ChevronDownIcon /></button>
        <button type="button" className={styles.linkBtn} onClick={onGoContact}>{labels.contact}</button>
      </div>
      <div className={styles.navRight}>
        {isAdminUser ? (
          <button type="button" className={styles.switchButton} onClick={onSwitchAdmin}>
            Switch to Admin
          </button>
        ) : null}
        <LanguageDropdown language={language} setLanguage={setLanguage} />
        <button className={styles.profileBtn} onClick={onGoProfile} type="button"><img src={userIcon} alt="Profile" /></button>
      </div>
    </nav>
  );
};

const Sidebar = ({ isOpen, onClose, onGoProfile, onGoSimulations, onGoProgress, onLogout, labels }) => {
  const menuItems = [
    { id: "simulations", label: "Simulations", icon: IconSimulations, activeColor: "#dc2626", isActive: true, onClick: onGoSimulations },
    { id: "progres", label: labels.progress, icon: IconProgress, activeColor: "#facc15", isActive: false, onClick: onGoProgress },
    { id: "profil", label: labels.profile, icon: IconProfile, activeColor: "#3b82f6", isActive: false, onClick: onGoProfile },
  ];
  return (
    <>
      {isOpen && <div className={styles.sidebarOverlay} onClick={onClose} />}
      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`}>
        <ul className={styles.sidebarMenu}>
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id} className={`${styles.menuItem} ${item.isActive ? styles.active : ""}`} onClick={item.onClick}>
                <Icon color={item.isActive ? item.activeColor : "#4b5563"} />
                <span>{item.label}</span>
              </li>
            );
          })}
        </ul>
        <div className={styles.sidebarBottom}><div className={styles.menuItem} onClick={onLogout}><IconLogout color="#111827" /><span>{labels.logout}</span></div></div>
      </aside>
    </>
  );
};

const ProgressCard = ({ progress, labels }) => {
  const percent = progress?.percent ?? 0;
  const level = progress?.currentLevel ?? "B2";
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{labels.certificationProgress}</h3>
      <div className={styles.chartContainer}>
        <svg viewBox="0 0 36 36" className={styles.donutChart}>
          <path className={styles.donutBg} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          <path className={styles.donutProgress} strokeDasharray={`${percent}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          <text x="18" y="20.35" className={styles.donutText}>{percent}%</text>
        </svg>
      </div>
      <div className={styles.legendContainer}>
        <div className={styles.legendItem}><div className={styles.legendBox} style={{ backgroundColor: "#facc15" }} /><span>{labels.currentLevel} {level}</span></div>
        <div className={styles.legendItem}><div className={styles.legendBox} style={{ backgroundColor: "#e5e7eb" }} /><span>{labels.target}</span></div>
      </div>
    </div>
  );
};

const RecommendationsCard = ({ recommendations, labels }) => (
  <div className={styles.card}>
    <h3 className={styles.cardTitle}>{labels.recommendations}</h3>
    <div className={styles.recommendationsList}>
      {(recommendations?.length ? recommendations : ["Améliorer l'expression Ecrite"]).slice(0, 3).map((rec, index) => (
        <div key={index} className={styles.recommendationItem}><div className={styles.redPill} /><p>{rec}</p></div>
      ))}
    </div>
  </div>
);

const skillsOrder = [
  { key: "read", label: "Compréhension Écrite" },
  { key: "listen", label: "Compréhension Orale" },
  { key: "write", label: "Expression Écrite" },
  { key: "speak", label: "Expression Orale" },
  { key: "grammar", label: "Grammaire" },
  { key: "vocabulary", label: "Vocabulaire" },
];

const labelPosition = (idx, radius = 112, center = 120) => {
  const angle = (-90 + idx * (360 / skillsOrder.length)) * (Math.PI / 180);
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  };
};

const buildRadarPoints = (scores, radius = 96, center = 120) =>
  skillsOrder
    .map((skill, idx) => {
      const angle = (-90 + idx * (360 / skillsOrder.length)) * (Math.PI / 180);
      const ratio = Math.max(0, Math.min(100, Number(scores?.[skill.key] ?? 50))) / 100;
      const x = center + radius * ratio * Math.cos(angle);
      const y = center + radius * ratio * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(" ");

const buildHexRings = (radius, center = 120) =>
  skillsOrder
    .map((_, idx) => {
      const angle = (-90 + idx * (360 / skillsOrder.length)) * (Math.PI / 180);
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(" ");

const SkillsCard = ({ scores, labels, moduleLabels }) => (
  <div className={`${styles.card} ${styles.skillsCard}`}>
    <h3 className={styles.cardTitle}>{labels.skillsBalance}</h3>
    <div className={styles.hexMapContainer}>
      <svg viewBox="0 0 240 240" className={styles.hexMap} role="img" aria-label="Carte de maîtrise des compétences">
        <polygon points={buildHexRings(96)} className={styles.hexRingOuter} />
        <polygon points={buildHexRings(64)} className={styles.hexRingMiddle} />
        <polygon points={buildHexRings(32)} className={styles.hexRingInner} />
        {skillsOrder.map((_, idx) => {
          const angle = (-90 + idx * (360 / skillsOrder.length)) * (Math.PI / 180);
          const x = 120 + 96 * Math.cos(angle);
          const y = 120 + 96 * Math.sin(angle);
          return <line key={idx} x1="120" y1="120" x2={x} y2={y} className={styles.hexAxis} />;
        })}
        <polygon points={buildRadarPoints(scores)} className={styles.hexSkillArea} />
        {skillsOrder.map((skill, idx) => {
          const p = labelPosition(idx);
          return (
            <text key={skill.key} x={p.x} y={p.y} className={styles.hexLabel}>
            {moduleLabels?.[skill.key] ?? skill.label}
            </text>
          );
        })}
      </svg>
      <div className={styles.hexLegend}>
        <span>Zone proche du bord = mieux maîtrisé</span>
        <span>Zone proche du centre = à renforcer</span>
      </div>
    </div>
  </div>
);

const RecentSimulationsCard = ({ simulations, labels, onResume, onMore }) => (
  <div className={styles.card}>
    <div className={styles.cardTitleRow}>
      <h3 className={styles.cardTitle}>{labels.recent}</h3>
      <button type="button" className={styles.moreButton} onClick={onMore}>More</button>
    </div>
    <div className={styles.simulationList}>
      {simulations?.length ? simulations.slice(0, 3).map((sim) => (
        <div key={sim.id} className={`${styles.simCardInner} ${styles.resumeCard}`}>
          <button type="button" className={styles.resumeCardButton} onClick={() => onResume(sim)}>
            <div className={styles.simCardHeader}><h4>{sim.title ?? sim.exam_name}</h4><ChevronRightIcon /></div>
            <p className={styles.simDate}>{sim.moduleType}</p>
            <div className={styles.resumeProgressTrack}><span style={{ width: `${sim.progressPercent ?? sim.score_pct ?? 0}%` }} /></div>
          </button>
          <div className={styles.simCardBody}>
            <div>
              <p className={styles.simDate}>Dernier acces : {formatDateTimeFr(sim.lastAccessedAt ?? sim.taken_at)}</p>
              <p className={styles.simScore}>{sim.progressPercent ?? sim.score_pct ?? 0}% completed</p>
            </div>
            <button className={styles.btnDetails} onClick={() => onResume(sim)}>Resume</button>
          </div>
        </div>
      )) : <p className={styles.simDate}>{labels.none}</p>}
    </div>
  </div>
);

export default function DashboardMainPage() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const auth = useMemo(() => getAuthUser(), []);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!auth?.id) { setError("Utilisateur non connecté."); setData(null); return; }
      const res = await API.get("/dashboard");
      if (!res.data?.ok) { setError(res.data?.error ?? "Impossible de charger le dashboard."); setData(null); return; }
      setData(res.data);
    } catch {
      setError("Impossible de joindre le backend.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [auth?.id]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const displayName = useMemo(() => {
    const first = data?.user?.first_name ?? "";
    const last = data?.user?.last_name ?? "";
    const full = `${first} ${last}`.trim();
    return full || data?.user?.username || "Utilisateur";
  }, [data]);

  const dashboardSimulations = useMemo(() => {
    return (data?.simulations ?? []).map((simulation) => ({
      ...simulation,
      id: `server-${simulation.id}`,
      title: simulation.exam_name,
      moduleType: "Résultat enregistré",
      progressPercent: simulation.score_pct,
      lastAccessedAt: simulation.created_at ?? simulation.taken_at,
      route: "/simulations",
    }));
  }, [data?.simulations]);

  const onLogout = useCallback(async () => {
    try {
      await API.post("/api/auth/logout");
    } catch {
      // Local cleanup still needs to happen if the token is already expired.
    }
    clearAuthSession();
    navigate("/login");
  }, [navigate]);

  const labels = useMemo(() => {
    const common = t.common;
    return {
      home: common.home,
      news: common.news,
      about: common.about,
      training: common.training,
      pages: common.pages,
      contact: common.contact,
      profile: common.profile,
      progress: common.progress,
      dashboard: common.dashboard,
      logout: common.logout,
      modules: t.modules,
    };
  }, [t]);

  return (
    <div className={styles.appWrapper}>
      <TopNav
        onToggleMenu={() => setSidebarOpen(true)}
        onGoHome={() => navigate("/")}
        onGoDashboard={() => navigate("/dashboard?view=user")}
        onGoProfile={() => navigate("/profile")}
        onGoActualites={() => navigate("/actualites")}
        onGoAbout={() => navigate("/about")}
        onGoContact={() => navigate("/contact")}
        onGoModule={(moduleId) => navigate(`/simulation/${moduleId}`)}
        onGoLessons={() => navigate("/lessons")}
        onSwitchAdmin={() => navigate("/admin/dashboard")}
        isAdminUser={isAdmin()}
        language={language}
        setLanguage={setLanguage}
        labels={labels}
      />

      <div className={styles.mainLayout}>
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onGoProfile={() => navigate("/profile")}
          onGoSimulations={() => navigate("/simulations")}
          onGoProgress={() => navigate("/progress")}
          onLogout={onLogout}
          labels={labels}
        />

        <main className={styles.contentArea}>
          <header className={styles.pageHeader}>
            <h1>{t.dashboard.welcome} {loading ? "..." : displayName}</h1>
            {error ? <p className={styles.errorText}>{error}</p> : null}
          </header>
          <div className={styles.dashboardGrid}>
            <div className={styles.colLeft}>
              <ProgressCard progress={data?.progress} labels={t.dashboard} />
              <RecommendationsCard recommendations={data?.recommendations ?? []} labels={t.dashboard} />
            </div>
            <div className={styles.colCenter}><SkillsCard scores={data?.skills} labels={t.dashboard} moduleLabels={t.modules} /></div>
            <div className={styles.colRight}>
              <RecentSimulationsCard
                simulations={dashboardSimulations}
                labels={t.dashboard}
                onResume={(simulation) => navigate(simulation.route)}
                onMore={() => navigate("/recent-simulations")}
              />
            </div>
          </div>
        </main>
      </div>

      <button className={styles.floatingCta} onClick={() => navigate("/simulations")}>{t.dashboard.newSimulation}</button>
    </div>
  );
}
