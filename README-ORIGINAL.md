# Tidyline — cleaning dispatch app

A public booking page (`index.html`) plus a separate admin dashboard (`admin.html`),
backed by a real Supabase database so data persists no matter who visits or where
it's hosted.

## Files

| File | Purpose |
|---|---|
| `index.html` | Public page — company info + booking form. This is your homepage. |
| `admin.html` | Staff/admin dashboard. Not linked from the main nav — only from the footer and directly by URL. |
| `style.css` | Shared design system for both pages. |
| `config.js` | **Edit this** — your Supabase project URL and public API key go here. |
| `supabase-schema.sql` | Run first in Supabase to create your core tables, security rules, and fair-assignment logic. |
| `supabase-schema-update-2.sql` | Run second — adds branding/pricing settings, logo storage, and pricing on bookings. |
| `supabase/functions/send-email/index.ts` | Edge Function that sends invoice/receipt emails via Resend. Deployed with the Supabase CLI, not copy-pasted into SQL Editor. |

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up (free) → **New project**.
2. Pick a name, a database password (save it somewhere), and a region close to your customers.
3. Wait ~2 minutes for it to provision.

## 2. Run the schema

1. In your Supabase project, open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-schema.sql` and click **Run**.
3. This creates the `staff`, `bookings`, and `activity_log` tables, locks them down with
   Row Level Security, seeds four starter staff members, and creates the
   `create_booking` function the public booking form calls.
4. Open a **new query**, paste the entire contents of `supabase-schema-update-2.sql`, and
   run it too. This adds:
   - a `settings` table for your company name, logo, and hourly rate per service type
   - `email` and `price` columns on `bookings`
   - a public `logos` storage bucket the admin dashboard uploads your logo into
   - an updated `create_booking` that prices each job and stores the client's email

## 3. Create your admin login

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter the email and password you want to sign into `admin.html` with.
3. There's no public sign-up page — only accounts you create here can log in.
4. Add more admin accounts the same way if more than one person needs access.

## 4. Connect the app to your project

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `config.js` and paste them in:
   ```js
   const SUPABASE_URL = "https://your-project-ref.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
   This key is *meant* to be public in front-end code — Row Level Security
   (already set up by the SQL scripts) is what actually protects your data,
   not keeping this key secret.

## 5. Set up email sending (invoices + receipts)

Emails go out through [Resend](https://resend.com) (free for up to 3,000 emails/month),
called from a small server-side function — browsers can't send email directly, so this
step is what makes "Email invoice" and "Email receipt" actually work.

1. **Sign up at [resend.com](https://resend.com)** and create an API key
   (Dashboard → API Keys → Create). For real deliverability, also verify your own
   sending domain under Domains — until then, Resend's shared `onboarding@resend.dev`
   sender works fine for testing.
2. **Install the Supabase CLI** if you don't have it: `npm install -g supabase`
3. **Log in and link your project**:
   ```
   supabase login
   supabase link --project-ref your-project-ref
   ```
   (find `your-project-ref` in your Supabase project URL)
4. **Set your secrets** (the Resend key never goes in your public repo):
   ```
   supabase secrets set RESEND_API_KEY=your_resend_api_key
   supabase secrets set RESEND_FROM="Tidyline <onboarding@resend.dev>"
   ```
5. **Deploy the function** — from the folder containing the `supabase/` directory:
   ```
   supabase functions deploy send-email
   ```
6. Test it: submit a booking on `index.html` with a real email address — you should get
   an invoice email within a few seconds. If not, check **Edge Functions → send-email →
   Logs** in your Supabase dashboard for the error.

Once this is deployed, invoices send automatically the moment someone books, and
receipts send automatically when an admin marks a job **Completed**. Admins can also
resend either one manually from the bookings table.

## 6. Set your branding and pricing

Sign into `admin.html` and click **Settings** in the top right:
- Set your company name and either upload a logo image or paste an image URL — both
  the homepage and the admin dashboard pick it up automatically.
- Set your hourly rate for each service type. Booking totals are calculated as
  **rate × duration** of the requested time window, and locked in at booking time.

## 7. Test locally before publishing

Open `index.html` directly in your browser (or run a local server) and submit a
test booking. Then open `admin.html`, sign in, and confirm it shows up. If
something fails, open the browser console (F12) — Supabase errors show up there.

## 8. Host it on GitHub Pages

1. Create a new GitHub repository and push these files to it (root of the repo,
   or a `/docs` folder — either works). Include the `supabase/` folder too, even
   though GitHub Pages won't serve it — it's what the Supabase CLI deploys from.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose the branch and folder your files are in, then **Save**.
4. GitHub gives you a URL like `https://yourname.github.io/your-repo/` — that's your
   live site. `admin.html` will be at `https://yourname.github.io/your-repo/admin.html`.

That's it — no server to run or maintain. GitHub Pages serves the static files;
Supabase handles the database and email sending.

## Notes on the design

- **20h soft target / 40h hard cap per staff member, per Monday–Sunday week** — enforced
  both when a client books (via the `create_booking` database function) and when an
  admin uses Shuffle in the dashboard.
- **Public visitors never read the bookings table directly** — the booking form only
  calls `create_booking`, which runs the assignment privately and returns just the
  assigned staff member's name and price. This keeps other clients' names, phones,
  and addresses private from the public.
- **Admin actions require a real Supabase login** — reassigning, shuffling, marking
  jobs complete/cancelled, managing staff, editing branding/pricing, and resending
  emails are all only possible once signed in.
- **Pricing is rate × duration**, using whatever hourly rate is set per service type
  in Settings at the moment of booking — later rate changes don't affect past bookings.
- **Invoices send automatically on booking; receipts send automatically when a job is
  marked Completed.** Both can also be resent manually from the bookings table.
- Want a custom domain instead of the `github.io` URL? Add a `CNAME` file with your
  domain, and point your domain's DNS at GitHub Pages — GitHub's Pages docs walk
  through this if you search "GitHub Pages custom domain."
