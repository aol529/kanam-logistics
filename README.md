# Kanam Logistics Limited

Company website and staff portal. Static HTML/CSS/JS backed by Supabase.

- **Website**: Home, About, Services, Pishori Rice, Projects and Contact. Rice products and prices, projects and the company details come from Supabase, so staff can change them without touching code. The order / quote form saves to Supabase and offers WhatsApp too.
- **Staff portal** (`/portal/`): sign in to manage **Inquiries** (orders and quote requests from the site: status, notes, call or WhatsApp the customer), **Products** (sizes, prices, stock, photos), **Projects** (road works, supplies, rice; with photos) and **Settings** (phone, email, registration details, About text...).

Until Supabase is connected the website still works: it shows the default content in `js/data.js`, and the form sends by WhatsApp once a WhatsApp number is set there.

## Placeholders

Anything in `[square brackets]` is a placeholder and shows **highlighted in yellow** on the site. Replace them in the portal (Settings) once it is connected, or in `js/data.js` before then. Still to fill in: phone, WhatsApp, email, office location, P.O. Box, hours, delivery areas, year registered, registration number, KRA PIN, directors, number of road contracts, years supplying institutions, and the sample projects. Photo spaces are the striped boxes; add pictures to products and projects from the portal.

## Setup

1. Create a new Supabase project.
2. In its SQL editor, run `sql/01-schema.sql`.
3. Authentication → Users → **Add user** (your email and a password). Then, in the SQL editor:
   `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
4. Authentication → Sign In / Providers: turn **off** "Allow new users to sign up" (staff are added by hand, as in step 3).
5. Put the project URL and publishable key in `js/config.js` (Project Settings → API).
6. `npm start`, then open http://localhost:3002 (portal: http://localhost:3002/portal/).

Pushing to `main` publishes the site to GitHub Pages (`.github/workflows/pages.yml`), once the repository exists and Pages is set to "GitHub Actions".
