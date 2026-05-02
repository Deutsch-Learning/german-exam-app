const express = require("express");
const pool = require("./db");
const cors = require("cors");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

const app = express();
app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  })
);
app.use(express.json());

function getUserIdFromRequest(req) {
  const raw = req.header("x-user-id");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      date_of_birth DATE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Existing DB may already have a users table without these columns.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
      ON users(username)
      WHERE username IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS simulations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_name TEXT NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      score_pct INTEGER NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100),
      level_current TEXT,
      level_target TEXT,
      ai_corrections JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS simulations_user_taken_at_idx
      ON simulations(user_id, taken_at DESC);
  `);
}

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB connection failed");
  }
});

app.post("/register", async (req, res) => {
  try {
    const { email, password, username, firstName, lastName } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ ok: false, error: "Email is required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    }

    const safeUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!safeUsername) {
      return res.status(400).json({ ok: false, error: "Username is required" });
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Username must be 3-30 chars (a-z, 0-9, . _ -)" });
    }

    const safeFirst = typeof firstName === "string" ? firstName.trim().slice(0, 80) : null;
    const safeLast = typeof lastName === "string" ? lastName.trim().slice(0, 80) : null;
    const passwordHash = await bcrypt.hash(password, 12);

    const insert = await pool.query(
      `INSERT INTO users (email, username, first_name, last_name, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, username, first_name, last_name, date_of_birth, created_at`,
      [normalizedEmail, safeUsername, safeFirst, safeLast, passwordHash]
    );

    return res.status(201).json({ ok: true, user: insert.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      const message = err.constraint?.includes("username")
        ? "Username already taken"
        : "Email already registered";
      return res.status(409).json({ ok: false, error: message });
    }
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userRes = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, password_hash FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = userRes.rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    // Placeholder: later return JWT token
    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        date_of_birth: user.date_of_birth,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/me", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Missing x-user-id" });

    const r = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, created_at FROM users WHERE id = $1`,
      [userId]
    );
    const user = r.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Missing x-user-id" });

    const userRes = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const simsRes = await pool.query(
      `SELECT id, exam_name, taken_at, score_pct, level_current, level_target, ai_corrections
       FROM simulations
       WHERE user_id = $1
       ORDER BY taken_at DESC
       LIMIT 10`,
      [userId]
    );
    const simulations = simsRes.rows;

    const statsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total_tests,
         COALESCE(ROUND(AVG(score_pct))::int, 0) AS avg_score
       FROM simulations
       WHERE user_id = $1`,
      [userId]
    );
    const stats = statsRes.rows[0] ?? { total_tests: 0, avg_score: 0 };

    const latest = simulations[0];
    const progressPct = Math.max(0, Math.min(100, Number(stats.avg_score ?? 0)));

    const recommendations =
      latest?.ai_corrections?.recommendations && Array.isArray(latest.ai_corrections.recommendations)
        ? latest.ai_corrections.recommendations.slice(0, 6)
        : [
            "Réviser les déclinaisons de l'adjectif (Cas génitif)",
            "Pratiquer l'écoute des journaux télévisés allemands",
            "Renforcer le vocabulaire lié à l'environnement",
          ];

    const skills = {
      read: Math.max(10, Math.min(100, progressPct + 4)),
      listen: Math.max(10, Math.min(100, progressPct - 8)),
      write: Math.max(10, Math.min(100, progressPct - 2)),
      speak: Math.max(10, Math.min(100, progressPct + 6)),
      grammar: Math.max(10, Math.min(100, progressPct - 12)),
      vocabulary: Math.max(10, Math.min(100, progressPct + 2)),
    };

    return res.json({
      ok: true,
      user,
      progress: {
        percent: progressPct,
        currentLevel: latest?.level_current ?? "B2",
        targetLevel: latest?.level_target ?? "C1",
        totalTests: stats.total_tests,
        avgScore: stats.avg_score,
      },
      recommendations,
      skills,
      simulations,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/me", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Missing x-user-id" });

    const { username, firstName, lastName, email, dateOfBirth } = req.body ?? {};
    if (
      typeof username !== "string" ||
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof email !== "string" ||
      typeof dateOfBirth !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        error: "username, firstName, lastName, email and dateOfBirth are required",
      });
    }

    const safeUsername = username.trim().toLowerCase();
    const safeFirst = firstName.trim().slice(0, 80);
    const safeLast = lastName.trim().slice(0, 80);
    const safeEmail = email.trim().toLowerCase();
    const safeDob = dateOfBirth.trim();

    if (!safeUsername || !/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Username must be 3-30 chars (a-z, 0-9, . _ -)" });
    }
    if (!safeFirst || !safeLast) {
      return res.status(400).json({ ok: false, error: "First name and last name are required" });
    }
    if (!safeEmail || !/^\S+@\S+\.\S+$/.test(safeEmail)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDob)) {
      return res.status(400).json({ ok: false, error: "dateOfBirth must be in YYYY-MM-DD format" });
    }

    const updated = await pool.query(
      `UPDATE users
       SET username = $1, first_name = $2, last_name = $3, email = $4, date_of_birth = $5::date
       WHERE id = $6
       RETURNING id, email, username, first_name, last_name, date_of_birth, created_at`,
      [safeUsername, safeFirst, safeLast, safeEmail, safeDob, userId]
    );

    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "User not found" });
    return res.json({ ok: true, user: updated.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, error: "Username or email already taken" });
    }
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Called after each test to update dashboard data
app.post("/simulations", async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Missing x-user-id" });

    const { examName, scorePct, levelCurrent, levelTarget, aiCorrections } = req.body ?? {};
    if (typeof examName !== "string" || !examName.trim()) {
      return res.status(400).json({ ok: false, error: "examName is required" });
    }
    const score = Number(scorePct);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(400).json({ ok: false, error: "scorePct must be 0..100" });
    }

    const insert = await pool.query(
      `INSERT INTO simulations (user_id, exam_name, score_pct, level_current, level_target, ai_corrections)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, exam_name, taken_at, score_pct, level_current, level_target, ai_corrections`,
      [
        userId,
        examName.trim().slice(0, 140),
        Math.round(score),
        typeof levelCurrent === "string" ? levelCurrent.trim().slice(0, 10) : null,
        typeof levelTarget === "string" ? levelTarget.trim().slice(0, 10) : null,
        aiCorrections && typeof aiCorrections === "object" ? aiCorrections : {},
      ]
    );

    return res.status(201).json({ ok: true, simulation: insert.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/contact", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, message } = req.body ?? {};
    if (
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof email !== "string" ||
      typeof message !== "string"
    ) {
      return res.status(400).json({ ok: false, error: "Invalid contact payload" });
    }

    const safeFirst = firstName.trim().slice(0, 80);
    const safeLast = lastName.trim().slice(0, 80);
    const safeEmail = email.trim().toLowerCase();
    const safePhone = typeof phone === "string" ? phone.trim().slice(0, 40) : "";
    const safeMessage = message.trim().slice(0, 5000);

    if (!safeFirst || !safeLast || !safeMessage || !/^\S+@\S+\.\S+$/.test(safeEmail)) {
      return res.status(400).json({ ok: false, error: "Please provide valid contact details" });
    }

    const smtpUser = process.env.CONTACT_SMTP_USER;
    const smtpPass = process.env.CONTACT_SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      return res.status(500).json({ ok: false, error: "Contact service is not configured" });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"German Exam App Contact" <${smtpUser}>`,
      to: "appgerman989@gmail.com",
      replyTo: safeEmail,
      subject: `Nouveau message contact: ${safeFirst} ${safeLast}`,
      text: [
        `Nom: ${safeLast}`,
        `Prénom: ${safeFirst}`,
        `Email: ${safeEmail}`,
        `Téléphone: ${safePhone || "-"}`,
        "",
        "Message:",
        safeMessage,
      ].join("\n"),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Unable to send message" });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});

ensureSchema().catch((err) => {
  console.error("Schema init failed", err);
});