# Deployment Setup

This is the production setup:

* **GitHub:** Source code and repository
* **Supabase:** Backend, database, authentication, and storage
* **Vercel:** Application deployment and production URL
* **Hostinger:** Domain and DNS management

## Vercel Deployment

The application is deployed directly from the GitHub repository through Vercel.

* Repository: `Deutsch Prüfungen/german-exam-app`
* Branch: `feature/ui-improvements`
* Framework: Vite
* Root Directory: `client/gem-app`
* Build Command: `npm run build`
* Output Directory: `dist`

Vercel handles the production deployment and provides the application URL.

## Supabase

Supabase is used for the backend and PostgreSQL database.

The application connects to Supabase through its configured environment variables and client settings.

## Domain

The custom domain is managed through **Hostinger DNS** and connected to the Vercel deployment.

* `xn--n-deutschprfungen-d3b.com`
* `www.xn--n-deutschprfungen-d3b.com`

**Deployment flow:**

`GitHub → Vercel → Production`

`Application → Supabase`

`Domain/DNS → Hostinger`

