const nodemailer = require("nodemailer");

const BRAND_NAME = "N-Deutschprüfungen";
const RESEND_API_URL = "https://api.resend.com/emails";

const trimTrailingSlash = (value) => String(value || "").trim().replace(/\/+$/, "");

const getAppBaseUrl = () =>
  trimTrailingSlash(
    process.env.APP_BASE_URL ||
      process.env.FRONTEND_URL ||
      "https://n-deutschprüfungen.com"
  );

const getEmailFromName = () => process.env.EMAIL_FROM_NAME || BRAND_NAME;

const getSupportEmail = () =>
  process.env.SUPPORT_EMAIL ||
  process.env.EMAIL_REPLY_TO ||
  "support@xn--n-deutschprfungen-d3b.com";

const getEmailFromAddress = () => {
  const configured = process.env.EMAIL_FROM || process.env.EMAIL_FROM_ADDRESS || "";
  if (configured.includes("<")) return configured;
  return configured || "no-reply@xn--n-deutschprfungen-d3b.com";
};

const getFormattedFrom = () => {
  const from = getEmailFromAddress();
  if (from.includes("<")) return from;
  return `${getEmailFromName()} <${from}>`;
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const getMailer = () => {
  const host = process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT || 587);
  const user =
    process.env.EMAIL_SMTP_USER ||
    process.env.SMTP_USER ||
    process.env.CONTACT_SMTP_USER ||
    (process.env.RESEND_API_KEY ? "resend" : "");
  const pass =
    process.env.EMAIL_SMTP_PASS ||
    process.env.SMTP_PASS ||
    process.env.CONTACT_SMTP_PASS ||
    "";

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  if (user && pass && !process.env.RESEND_API_KEY) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }

  return null;
};

const logEmailEvent = async (pool, event) => {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO email_events (
         user_id, email_type, recipient, subject, provider, status,
         provider_message_id, error_message, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        event.userId || null,
        event.type || "transactional",
        event.to,
        event.subject,
        event.provider || "disabled",
        event.status || "logged",
        event.providerMessageId || null,
        event.errorMessage || null,
        JSON.stringify(event.metadata || {}),
      ]
    );
  } catch (err) {
    console.error("Email event log failed", err);
  }
};

const sendWithResend = async ({ from, to, subject, html, text, replyTo, idempotencyKey }) => {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      reply_to: replyTo || getSupportEmail(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.error || `Resend returned ${response.status}`;
    throw new Error(message);
  }
  return body;
};

const sendEmail = async ({ pool, userId, to, subject, text, html, type, metadata, idempotencyKey }) => {
  const from = getFormattedFrom();
  const replyTo = getSupportEmail();

  if (process.env.RESEND_API_KEY) {
    try {
      const result = await sendWithResend({ from, to, subject, html, text, replyTo, idempotencyKey });
      await logEmailEvent(pool, {
        userId,
        type,
        to,
        subject,
        provider: "resend",
        status: "sent",
        providerMessageId: result?.id,
        metadata,
      });
      return { sent: true, provider: "resend", id: result?.id };
    } catch (err) {
      await logEmailEvent(pool, {
        userId,
        type,
        to,
        subject,
        provider: "resend",
        status: "failed",
        errorMessage: err.message,
        metadata,
      });
      throw err;
    }
  }

  const transporter = getMailer();
  if (transporter) {
    await transporter.sendMail({ from, to, subject, text, html, replyTo });
    await logEmailEvent(pool, {
      userId,
      type,
      to,
      subject,
      provider: "smtp",
      status: "sent",
      metadata,
    });
    return { sent: true, provider: "smtp" };
  }

  console.log(`[email disabled] ${subject} -> ${to}\n${text}`);
  await logEmailEvent(pool, {
    userId,
    type,
    to,
    subject,
    provider: "disabled",
    status: "logged",
    metadata,
  });
  return { sent: false, provider: "disabled" };
};

