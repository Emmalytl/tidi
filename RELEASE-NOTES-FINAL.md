# Tidyline Final Web Release

## Included

- Frozen final customer index
- Responsive Admin Console
- Bookings and manual staff assignment
- Customers, invoices, reports and payroll
- Staff profiles and availability management
- Audit tray with individual delete and clear history
- Fresh Start / system reset protection
- Admin five-minute inactivity logout
- Staff Portal with authentication
- Staff-only job list
- Start Job / Complete Job timestamps
- Staff hours and earnings
- Staff availability/absence requests with Admin approval
- Admin ↔ Staff status and availability integration
- Mobile-first Staff Portal

## Database

Apply the migrations in order for the existing project. The final integration layer is:

`supabase/migrations/011_admin_staff_integration.sql`

This migration aligns the Admin destructive RPCs, adds Admin approval RPCs for Staff availability requests, protects staff request rows, and keeps temporary staff statuses from remaining stuck after their approved period ends.
