/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  BookOpen,
  Bold,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  Eye,
  FileJson,
  FileText,
  Headphones,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  LogOut,
  MessageSquareText,
  Palette,
  Plus,
  Redo2,
  Search,
  Shield,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  Users,
  Volume2,
} from "lucide-react";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import styles from "./AdminPanel.module.css";
import examStyles from "./SimulationModulePage.module.css";
import { clearDashboardCache } from "../services/dashboard";
import { clearAuthSession } from "../utils/access";
import { examSimulations } from "../data/siteContent";
import { clearImportedExamCache, fetchImportedSeries } from "../services/importedExams";
import { hasRichTextMarkup, richTextToPlainText, sanitizeRichTextHtml } from "../utils/richText";
import { stripQuestionMaterial } from "../utils/examText";
import {
  DEFAULT_STYLE_OPTIONS,
  STYLE_PROPERTY_OPTIONS,
  STYLE_SCOPE_OPTIONS,
  describeStyleTemplate,
  extractContentStyleTemplate,
  getStyleBlockTypeLabel,
} from "../utils/contentStyle";

const formatDate = (value) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("fr-FR");
  } catch {
    return "-";
  }
};

const useAdminData = (loader) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (err) {
      setError(err.response?.data?.error ?? "Impossible de charger les données admin.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
};

const LEVEL_OPTIONS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MODULE_OPTIONS = [
  { id: "read", label: "Lesen", icon: BookOpen },
  { id: "listen", label: "Hören", icon: Headphones },
  { id: "write", label: "Schreiben", icon: FileText },
  { id: "speak", label: "Sprechen", icon: Volume2 },
];
const EXAM_BODY_OPTIONS = ["goethe", "ösd", "osd", "telc", "ecl", "testdaf", "dsh", "custom"];
const QUESTION_TYPE_OPTIONS = [
  "multiple_choice",
  "true_false",
  "yes_no",
  "matching",
  "fill_blank",
  "short_answer",
  "prompt",
  "compound",
];

const MODULE_LABELS = MODULE_OPTIONS.reduce((acc, item) => ({ ...acc, [item.id]: item.label }), {});
const RICH_FONT_FAMILIES = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Tahoma",
  "Courier New",
];
const RICH_FONT_SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "4" },
  { label: "Title", value: "5" },
];
const RICH_COLORS = ["#111827", "#c10016", "#2563eb", "#047857", "#92400e", "#7c3aed"];

const getModuleLabel = (value) => MODULE_LABELS[String(value ?? "").toLowerCase()] ?? value ?? "-";

const formatJson = (value, fallback) => {
  try {
    return JSON.stringify(value ?? fallback, null, 2);
  } catch {
    return JSON.stringify(fallback, null, 2);
  }
};

const parseJsonField = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
};

const normalizeDateLabel = (value) => (value ? formatDate(value) : "-");

const getExamBody = (exam) =>
  String(exam?.provider || exam?.exam_type || "custom").trim().toLowerCase();

const asPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const getExamWebsiteInstructions = (exam) => {
  if (!exam) return "";
  if (Object.prototype.hasOwnProperty.call(exam, "websiteInstructions")) {
    return exam.websiteInstructions ?? "";
  }
  return asPlainObject(exam.metadata).instructions ?? "";
};

const getSectionWebsiteInstructions = (section, sectionQuestions = []) => {
  const instructions = section?.instructions ?? "";
  if (!instructions || hasRichTextMarkup(instructions)) return instructions;
  return stripQuestionMaterial(instructions, sectionQuestions);
};

const makeExamDraft = (exam) => {
  const metadata = asPlainObject(exam?.metadata);
  return {
    code: exam?.code ?? "",
    name: exam?.name ?? "",
    examType: exam?.exam_type ?? "",
    provider: exam?.provider ?? "",
    level: exam?.level ?? "",
    sectionType: exam?.section_type ?? "",
    seriesNumber: exam?.series_number ?? "",
    isActive: Boolean(exam?.is_active),
    websiteInstructions: metadata.instructions ?? "",
    metadata: formatJson(metadata, {}),
  };
};

const makeSectionDraft = (section, exam, sectionQuestions = []) => ({
  id: section?.id ?? "",
  sectionType: section?.section_type ?? exam?.section_type ?? "read",
  partNumber: section?.part_number ?? 1,
  title: section?.title ?? "",
  instructions: getSectionWebsiteInstructions(section, sectionQuestions),
  durationMinutes: section?.duration_minutes ?? "",
  points: section?.points ?? "",
  position: section?.position ?? "",
  scoring: formatJson(section?.scoring, {}),
  metadata: formatJson(section?.metadata, {}),
});

const makeQuestionDraft = (question, exam, section) => ({
  id: question?.id ?? "",
  sectionId: question?.section_id ?? section?.id ?? "",
  moduleId: question?.module_id ?? section?.section_type ?? exam?.section_type ?? "read",
  questionType: question?.question_type ?? "prompt",
  prompt: question?.prompt ?? "",
  options: formatJson(question?.options, []),
  correctAnswer: formatJson(question?.correct_answer, {}),
  explanation: question?.explanation ?? "",
  transcript: question?.transcript ?? "",
  audio: formatJson(question?.audio, {}),
  scoring: formatJson(question?.scoring, {}),
  sourceMetadata: formatJson(question?.source_metadata, {}),
  position: question?.position ?? "",
});

