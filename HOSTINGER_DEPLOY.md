# Hostinger Deployment

This app deploys as one Hostinger Node.js web app:

- Express serves the API.
- Express serves the built React/Vite frontend from `client/gem-app/dist` in production.
- Supabase provides the PostgreSQL database.

## Hostinger App Settings

Use the GitHub deployment flow in hPanel.

- Repository: `Deutsch Prüfungen/german-exam-app`
- Branch: `feature/ui-improvements` until it is merged to `main`
- Framework type: `Other` or `Express.js`
- Node.js version: `20.x` or `22.x`
- Build command: `npm run hostinger:build`
- Start command: `npm run hostinger:start`
- Entry file, if Hostinger asks: `server/server.js`

## Environment Variables

Set these in Hostinger's Node.js app Environment Variables page.

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:YOUR_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
JWT_SECRET=generate-a-long-random-secret
FRONTEND_URL=https://xn--n-deutschprfungen-d3b.com
CORS_ORIGINS=https://www.xn--n-deutschprfungen-d3b.com
```

If the Supabase password contains reserved URL characters, encode them:

- `@` becomes `%40`
- `#` becomes `%23`

For example, a password shaped like `word@123#` must be written as `word%40123%23` inside `DATABASE_URL`.

## Supabase Connection Note

Supabase direct database URLs use IPv6 by default. If Hostinger cannot connect to the direct `db.PROJECT_REF.supabase.co:5432` URL, use the Supabase **Session pooler** connection string from the Supabase dashboard instead.

## Email Later

The app can start without SMTP variables. In that mode, verification/reset messages are logged by the server instead of being sent. Add these when domain email is ready:

```env
EMAIL_SMTP_HOST=smtp.hostinger.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=no-reply@xn--n-deutschprfungen-d3b.com
EMAIL_SMTP_PASS=your-email-password
EMAIL_FROM=no-reply@xn--n-deutschprfungen-d3b.com
```
