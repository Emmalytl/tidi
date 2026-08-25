# Tidyline Staff Onboarding & Login Update

- Staff onboarding now asks for a password.
- Staff ID is generated automatically as `TDL-0001`, `TDL-0002`, etc.
- Staff address is stored in `public.staff.address`.
- Staff Portal login now uses Staff ID + password.
- Passwords are handled by Supabase Authentication and are never stored in `public.staff`.
- Added Edge Functions: `create-staff-account` and `staff-login`.
- Added migration: `012_staff_onboarding_login.sql`.
