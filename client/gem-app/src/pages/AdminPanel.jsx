/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Download,
  FileJson,
  Shield,
  Users,
} from "lucide-react";
import API from "../services/api";
import logo from "../assets/images/logo.png";
import styles from "./AdminPanel.module.css";

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
  const links = [
    { to: "/admin/dashboard", label: "Dashboard", icon: BarChart3 },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/exams", label: "Exams", icon: FileJson },
    { to: "/admin/api-usage", label: "API usage", icon: Activity },
    { to: "/admin/exports", label: "Exports", icon: Download },
  ];

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
      <Header title="User Management" subtitle="View users, suspend or activate accounts, and grant full access." />
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
                  <td>{user.has_full_access ? "Full" : "Free"}</td>
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
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => updateUser(user, { hasFullAccess: !user.has_full_access })}
                      >
                        {user.has_full_access ? "Revoke full" : "Grant full"}
                      </button>
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
      {loading ? <p>Loading...</p> : null}
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