const clipPreview = (value, max = 180) => {
  const text = richTextToPlainText(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const cleanRichTextValue = (value) => sanitizeRichTextHtml(value);
const cleanTitleValue = (value) => (hasRichTextMarkup(value) ? sanitizeRichTextHtml(value) : String(value ?? "").trim());

const getPlainDisplayText = (value, fallback = "") => {
  const text = richTextToPlainText(value);
  return text || fallback;
};

const makeStyleBlockId = (blockType, ids = {}) =>
  `${blockType}:${ids.questionId ?? ids.sectionId ?? ids.examId ?? ""}`;

const makeStyleSourceBlock = (blockType, ids = {}) => ({
  blockType,
  blockId: makeStyleBlockId(blockType, ids),
  examId: ids.examId ?? null,
  sectionId: ids.sectionId ?? null,
  questionId: ids.questionId ?? null,
});

const getExamStyleLabel = (exam) =>
  [getExamBody(exam).toUpperCase(), exam?.level, exam?.series_number ? `Series ${exam.series_number}` : null, getModuleLabel(exam?.section_type)]
    .filter(Boolean)
    .join(" / ");

const getSectionPlainTitle = (section) => getPlainDisplayText(section?.title, "Anweisungen");

const getQuestionOptionText = (question) =>
  (Array.isArray(question?.options) ? question.options : [])
    .map((option, index) => `${option?.value ?? String.fromCharCode(97 + index)}) ${option?.label ?? option?.text ?? option?.title ?? ""}`.trim())
    .filter(Boolean)
    .join("\n");

const buildAdminStyleBlocks = (exams = [], sections = [], questions = []) => {
  const examMap = new Map(exams.map((exam) => [exam.id, exam]));
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const blocks = [];

  exams.forEach((exam) => {
    blocks.push({
      ...makeStyleSourceBlock("exam_intro", { examId: exam.id }),
      label: `${getExamStyleLabel(exam)} - Website intro`,
      context: getExamStyleLabel(exam),
    });
  });

  sections.forEach((section) => {
    const exam = examMap.get(section.exam_id);
    const context = `${getExamStyleLabel(exam)} - Teil ${section.part_number ?? section.position ?? section.id}`;
    blocks.push({
      ...makeStyleSourceBlock("section_title", { examId: section.exam_id, sectionId: section.id }),
      label: `${context} title`,
      context,
    });
    blocks.push({
      ...makeStyleSourceBlock("section_instructions", { examId: section.exam_id, sectionId: section.id }),
      label: `${context} instructions`,
      context,
    });
  });

  questions.forEach((question) => {
    const exam = examMap.get(question.exam_id);
    const section = question.section_id ? sectionMap.get(question.section_id) : null;
    const sectionLabel = section ? `Teil ${section.part_number ?? section.position ?? section.id}: ${getSectionPlainTitle(section)}` : "Unassigned";
    const context = `${getExamStyleLabel(exam)} - ${sectionLabel} - Task ${question.position ?? question.id}`;
    blocks.push({
      ...makeStyleSourceBlock("question_prompt", { examId: question.exam_id, sectionId: question.section_id, questionId: question.id }),
      label: `${context} prompt`,
      context,
    });
    if (question.explanation) {
      blocks.push({
        ...makeStyleSourceBlock("question_explanation", { examId: question.exam_id, sectionId: question.section_id, questionId: question.id }),
        label: `${context} explanation`,
        context,
      });
    }
    if (question.transcript) {
      blocks.push({
        ...makeStyleSourceBlock("question_transcript", { examId: question.exam_id, sectionId: question.section_id, questionId: question.id }),
        label: `${context} transcript`,
        context,
      });
    }
    if (getQuestionOptionText(question)) {
      blocks.push({
        ...makeStyleSourceBlock("answer_options", { examId: question.exam_id, sectionId: question.section_id, questionId: question.id }),
        label: `${context} answer options`,
        context,
      });
    }
  });

  return blocks;
};

const classifyAdminPreviewLine = (line, index = 0, total = 1) => {
  const text = String(line ?? "").trim();
  if (!text) return "body";
  if (/^(achtung|warning|warnung|important|wichtig|note|notiz|hinweis|remarque|attention)\b\s*:?\s*/i.test(text)) return "notice";
  if (/lesen sie zuerst die anweisungen/i.test(text)) return "introInstruction";
  if (/^(teil|part|section|abschnitt)\s*\d+\s*(\||-|:)/i.test(text)) return "sectionTitle";
  if (/^(anweisung|instructions?|directions?|aufgabe|consigne)\b/i.test(text)) return "instruction";
  if (/^(lisez|lesen sie|hoeren sie|horen sie|schreiben sie|waehlen sie|wahlen sie|kreuzen sie|ordnen sie|markieren sie|completez|choisissez|associez|ecoutez)\b/i.test(text)) return "body";
  if (/^(teil|part|section|abschnitt)\s*\d+\b/i.test(text)) return "sectionTitle";
  if (/^(quelle|source|text|texte|transkript|transcript|situation|scenario|szenario)\b\s*:?\s*/i.test(text)) return "subtitle";
  if (/^[A-Z][\p{L}\p{N}\s'().,:-]{2,72}:$/u.test(text)) return "subtitle";
  if (total > 1 && index === 0 && text.length <= 90 && !/[.!?]$/.test(text)) return "sectionTitle";
  if (text.length <= 56 && !/[.!?]$/.test(text)) return "subtitle";
  return "body";
};

function AdminShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const links = [
    { to: "/admin/dashboard", label: "Dashboard", icon: BarChart3 },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/exams", label: "Exams", icon: FileJson },
    { to: "/admin/api-usage", label: "API usage", icon: Activity },
    { to: "/admin/exports", label: "Exports", icon: Download },
  ];

  const logout = async () => {
    try {
      await API.post("/api/auth/logout");
    } catch {
      // Local cleanup still needs to happen if the token is already expired.
    }
    clearAuthSession();
    clearDashboardCache();
    navigate("/", { replace: true });
  };

  return (
    <div className={styles.adminPage}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <img src={logo} alt="" />
            <span>Admin</span>
          </div>
          <button
            type="button"
            className={styles.switchButton}
            onClick={() => navigate("/dashboard?view=user")}
          >
            Switch to User
          </button>
          <button
            type="button"
            className={styles.logoutButton}
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut size={18} />
            Logout
          </button>
          <nav className={styles.nav} aria-label="Admin navigation">
            {links.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={location.pathname === item.to ? styles.active : ""}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className={styles.main}>{children}</main>
      </div>
      {confirmLogout ? (
        <div className={styles.modalOverlay} role="presentation">
          <div className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="admin-logout-title">
            <p className={styles.modalEyebrow}>Admin session</p>
            <h2 id="admin-logout-title">Confirm logout</h2>
            <p>Do you want to close the admin session and return to the public site?</p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setConfirmLogout(false)}>
                Cancel
              </button>
              <button type="button" className={styles.dangerButton} onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminDashboard() {
  const loader = useCallback(async () => {
    const res = await API.get("/api/admin/analytics");
    return res.data.analytics;
  }, []);
  const { data, loading, error } = useAdminData(loader);
  const stats = [
    ["Total users", data?.total_users ?? 0],
    ["Active users", data?.active_users ?? 0],
    ["Verified users", data?.verified_users ?? 0],
    ["Exam attempts", data?.total_simulations ?? 0],
    ["Average score", `${data?.avg_score ?? 0}%`],
    ["Attempts 7d", data?.simulations_7d ?? 0],
  ];

  return (
    <>
      <Header title="Analytics Dashboard" subtitle="Internal overview of users, exam usage, and recent admin actions." />
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p>Loading...</p> : null}
      <section className={styles.statGrid}>
        {stats.map(([label, value]) => (
          <article className={styles.statCard} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <div className={styles.split}>
        <section className={styles.panel}>
          <h2>Exam usage stats</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Exam</th><th>Attempts</th><th>Avg</th></tr>
              </thead>
              <tbody>
                {(data?.exam_usage ?? []).map((item) => (
                  <tr key={item.exam_name}>
                    <td>{item.exam_name}</td>
                    <td>{item.attempts}</td>
                    <td>{item.avg_score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={styles.panel}>
          <h2>Recent audit logs</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Action</th><th>Admin</th><th>Date</th></tr>
              </thead>
              <tbody>
                {(data?.recent_audit ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.action}</td>
                    <td>{item.admin_email ?? "-"}</td>
                    <td>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function AdminUsers() {
  const loader = useCallback(async () => {
    const res = await API.get("/api/admin/users");
    return res.data.users;
  }, []);
  const { data: users, loading, error, reload } = useAdminData(loader);
  const [status, setStatus] = useState("");

  const updateUser = async (user, payload) => {
    setStatus("");
    await API.patch(`/api/admin/users/${user.id}/status`, payload);
    setStatus(`${user.email} mis à jour.`);
    await reload();
  };

  return (
    <>
      <Header title="User Management" subtitle="View users, suspend or activate accounts, and grant full or partial series access." />
      {status ? <p className={styles.status}>{status}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p>Loading...</p> : null}
      <section className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th><th>Role</th><th>Status</th><th>Verified</th><th>Access</th><th>Usage</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.email}</strong><br />
                    <span>{user.username ?? "-"} · Joined {formatDate(user.created_at)}</span>
                  </td>
                  <td><span className={styles.badge}>{user.role}</span></td>
                  <td>
                    <span className={`${styles.badge} ${user.status === "suspended" ? styles.danger : ""}`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{user.email_verified ? "Yes" : "No"}</td>
                  <td>
                    {user.has_full_access ? (
                      <span className={styles.badge}>Full</span>
                    ) : Array.isArray(user.partial_access) && user.partial_access.length ? (
                      <div className={styles.accessSummary}>
                        <span className={`${styles.badge} ${styles.warn}`}>Partial</span>
                        <small>
                          {user.partial_access.map((grant) =>
                            `${grant.examName || grant.examId} / ${grant.seriesCode || grant.seriesId}`
                          ).join(", ")}
                        </small>
                      </div>
                    ) : (
                      <span className={styles.badge}>Free</span>
                    )}
                  </td>
                  <td>{user.simulation_count} tests · {user.avg_score}% avg</td>
                  <td>
                    <div className={styles.actions}>
                      {user.status === "suspended" ? (
                        <button className={styles.button} type="button" onClick={() => updateUser(user, { status: "active" })}>
                          Activate
                        </button>
                      ) : (
                        <button className={styles.dangerButton} type="button" onClick={() => updateUser(user, { status: "suspended" })}>
                          Suspend
                        </button>
                      )}
                      <UserAccessControl user={user} onUpdate={updateUser} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function UserAccessControl({ user, onUpdate }) {
  const partialAccess = useMemo(
    () => (Array.isArray(user.partial_access) ? user.partial_access : []),
    [user.partial_access]
  );
  const partialAccessKey = useMemo(() => JSON.stringify(partialAccess), [partialAccess]);
  const initialMode = user.has_full_access ? "full" : partialAccess.length ? "partial" : "free";
  const [mode, setMode] = useState(initialMode);
  const [selectedExamIds, setSelectedExamIds] = useState(() =>
    [...new Set(partialAccess.map((grant) => grant.examId).filter(Boolean))]
  );
  const [selectedSeriesByExam, setSelectedSeriesByExam] = useState(() =>
    partialAccess.reduce((acc, grant) => {
      if (!grant.examId || !grant.seriesId) return acc;
      acc[grant.examId] = [...new Set([...(acc[grant.examId] ?? []), grant.seriesId])];
      return acc;
    }, {})
  );
  const [seriesByExam, setSeriesByExam] = useState({});
  const [loadingByExam, setLoadingByExam] = useState({});
  const requestedSeriesRef = useRef(new Set());

  useEffect(() => {
    setMode(user.has_full_access ? "full" : partialAccess.length ? "partial" : "free");
    setSelectedExamIds([...new Set(partialAccess.map((grant) => grant.examId).filter(Boolean))]);
    setSelectedSeriesByExam(
      partialAccess.reduce((acc, grant) => {
        if (!grant.examId || !grant.seriesId) return acc;
        acc[grant.examId] = [...new Set([...(acc[grant.examId] ?? []), grant.seriesId])];
        return acc;
      }, {})
    );
  }, [partialAccess, partialAccessKey, user.has_full_access]);

  useEffect(() => {
    if (mode !== "partial" || !selectedExamIds.length) return undefined;

    selectedExamIds.forEach((examId) => {
      if (!examId || seriesByExam[examId] || requestedSeriesRef.current.has(examId)) return;

      requestedSeriesRef.current.add(examId);
      setLoadingByExam((current) => ({ ...current, [examId]: true }));
      fetchImportedSeries(examId)
        .then((items) => {
          setSeriesByExam((current) => ({ ...current, [examId]: items }));
          setSelectedSeriesByExam((current) => {
            const validIds = new Set(items.map((item) => item.id));
            const nextIds = (current[examId] ?? []).filter((seriesId) => validIds.has(seriesId));
            return { ...current, [examId]: nextIds };
          });
        })
        .catch(() => {
          setSeriesByExam((current) => ({ ...current, [examId]: [] }));
        })
        .finally(() => {
          setLoadingByExam((current) => ({ ...current, [examId]: false }));
          requestedSeriesRef.current.delete(examId);
        });
    });
    return undefined;
  }, [mode, selectedExamIds, seriesByExam]);

  const totalSelectedSeries = selectedExamIds.reduce(
    (sum, examId) => sum + (selectedSeriesByExam[examId]?.length ?? 0),
    0
  );
  const canValidatePartial = mode !== "partial" || (selectedExamIds.length > 0 && totalSelectedSeries > 0);

  const toggleExam = (examId) => {
    setSelectedExamIds((current) => {
      if (current.includes(examId)) return current.filter((id) => id !== examId);
      return [...current, examId];
    });
    setSelectedSeriesByExam((current) => ({ ...current, [examId]: current[examId] ?? [] }));
  };

  const toggleSeries = (examId, seriesId) => {
    setSelectedSeriesByExam((current) => {
      const currentIds = current[examId] ?? [];
      const nextIds = currentIds.includes(seriesId)
        ? currentIds.filter((id) => id !== seriesId)
        : [...currentIds, seriesId];
      return { ...current, [examId]: nextIds };
    });
  };

  const validateAccess = () => {
    if (mode === "full") {
      onUpdate(user, { hasFullAccess: true, partialAccess: [] });
      return;
    }

    if (mode === "free") {
      onUpdate(user, { hasFullAccess: false, partialAccess: [] });
      return;
    }

    onUpdate(user, {
      hasFullAccess: false,
      partialAccess: selectedExamIds.flatMap((examId) => {
        const exam = examSimulations.find((item) => item.id === examId);
        const seriesList = seriesByExam[examId] ?? [];
        return (selectedSeriesByExam[examId] ?? []).map((seriesId) => {
          const series = seriesList.find((item) => item.id === seriesId);
          return {
            examId,
            seriesId,
            examName: exam?.name ?? examId,
            seriesCode: series?.code ?? seriesId,
            grantedAt: new Date().toISOString(),
          };
        });
      }),
    });
  };

  return (
    <div className={styles.accessControl}>
      <label>
        Access
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="free">Free access</option>
          <option value="partial">Partial access</option>
          <option value="full">Full access</option>
        </select>
      </label>

      {mode === "partial" ? (
        <div className={styles.partialAccessFields}>
          <div className={styles.multiAccessGroup}>
            <p>Tests</p>
            <div className={styles.multiAccessList}>
              {examSimulations.map((exam) => (
                <label key={exam.id} className={styles.checkOption}>
                  <input
                    type="checkbox"
                    checked={selectedExamIds.includes(exam.id)}
                    onChange={() => toggleExam(exam.id)}
                  />
                  <span>{exam.name}</span>
                </label>
              ))}
            </div>
          </div>

          {selectedExamIds.map((examId) => {
            const exam = examSimulations.find((item) => item.id === examId);
            const series = seriesByExam[examId] ?? [];
            const loadingSeries = Boolean(loadingByExam[examId]);
            return (
              <div key={examId} className={styles.multiAccessGroup}>
                <p>{exam?.name ?? examId} series</p>
                {loadingSeries ? <span className={styles.accessHint}>Loading series...</span> : null}
                {!loadingSeries && !series.length ? <span className={styles.accessHint}>No series available</span> : null}
                {!loadingSeries && series.length ? (
                  <div className={styles.multiAccessList}>
                    {series.map((item) => (
                      <label key={item.id} className={styles.checkOption}>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedSeriesByExam[examId]?.includes(item.id))}
                          onChange={() => toggleSeries(examId, item.id)}
                        />
                        <span>{item.code}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <button
        className={styles.button}
        type="button"
        onClick={validateAccess}
        disabled={!canValidatePartial}
      >
        Validate
      </button>
    </div>
  );
}

function AdminApiUsage() {
  const loader = useCallback(async () => {
    const res = await API.get("/api/admin/api-usage");
    return res.data;
  }, []);
  const { data, loading, error } = useAdminData(loader);

  return (
    <>
      <Header title="API Usage Monitoring" subtitle="Track API calls per user, including AI-labelled consumption units." />
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p>Loading...</p> : null}
      <section className={styles.statGrid}>
        <article className={styles.statCard}>
          <span>AI requests</span>
          <strong>{data?.summary?.ai_requests ?? 0}</strong>
        </article>
        <article className={styles.statCard}>
          <span>Token usage</span>
          <strong>{data?.summary?.token_usage ?? 0}</strong>
        </article>
        <article className={styles.statCard}>
          <span>Calls 24h</span>
          <strong>{data?.summary?.calls_24h ?? 0}</strong>
        </article>
        <article className={styles.statCard}>
          <span>Estimated cost</span>
          <strong>${data?.summary?.estimated_cost ?? 0}</strong>
        </article>
      </section>
      <section className={styles.panel}>
        <h2>Consumption by user</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>User</th><th>Total calls</th><th>AI calls</th><th>AI units</th><th>Last call</th></tr>
            </thead>
            <tbody>
              {(data?.usage ?? []).map((item) => (
                <tr key={item.user_id}>
                  <td>{item.email ?? item.username ?? "-"}</td>
                  <td>{item.total_calls}</td>
                  <td>{item.ai_calls}</td>
                  <td>{item.ai_units}</td>
                  <td>{formatDate(item.last_call_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Recent API calls</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>User</th><th>Method</th><th>Path</th><th>Status</th><th>Feature</th><th>AI</th><th>Date</th></tr>
            </thead>
            <tbody>
              {(data?.recent ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.email ?? "-"}</td>
                  <td>{item.method}</td>
                  <td>{item.path}</td>
                  <td>{item.status_code}</td>
                  <td>{item.feature}</td>
                  <td>{item.is_ai_usage ? item.units : "-"}</td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AdminExams() {
  const loader = useCallback(async () => {
    const [contentRes, styleRes] = await Promise.all([
      API.get("/api/admin/exams"),
      API.get("/api/admin/style-templates"),
    ]);
    return { ...contentRes.data, styleTemplates: styleRes.data.templates ?? [] };
  }, []);
  const { data, loading, error, reload } = useAdminData(loader);
  const [form, setForm] = useState({ code: "", name: "", examType: "custom", level: "B2" });
  const [generateForm, setGenerateForm] = useState({ type: "testdaf", serie: "serie-1", level: "B2", moduleCategory: "reading", quantity: 4 });
  const [jsonPayload, setJsonPayload] = useState("");
  const [documentFile, setDocumentFile] = useState(null);
  const [documentBusy, setDocumentBusy] = useState("");
  const [documentAnalysis, setDocumentAnalysis] = useState(null);
  const [documentError, setDocumentError] = useState("");
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    provider: "all",
    level: "all",
    status: "all",
    module: "all",
    sortBy: "order",
    sortDir: "asc",
  });
  const [selectedExamId, setSelectedExamId] = useState("");
  const [examDraft, setExamDraft] = useState(null);
  const [sectionDraft, setSectionDraft] = useState(null);
  const [questionDraft, setQuestionDraft] = useState(null);
  const [stylePanel, setStylePanel] = useState(null);
  const [stylePreview, setStylePreview] = useState(null);
  const [styleBusy, setStyleBusy] = useState("");

  const exams = useMemo(() => data?.exams ?? [], [data?.exams]);
  const sections = useMemo(() => data?.sections ?? [], [data?.sections]);
  const questions = useMemo(() => data?.questions ?? [], [data?.questions]);
  const imports = useMemo(() => data?.imports ?? [], [data?.imports]);
  const styleTemplates = useMemo(() => data?.styleTemplates ?? [], [data?.styleTemplates]);
  const styleBlocks = useMemo(() => buildAdminStyleBlocks(exams, sections, questions), [exams, sections, questions]);

  const sectionsByExam = useMemo(() => {
    const map = new Map();
    sections.forEach((section) => {
      map.set(section.exam_id, [...(map.get(section.exam_id) ?? []), section]);
    });
    return map;
  }, [sections]);

  const questionsBySection = useMemo(() => {
    const map = new Map();
    questions.forEach((question) => {
      if (!question.section_id) return;
      map.set(question.section_id, [...(map.get(question.section_id) ?? []), question]);
    });
    return map;
  }, [questions]);

  const orphanQuestionsByExam = useMemo(() => {
    const map = new Map();
    questions.forEach((question) => {
      if (question.section_id) return;
      map.set(question.exam_id, [...(map.get(question.exam_id) ?? []), question]);
    });
    return map;
  }, [questions]);

  const visibleExams = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const levelRank = (level) => {
      const index = LEVEL_OPTIONS.indexOf(String(level ?? "").toUpperCase());
      return index === -1 ? 999 : index;
    };
    const moduleRank = (moduleId) => {
      const index = MODULE_OPTIONS.findIndex((item) => item.id === String(moduleId ?? "").toLowerCase());
      return index === -1 ? 999 : index;
    };
    const compareText = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), "fr", { numeric: true, sensitivity: "base" });
    const compareNumber = (a, b) => (Number(a) || 0) - (Number(b) || 0);
    const compareDate = (a, b) => new Date(a ?? 0).getTime() - new Date(b ?? 0).getTime();
    const filtered = exams.filter((exam) => {
      const body = getExamBody(exam);
      const text = [
        exam.name,
        exam.code,
        exam.exam_type,
        exam.provider,
        exam.level,
        exam.section_type,
        exam.series_number,
      ].join(" ").toLowerCase();
      const matchesSearch = !search || text.includes(search);
      const matchesProvider = filters.provider === "all" || body === filters.provider;
      const matchesLevel = filters.level === "all" || String(exam.level ?? "").toUpperCase() === filters.level;
      const matchesStatus = filters.status === "all" || (filters.status === "published" ? exam.is_active : !exam.is_active);
      const matchesModule = filters.module === "all" || String(exam.section_type ?? "").toLowerCase() === filters.module;
      return matchesSearch && matchesProvider && matchesLevel && matchesStatus && matchesModule;
    });
    const sorted = [...filtered].sort((a, b) => {
      let result;
      if (filters.sortBy === "name") {
        result = compareText(a.name, b.name);
      } else if (filters.sortBy === "body") {
        result = compareText(getExamBody(a), getExamBody(b)) || levelRank(a.level) - levelRank(b.level);
      } else if (filters.sortBy === "level") {
        result = levelRank(a.level) - levelRank(b.level) || compareText(getExamBody(a), getExamBody(b));
      } else if (filters.sortBy === "module") {
        result = moduleRank(a.section_type) - moduleRank(b.section_type) || compareText(a.name, b.name);
      } else if (filters.sortBy === "updated") {
        result = compareDate(a.updated_at, b.updated_at);
      } else {
        result =
          compareText(getExamBody(a), getExamBody(b)) ||
          levelRank(a.level) - levelRank(b.level) ||
          compareNumber(a.series_number, b.series_number) ||
          moduleRank(a.section_type) - moduleRank(b.section_type) ||
          compareText(a.name, b.name);
      }
      return filters.sortDir === "desc" ? -result : result;
    });
    return sorted;
  }, [exams, filters]);

  useEffect(() => {
    if (!visibleExams.length) {
      setSelectedExamId("");
      return;
    }
    if (!visibleExams.some((exam) => String(exam.id) === String(selectedExamId))) {
      setSelectedExamId(String(visibleExams[0].id));
    }
  }, [selectedExamId, visibleExams]);

  const selectedExam = useMemo(
    () => exams.find((exam) => String(exam.id) === String(selectedExamId)) ?? visibleExams[0] ?? null,
    [exams, selectedExamId, visibleExams]
  );

  const selectedSections = useMemo(
    () => (selectedExam ? sectionsByExam.get(selectedExam.id) ?? [] : []),
    [selectedExam, sectionsByExam]
  );
  const selectedOrphans = selectedExam ? orphanQuestionsByExam.get(selectedExam.id) ?? [] : [];

  useEffect(() => {
    setExamDraft(selectedExam ? makeExamDraft(selectedExam) : null);
    setSectionDraft(null);
    setQuestionDraft(null);
  }, [selectedExam]);

  const runAction = async (label, action, successMessage) => {
    setBusyAction(label);
    setStatus("");
    setDocumentError("");
    try {
      await action();
      clearImportedExamCache();
      setStatus(successMessage);
      await reload();
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? err.message ?? "Admin action failed.");
    } finally {
      setBusyAction("");
    }
  };

  const createExam = async (event) => {
    event.preventDefault();
    await runAction("create-exam", async () => {
      await API.post("/api/admin/exams", form);
      setForm({ code: "", name: "", examType: "custom", level: "B2" });
    }, "Exam created.");
  };

  const saveExam = async (event) => {
    event.preventDefault();
    if (!selectedExam || !examDraft) return;
    await runAction("save-exam", async () => {
      const metadata = parseJsonField(examDraft.metadata, "Exam metadata") ?? {};
      await API.put(`/api/admin/exams/${selectedExam.id}`, {
        ...examDraft,
        metadata: {
          ...metadata,
          instructions: cleanRichTextValue(examDraft.websiteInstructions),
        },
      });
    }, "Exam metadata saved.");
  };

  const toggleExamStatus = async () => {
    if (!selectedExam) return;
    await runAction("toggle-exam", async () => {
      await API.put(`/api/admin/exams/${selectedExam.id}`, { isActive: !selectedExam.is_active });
    }, selectedExam.is_active ? "Exam unpublished." : "Exam published.");
  };

  const duplicateExam = async () => {
    if (!selectedExam) return;
    await runAction("duplicate-exam", async () => {
      const res = await API.post(`/api/admin/exams/${selectedExam.id}/duplicate`);
      setSelectedExamId(String(res.data.exam.id));
    }, "Exam duplicated as draft.");
  };

  const saveSection = async (event) => {
    event.preventDefault();
    if (!selectedExam || !sectionDraft) return;
    await runAction("save-section", async () => {
      const payload = {
        ...sectionDraft,
        title: cleanTitleValue(sectionDraft.title),
        instructions: cleanRichTextValue(sectionDraft.instructions),
        scoring: parseJsonField(sectionDraft.scoring, "Section scoring") ?? {},
        metadata: parseJsonField(sectionDraft.metadata, "Section metadata") ?? {},
      };
      if (sectionDraft.id) {
        await API.put(`/api/admin/exams/${selectedExam.id}/sections/${sectionDraft.id}`, payload);
      } else {
        await API.post(`/api/admin/exams/${selectedExam.id}/sections`, payload);
      }
      setSectionDraft(null);
    }, sectionDraft.id ? "Section saved." : "Section created.");
  };

  const deleteSection = async (section) => {
    if (!selectedExam || !window.confirm(`Delete section "${getSectionPlainTitle(section)}"? Empty sections only can be deleted.`)) return;
    await runAction("delete-section", async () => {
      await API.delete(`/api/admin/exams/${selectedExam.id}/sections/${section.id}`);
    }, "Section deleted.");
  };

  const saveQuestion = async (event) => {
    event.preventDefault();
    if (!selectedExam || !questionDraft) return;
    await runAction("save-question", async () => {
      const payload = {
        ...questionDraft,
        prompt: cleanRichTextValue(questionDraft.prompt),
        explanation: cleanRichTextValue(questionDraft.explanation),
        transcript: cleanRichTextValue(questionDraft.transcript),
        options: parseJsonField(questionDraft.options, "Question options") ?? [],
        correctAnswer: parseJsonField(questionDraft.correctAnswer, "Correct answer") ?? {},
        audio: parseJsonField(questionDraft.audio, "Audio metadata") ?? {},
        scoring: parseJsonField(questionDraft.scoring, "Question scoring") ?? {},
        sourceMetadata: parseJsonField(questionDraft.sourceMetadata, "Source metadata") ?? {},
      };
      if (questionDraft.id) {
        await API.put(`/api/admin/exams/${selectedExam.id}/questions/${questionDraft.id}`, payload);
      } else {
        await API.post(`/api/admin/exams/${selectedExam.id}/questions`, payload);
      }
      setQuestionDraft(null);
    }, questionDraft.id ? "Question saved." : "Question created.");
  };

  const startSectionEdit = (section = null) => {
    setQuestionDraft(null);
    setSectionDraft(makeSectionDraft(section, selectedExam, section ? questionsBySection.get(section.id) ?? [] : []));
  };

  const startQuestionEdit = (question = null, section = null) => {
    setSectionDraft(null);
    setQuestionDraft(makeQuestionDraft(question, selectedExam, section));
  };

  const deleteQuestion = async (question) => {
    if (!selectedExam || !window.confirm("Delete this question? This cannot be undone.")) return;
    await runAction("delete-question", async () => {
      await API.delete(`/api/admin/exams/${selectedExam.id}/questions/${question.id}`);
    }, "Question deleted.");
  };

  const uploadJson = async () => {
    await runAction("upload-json", async () => {
      const payload = JSON.parse(jsonPayload);
      await API.post("/api/admin/exams/upload-json", { payload });
      setJsonPayload("");
    }, "JSON exam upload complete.");
  };

  const processDocument = async (mode) => {
    if (!documentFile) return;
    setDocumentBusy(mode);
    setDocumentError("");
    setStatus("");
    try {
      const formData = new FormData();
      formData.append("document", documentFile);
      const endpoint = mode === "import" ? "/api/admin/exams/import-document" : "/api/admin/exams/analyze-document";
      const res = await API.post(endpoint, formData);
      setDocumentAnalysis(res.data.analysis);
      if (mode === "import") {
        clearImportedExamCache();
        setStatus(
          res.data.duplicate
            ? "Document already imported. Existing data was kept."
            : `${res.data.exams?.length ?? 0} exam series imported from document.`
        );
        await reload();
      } else {
        setStatus("Document analyzed. Review the detected structure before importing.");
      }
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Document processing failed.");
    } finally {
      setDocumentBusy("");
    }
  };

  const generateExams = async (event) => {
    event.preventDefault();
    await runAction("generate-exams", async () => {
      await API.post("/api/admin/exams/generate", generateForm);
    }, "Generated exam content saved.");
  };

  const updateExamMetadata = (value) => {
    setExamDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, metadata: value };
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed?.instructions === "string") {
          next.websiteInstructions = parsed.instructions;
        }
      } catch {
        // Keep the rich editor stable while the JSON textarea is mid-edit.
      }
      return next;
    });
  };

  const updateExamWebsiteInstructions = (value) => {
    setExamDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, websiteInstructions: value };
      try {
        const metadata = JSON.parse(prev.metadata || "{}");
        next.metadata = formatJson({ ...asPlainObject(metadata), instructions: value }, {});
      } catch {
        // If the JSON is temporarily invalid, preserve the editor change and let save validation report the JSON issue.
      }
      return next;
    });
  };

  const openStylePanel = ({ sourceBlock, value, label }) => {
    if (!sourceBlock?.blockId || !sourceBlock.blockType) return;
    const styleJson = extractContentStyleTemplate(value, sourceBlock.blockType);
    setStylePreview(null);
    setStylePanel({
      sourceBlock,
      sourceLabel: label,
      sourceValue: value,
      styleJson,
      styleOptions: { ...DEFAULT_STYLE_OPTIONS },
      scope: "section",
      manualBlockIds: [],
      allowCrossType: false,
      selectedTemplateId: "",
      templateName: `${getStyleBlockTypeLabel(sourceBlock.blockType)} style`,
      templateDescription: "",
    });
  };

  const updateStylePanel = (updater) => {
    setStylePanel((prev) => {
      if (!prev) return prev;
      const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      return next;
    });
    setStylePreview(null);
  };

  const useStyleTemplate = (templateId) => {
    const template = styleTemplates.find((item) => String(item.id) === String(templateId));
    updateStylePanel((prev) => {
      if (!template) {
        return { ...prev, selectedTemplateId: "", styleJson: extractContentStyleTemplate(prev.sourceValue, prev.sourceBlock.blockType) };
      }
      return {
        ...prev,
        selectedTemplateId: String(template.id),
        styleJson: template.style_json,
        templateName: template.name,
        templateDescription: template.description ?? "",
      };
    });
  };

  const previewStyleApplication = async () => {
    if (!stylePanel) return;
    setStyleBusy("preview");
    setDocumentError("");
    try {
      const res = await API.post("/api/admin/style-templates/preview", {
        sourceBlock: stylePanel.sourceBlock,
        scope: stylePanel.scope,
        manualBlockIds: stylePanel.manualBlockIds,
        allowCrossType: stylePanel.allowCrossType,
        styleJson: stylePanel.styleJson,
        styleOptions: stylePanel.styleOptions,
      });
      setStylePreview(res.data);
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Style preview failed.");
    } finally {
      setStyleBusy("");
    }
  };

  const applyStyleApplication = async () => {
    if (!stylePanel || !stylePreview?.count) return;
    setStyleBusy("apply");
    setDocumentError("");
    try {
      const res = await API.post("/api/admin/style-templates/apply", {
        sourceBlock: stylePanel.sourceBlock,
        scope: stylePanel.scope,
        manualBlockIds: stylePanel.manualBlockIds,
        allowCrossType: stylePanel.allowCrossType,
        styleJson: stylePanel.styleJson,
        styleOptions: stylePanel.styleOptions,
        confirmed: true,
      });
      clearImportedExamCache();
      setStatus(`Style applied to ${res.data.count ?? 0} block(s).`);
      setStylePanel(null);
      setStylePreview(null);
      await reload();
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Style apply failed.");
    } finally {
      setStyleBusy("");
    }
  };

  const saveStyleTemplate = async () => {
    if (!stylePanel) return;
    setStyleBusy("save-template");
    setDocumentError("");
    try {
      await API.post("/api/admin/style-templates", {
        name: stylePanel.templateName,
        description: stylePanel.templateDescription,
        blockType: stylePanel.sourceBlock.blockType,
        styleJson: stylePanel.styleJson,
      });
      setStatus("Reusable style template saved.");
      await reload();
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Could not save style template.");
    } finally {
      setStyleBusy("");
    }
  };

  const archiveStyleTemplate = async () => {
    if (!stylePanel?.selectedTemplateId) return;
    setStyleBusy("archive-template");
    setDocumentError("");
    try {
      await API.delete(`/api/admin/style-templates/${stylePanel.selectedTemplateId}`);
      setStatus("Style template archived.");
      updateStylePanel((prev) => ({
        ...prev,
        selectedTemplateId: "",
        styleJson: extractContentStyleTemplate(prev.sourceValue, prev.sourceBlock.blockType),
      }));
      await reload();
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Could not archive style template.");
    } finally {
      setStyleBusy("");
    }
  };

  const undoLastStyleApply = async () => {
    setStyleBusy("undo");
    setDocumentError("");
    try {
      const res = await API.post("/api/admin/style-templates/undo-last");
      clearImportedExamCache();
      setStatus(`Last style apply undone for ${res.data.count ?? 0} block(s).`);
      setStylePanel(null);
      setStylePreview(null);
      await reload();
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "No style apply action could be undone.");
    } finally {
      setStyleBusy("");
    }
  };

  const initialLoading = loading && !data;

  return (
    <>
      <Header title="Exam Content CMS" subtitle="Manage German exam bodies, levels, series, sections, tasks, scoring, and publication state." />
      {status ? <p className={styles.status}>{status}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {documentError ? <p className={styles.error}>{documentError}</p> : null}
      {initialLoading ? (
        <AdminCmsLoading />
      ) : (
        <>

      <section className={styles.cmsHero}>
        <div className={styles.cmsHeroText}>
          <p className={styles.modalEyebrow}>Content hierarchy</p>
          <h2>Exam body - level - series - section - task</h2>
          <p>Reusable CMS layer built on the current exam, section, and question tables so learner tests continue to load from the same source of truth.</p>
        </div>
        <div className={styles.cmsStatGrid}>
          <CmsStat icon={ClipboardList} label="Exams" value={exams.length} />
          <CmsStat icon={BookOpen} label="Sections" value={sections.length} />
          <CmsStat icon={MessageSquareText} label="Tasks" value={questions.length} />
          <CmsStat icon={CheckCircle2} label="Published" value={exams.filter((exam) => exam.is_active).length} />
          <CmsStat icon={FileJson} label="Modules" value={new Set(exams.map((exam) => exam.section_type).filter(Boolean)).size} />
        </div>
      </section>

      <section className={styles.cmsToolbar}>
        <label className={`${styles.field} ${styles.searchField}`}>Search content
          <span>
            <Search size={16} />
            <input
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Goethe B1, series 2, schreiben..."
            />
          </span>
        </label>
        <div className={styles.filterRow}>
          <label className={styles.field}>Exam body
            <select value={filters.provider} onChange={(event) => setFilters((prev) => ({ ...prev, provider: event.target.value }))}>
              <option value="all">All bodies</option>
              {EXAM_BODY_OPTIONS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
          </label>
          <label className={styles.field}>Level
            <select value={filters.level} onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}>
              <option value="all">All levels</option>
              {LEVEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className={styles.field}>Module
            <select value={filters.module} onChange={(event) => setFilters((prev) => ({ ...prev, module: event.target.value }))}>
              <option value="all">All modules</option>
              {MODULE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>Status
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <label className={styles.field}>Sort by
            <select value={filters.sortBy} onChange={(event) => setFilters((prev) => ({ ...prev, sortBy: event.target.value }))}>
              <option value="order">Exam order</option>
              <option value="name">Name</option>
              <option value="body">Exam body</option>
              <option value="level">Level</option>
              <option value="module">Module</option>
              <option value="updated">Updated date</option>
            </select>
          </label>
          <label className={styles.field}>Direction
            <select value={filters.sortDir} onChange={(event) => setFilters((prev) => ({ ...prev, sortDir: event.target.value }))}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      </section>

      <div className={styles.cmsWorkspace}>
        <section className={styles.cmsLibrary}>
          <div className={styles.panelHeader}>
            <h2>Content library</h2>
            <span>{visibleExams.length} shown</span>
          </div>
          <div className={styles.examList}>
            {visibleExams.map((exam) => {
              const module = MODULE_OPTIONS.find((item) => item.id === exam.section_type);
              const Icon = module?.icon ?? FileJson;
              const isActive = String(exam.id) === String(selectedExam?.id);
              return (
                <button
                  type="button"
                  key={exam.id}
                  className={`${styles.examCard} ${isActive ? styles.examCardActive : ""}`}
                  onClick={() => setSelectedExamId(String(exam.id))}
                >
                  <span className={styles.moduleBadge}>
                    <Icon size={15} />
                    {getModuleLabel(exam.section_type)}
                  </span>
                  <strong>{exam.name}</strong>
                  <small>{exam.code}</small>
                  <span className={styles.examMeta}>
                    {getExamBody(exam).toUpperCase()} - {exam.level ?? "-"} - Series {exam.series_number ?? "-"}
                  </span>
                  <span className={styles.miniBadges}>
                    <span className={`${styles.badge} ${exam.is_active ? "" : styles.warn}`}>{exam.is_active ? "Published" : "Draft"}</span>
                    <span>{exam.section_count ?? 0} sections</span>
                    <span>{exam.question_count ?? 0} tasks</span>
                  </span>
                </button>
              );
            })}
            {!visibleExams.length ? <p className={styles.emptyState}>No exams match these filters.</p> : null}
          </div>
        </section>

        <section className={styles.cmsDetail}>
          {!selectedExam || !examDraft ? (
            <div className={styles.emptyState}>Select or create an exam to start editing content.</div>
          ) : (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <p className={styles.modalEyebrow}>Selected exam</p>
                  <h2>{selectedExam.name}</h2>
                  <p>{selectedExam.code} - updated {normalizeDateLabel(selectedExam.updated_at)}</p>
                </div>
                <div className={styles.actions}>
                  <button className={styles.secondaryButton} type="button" onClick={duplicateExam} disabled={Boolean(busyAction)}>
                    <Copy size={16} />
                    Duplicate
                  </button>
                  <button className={selectedExam.is_active ? styles.secondaryButton : styles.button} type="button" onClick={toggleExamStatus} disabled={Boolean(busyAction)}>
                    <CheckCircle2 size={16} />
                    {selectedExam.is_active ? "Unpublish" : "Publish"}
                  </button>
                </div>
              </div>

              <form className={styles.editorPanel} onSubmit={saveExam}>
                <div className={styles.panelHeader}>
                  <h3>Exam metadata</h3>
                  <span className={styles.badge}>
                    <Shield size={14} />
                    Admin API
                  </span>
                </div>
                <div className={styles.editorGrid}>
                  <label className={styles.field}>Code
                    <input value={examDraft.code} onChange={(event) => setExamDraft((prev) => ({ ...prev, code: event.target.value }))} />
                  </label>
                  <label className={styles.field}>Name
                    <input value={examDraft.name} onChange={(event) => setExamDraft((prev) => ({ ...prev, name: event.target.value }))} />
                  </label>
                  <label className={styles.field}>Exam body
                    <input list="exam-body-options" value={examDraft.provider} onChange={(event) => setExamDraft((prev) => ({ ...prev, provider: event.target.value }))} placeholder="goethe" />
                  </label>
                  <label className={styles.field}>Exam type
                    <input value={examDraft.examType} onChange={(event) => setExamDraft((prev) => ({ ...prev, examType: event.target.value }))} />
                  </label>
                  <label className={styles.field}>Level
                    <select value={examDraft.level} onChange={(event) => setExamDraft((prev) => ({ ...prev, level: event.target.value }))}>
                      <option value="">No level</option>
                      {LEVEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>Module
                    <select value={examDraft.sectionType} onChange={(event) => setExamDraft((prev) => ({ ...prev, sectionType: event.target.value }))}>
                      <option value="">No module</option>
                      {MODULE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>Series number
                    <input type="number" min="1" value={examDraft.seriesNumber} onChange={(event) => setExamDraft((prev) => ({ ...prev, seriesNumber: event.target.value }))} />
                  </label>
                  <label className={`${styles.field} ${styles.toggleField}`}>Publication
                    <span>
                      <input type="checkbox" checked={examDraft.isActive} onChange={(event) => setExamDraft((prev) => ({ ...prev, isActive: event.target.checked }))} />
                      Published in learner app
                    </span>
                  </label>
                </div>
                <RichTextEditor
                  label="Website intro instructions"
                  value={examDraft.websiteInstructions}
                  variant="instruction"
                  onChange={updateExamWebsiteInstructions}
                  onApplyStyle={(value) => openStylePanel({
                    sourceBlock: makeStyleSourceBlock("exam_intro", { examId: selectedExam.id }),
                    value,
                    label: `${getExamStyleLabel(selectedExam)} - Website intro`,
                  })}
                />
                <RichPreview label="Website intro preview" value={examDraft.websiteInstructions} variant="instruction" />
                <JsonTextarea label="Metadata JSON" value={examDraft.metadata} onChange={updateExamMetadata} />
                <div className={styles.contentActions}>
                  <button className={styles.button} type="submit" disabled={busyAction === "save-exam"}>
                    <Edit3 size={16} />
                    Save exam
                  </button>
                </div>
              </form>

              <section className={styles.editorPanel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h3>Sections and tasks</h3>
                    <p className={styles.panelHint}>Edit Lesen, Hören, Schreiben, and Sprechen content in the same hierarchy the learner app reads.</p>
                  </div>
                  <button className={styles.button} type="button" onClick={() => startSectionEdit(null)}>
                    <Plus size={16} />
                    Add section
                  </button>
                </div>

                {sectionDraft && !sectionDraft.id ? (
                  <SectionForm
                    draft={sectionDraft}
                    exam={selectedExam}
                    examIntro={getExamWebsiteInstructions(examDraft)}
                    sectionQuestions={[]}
                    onChange={setSectionDraft}
                    onSubmit={saveSection}
                    onCancel={() => setSectionDraft(null)}
                    busy={busyAction === "save-section"}
                    onApplyStyle={openStylePanel}
                  />
                ) : null}

                <div className={styles.sectionStack}>
                  {selectedSections.map((section) => {
                    const sectionQuestions = questionsBySection.get(section.id) ?? [];
                    const module = MODULE_OPTIONS.find((item) => item.id === section.section_type);
                    const Icon = module?.icon ?? FileJson;
                    const sectionIsEditing = String(sectionDraft?.id ?? "") === String(section.id);
                    return (
                      <article className={styles.sectionCard} key={section.id}>
                        <div className={styles.sectionHeader}>
                          <div>
                            <span className={styles.moduleBadge}>
                              <Icon size={15} />
                              {getModuleLabel(section.section_type)}
                            </span>
                            <h4>Teil {section.part_number}: {getSectionPlainTitle(section)}</h4>
                            <p>{section.duration_minutes ?? "-"} min - {section.points ?? "-"} points - position {section.position}</p>
                          </div>
                          <div className={styles.actions}>
                            <button className={styles.secondaryButton} type="button" onClick={() => startSectionEdit(section)}>
                              <Edit3 size={15} />
                              Edit
                            </button>
                            <button className={styles.dangerGhostButton} type="button" onClick={() => deleteSection(section)}>
                              <Trash2 size={15} />
                              Delete
                            </button>
                          </div>
                        </div>
                        {sectionIsEditing ? (
                          <SectionForm
                            draft={sectionDraft}
                            exam={selectedExam}
                            examIntro={getExamWebsiteInstructions(examDraft)}
                            sectionQuestions={sectionQuestions}
                            onChange={setSectionDraft}
                            onSubmit={saveSection}
                            onCancel={() => setSectionDraft(null)}
                            busy={busyAction === "save-section"}
                            onApplyStyle={openStylePanel}
                          />
                        ) : (
                          <SectionWebsitePreview
                            examIntro={getExamWebsiteInstructions(examDraft)}
                            section={section}
                            questions={sectionQuestions}
                          />
                        )}
                        <div className={styles.questionList}>
                          {sectionQuestions.map((question) => (
                            <div key={question.id} className={styles.questionSlot}>
                              <QuestionCard
                                question={question}
                                onEdit={() => startQuestionEdit(question, section)}
                                onDelete={() => deleteQuestion(question)}
                              />
                              {String(questionDraft?.id ?? "") === String(question.id) ? (
                                <QuestionForm
                                  draft={questionDraft}
                                  exam={selectedExam}
                                  sections={selectedSections}
                                  onChange={setQuestionDraft}
                                  onSubmit={saveQuestion}
                                  onCancel={() => setQuestionDraft(null)}
                                  busy={busyAction === "save-question"}
                                  onApplyStyle={openStylePanel}
                                />
                              ) : null}
                            </div>
                          ))}
                          {questionDraft && !questionDraft.id && String(questionDraft.sectionId) === String(section.id) ? (
                            <QuestionForm
                              draft={questionDraft}
                              exam={selectedExam}
                              sections={selectedSections}
                              onChange={setQuestionDraft}
                              onSubmit={saveQuestion}
                              onCancel={() => setQuestionDraft(null)}
                              busy={busyAction === "save-question"}
                              onApplyStyle={openStylePanel}
                            />
                          ) : null}
                          <button className={styles.secondaryButton} type="button" onClick={() => startQuestionEdit(null, section)}>
                            <Plus size={15} />
                            Add task to this section
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {selectedOrphans.length ? (
                    <article className={styles.sectionCard}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <span className={styles.moduleBadge}><FileJson size={15} /> Unassigned</span>
                          <h4>Tasks without a section</h4>
                          <p>Move these into a section when possible.</p>
                        </div>
                      </div>
                      <div className={styles.questionList}>
                        {selectedOrphans.map((question) => (
                          <div key={question.id} className={styles.questionSlot}>
                            <QuestionCard
                              question={question}
                              onEdit={() => startQuestionEdit(question, null)}
                              onDelete={() => deleteQuestion(question)}
                            />
                            {String(questionDraft?.id ?? "") === String(question.id) ? (
                                <QuestionForm
                                  draft={questionDraft}
                                  exam={selectedExam}
                                  sections={selectedSections}
                                  onChange={setQuestionDraft}
                                  onSubmit={saveQuestion}
                                  onCancel={() => setQuestionDraft(null)}
                                  busy={busyAction === "save-question"}
                                  onApplyStyle={openStylePanel}
                                />
                            ) : null}
                          </div>
                        ))}
                        {questionDraft && !questionDraft.id && !questionDraft.sectionId ? (
                            <QuestionForm
                              draft={questionDraft}
                              exam={selectedExam}
                              sections={selectedSections}
                              onChange={setQuestionDraft}
                              onSubmit={saveQuestion}
                              onCancel={() => setQuestionDraft(null)}
                              busy={busyAction === "save-question"}
                              onApplyStyle={openStylePanel}
                            />
                        ) : null}
                        <button className={styles.secondaryButton} type="button" onClick={() => startQuestionEdit(null, null)}>
                          <Plus size={15} />
                          Add unassigned task
                        </button>
                      </div>
                    </article>
                  ) : null}
                  {!selectedSections.length && !selectedOrphans.length ? (
                    <p className={styles.emptyState}>No sections yet. Add one to start building this exam module.</p>
                  ) : null}
                </div>

              </section>
            </>
          )}
        </section>
      </div>

      <datalist id="exam-body-options">
        {EXAM_BODY_OPTIONS.map((item) => <option key={item} value={item} />)}
      </datalist>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Intelligent document import</h2>
            <p className={styles.panelHint}>Upload PDF, DOCX, TXT, or image files. The parser detects provider, level, section, series, questions, scoring, and prevents duplicate imports.</p>
          </div>
          <span className={styles.badge}>
            <Upload size={14} />
            Auto parser
          </span>
        </div>
        <div className={styles.documentImportGrid}>
          <label className={styles.field}>Exam document
            <input
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
              onChange={(event) => {
                setDocumentFile(event.target.files?.[0] ?? null);
                setDocumentAnalysis(null);
                setDocumentError("");
              }}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={!documentFile || Boolean(documentBusy)}
              onClick={() => processDocument("analyze")}
            >
              {documentBusy === "analyze" ? "Analyzing..." : "Analyze only"}
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={!documentFile || Boolean(documentBusy)}
              onClick={() => processDocument("import")}
            >
              {documentBusy === "import" ? "Importing..." : "Analyze & import"}
            </button>
          </div>
        </div>
        {documentAnalysis ? (
          <div className={styles.importSummary}>
            <div className={styles.summaryGrid}>
              <span><strong>Provider</strong>{documentAnalysis.metadata?.provider ?? "-"}</span>
              <span><strong>Exam</strong>{documentAnalysis.metadata?.examType ?? "-"}</span>
              <span><strong>Level</strong>{documentAnalysis.metadata?.level ?? "-"}</span>
              <span><strong>Section</strong>{documentAnalysis.metadata?.sectionLabel ?? documentAnalysis.metadata?.sectionType ?? "-"}</span>
              <span><strong>Series</strong>{documentAnalysis.outline?.series?.length ?? 0}</span>
              <span><strong>Questions</strong>{documentAnalysis.validation?.questionCount ?? 0}</span>
            </div>
            {documentAnalysis.validation?.warnings?.length ? (
              <ul className={styles.warningList}>
                {documentAnalysis.validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
            <div className={styles.outlineList}>
              {(documentAnalysis.outline?.series ?? []).slice(0, 8).map((series) => (
                <article key={`${series.seriesNumber}-${series.title}`}>
                  <strong>{series.sourceLabel}: {series.title}</strong>
                  <span>{series.sectionCount} sections - {series.questionCount} questions</span>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className={styles.intakeGrid}>
        <section className={styles.panel}>
          <h2>Create exam shell</h2>
          <form className={styles.formGrid} onSubmit={createExam}>
            <label className={styles.field}>Code
              <input value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="goethe-b2-2026" />
            </label>
            <label className={styles.field}>Name
              <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Goethe B2 2026" />
            </label>
            <label className={styles.field}>Type
              <input value={form.examType} onChange={(e) => setForm((prev) => ({ ...prev, examType: e.target.value }))} />
            </label>
            <label className={styles.field}>Level
              <select value={form.level} onChange={(e) => setForm((prev) => ({ ...prev, level: e.target.value }))}>
                {LEVEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <button className={styles.button} type="submit" disabled={busyAction === "create-exam"}>
              <Plus size={16} />
              Create
            </button>
          </form>
        </section>

        <section className={styles.panel}>
          <h2>Upload exams via JSON</h2>
          <label className={styles.field}>JSON payload
            <textarea
              value={jsonPayload}
              onChange={(event) => setJsonPayload(event.target.value)}
              placeholder='{"exams":[{"code":"testdaf-1","name":"TestDaF Set 1","questions":[]}]}'
            />
          </label>
          <button className={styles.secondaryButton} type="button" onClick={uploadJson} disabled={!jsonPayload.trim() || busyAction === "upload-json"}>
            <Upload size={16} />
            Upload JSON
          </button>
        </section>
      </div>

      <section className={styles.panel}>
        <h2>Bulk exam generation</h2>
        <form className={styles.formGrid} onSubmit={generateExams}>
          <label className={styles.field}>Test type
            <select value={generateForm.type} onChange={(e) => setGenerateForm((prev) => ({ ...prev, type: e.target.value }))}>
              <option value="testdaf">TestDaF</option>
              <option value="dsh">DSH</option>
              <option value="goethe">Goethe</option>
              <option value="telc">telc</option>
            </select>
          </label>
          <label className={styles.field}>Serie
            <input value={generateForm.serie} onChange={(e) => setGenerateForm((prev) => ({ ...prev, serie: e.target.value }))} />
          </label>
          <label className={styles.field}>Level
            <select value={generateForm.level} onChange={(e) => setGenerateForm((prev) => ({ ...prev, level: e.target.value }))}>
              {LEVEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className={styles.field}>Module
            <select value={generateForm.moduleCategory} onChange={(e) => setGenerateForm((prev) => ({ ...prev, moduleCategory: e.target.value }))}>
              <option value="reading">Reading</option>
              <option value="listening">Listening</option>
              <option value="writing">Writing</option>
              <option value="speaking">Speaking</option>
            </select>
          </label>
          <label className={styles.field}>Quantity
            <input type="number" min="1" max="50" value={generateForm.quantity} onChange={(e) => setGenerateForm((prev) => ({ ...prev, quantity: Number(e.target.value) }))} />
          </label>
          <button className={styles.button} type="submit" disabled={busyAction === "generate-exams"}>
            <FileJson size={16} />
            Generate
          </button>
        </form>
      </section>

      {imports.length ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Recent document imports</h2>
            <span>{imports.length} latest</span>
          </div>
          <div className={styles.importHistory}>
            {imports.slice(0, 8).map((item) => (
              <article key={item.id}>
                <strong>{item.filename}</strong>
                <span>{item.provider ?? "-"} - {item.level ?? "-"} - {item.section_type ?? "-"} - {item.total_questions ?? 0} questions</span>
                <small>{normalizeDateLabel(item.created_at)}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}
        </>
      )}
      {stylePanel ? (
        <StyleTemplatePanel
          state={stylePanel}
          preview={stylePreview}
          templates={styleTemplates}
          blocks={styleBlocks}
          busy={styleBusy}
          onClose={() => {
            setStylePanel(null);
            setStylePreview(null);
          }}
          onUpdate={updateStylePanel}
          onUseTemplate={useStyleTemplate}
          onPreview={previewStyleApplication}
          onApply={applyStyleApplication}
          onSaveTemplate={saveStyleTemplate}
          onArchiveTemplate={archiveStyleTemplate}
          onUndo={undoLastStyleApply}
        />
      ) : null}
    </>
  );
}

function StyleTemplatePanel({
  state,
  preview,
  templates,
  blocks,
  busy,
  onClose,
  onUpdate,
  onUseTemplate,
  onPreview,
  onApply,
  onSaveTemplate,
  onArchiveTemplate,
  onUndo,
}) {
  const compatibleTemplates = templates.filter((template) => template.block_type === state.sourceBlock.blockType);
  const manualBlocks = blocks.filter((block) =>
    state.allowCrossType ? block.blockId !== state.sourceBlock.blockId : block.blockType === state.sourceBlock.blockType
  );
  const selectedCount = state.manualBlockIds.length;
  const blockTypeLabel = getStyleBlockTypeLabel(state.sourceBlock.blockType);
  const scopeLabel = STYLE_SCOPE_OPTIONS.find((item) => item.id === state.scope)?.label ?? state.scope;

  return (
    <div className={styles.modalOverlay} role="presentation">
      <section className={styles.styleModal} role="dialog" aria-modal="true" aria-labelledby="style-template-title">
        <div className={styles.styleModalHeader}>
          <div>
            <p className={styles.modalEyebrow}>Reusable style</p>
            <h2 id="style-template-title">Apply this style</h2>
            <p>{blockTypeLabel} - {state.sourceLabel}</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={onClose}>Close</button>
        </div>

        <div className={styles.styleModalGrid}>
          <section className={styles.stylePanelSection}>
            <h3>Source</h3>
            <div className={styles.styleSummary}>
              <span>{describeStyleTemplate(state.styleJson)}</span>
              <small>{state.styleJson?.sourcePreview || "No text preview"}</small>
            </div>
            <RichPreview label="Source appearance" value={state.sourceValue} variant="material" />
          </section>

          <section className={styles.stylePanelSection}>
            <h3>Template</h3>
            <label className={styles.field}>Saved templates
              <select value={state.selectedTemplateId} onChange={(event) => onUseTemplate(event.target.value)}>
                <option value="">Current block style</option>
                {compatibleTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <div className={styles.editorGrid}>
              <label className={styles.field}>Template name
                <input value={state.templateName} onChange={(event) => onUpdate({ templateName: event.target.value })} />
              </label>
              <label className={styles.field}>Description
                <input value={state.templateDescription} onChange={(event) => onUpdate({ templateDescription: event.target.value })} />
              </label>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondaryButton} type="button" onClick={onSaveTemplate} disabled={busy === "save-template" || !state.templateName.trim()}>
                <Plus size={15} />
                Save as template
              </button>
              <button className={styles.dangerGhostButton} type="button" onClick={onArchiveTemplate} disabled={busy === "archive-template" || !state.selectedTemplateId}>
                <Trash2 size={15} />
                Archive
              </button>
            </div>
          </section>

          <section className={styles.stylePanelSection}>
            <h3>Apply to</h3>
            <div className={styles.styleScopeGrid}>
              {STYLE_SCOPE_OPTIONS.map((scope) => (
                <label key={scope.id} className={styles.radioCard}>
                  <input
                    type="radio"
                    name="style-scope"
                    value={scope.id}
                    checked={state.scope === scope.id}
                    onChange={(event) => onUpdate({ scope: event.target.value })}
                  />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
            <label className={styles.checkLine}>
              <input
                type="checkbox"
                checked={state.allowCrossType}
                onChange={(event) => onUpdate({ allowCrossType: event.target.checked, manualBlockIds: [] })}
              />
              Manual override across block types
            </label>
            {state.scope === "manual" ? (
              <div className={styles.manualBlockList}>
                <div className={styles.panelHeader}>
                  <h3>Selected blocks</h3>
                  <span>{selectedCount}/{manualBlocks.length}</span>
                </div>
                {manualBlocks.slice(0, 160).map((block) => (
                  <label key={block.blockId} className={styles.manualBlockItem}>
                    <input
                      type="checkbox"
                      checked={state.manualBlockIds.includes(block.blockId)}
                      onChange={(event) => {
                        const nextIds = event.target.checked
                          ? [...state.manualBlockIds, block.blockId]
                          : state.manualBlockIds.filter((id) => id !== block.blockId);
                        onUpdate({ manualBlockIds: nextIds });
                      }}
                    />
                    <span>
                      <strong>{getStyleBlockTypeLabel(block.blockType)}</strong>
                      {block.label}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          <section className={styles.stylePanelSection}>
            <h3>Formatting</h3>
            <div className={styles.styleOptionsGrid}>
              {STYLE_PROPERTY_OPTIONS.map((option) => (
                <label key={option.id} className={styles.checkLine}>
                  <input
                    type="checkbox"
                    checked={Boolean(state.styleOptions[option.id])}
                    onChange={(event) => onUpdate({
                      styleOptions: {
                        ...state.styleOptions,
                        [option.id]: event.target.checked,
                      },
                    })}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </section>
        </div>

        <section className={styles.stylePreviewPanel}>
          <div className={styles.panelHeader}>
            <div>
              <h3>Preview</h3>
              <p className={styles.panelHint}>{scopeLabel}{preview ? ` - ${preview.count} block(s)` : ""}</p>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondaryButton} type="button" onClick={onUndo} disabled={busy === "undo"}>
                <Undo2 size={15} />
                Undo last style apply
              </button>
              <button className={styles.secondaryButton} type="button" onClick={onPreview} disabled={busy === "preview"}>
                <Eye size={15} />
                Preview changes
              </button>
              <button className={styles.button} type="button" onClick={onApply} disabled={busy === "apply" || !preview?.count}>
                <CheckCircle2 size={15} />
                Confirm apply
              </button>
            </div>
          </div>
          {preview?.blocks?.length ? (
            <div className={styles.stylePreviewList}>
              {preview.blocks.slice(0, 12).map((block) => (
                <article key={block.blockId} className={styles.stylePreviewItem}>
                  <strong>{block.label}</strong>
                  <div className={styles.stylePreviewCompare}>
                    <div>
                      <span>Current</span>
                      <ExamTextPreview value={block.currentValue} variant="material" />
                    </div>
                    <div>
                      <span>After</span>
                      <ExamTextPreview value={block.nextValue} variant="material" />
                    </div>
                  </div>
                </article>
              ))}
              {preview.blocks.length > 12 ? <p className={styles.panelHint}>Showing first 12 affected blocks.</p> : null}
            </div>
          ) : (
            <p className={styles.emptyState}>Preview the selected scope before applying.</p>
          )}
        </section>
      </section>
    </div>
  );
}

function CmsStat({ icon: Icon, label, value }) {
  return (
    <article className={styles.cmsStat}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminCmsLoading() {
  return (
    <div className={styles.cmsLoadingState} aria-busy="true">
      <section className={styles.cmsLoadingHero}>
        <span />
        <strong />
        <p />
      </section>
      <section className={styles.cmsLoadingToolbar}>
        <span />
        <span />
        <span />
        <span />
      </section>
      <div className={styles.cmsLoadingWorkspace}>
        <section>
          {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
        </section>
        <section>
          <span />
          <span />
          <span />
          <span />
        </section>
      </div>
    </div>
  );
}

function JsonTextarea({ label, value, onChange }) {
  return (
    <label className={`${styles.field} ${styles.jsonField}`}>{label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck="false" />
    </label>
  );
}

const getExamPreviewTextClass = (lineType) =>
  examStyles[`examText${lineType[0].toUpperCase()}${lineType.slice(1)}`] ?? examStyles.examTextBody;

const getExamPreviewWrapperClass = (variant = "material") => {
  const baseClass = variant === "instruction" ? examStyles.instructionText : examStyles.examMaterial;
  return `${baseClass} ${examStyles.readableScrollArea} ${styles.examPreviewSurface}`;
};

const getSectionDisplayTitle = (section) => {
  const number = Number(section?.part_number ?? section?.partNumber) || 1;
  const title = getPlainDisplayText(section?.title, "Anweisungen").replace(/^Teil\s+\d+\s*:?\s*/i, "").trim() || "Anweisungen";
  return `Teil ${number} - ${title}`;
};

function SectionTitlePreview({ section }) {
  const number = Number(section?.part_number ?? section?.partNumber) || 1;
  const title = section?.title ?? "";
  const plainTitle = getPlainDisplayText(title, "Anweisungen").replace(/^Teil\s+\d+\s*:?\s*/i, "").trim() || "Anweisungen";
  if (!hasRichTextMarkup(title)) {
    return <h2 translate="no">{`Teil ${number} - ${plainTitle}`}</h2>;
  }
  return (
    <h2 translate="no" className={styles.richTitleHeading}>
      <span>{`Teil ${number} - `}</span>
      <span dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(title) }} />
    </h2>
  );
}

function WebsiteTextPreview({ value, variant = "material" }) {
  if (variant === "instruction") {
    const lines = String(value ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) return <p>No content yet.</p>;

    return (
      <div className={getExamPreviewWrapperClass(variant)}>
        {lines.map((line, index) => {
          const lineType = classifyAdminPreviewLine(line, index, lines.length);
          return (
            <p key={`${line}-${index}`} className={getExamPreviewTextClass(lineType)} translate="no">
              {line}
            </p>
          );
        })}
      </div>
    );
  }

  const blocks = String(value ?? "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return <p>No content yet.</p>;

  return (
    <div className={getExamPreviewWrapperClass(variant)}>
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const listLineCount = lines.filter((line) => /^(\(?[a-j]\)|[-*]|\d+\.)\s+/i.test(line)).length;
        const looksLikeList = lines.length > 1 && listLineCount >= Math.ceil(lines.length * 0.6);
        if (looksLikeList) {
          return (
            <ul key={`${block}-${index}`}>
              {lines.map((line) => (
                <li key={line} className={examStyles.examTextBody} translate="no">
                  {line.replace(/^[-*]\s*/, "")}
                </li>
              ))}
            </ul>
          );
        }

        if (lines.length > 1) {
          return (
            <div key={`${block}-${index}`} className={examStyles.examTextGroup}>
              {lines.map((line, lineIndex) => {
                const lineType = classifyAdminPreviewLine(line, lineIndex, lines.length);
                return (
                  <p key={`${line}-${lineIndex}`} className={getExamPreviewTextClass(lineType)} translate="no">
                    {line}
                  </p>
                );
              })}
            </div>
          );
        }

        const blockType = classifyAdminPreviewLine(block, index, blocks.length);
        return (
          <p key={`${block}-${index}`} className={getExamPreviewTextClass(blockType)} translate="no">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function ExamTextPreview({ value, variant = "material" }) {
  const html = sanitizeRichTextHtml(value);
  const isRich = hasRichTextMarkup(value);
  if (isRich && html) {
    return (
      <div className={getExamPreviewWrapperClass(variant)}>
        <div className={examStyles.richExamText} translate="no" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  if (!isRich) return <WebsiteTextPreview value={value} variant={variant} />;
  return <p>No content yet.</p>;
}

function RichPreview({ label, value, variant = "material" }) {
  return (
    <div className={styles.previewBox}>
      <span className={styles.previewLabel}><Eye size={15} /> {label}</span>
      <ExamTextPreview value={value} variant={variant} />
    </div>
  );
}

function SectionWebsitePreview({ label = "Instructions preview", examIntro = "", section, questions = [] }) {
  const number = Number(section?.part_number ?? section?.partNumber) || 1;
  const moduleId = String(section?.section_type ?? section?.sectionType ?? "read").toLowerCase();
  const displayText = getSectionWebsiteInstructions(section, questions);
  return (
    <div className={styles.previewBox}>
      <span className={styles.previewLabel}><Eye size={15} /> {label}</span>
      <section className={`${examStyles.passagePane} ${styles.examPreviewPane}`}>
        <div className={examStyles.sectionLabel}>
          <BookOpen size={18} />
          {moduleId === "read" ? "Quelle" : getModuleLabel(moduleId)} Teil {number}
        </div>
        <SectionTitlePreview section={section} />
        {moduleId === "read" && examIntro ? <ExamTextPreview value={examIntro} variant="instruction" /> : null}
        <ExamTextPreview value={displayText} variant="material" />
      </section>
    </div>
  );
}

function RichTextEditor({ label, value, onChange, variant = "material", onApplyStyle }) {
  const fieldRef = useRef(null);
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const currentHtmlRef = useRef("");
  const skipNextValueSyncRef = useRef(false);
  const toolbarInteractingRef = useRef(false);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);

  const resetHistory = (html) => {
    historyRef.current = [html];
    historyIndexRef.current = 0;
  };

  const setEditorHtml = (html) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = html;
    currentHtmlRef.current = html;
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = sanitizeRichTextHtml(value);
    if (skipNextValueSyncRef.current) {
      skipNextValueSyncRef.current = false;
      return;
    }
    if (editor.innerHTML !== nextHtml) setEditorHtml(nextHtml);
    resetHistory(nextHtml);
  }, [value]);

  const pushHistory = (html) => {
    const history = historyRef.current;
    if (history[historyIndexRef.current] === html) return;
    const nextHistory = history.slice(0, historyIndexRef.current + 1);
    nextHistory.push(html);
    if (nextHistory.length > 80) nextHistory.shift();
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
  };

  const emitChange = (html, { recordHistory = true } = {}) => {
    currentHtmlRef.current = html;
    if (recordHistory) pushHistory(html);
    skipNextValueSyncRef.current = true;
    onChange(html);
  };

  const rememberSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  };

  const restoreSelection = () => {
    const editor = editorRef.current;
    const range = savedRangeRef.current;
    if (!editor || !range) {
      editor?.focus();
      return;
    }
    try {
      if (!editor.contains(range.commonAncestorContainer)) {
        editor.focus();
        return;
      }
      const selection = window.getSelection();
      editor.focus();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      savedRangeRef.current = null;
      editor.focus();
    }
  };

  const runCommand = (command, commandValue = null) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    document.execCommand(command, false, commandValue);
    rememberSelection();
    emitChange(editor.innerHTML);
    window.setTimeout(() => {
      toolbarInteractingRef.current = false;
    }, 80);
  };

  const moveHistory = (direction) => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextIndex = Math.max(0, Math.min(historyRef.current.length - 1, historyIndexRef.current + direction));
    if (nextIndex === historyIndexRef.current) {
      window.setTimeout(() => {
        toolbarInteractingRef.current = false;
      }, 80);
      return;
    }
    historyIndexRef.current = nextIndex;
    const nextHtml = historyRef.current[nextIndex] ?? "";
    setEditorHtml(nextHtml);
    emitChange(nextHtml, { recordHistory: false });
    window.setTimeout(() => {
      toolbarInteractingRef.current = false;
    }, 80);
  };

  const syncValue = () => {
    const editor = editorRef.current;
    if (!editor) return;
    rememberSelection();
    emitChange(editor.innerHTML);
  };

  const sanitizeValue = (event) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (toolbarInteractingRef.current || fieldRef.current?.contains(event?.relatedTarget)) return;
    const safeHtml = sanitizeRichTextHtml(editor.innerHTML);
    if (safeHtml !== editor.innerHTML) setEditorHtml(safeHtml);
    emitChange(safeHtml);
  };

  const handleToolbarMouseDown = (event) => {
    event.preventDefault();
    toolbarInteractingRef.current = true;
    rememberSelection();
  };

  const markToolbarInteraction = () => {
    toolbarInteractingRef.current = true;
    rememberSelection();
  };

  const handleEditorWheel = (event) => {
    const editor = editorRef.current;
    if (!editor) return;
    const maxScrollTop = editor.scrollHeight - editor.clientHeight;
    if (maxScrollTop <= 0 || event.deltaY === 0) return;

    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, editor.scrollTop + event.deltaY));
    if (nextScrollTop !== editor.scrollTop) {
      event.preventDefault();
      event.stopPropagation();
      editor.scrollTop = nextScrollTop;
    }
  };

  const handleKeyDown = (event) => {
    const modKey = event.ctrlKey || event.metaKey;
    if (!modKey) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      moveHistory(event.shiftKey ? 1 : -1);
    } else if (key === "y") {
      event.preventDefault();
      moveHistory(1);
    }
  };

  return (
    <div className={styles.richField} ref={fieldRef}>
      <span className={styles.richLabel}>{label}</span>
      <div className={styles.richToolbar} aria-label={`${label} formatting`}>
        <button type="button" title="Undo" onMouseDown={handleToolbarMouseDown} onClick={() => moveHistory(-1)}>
          <Undo2 size={16} />
        </button>
        <button type="button" title="Redo" onMouseDown={handleToolbarMouseDown} onClick={() => moveHistory(1)}>
          <Redo2 size={16} />
        </button>
        <span className={styles.toolbarDivider} />
        <button type="button" title="Bold" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("bold")}>
          <Bold size={16} />
        </button>
        <button type="button" title="Italic" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("italic")}>
          <Italic size={16} />
        </button>
        <button type="button" title="Underline" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("underline")}>
          <Underline size={16} />
        </button>
        <button type="button" title="Align left" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyLeft")}>
          <AlignLeft size={16} />
        </button>
        <button type="button" title="Align center" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyCenter")}>
          <AlignCenter size={16} />
        </button>
        <button type="button" title="Align right" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("justifyRight")}>
          <AlignRight size={16} />
        </button>
        <button type="button" title="Bullet list" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("insertUnorderedList")}>
          <List size={16} />
        </button>
        <button type="button" title="Numbered list" onMouseDown={handleToolbarMouseDown} onClick={() => runCommand("insertOrderedList")}>
          <ListOrdered size={16} />
        </button>
        <label className={styles.richSelectTool} title="Font">
          <Type size={16} />
          <select
            defaultValue=""
            onMouseDown={markToolbarInteraction}
            onBlur={() => window.setTimeout(() => { toolbarInteractingRef.current = false; }, 80)}
            onChange={(event) => {
              runCommand("fontName", event.target.value);
              event.target.value = "";
            }}
          >
            <option value="" disabled>Font</option>
            {RICH_FONT_FAMILIES.map((font) => <option key={font} value={font}>{font}</option>)}
          </select>
        </label>
        <label className={styles.richSelectTool} title="Size">
          <select
            defaultValue=""
            onMouseDown={markToolbarInteraction}
            onBlur={() => window.setTimeout(() => { toolbarInteractingRef.current = false; }, 80)}
            onChange={(event) => {
              runCommand("fontSize", event.target.value);
              event.target.value = "";
            }}
          >
            <option value="" disabled>Size</option>
            {RICH_FONT_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
          </select>
        </label>
        <span className={styles.toolbarDivider} />
        {RICH_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.colorSwatch}
            title={`Color ${color}`}
            style={{ "--swatch-color": color }}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => runCommand("foreColor", color)}
          />
        ))}
        <label className={styles.colorTool} title="Custom text color" onMouseDown={markToolbarInteraction}>
          <Palette size={16} />
          <input
            type="color"
            onBlur={() => window.setTimeout(() => { toolbarInteractingRef.current = false; }, 80)}
            onChange={(event) => runCommand("foreColor", event.target.value)}
          />
        </label>
        <label className={styles.colorTool} title="Highlight color" onMouseDown={markToolbarInteraction}>
          <Highlighter size={16} />
          <input
            type="color"
            onBlur={() => window.setTimeout(() => { toolbarInteractingRef.current = false; }, 80)}
            onChange={(event) => runCommand("hiliteColor", event.target.value)}
          />
        </label>
        {onApplyStyle ? (
          <>
            <span className={styles.toolbarDivider} />
            <button
              type="button"
              className={styles.styleReuseButton}
              title="Apply this style"
              onMouseDown={handleToolbarMouseDown}
              onClick={() => {
                rememberSelection();
                onApplyStyle(currentHtmlRef.current || sanitizeRichTextHtml(value));
                window.setTimeout(() => {
                  toolbarInteractingRef.current = false;
                }, 80);
              }}
            >
              <Copy size={16} />
              <span>Apply style</span>
            </button>
          </>
        ) : null}
      </div>
      <div
        ref={editorRef}
        className={`${styles.richEditor} ${styles.richEditorWebsite} ${variant === "instruction" ? examStyles.instructionText : examStyles.examMaterial} ${styles.examPreviewSurface}`}
        contentEditable
        role="textbox"
        aria-label={label}
        spellCheck="true"
        onInput={syncValue}
        onKeyDown={handleKeyDown}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={sanitizeValue}
        onWheel={handleEditorWheel}
      />
    </div>
  );
}

function SectionForm({ draft, exam, examIntro = "", sectionQuestions = [], onChange, onSubmit, onCancel, busy, onApplyStyle }) {
  const previewSection = {
    sectionType: draft.sectionType,
    part_number: draft.partNumber,
    title: draft.title,
    instructions: draft.instructions,
  };
  const sectionIds = draft.id && exam?.id ? { examId: exam.id, sectionId: draft.id } : null;
  return (
    <form className={styles.inlineEditor} onSubmit={onSubmit}>
      <div className={styles.panelHeader}>
        <h4>{draft.id ? "Edit section" : "New section"}</h4>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" onClick={onCancel}>Cancel</button>
          <button className={styles.button} type="submit" disabled={busy}>Save section</button>
        </div>
      </div>
      <SectionWebsitePreview
        label="Website section preview"
        examIntro={examIntro}
        section={previewSection}
        questions={sectionQuestions}
      />
      <div className={styles.editorGrid}>
        <label className={styles.field}>Module
          <select value={draft.sectionType} onChange={(event) => onChange((prev) => ({ ...prev, sectionType: event.target.value }))}>
            {MODULE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Part number
          <input type="number" min="1" value={draft.partNumber} onChange={(event) => onChange((prev) => ({ ...prev, partNumber: event.target.value }))} />
        </label>
        <label className={styles.field}>Duration minutes
          <input type="number" min="0" value={draft.durationMinutes} onChange={(event) => onChange((prev) => ({ ...prev, durationMinutes: event.target.value }))} />
        </label>
        <label className={styles.field}>Points
          <input type="number" min="0" value={draft.points} onChange={(event) => onChange((prev) => ({ ...prev, points: event.target.value }))} />
        </label>
        <label className={styles.field}>Position
          <input type="number" min="0" value={draft.position} onChange={(event) => onChange((prev) => ({ ...prev, position: event.target.value }))} />
        </label>
      </div>
      <RichTextEditor
        label="Section / task title"
        value={draft.title}
        variant="instruction"
        onChange={(value) => onChange((prev) => ({ ...prev, title: value }))}
        onApplyStyle={sectionIds && onApplyStyle ? (value) => onApplyStyle({
          sourceBlock: makeStyleSourceBlock("section_title", sectionIds),
          value,
          label: `${getExamStyleLabel(exam)} - Teil ${draft.partNumber || draft.position || draft.id} title`,
        }) : undefined}
      />
      <RichTextEditor
        label="Instructions"
        value={draft.instructions}
        variant="material"
        onChange={(value) => onChange((prev) => ({ ...prev, instructions: value }))}
        onApplyStyle={sectionIds && onApplyStyle ? (value) => onApplyStyle({
          sourceBlock: makeStyleSourceBlock("section_instructions", sectionIds),
          value,
          label: `${getExamStyleLabel(exam)} - Teil ${draft.partNumber || draft.position || draft.id} instructions`,
        }) : undefined}
      />
      <div className={styles.editorGrid}>
        <JsonTextarea label="Scoring JSON" value={draft.scoring} onChange={(value) => onChange((prev) => ({ ...prev, scoring: value }))} />
        <JsonTextarea label="Metadata JSON" value={draft.metadata} onChange={(value) => onChange((prev) => ({ ...prev, metadata: value }))} />
      </div>
    </form>
  );
}

function QuestionCard({ question, onEdit, onDelete }) {
  return (
    <article className={styles.questionCard}>
      <div>
        <span className={styles.questionMeta}>#{question.position ?? "-"} - {question.question_type ?? "prompt"} - {getModuleLabel(question.module_id)}</span>
        <strong>{clipPreview(question.prompt, 160) || "Untitled task"}</strong>
        {question.explanation ? <small>{clipPreview(question.explanation, 140)}</small> : null}
      </div>
      <div className={styles.actions}>
        <button className={styles.secondaryButton} type="button" onClick={onEdit}>
          <Edit3 size={15} />
          Edit
        </button>
        <button className={styles.dangerGhostButton} type="button" onClick={onDelete}>
          <Trash2 size={15} />
          Delete
        </button>
      </div>
    </article>
  );
}

function QuestionForm({ draft, exam, sections, onChange, onSubmit, onCancel, busy, onApplyStyle }) {
  const questionIds = draft.id && exam?.id ? { examId: exam.id, sectionId: draft.sectionId || null, questionId: draft.id } : null;
  const selectedSection = sections.find((section) => String(section.id) === String(draft.sectionId));
  const taskLabel = `${getExamStyleLabel(exam)} - ${selectedSection ? `Teil ${selectedSection.part_number}: ${getSectionPlainTitle(selectedSection)}` : "Unassigned"} - Task ${draft.position || draft.id || "new"}`;
  let optionPreview = "";
  try {
    optionPreview = getQuestionOptionText({ options: JSON.parse(draft.options || "[]") });
  } catch {
    optionPreview = "";
  }
  return (
    <form className={styles.inlineEditor} onSubmit={onSubmit}>
      <div className={styles.panelHeader}>
        <h4>{draft.id ? "Edit task" : "New task"}</h4>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" onClick={onCancel}>Cancel</button>
          <button className={styles.button} type="submit" disabled={busy}>Save task</button>
        </div>
      </div>
      <div className={styles.editorGrid}>
        <label className={styles.field}>Section
          <select value={draft.sectionId} onChange={(event) => onChange((prev) => ({ ...prev, sectionId: event.target.value }))}>
            <option value="">Unassigned</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>Teil {section.part_number}: {getSectionPlainTitle(section)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>Module
          <select value={draft.moduleId} onChange={(event) => onChange((prev) => ({ ...prev, moduleId: event.target.value }))}>
            {MODULE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>Question type
          <input list="question-type-options" value={draft.questionType} onChange={(event) => onChange((prev) => ({ ...prev, questionType: event.target.value }))} />
        </label>
        <label className={styles.field}>Position
          <input type="number" min="0" value={draft.position} onChange={(event) => onChange((prev) => ({ ...prev, position: event.target.value }))} />
        </label>
      </div>
      <datalist id="question-type-options">
        {QUESTION_TYPE_OPTIONS.map((item) => <option key={item} value={item} />)}
      </datalist>
      <RichPreview label="Candidate preview" value={draft.prompt} variant="instruction" />
      <RichTextEditor
        label="Prompt / task text"
        value={draft.prompt}
        variant="instruction"
        onChange={(value) => onChange((prev) => ({ ...prev, prompt: value }))}
        onApplyStyle={questionIds && onApplyStyle ? (value) => onApplyStyle({
          sourceBlock: makeStyleSourceBlock("question_prompt", questionIds),
          value,
          label: `${taskLabel} prompt`,
        }) : undefined}
      />
      <RichTextEditor
        label="Explanation / examiner note"
        value={draft.explanation}
        onChange={(value) => onChange((prev) => ({ ...prev, explanation: value }))}
        onApplyStyle={questionIds && onApplyStyle ? (value) => onApplyStyle({
          sourceBlock: makeStyleSourceBlock("question_explanation", questionIds),
          value,
          label: `${taskLabel} explanation`,
        }) : undefined}
      />
      <RichTextEditor
        label="Transcript"
        value={draft.transcript}
        onChange={(value) => onChange((prev) => ({ ...prev, transcript: value }))}
        onApplyStyle={questionIds && onApplyStyle ? (value) => onApplyStyle({
          sourceBlock: makeStyleSourceBlock("question_transcript", questionIds),
          value,
          label: `${taskLabel} transcript`,
        }) : undefined}
      />
      {optionPreview && questionIds && onApplyStyle ? (
        <div className={styles.optionStyleBox}>
          <div>
            <span className={styles.previewLabel}><Eye size={15} /> Answer options preview</span>
            <pre>{optionPreview}</pre>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => onApplyStyle({
              sourceBlock: makeStyleSourceBlock("answer_options", questionIds),
              value: optionPreview,
              label: `${taskLabel} answer options`,
            })}
          >
            <Copy size={15} />
            Apply option style
          </button>
        </div>
      ) : null}
      <div className={styles.editorGrid}>
        <JsonTextarea label="Options JSON" value={draft.options} onChange={(value) => onChange((prev) => ({ ...prev, options: value }))} />
        <JsonTextarea label="Correct answer JSON" value={draft.correctAnswer} onChange={(value) => onChange((prev) => ({ ...prev, correctAnswer: value }))} />
        <JsonTextarea label="Audio JSON" value={draft.audio} onChange={(value) => onChange((prev) => ({ ...prev, audio: value }))} />
        <JsonTextarea label="Scoring JSON" value={draft.scoring} onChange={(value) => onChange((prev) => ({ ...prev, scoring: value }))} />
        <JsonTextarea label="Source metadata JSON" value={draft.sourceMetadata} onChange={(value) => onChange((prev) => ({ ...prev, sourceMetadata: value }))} />
      </div>
    </form>
  );
}

// eslint-disable-next-line no-unused-vars
function AdminExamsLegacy() {
  const loader = useCallback(async () => {
    const res = await API.get("/api/admin/exams");
    return res.data;
  }, []);
  const { data, loading, error, reload } = useAdminData(loader);
  const [form, setForm] = useState({ code: "", name: "", examType: "custom", level: "B2" });
  const [generateForm, setGenerateForm] = useState({ type: "testdaf", serie: "serie-1", level: "B2", moduleCategory: "reading", quantity: 4 });
  const [jsonPayload, setJsonPayload] = useState("");
  const [questionEdit, setQuestionEdit] = useState({ examId: "", questionId: "", prompt: "" });
  const [documentFile, setDocumentFile] = useState(null);
  const [documentBusy, setDocumentBusy] = useState("");
  const [documentAnalysis, setDocumentAnalysis] = useState(null);
  const [documentError, setDocumentError] = useState("");
  const [status, setStatus] = useState("");

  const createExam = async (event) => {
    event.preventDefault();
    await API.post("/api/admin/exams", form);
    setForm({ code: "", name: "", examType: "custom", level: "B2" });
    setStatus("Exam created.");
    await reload();
  };

  const uploadJson = async () => {
    const payload = JSON.parse(jsonPayload);
    await API.post("/api/admin/exams/upload-json", { payload });
    setJsonPayload("");
    setStatus("JSON exam upload complete.");
    await reload();
  };

  const processDocument = async (mode) => {
    if (!documentFile) return;
    setDocumentBusy(mode);
    setDocumentError("");
    setStatus("");
    try {
      const formData = new FormData();
      formData.append("document", documentFile);
      const endpoint = mode === "import" ? "/api/admin/exams/import-document" : "/api/admin/exams/analyze-document";
      const res = await API.post(endpoint, formData);
      setDocumentAnalysis(res.data.analysis);
      if (mode === "import") {
        setStatus(
          res.data.duplicate
            ? "Document already imported. Existing data was kept."
            : `${res.data.exams?.length ?? 0} exam series imported from document.`
        );
        await reload();
      } else {
        setStatus("Document analyzed. Review the detected structure before importing.");
      }
    } catch (err) {
      setDocumentError(err.response?.data?.error ?? "Document processing failed.");
    } finally {
      setDocumentBusy("");
    }
  };

  const generateExams = async (event) => {
    event.preventDefault();
    await API.post("/api/admin/exams/generate", generateForm);
    setStatus("Generated exam content saved.");
    await reload();
  };

  const updateQuestion = async (event) => {
    event.preventDefault();
    await API.put(`/api/admin/exams/${questionEdit.examId}/questions/${questionEdit.questionId}`, {
      prompt: questionEdit.prompt,
    });
    setStatus("Question updated.");
    await reload();
  };

  const questionsByExam = useMemo(() => {
    const map = new Map();
    (data?.questions ?? []).forEach((question) => {
      map.set(question.exam_id, [...(map.get(question.exam_id) ?? []), question]);
    });
    return map;
  }, [data?.questions]);

  return (
    <>
      <Header title="Exam Management" subtitle="Create exams, bulk upload JSON, and edit existing questions." />
      {status ? <p className={styles.status}>{status}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {documentError ? <p className={styles.error}>{documentError}</p> : null}
      {loading ? <p>Loading...</p> : null}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Intelligent document import</h2>
            <p className={styles.panelHint}>Upload PDF, DOCX, TXT, or image files. The parser detects provider, level, section, series, questions, scoring, and prevents duplicate imports.</p>
          </div>
          <span className={styles.badge}>
            <Upload size={14} />
            Auto parser
          </span>
        </div>
        <div className={styles.documentImportGrid}>
          <label className={styles.field}>Exam document
            <input
              type="file"
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
              onChange={(event) => {
                setDocumentFile(event.target.files?.[0] ?? null);
                setDocumentAnalysis(null);
                setDocumentError("");
              }}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={!documentFile || Boolean(documentBusy)}
              onClick={() => processDocument("analyze")}
            >
              {documentBusy === "analyze" ? "Analyzing..." : "Analyze only"}
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={!documentFile || Boolean(documentBusy)}
              onClick={() => processDocument("import")}
            >
              {documentBusy === "import" ? "Importing..." : "Analyze & import"}
            </button>
          </div>
        </div>
        {documentAnalysis ? (
          <div className={styles.importSummary}>
            <div className={styles.summaryGrid}>
              <span><strong>Provider</strong>{documentAnalysis.metadata?.provider ?? "-"}</span>
              <span><strong>Exam</strong>{documentAnalysis.metadata?.examType ?? "-"}</span>
              <span><strong>Level</strong>{documentAnalysis.metadata?.level ?? "-"}</span>
              <span><strong>Section</strong>{documentAnalysis.metadata?.sectionLabel ?? documentAnalysis.metadata?.sectionType ?? "-"}</span>
              <span><strong>Series</strong>{documentAnalysis.outline?.series?.length ?? 0}</span>
              <span><strong>Questions</strong>{documentAnalysis.validation?.questionCount ?? 0}</span>
            </div>
            {documentAnalysis.validation?.warnings?.length ? (
              <ul className={styles.warningList}>
                {documentAnalysis.validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
            <div className={styles.outlineList}>
              {(documentAnalysis.outline?.series ?? []).slice(0, 8).map((series) => (
                <article key={`${series.seriesNumber}-${series.title}`}>
                  <strong>{series.sourceLabel}: {series.title}</strong>
                  <span>{series.sectionCount} sections · {series.questionCount} questions</span>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <div className={styles.split}>
        <section className={styles.panel}>
          <h2>Create exam</h2>
          <form className={styles.formGrid} onSubmit={createExam}>
            <label className={styles.field}>Code
              <input value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="goethe-b2-2026" />
            </label>
            <label className={styles.field}>Name
              <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Goethe B2 2026" />
            </label>
            <label className={styles.field}>Type
              <input value={form.examType} onChange={(e) => setForm((prev) => ({ ...prev, examType: e.target.value }))} />
            </label>
            <label className={styles.field}>Level
              <input value={form.level} onChange={(e) => setForm((prev) => ({ ...prev, level: e.target.value }))} />
            </label>
            <button className={styles.button} type="submit">Create</button>
          </form>
        </section>
        <section className={styles.panel}>
          <h2>Upload exams via JSON</h2>
          <label className={styles.field}>JSON payload
            <textarea
              value={jsonPayload}
              onChange={(event) => setJsonPayload(event.target.value)}
              placeholder='{"exams":[{"code":"testdaf-1","name":"TestDaF Set 1","questions":[]}]}'
            />
          </label>
          <button className={styles.secondaryButton} type="button" onClick={uploadJson} disabled={!jsonPayload.trim()}>
            Upload JSON
          </button>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>Bulk exam generation</h2>
        <form className={styles.formGrid} onSubmit={generateExams}>
          <label className={styles.field}>Test type
            <select value={generateForm.type} onChange={(e) => setGenerateForm((prev) => ({ ...prev, type: e.target.value }))}>
              <option value="testdaf">TestDaF</option>
              <option value="dsh">DSH</option>
              <option value="goethe">Goethe</option>
              <option value="telc">telc</option>
            </select>
          </label>
          <label className={styles.field}>Serie
            <input value={generateForm.serie} onChange={(e) => setGenerateForm((prev) => ({ ...prev, serie: e.target.value }))} />
          </label>
          <label className={styles.field}>Level
            <select value={generateForm.level} onChange={(e) => setGenerateForm((prev) => ({ ...prev, level: e.target.value }))}>
              <option value="A1">A1</option>
              <option value="A2">A2</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
              <option value="C1">C1</option>
              <option value="C2">C2</option>
            </select>
          </label>
          <label className={styles.field}>Module
            <select value={generateForm.moduleCategory} onChange={(e) => setGenerateForm((prev) => ({ ...prev, moduleCategory: e.target.value }))}>
              <option value="reading">Reading</option>
              <option value="listening">Listening</option>
              <option value="writing">Writing</option>
              <option value="speaking">Speaking</option>
            </select>
          </label>
          <label className={styles.field}>Quantity
            <input type="number" min="1" max="50" value={generateForm.quantity} onChange={(e) => setGenerateForm((prev) => ({ ...prev, quantity: Number(e.target.value) }))} />
          </label>
          <button className={styles.button} type="submit">Generate</button>
        </form>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2>Existing exams</h2>
          <span>{data?.exams?.length ?? 0} exams</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Exam</th><th>Type</th><th>Level</th><th>Questions</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {(data?.exams ?? []).map((exam) => (
                <tr key={exam.id}>
                  <td><strong>{exam.name}</strong><br /><span>{exam.code}</span></td>
                  <td>{exam.exam_type}</td>
                  <td>{exam.level ?? "-"}</td>
                  <td>{exam.question_count}</td>
                  <td>{formatDate(exam.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Edit question prompt</h2>
        <form className={styles.formGrid} onSubmit={updateQuestion}>
          <label className={styles.field}>Exam
            <select value={questionEdit.examId} onChange={(e) => setQuestionEdit({ examId: e.target.value, questionId: "", prompt: "" })}>
              <option value="">Choose exam</option>
              {(data?.exams ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>Question
            <select
              value={questionEdit.questionId}
              onChange={(e) => {
                const question = (questionsByExam.get(Number(questionEdit.examId)) ?? []).find((item) => String(item.id) === e.target.value);
                setQuestionEdit((prev) => ({ ...prev, questionId: e.target.value, prompt: question?.prompt ?? "" }));
              }}
            >
              <option value="">Choose question</option>
              {(questionsByExam.get(Number(questionEdit.examId)) ?? []).map((question) => (
                <option key={question.id} value={question.id}>#{question.position} {question.module_id}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>Prompt
            <textarea value={questionEdit.prompt} onChange={(e) => setQuestionEdit((prev) => ({ ...prev, prompt: e.target.value }))} />
          </label>
          <button className={styles.button} type="submit" disabled={!questionEdit.examId || !questionEdit.questionId}>
            Save question
          </button>
        </form>
      </section>
    </>
  );
}

function AdminExports() {
  const [error, setError] = useState("");

  const download = async (type, format) => {
    setError("");
    try {
      const res = await API.get(`/api/admin/exports?type=${type}&format=${format}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${type}.${format}`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error ?? "Export impossible.");
    }
  };

  return (
    <>
      <Header title="Data Export" subtitle="Export users and result history as CSV or JSON." />
      {error ? <p className={styles.error}>{error}</p> : null}
      <section className={styles.panel}>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => download("users", "csv")}>Users CSV</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("users", "excel")}>Users Excel</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("users", "pdf")}>Users PDF</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("users", "json")}>Users JSON</button>
          <button className={styles.button} type="button" onClick={() => download("results", "csv")}>Results CSV</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("results", "excel")}>Results Excel</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("results", "pdf")}>Results PDF</button>
          <button className={styles.secondaryButton} type="button" onClick={() => download("results", "json")}>Results JSON</button>
          <button className={styles.button} type="button" onClick={() => download("statistics", "csv")}>Statistics CSV</button>
          <button className={styles.button} type="button" onClick={() => download("written-copies", "csv")}>Written copies CSV</button>
        </div>
      </section>
    </>
  );
}

function Header({ title, subtitle }) {
  return (
    <div className={styles.topline}>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <span className={styles.badge}>
        <Shield size={14} />
        Admin only
      </span>
    </div>
  );
}

export default function AdminPanel() {
  return (
    <AdminShell>
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="exams" element={<AdminExams />} />
        <Route path="api-usage" element={<AdminApiUsage />} />
        <Route path="exports" element={<AdminExports />} />
        <Route path="*" element={<AdminDashboard />} />
      </Routes>
    </AdminShell>
  );
}
