# Production Email And Authentication

This project currently uses the app server's JWT auth flow backed by the Supabase Postgres database. The code now supports production email delivery with Resend while keeping secrets server-side.

## Production URLs

- App: `https://n-deutschprüfungen.com`
- Verify email: `https://n-deutschprüfungen.com/verify-email`
- Reset password: `https://n-deutschprüfungen.com/reset-password`
- Dashboard: `https://n-deutschprüfungen.com/dashboard`

Set these server environment variables:

- `APP_BASE_URL=https://n-deutschprüfungen.com`
- `FRONTEND_URL=https://n-deutschprüfungen.com`
- `CORS_ORIGINS=https://n-deutschprüfungen.com,https://www.n-deutschprüfungen.com,https://xn--n-deutschprfungen-d3b.com,https://www.xn--n-deutschprfungen-d3b.com`

## Resend Setup

Required production checklist:

- Add `n-deutschprüfungen.com` in Resend Domains.
- Add the SPF, DKIM, and MX records Resend provides.
- Add or verify a DMARC record in DNS.
- Confirm the Resend domain status is verified.
- Store `RESEND_API_KEY` only in server/Vercel environment variables.
- Use an official sender. For IDN domains, use the ASCII/punycode domain in the email address, for example `N-Deutschprüfungen <no-reply@xn--n-deutschprfungen-d3b.com>`.

Environment variables:

- `RESEND_API_KEY`
- `EMAIL_FROM=N-Deutschprüfungen <no-reply@xn--n-deutschprfungen-d3b.com>`
- `EMAIL_FROM_NAME=N-Deutschprüfungen`
- `SUPPORT_EMAIL=support@xn--n-deutschprfungen-d3b.com`
- `CONTACT_TO=support@xn--n-deutschprfungen-d3b.com`

If `RESEND_API_KEY` is missing locally, the server logs emails instead of sending them.

## Verification Flow

Registration creates the user, generates a legacy verification link and a 6-digit code, sends the code email, then routes the user to `/verify-email`.

The verification page accepts:

- the 6-digit code plus email
- legacy `/verify-email/:token` links

When verification succeeds, the server sends a welcome email once. Email verification is soft by default, so users are reminded to verify but are not blocked from the app unless `EMAIL_VERIFICATION_MODE=strict` is set.

## Password Reset Flow

Forgot password sends a generic success response so account existence is not revealed. The reset link points to `/reset-password/:token`; the frontend also supports `/reset-password?token=...`.

After a successful password reset:

- the password hash is updated
- active refresh sessions are revoked
- a password-changed security email is sent

## Promotional Emails

Promotional email consent is separate from auth/security email.

- Registration opt-in is off by default.
- Profile settings let the user change `marketing_emails_enabled`.
- Disabling marketing email records `marketing_unsubscribed_at`.
- Auth emails must not contain promotional copy.
- Future admin promotional sending should only target users with `marketing_emails_enabled = true`.

## Database Fields

The server auto-ensures these user fields:

- `verification_code_hash`
- `verification_code_expires_at`
- `last_verification_email_sent_at`
- `welcome_email_sent_at`
- `marketing_emails_enabled`
- `marketing_unsubscribed_at`

Email delivery attempts are logged in `email_events`.

## Supabase Auth Note

The attached production brief asks for Supabase Auth to become the source of truth. This repository is not currently wired to Supabase Auth; it uses a custom `users` table, app JWTs, and refresh tokens. A full Supabase Auth migration still requires a controlled migration plan for existing users and Supabase dashboard/API configuration:

- Supabase Auth Site URL and redirect URLs
- custom SMTP through Resend
- Auth email templates with the correct OTP variables
- service role/admin migration strategy for existing users

Do not switch this app to Supabase Auth by only changing frontend code; existing password hashes and sessions need a planned migration.

Required Supabase Auth production settings for the future migration:

- Site URL: `https://n-deutschprüfungen.com/`
- Redirect URLs: `/verify-email`, `/reset-password`, `/auth/callback`, and `/dashboard` on the production domain.
- Custom SMTP: Resend SMTP host, port, username `resend`, and the Resend API key as the SMTP password.
- Sender name: `N-Deutschprüfungen`
- Sender email: use the verified punycode sender address.
- Templates: confirmation/OTP, reset password, email change, and security notices with no promotional content.

Known limitation: this release implements production email verification, password reset, welcome emails, and marketing preferences in the existing custom auth system. It does not complete the larger Supabase Auth migration because that would require a controlled user/session migration and dashboard configuration.

## Production Test Checklist

- Register a new user.
- Confirm the email arrives from the official sender.
- Verify with the 6-digit code.
- Try a wrong code and confirm a clear error.
- Resend the code and confirm the cooldown.
- Confirm the welcome email sends once after verification.
- Request a password reset.
- Open the reset link on the production domain.
- Set a new password and log in.
- Confirm marketing opt-in/off works in profile settings.
- Confirm `RESEND_API_KEY` is not present in frontend bundles.
