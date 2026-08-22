# Tidyline Web Final — Staff, Booking & Reset Update

## Included
- Booking queue sorted Pending → Assigned → In Progress → Completed → Cancelled, with date/time sorting inside each status.
- Assigned staff name is shown directly in the booking table.
- Booking deletion from Admin.
- Clear Audit Tray history.
- Protected Fresh Start operation using the exact confirmation phrase `RESET TIDYLINE`; preserves the authenticated admin account and resets business settings.
- Staff employee profiles with contact, employment, emergency-contact and payroll information.
- Weekly/monthly hours and assigned job revenue metrics.
- Gross, estimated tax, deductions and net salary calculations.
- Staff availability/leave records can be changed back to Available by replacing overlapping records.
- Currency ambiguity fixed in the booking RPC by qualifying `settings.currency`.

## Database
Run migrations 001 through 006 in order. The new migration is `006_staff_profiles_reset_and_management.sql`.
