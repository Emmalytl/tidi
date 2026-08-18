-- ============================================================
-- Tidyline — Supabase schema
-- Run this once in Supabase: Project → SQL Editor → New query → Run
-- ============================================================

-- ---------- Tables ----------
create table if not exists staff (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id text primary key,
  name text not null,
  phone text,
  address text,
  date date not null,
  start_time text not null,
  end_time text not null,
  type text,
  notes text,
  status text not null default 'assigned',
  staff_id text references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists activity_log (
  id bigserial primary key,
  message text not null,
  created_at timestamptz not null default now()
);

-- Starter roster — edit names, or manage from the admin dashboard later
insert into staff (id, name, active) values
  ('s1','Maria Santos', true),
  ('s2','Devon Brooks', true),
  ('s3','Priya Nair', true),
  ('s4','Kwame Osei', true)
on conflict (id) do nothing;

-- ---------- Row Level Security ----------
-- Public visitors (the "anon" role) get NO direct read/write access to these
-- tables at all. The booking form talks to the create_booking() function
-- below instead, which runs with elevated rights and only ever hands back
-- the assigned staff member's name — never the rest of the bookings table.
-- Admins, once signed in ("authenticated" role), get full access.

alter table staff enable row level security;
alter table bookings enable row level security;
alter table activity_log enable row level security;

create policy "staff_admin_all" on staff
  for all to authenticated using (true) with check (true);

create policy "bookings_admin_all" on bookings
  for all to authenticated using (true) with check (true);

create policy "log_admin_all" on activity_log
  for all to authenticated using (true) with check (true);

-- ---------- Booking + fair-assignment function ----------
-- Mirrors the app's rule: 20h/week soft target, 40h/week hard cap,
-- Monday–Sunday week. Runs server-side so the public client never
-- needs to read other people's bookings to make the pick.
create or replace function create_booking(
  p_id text, p_name text, p_phone text, p_address text,
  p_date date, p_start text, p_end text, p_type text, p_notes text
)
returns table(assigned_staff_id text, assigned_staff_name text, cap_exceeded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dur numeric;
  v_week_start date;
  v_week_end date;
  v_min_hours numeric := 20;
  v_max_hours numeric := 40;
  v_chosen_id text;
  v_chosen_name text;
  v_cap_exceeded boolean := false;
begin
  v_dur := (extract(epoch from (p_end::time - p_start::time))) / 3600.0;
  if v_dur < 0 then v_dur := v_dur + 24; end if;

  -- Monday-start week containing p_date
  v_week_start := p_date - (((extract(dow from p_date)::int + 6) % 7));
  v_week_end := v_week_start + 7;

  -- Pass 1: prefer active staff currently under the 20h target, with room under 40h
  select id, name into v_chosen_id, v_chosen_name
  from (
    select s.id, s.name,
      coalesce((select sum((extract(epoch from (b.end_time::time - b.start_time::time)))/3600.0)
                from bookings b
                where b.staff_id = s.id and b.status <> 'cancelled'
                  and b.date >= v_week_start and b.date < v_week_end), 0) as current
    from staff s where s.active
  ) c
  where c.current < v_min_hours and c.current + v_dur <= v_max_hours
  order by random() limit 1;

  -- Pass 2: anyone active with room under 40h
  if v_chosen_id is null then
    select id, name into v_chosen_id, v_chosen_name
    from (
      select s.id, s.name,
        coalesce((select sum((extract(epoch from (b.end_time::time - b.start_time::time)))/3600.0)
                  from bookings b
                  where b.staff_id = s.id and b.status <> 'cancelled'
                    and b.date >= v_week_start and b.date < v_week_end), 0) as current
      from staff s where s.active
    ) c
    where c.current + v_dur <= v_max_hours
    order by random() limit 1;
  end if;

  -- Pass 3: nobody has room — assign to whoever has the fewest hours, flag it
  if v_chosen_id is null then
    v_cap_exceeded := true;
    select id, name into v_chosen_id, v_chosen_name
    from (
      select s.id, s.name,
        coalesce((select sum((extract(epoch from (b.end_time::time - b.start_time::time)))/3600.0)
                  from bookings b
                  where b.staff_id = s.id and b.status <> 'cancelled'
                    and b.date >= v_week_start and b.date < v_week_end), 0) as current
      from staff s where s.active
    ) c
    order by c.current asc limit 1;
  end if;

  if v_chosen_id is null then
    raise exception 'No active staff available';
  end if;

  insert into bookings(id, name, phone, address, date, start_time, end_time, type, notes, status, staff_id)
  values (p_id, p_name, p_phone, p_address, p_date, p_start, p_end, p_type, p_notes, 'assigned', v_chosen_id);

  insert into activity_log(message) values (
    'New request from ' || p_name || ' — auto-assigned to ' || v_chosen_name ||
    case when v_cap_exceeded then ' (over 40h cap — no one had room)' else '' end
  );

  return query select v_chosen_id, v_chosen_name, v_cap_exceeded;
end;
$$;

-- Let public visitors call the function (but NOT read the tables directly)
grant execute on function create_booking(text,text,text,text,date,text,text,text,text) to anon;