const renderLayout = ({ preview, title, body, buttonHref, buttonText, note }) => {
  const supportEmail = getSupportEmail();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 28px;background:#111827;color:#ffffff;">
                <div style="font-size:20px;font-weight:800;letter-spacing:.2px;">${BRAND_NAME}</div>
                <div style="font-size:13px;color:#d1d5db;margin-top:4px;">Préparation aux examens d'allemand</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;">
                <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px;color:#111827;">${escapeHtml(title)}</h1>
                <div style="font-size:15px;line-height:1.65;color:#374151;">${body}</div>
                ${
                  buttonHref && buttonText
                    ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(buttonHref)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:13px 18px;">${escapeHtml(buttonText)}</a></p>`
                    : ""
                }
                ${note ? `<p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.55;">${note}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.55;">
                Besoin d'aide ? Contactez-nous à <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2563eb;">${escapeHtml(supportEmail)}</a>.<br>
                Vous recevez cet email parce qu'une action a été demandée sur ${BRAND_NAME}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const renderVerificationEmail = ({ user, code, verifyUrl }) => {
  const name = user.first_name || user.username || "";
  return {
    subject: `Votre code de vérification ${BRAND_NAME}`,
    text: [
      `Bonjour ${name},`,
      "",
      `Votre code de vérification ${BRAND_NAME} est : ${code}`,
      "",
      "Ce code expire dans 15 minutes.",
      `Vous pouvez aussi ouvrir cette page : ${verifyUrl}`,
      "",
      "Si vous n'avez pas demandé cette inscription, ignorez cet email.",
    ].join("\n"),
    html: renderLayout({
      preview: `Votre code de vérification ${BRAND_NAME}`,
      title: "Vérifiez votre adresse email",
      body: `
        <p style="margin:0 0 16px;">Bonjour ${escapeHtml(name)},</p>
        <p style="margin:0 0 16px;">Entrez ce code dans l'application pour confirmer votre compte :</p>
        <div style="font-size:34px;letter-spacing:8px;font-weight:800;text-align:center;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;padding:16px 10px;color:#111827;">${escapeHtml(code)}</div>
        <p style="margin:18px 0 0;">Le code expire dans 15 minutes.</p>
      `,
      buttonHref: verifyUrl,
      buttonText: "Ouvrir la vérification",
      note: "Si vous n'avez pas demandé cette inscription, vous pouvez ignorer cet email.",
    }),
  };
};

const renderResetPasswordEmail = ({ user, resetUrl }) => {
  const name = user.first_name || user.username || "";
  return {
    subject: `Réinitialisation de votre mot de passe ${BRAND_NAME}`,
    text: [
      `Bonjour ${name},`,
      "",
      "Utilisez le lien suivant pour définir un nouveau mot de passe :",
      resetUrl,
      "",
      "Ce lien expire dans 60 minutes. Si vous n'avez rien demandé, ignorez cet email.",
    ].join("\n"),
    html: renderLayout({
      preview: "Lien sécurisé de réinitialisation",
      title: "Réinitialiser votre mot de passe",
      body: `
        <p style="margin:0 0 16px;">Bonjour ${escapeHtml(name)},</p>
        <p style="margin:0;">Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.</p>
      `,
      buttonHref: resetUrl,
      buttonText: "Réinitialiser le mot de passe",
      note: "Ce lien expire dans 60 minutes. Si vous n'avez rien demandé, ignorez cet email.",
    }),
  };
};

const renderWelcomeEmail = ({ user }) => {
  const baseUrl = getAppBaseUrl();
  const name = user.first_name || user.username || "";
  return {
    subject: `Bienvenue sur ${BRAND_NAME}`,
    text: [
      `Bonjour ${name},`,
      "",
      `Bienvenue sur ${BRAND_NAME}. Vous pouvez maintenant vous entraîner avec des simulations Goethe, ÖSD, telc et ECL.`,
      `${baseUrl}/dashboard`,
      "",
      `Support : ${getSupportEmail()}`,
    ].join("\n"),
    html: renderLayout({
      preview: `Bienvenue sur ${BRAND_NAME}`,
      title: "Bienvenue, votre compte est vérifié",
      body: `
        <p style="margin:0 0 16px;">Bonjour ${escapeHtml(name)},</p>
        <p style="margin:0 0 16px;">Votre compte est confirmé. Vous pouvez maintenant préparer vos examens d'allemand avec des simulations structurées, des modules de lecture, écoute, écriture et expression orale.</p>
        <p style="margin:0;">Commencez par votre tableau de bord pour reprendre votre préparation.</p>
      `,
      buttonHref: `${baseUrl}/dashboard`,
      buttonText: "Aller au tableau de bord",
      note: "Cet email confirme uniquement l'activation de votre compte. Les emails promotionnels restent séparés de vos emails de sécurité.",
    }),
  };
};

const renderPasswordChangedEmail = ({ user }) => {
  const name = user.first_name || user.username || "";
  return {
    subject: `Mot de passe modifié - ${BRAND_NAME}`,
    text: [
      `Bonjour ${name},`,
      "",
      "Votre mot de passe vient d'être modifié.",
      `Si ce n'était pas vous, contactez immédiatement ${getSupportEmail()}.`,
    ].join("\n"),
    html: renderLayout({
      preview: "Votre mot de passe a été modifié",
      title: "Mot de passe modifié",
      body: `
        <p style="margin:0 0 16px;">Bonjour ${escapeHtml(name)},</p>
        <p style="margin:0;">Votre mot de passe vient d'être modifié. Si ce n'était pas vous, contactez immédiatement notre support.</p>
      `,
      note: "Message de sécurité automatique.",
    }),
  };
};

const renderPromotionalEmail = ({ title, message, ctaUrl, ctaLabel, unsubscribeUrl }) => ({
  subject: title,
  text: [
    title,
    "",
    message,
    "",
    ctaUrl || "",
    "",
    `Se désinscrire : ${unsubscribeUrl}`,
  ].join("\n"),
  html: renderLayout({
    preview: title,
    title,
    body: `<p style="margin:0;">${escapeHtml(message)}</p>`,
    buttonHref: ctaUrl,
    buttonText: ctaLabel,
    note: `Vous recevez cet email parce que vous avez accepté les communications promotionnelles. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#2563eb;">Se désinscrire</a>.`,
  }),
});

module.exports = {
  BRAND_NAME,
  getAppBaseUrl,
  getSupportEmail,
  sendEmail,
  renderVerificationEmail,
  renderResetPasswordEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
  renderPromotionalEmail,
};
