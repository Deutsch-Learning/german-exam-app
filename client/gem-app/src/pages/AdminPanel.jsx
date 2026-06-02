/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Download,
  FileJson,
  LogOut,
  Shield,
  Upload,
  Users,
} from "lucide-react";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import styles from "./AdminPanel.module.css";
import { clearDashboardCache } from "../services/dashboard";
import { clearAuthSession } from "../utils/access";
import { examSimulations } from "../data/siteContent";
import { fetchImportedSeries } from "../services/importedExams";

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
