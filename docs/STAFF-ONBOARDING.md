# Tidyline Staff Onboarding

## 1. Run the migration
Run the SQL inside `supabase/migrations/012_staff_onboarding_login.sql` in Supabase SQL Editor.

## 2. Deploy the Edge Function
Deploy `supabase/functions/create-staff-account` as `create-staff-account`.

The Supabase Edge Function automatically has access to `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in a normal Supabase project deployment.

## 3. Onboard a staff member
Admin → Staff → Add professional.

Enter:
- Full name
- Login password (minimum 8 characters)
- Email
- Phone
- Address

Tidyline generates a Staff ID such as `TDL-0001`.

The password is stored by Supabase Authentication; it is **not** stored in `public.staff`.

## 4. Staff login
Open `staff.html`.

The staff member enters:
- Staff ID, e.g. `TDL-0001`
- The password chosen during onboarding

The portal internally maps the Staff ID to the employee email and signs in through Supabase Auth.

## 5. Important
Do not add a `password` column to `public.staff`. Passwords must remain in Supabase Auth.

## 6. Deploy the Staff ID login function
Also deploy `supabase/functions/staff-login` as `staff-login`. Staff login is performed by Staff ID + password; the underlying employee email is never shown in the Staff Portal login form.
