# Tidyline Admin Professional Update

This package combines the current Tidyline public site with the updated professional Admin console.

## Key changes

- Tidyline is the only company name used in the Admin console.
- No logo is required on the Admin side.
- New bookings are **Pending / Unassigned** by default.
- Administrators manually assign staff.
- Audit logs are moved into a slide-out Audit Tray.
- Responsive sidebar navigation for desktop, tablet and mobile.
- 5-minute admin inactivity timeout with a 30-second warning.
- Admin session is signed out when leaving through the Public Site link.
- Staff workload and booking assignment controls are included.

## Important Supabase step

Run:

`supabase/migrations/002_no_automatic_staff_assignment.sql`

in Supabase SQL Editor after the existing schema/professional migration.

Do not expose a Supabase service-role key in the frontend. Continue using the public anon key with proper Row Level Security policies.
