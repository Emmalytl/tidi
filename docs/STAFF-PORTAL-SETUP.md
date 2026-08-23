# Tidyline Staff Portal Setup

## 1. Run the migration
In Supabase SQL Editor, run the SQL inside:
`supabase/migrations/010_staff_portal.sql`

## 2. Create a staff login
For each employee, open Supabase > Authentication > Users > Add user. Create an email/password account.

## 3. Link the account to the employee
Copy the Auth user's UUID and run:

```sql
update public.staff
set auth_user_id = 'PASTE-AUTH-USER-UUID-HERE'
where email = 'employee@tidyline.com';
```

Do not paste the UUID into the public website.

## 4. Staff workflow
- Staff signs in at `staff.html`.
- Only their assigned bookings are returned by the staff RPC.
- Assigned booking -> Start Job -> In Progress.
- In Progress -> Complete Job -> Completed.
- Start/end timestamps are recorded by the database.
- Staff can submit availability/absence requests with a reason.
- Requests are pending until Admin approval.

## 5. Admin approval
The current Admin interface should be extended with an Availability Requests view that approves/rejects rows in `staff_availability_requests` and, on approval, writes the official record to `staff_availability` and updates `staff.current_status`.

## 6. Security note
The existing project was originally built with broad authenticated RLS policies for the Admin. The staff portal itself uses SECURITY DEFINER RPCs that scope reads/actions to `auth.uid()`. Before production, replace broad authenticated table policies with explicit Admin-role policies and Staff self-service policies so a staff user cannot query tables directly outside the RPC layer.
