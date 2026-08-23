# Tidyline Admin v2

This build keeps the customer `index.html` frozen and focuses on the Admin application.

## Changes
- Admin visual system aligned with the Tidyline public index: green/teal palette, soft surfaces, subtle gradients and responsive interactions.
- Improved responsive behavior for desktop, tablet and phone widths.
- Customers redesigned from large cards into a compact, simple table.
- Removed the duplicate **View profile** action from staff cards. Use **Availability & profile** as the single staff management entry point.
- Added a dedicated **Payroll** page to the Admin navigation.
- Payroll shows selected month, hours, gross salary, employee SSNIT (5.5%), graduated Ghana PAYE, Tidyline administrative charge (10%), other deductions and net salary.
- Payroll hours/revenue are based on completed jobs with recorded start/end times; the future Staff Portal will record the authoritative start/end timestamps.
- Audit Tray now has an `×` delete control on every history item.
- Audit Tray **Clear history** uses the protected database function.
- Fresh Start remains protected by the `RESET TIDYLINE` confirmation phrase.
- Staff availability replacement handles open-ended records so a person can reliably be returned from Leave/Sick/Day Off/Unavailable to Available.

## Database
Run `supabase/migrations/007_admin_operations_v2.sql` after migration 006.

The migration adds:
- `delete_audit_log(bigint)` for deleting one Audit Tray item.
- Explicit authenticated execution grants for the existing clear/reset/delete functions.

## Important
The customer-facing index page is intentionally unchanged in this build.
