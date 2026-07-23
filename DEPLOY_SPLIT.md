# Split Deployment

This is the recommended production setup:

- Vercel: React/Vite frontend from `client/gem-app`
- Railway: Express backend from `server`
- Supabase: PostgreSQL database
- Hostinger: domain/DNS only

## Railway Backend

Create a Railway service from the GitHub repository.

- Repository: `Deutsch Prüfungen/german-exam-app`
- Branch: `feature/ui-improvements`
- Build command: handled by `railway.json`
- Start command: handled by `railway.json`

Railway environment variables:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@aws-1-eu-west-2.pooler.supabase.com:5432/postgres
JWT_SECRET=generate-a-long-random-secret
FRONTEND_URL=https://YOUR_VERCEL_APP.vercel.app
CORS_ORIGINS=https://YOUR_VERCEL_APP.vercel.app,https://xn--n-deutschprfungen-d3b.com,https://www.xn--n-deutschprfungen-d3b.com
```

Do not set `SERVE_CLIENT` on Railway.

If your Supabase password contains reserved URL characters, encode them:

- `@` becomes `%40`
- `#` becomes `%23`

For the current session-pooler shape:

```env
DATABASE_URL=postgresql://postgres.nkcvrumtjknbooboyvxe:ENCODED_PASSWORD@aws-1-eu-west-2.pooler.supabase.com:5432/postgres
```

## Vercel Frontend

Create a Vercel project from the same GitHub repository.

- Framework: Vite
- Root Directory: `client/gem-app`
- Build Command: `npm run build`
- Output Directory: `dist`

Vercel environment variables:

```env
VITE_API_URL=https://YOUR_RAILWAY_BACKEND.up.railway.app
```

## Domain Later

After both deployments are healthy:

- Point `xn--n-deutschprfungen-d3b.com` and `www` to Vercel.
- Point `api.xn--n-deutschprfungen-d3b.com` to Railway.
- Update Railway `FRONTEND_URL` and `CORS_ORIGINS` to include the final domain.
- Update Vercel `VITE_API_URL` to the final API domain if desired.
