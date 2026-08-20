# Tidyline update — Invoice, Print & Staff Availability

## Fixed
- Admin **Invoice** action now opens a real invoice preview with **Print invoice** and **Send invoice by email** actions.
- Admin **Print** action opens the invoice and triggers browser print; if the popup is blocked, a hidden iframe fallback is used.
- Invoice includes customer, service, date/time, address, payment status, currency and total.
- Invoice is responsive for mobile printing/preview.
- Removed customer address from the main Admin bookings dashboard table; address remains available to the invoice, email and CSV export.
- Added staff availability statuses: Available, Unavailable, On Leave, Sick Off, Day Off and Inactive.
- Staff availability date ranges prevent unavailable staff from appearing as available for new assignments on affected service dates.
- Added audit entries for availability changes.

## Database
Run:
`supabase/migrations/004_staff_availability.sql`

This creates the `staff_availability` table and authenticated-admin RLS policies.

## Email
Invoice email still requires the `send-email` Supabase Edge Function and `RESEND_API_KEY` / `EMAIL_FROM` secrets to be configured as described in `docs/EMAIL-SETUP.md`.
