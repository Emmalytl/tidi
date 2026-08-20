-- TIDYLINE: STAFF AVAILABILITY / LEAVE MANAGEMENT
-- Run after the existing Tidyline migrations.

create table if not exists staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  status text not null check (status in ('available','unavailable','leave','sick','day_off','inactive')),
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists staff_availability_staff_dates_idx
  on staff_availability(staff_id, start_date, end_date);

alter table staff_availability enable row level security;

drop policy if exists staff_availability_admin_select on staff_availability;
create policy staff_availability_admin_select
  on staff_availability for select to authenticated using (true);

drop policy if exists staff_availability_admin_insert on staff_availability;
create policy staff_availability_admin_insert
  on staff_availability for insert to authenticated with check (true);

drop policy if exists staff_availability_admin_update on staff_availability;
create policy staff_availability_admin_update
  on staff_availability for update to authenticated using (true) with check (true);

drop policy if exists staff_availability_admin_delete on staff_availability;
create policy staff_availability_admin_delete
  on staff_availability for delete to authenticated using (true);
