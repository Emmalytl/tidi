# Deployment guide

## Supabase

1. Open the Supabase SQL Editor.
2. For a fresh project, run the original `supabase-schema.sql` from the previous project, then run `supabase/migrations/001_professional_upgrade.sql`.
3. For the existing Tidyline project, run only `001_professional_upgrade.sql`.
4. Create an admin user under Authentication → Users.
5. Deploy the function at `supabase/functions/send-email` using the Supabase CLI or dashboard workflow.

## Frontend

Upload the project to your hosting provider. The application consists of static frontend files, so Cloudflare Pages, Netlify, Vercel or traditional web hosting can serve it.

Use HTTPS in production.

## Before launch

- Test customer booking from a separate browser.
- Test admin login.
- Test booking assignment.
- Test completion/cancellation.
- Test invoice email.
- Test CSV export.
- Test mobile layout.
- Review RLS policies.
- Configure database backups.
- Replace any demo staff names and prices.
