# Tidyline — Final Web Platform

This package contains the customer website, Admin Console and Staff Portal.

## Pages

- `index.html` — frozen customer-facing booking experience.
- `admin.html` — Admin Console.
- `staff.html` — Staff Portal.

## Final workflow

Customer booking:

`Pending → Assigned → In Progress → Completed`

- Customer creates a booking: **Pending / unassigned**.
- Admin assigns a staff member: **Assigned**.
- Staff logs in and starts the job: **In Progress** and `started_at` is recorded.
- Staff completes the job: **Completed** and `completed_at`/end time are recorded.
- Recorded time feeds Admin hours, revenue and payroll calculations.

## Staff availability

Staff can submit availability/absence requests with:

- Available
- Unavailable
- Day off
- Sick off
- Leave
- Start and end dates
- Required reason

Requests remain **Pending** until Admin approves or rejects them. Approved requests are written to official staff availability and are considered by booking assignment.

## Final integration migration

Run the SQL contained in:

`supabase/migrations/011_admin_staff_integration.sql`

Run it **after** the existing Tidyline migrations, including `010_staff_portal.sql`.

Do not paste the filename into Supabase SQL Editor; paste the SQL contained in the file.

## Staff account setup

1. Create the staff member in Admin.
2. Create the employee's Supabase Authentication account.
3. Copy the Auth user's UUID.
4. Link it to the employee:

```sql
UPDATE public.staff
SET auth_user_id = 'AUTH-USER-UUID'
WHERE email = 'employee@tidyline.com';
```

5. Open `staff.html` and sign in with that account.

## Payroll

Payroll uses recorded completed-job hours plus the staff pay settings. The Admin payroll screen shows:

- Gross salary
- Employee SSNIT (5.5% of basic salary)
- Graduated PAYE estimate
- Tidyline administrative charge (10%)
- Other deductions
- Net salary

SSNIT/PAYE calculations are estimates for operational planning and should be reviewed by the company's payroll/accounting adviser before statutory filing.

## Security

- Admin and Staff use separate Supabase authentication flows.
- Staff job actions are performed through staff-scoped RPCs.
- Staff availability requests are submitted through an RPC.
- Destructive Admin RPCs require an authenticated Admin session that is not linked to an active staff account.
- Admin inactivity logout is 5 minutes.

## Public index

The customer-facing index is intentionally treated as frozen for this release. Future changes should be made only after a deliberate product decision.
