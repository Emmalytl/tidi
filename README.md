# Tidyline — Professional Cleaning Management System

A production-oriented cleaning booking and dispatch application built with vanilla HTML/CSS/JavaScript and Supabase.

## Included

- Professional responsive public booking site
- Dynamic service pricing from Supabase settings
- Server-side booking creation and fair staff dispatch
- Automatic booking reference numbers
- Booking confirmation and invoice email integration
- Secure admin authentication through Supabase Auth
- Admin dashboard with search/filtering
- Booking status management
- Staff assignment and capacity tracking
- Activity/audit log
- Company branding and pricing settings
- CSV export
- Supabase Edge Function for transactional email
- Database migration for existing installations

## Folder structure

```text
tidyline/
├── index.html
├── admin.html
├── config.js
├── style.css
├── js/
│   ├── app.js
│   └── admin.js
├── supabase/
│   ├── functions/send-email/index.ts
│   └── migrations/001_professional_upgrade.sql
├── docs/
│   ├── DEPLOYMENT.md
│   └── ADMIN-GUIDE.md
└── assets/
```

## Setup

1. Create/open the Supabase project used by the application.
2. Confirm `config.js` contains your Supabase URL and public/anon key.
3. If this is a new database, run the supplied original schema followed by `supabase/migrations/001_professional_upgrade.sql`.
4. If you already installed the previous Tidyline version, run **only** `001_professional_upgrade.sql`.
5. Create your administrator in Supabase Authentication → Users.
6. Deploy the Edge Function from `supabase/functions/send-email` and configure its email provider secrets according to the function source.
7. Host the project from a web server; do not open the files through `file://` for production.

## Important security notes

The Supabase public/anon key is designed to be present in browser applications. Do not place a Supabase `service_role` key in this project. Database security must be enforced with Row Level Security and server-side functions.

Before public launch, review Supabase Auth settings, RLS policies, storage policies, SMTP/provider configuration and backups.

## Current dispatch rule

The booking RPC attempts to:

1. Prefer active staff below 20 hours for the Monday–Sunday week.
2. Otherwise choose active staff with room below 40 hours.
3. If nobody has room, select the lowest-hour active professional and flag the booking as over-capacity.

The assignment is performed in PostgreSQL rather than trusted to the public browser.


## Final build additions

- Currency selector: USD, GHS, EUR, GBP.
- Customer address displayed in the Admin bookings table and included in CSV export.
- CSV export includes booking reference, customer, email, phone, address, service, schedule, staff, status, payment status, currency, price, and creation time.
- Invoice email is sent through the Supabase `send-email` Edge Function.
- Admin can print an invoice directly from the booking table.
- Customer booking confirmation email is sent after a successful booking.
- New bookings remain pending and unassigned until an admin dispatches a staff member.

See `docs/EMAIL-SETUP.md` for transactional email configuration.

## Staff availability
Run `supabase/migrations/004_staff_availability.sql` after the other migrations to enable Available, Unavailable, On Leave, Sick Off, Day Off and Inactive staff statuses.
