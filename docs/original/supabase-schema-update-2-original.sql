-- ============================================================
-- Tidyline — schema update 2
-- Adds: company branding + hourly service rates (settings table),
-- email/price capture on bookings, a public "logos" storage bucket
-- for logo uploads, and updates create_booking() to price the job
-- and store the client's email. Run this AFTER supabase-schema.sql,
-- once, in Supabase: Project → SQL Editor → New query → Run.
-- ============================================================

-- ---------- New columns on bookings ----------
alter table bookings add column if not exists email text;
alter table bookings add column if not exists price numeric(10,2);

-- ---------- Company branding + hourly rates (single row) ----------
create table if not exists settings (
  id int primary key default 1,
  company_name text not null default 'Tidyline',
  logo_url text,
  price_standard numeric(10,2) not null default 45,
  price_deep numeric(10,2) not null default 65,
  price_moveinout numeric(10,2) not null default 55,
  price_office numeric(10,2) not null default 50,
  updated_at timestamptz not null default now()
);
insert into settings (id, company_name, logo_url, price_standard, price_deep, price_moveinout, price_office)
values (1, 'Tidyline', null, 45, 65, 55, 50)
on conflict (id) do nothing;

alter table settings enable row level security;

-- Public visitors need to read the company name/logo/rates to render
-- the homepage — this is intentionally public information.
create policy "settings_public_read" on settings for select to anon using (true);
-- Only signed-in admins can change them
create policy "settings_admin_all" on settings for all to authenticated using (true) with check (true);

-- ---------- Logo storage bucket ----------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "logos_public_read" on storage.objects
  for select using (bucket_id = 'logos');
create policy "logos_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'logos');
create policy "logos_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'logos');
create policy "logos_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'logos');

-- ---------- Updated create_booking(): now takes an email, prices the
-- job from the current hourly rate × duration, stores both, and
-- returns the price for the confirmation screen. Must drop the old
-- version first since the parameter list changed.
drop function if exists create_booking(text,text,text,text,date,text,text,text,text);

create or replace function create_booking(
  p_id text, p_name text, p_phone text, p_email text, p_address text,
  p_date date, p_start text, p_end text, p_type text, p_notes text
)
returns table(assigned_staff_id text, assigned_staff_name text, cap_exceeded boolean, price numeric)
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
  v_rate numeric;
  v_price numeric;
begin
  v_dur := (extract(epoch from (p_end::time - p_start::time))) / 3600.0;
  if v_dur < 0 then v_dur := v_dur + 24; end if;

  select case p_type
    when 'Standard clean' then s.price_standard
    when 'Deep clean' then s.price_deep
    when 'Move-in / move-out' then s.price_moveinout
    when 'Office clean' then s.price_office
    else 0
  end into v_rate
  from settings s where s.id = 1;

  v_price := coalesce(v_rate, 0) * v_dur;

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

  insert into bookings(id, name, phone, email, address, date, start_time, end_time, type, notes, status, staff_id, price)
  values (p_id, p_name, p_phone, p_email, p_address, p_date, p_start, p_end, p_type, p_notes, 'assigned', v_chosen_id, v_price);

  insert into activity_log(message) values (
    'New request from ' || p_name || ' — auto-assigned to ' || v_chosen_name ||
    case when v_cap_exceeded then ' (over 40h cap — no one had room)' else '' end
  );

  return query select v_chosen_id, v_chosen_name, v_cap_exceeded, v_price;
end;
$$;

grant execute on function create_booking(text,text,text,text,text,date,text,text,text,text) to anon;
