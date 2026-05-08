const getBearerToken = (req) => {
  const header = req.header("authorization") || "";
  const [type, token] = header.split(" ");
  return type === "Bearer" && token ? token : "";
};

const createAuthMiddleware = ({ pool, jwt, jwtSecret, issuer, audience }) => {
  return async function authMiddleware(req, res, next) {
    try {
      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: "Missing authorization token" });
      }

      const payload = jwt.verify(token, jwtSecret, {
        issuer,
        audience,
      });
      const userId = Number(payload.sub ?? payload.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(401).json({ ok: false, error: "Invalid token" });
      }

      if (payload.jti) {
        const revoked = await pool.query(
          `SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1`,
          [payload.jti]
        );
        if (revoked.rows[0]) {
          return res.status(401).json({ ok: false, error: "Token has been revoked" });
        }
      }

      const r = await pool.query(
        `SELECT id, email, username, first_name, last_name, date_of_birth, role, status,
                email_verified, has_full_access, created_at, last_login_at
         FROM users
         WHERE id = $1`,
        [userId]
      );
      const user = r.rows[0];
      if (!user) return res.status(401).json({ ok: false, error: "User not found" });
      if (user.status !== "active") {
        return res.status(403).json({ ok: false, error: "Account is suspended" });
      }
      if (!user.email_verified) {
        return res.status(403).json({
          ok: false,
          error: "Email verification required",
          requiresEmailVerification: true,
        });
      }
      if (!["user", "admin"].includes(String(user.role)) || payload.role !== user.role) {
        return res.status(401).json({ ok: false, error: "Token role is no longer valid" });
      }

      req.token = token;
      req.authPayload = payload;
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid or expired token" });
    }
  };
};

module.exports = {
  createAuthMiddleware,
  getBearerToken,
};
