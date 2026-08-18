-- Tidyline professional upgrade. Run after the existing Tidyline schema.
-- Safe for an existing installation: uses IF NOT EXISTS where possible.

alter table bookings add column if not exists email text;
alter table bookings add column if not exists price numeric(10,2);
alter table bookings add column if not exists booking_ref text;
alter table bookings add column if not exists payment_status text not null default 'unpaid';
alter table bookings add column if not exists updated_at timestamptz not null default now();

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
insert into settings(id) values(1) on conflict(id) do nothing;

alter table settings enable row level security;
drop policy if exists settings_public_read on settings;
create policy settings_public_read on settings for select to anon using(true);
drop policy if exists settings_admin_all on settings;
create policy settings_admin_all on settings for all to authenticated using(true) with check(true);

insert into storage.buckets(id,name,public) values('logos','logos',true) on conflict(id) do nothing;
drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects for select using(bucket_id='logos');
drop policy if exists logos_admin_insert on storage.objects;
create policy logos_admin_insert on storage.objects for insert to authenticated with check(bucket_id='logos');
drop policy if exists logos_admin_update on storage.objects;
create policy logos_admin_update on storage.objects for update to authenticated using(bucket_id='logos');
drop policy if exists logos_admin_delete on storage.objects;
create policy logos_admin_delete on storage.objects for delete to authenticated using(bucket_id='logos');

create or replace function set_booking_reference()
returns trigger language plpgsql as $$
begin
  if new.booking_ref is null or new.booking_ref='' then
    new.booking_ref := 'TD-' || to_char(coalesce(new.created_at,now()),'YYYYMMDD') || '-' || upper(substr(md5(new.id || clock_timestamp()::text),1,6));
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists bookings_reference_trigger on bookings;
create trigger bookings_reference_trigger before insert or update on bookings for each row execute function set_booking_reference();

-- Replace the previous RPC with a priced, reference-generating version.
drop function if exists create_booking(text,text,text,text,date,text,text,text,text);
drop function if exists create_booking(text,text,text,text,text,date,text,text,text,text);

create or replace function create_booking(
  p_id text,p_name text,p_phone text,p_email text,p_address text,
  p_date date,p_start text,p_end text,p_type text,p_notes text
)
returns table(assigned_staff_id text,assigned_staff_name text,cap_exceeded boolean,price numeric,booking_ref text)
language plpgsql security definer set search_path=public as $$
declare
  v_dur numeric; v_week_start date; v_week_end date; v_chosen_id text; v_chosen_name text;
  v_cap_exceeded boolean:=false; v_rate numeric:=0; v_price numeric:=0; v_ref text;
begin
  if trim(coalesce(p_name,''))='' or trim(coalesce(p_email,''))='' then raise exception 'Name and email are required'; end if;
  if p_date < current_date then raise exception 'Service date cannot be in the past'; end if;
  v_dur := extract(epoch from (p_end::time-p_start::time))/3600.0;
  if v_dur <= 0 then raise exception 'End time must be after start time'; end if;
  if v_dur > 12 then raise exception 'Service duration is too long'; end if;
  v_week_start := p_date-(((extract(dow from p_date)::int+6)%7)); v_week_end:=v_week_start+7;
  select case p_type when 'Standard clean' then price_standard when 'Deep clean' then price_deep when 'Move-in / move-out' then price_moveinout when 'Office clean' then price_office else null end into v_rate from settings where id=1;
  if v_rate is null then raise exception 'Invalid service type'; end if;
  v_price:=round(v_rate*v_dur,2);
  select id,name into v_chosen_id,v_chosen_name from (
    select s.id,s.name,coalesce((select sum(extract(epoch from (b.end_time::time-b.start_time::time))/3600.0) from bookings b where b.staff_id=s.id and b.status<>'cancelled' and b.date>=v_week_start and b.date<v_week_end),0) current from staff s where s.active
  ) c where current<20 and current+v_dur<=40 order by current asc,random() limit 1;
  if v_chosen_id is null then
    select id,name into v_chosen_id,v_chosen_name from (
      select s.id,s.name,coalesce((select sum(extract(epoch from (b.end_time::time-b.start_time::time))/3600.0) from bookings b where b.staff_id=s.id and b.status<>'cancelled' and b.date>=v_week_start and b.date<v_week_end),0) current from staff s where s.active
    ) c where current+v_dur<=40 order by current asc,random() limit 1;
  end if;
  if v_chosen_id is null then
    v_cap_exceeded:=true;
    select id,name into v_chosen_id,v_chosen_name from (
      select s.id,s.name,coalesce((select sum(extract(epoch from (b.end_time::time-b.start_time::time))/3600.0) from bookings b where b.staff_id=s.id and b.status<>'cancelled' and b.date>=v_week_start and b.date<v_week_end),0) current from staff s where s.active
    ) c order by current asc limit 1;
  end if;
  if v_chosen_id is null then raise exception 'No active staff available'; end if;
  v_ref:='TD-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(md5(p_id||clock_timestamp()::text),1,6));
  insert into bookings(id,name,phone,email,address,date,start_time,end_time,type,notes,status,staff_id,price,booking_ref,payment_status)
  values(p_id,p_name,p_phone,p_email,p_address,p_date,p_start,p_end,p_type,p_notes,'assigned',v_chosen_id,v_price,v_ref,'unpaid');
  insert into activity_log(message) values('New booking '||v_ref||' from '||p_name||' — assigned to '||v_chosen_name||case when v_cap_exceeded then ' (over 40h cap)' else '' end);
  return query select v_chosen_id,v_chosen_name,v_cap_exceeded,v_price,v_ref;
end; $$;
grant execute on function create_booking(text,text,text,text,text,date,text,text,text,text) to anon;

create index if not exists bookings_date_idx on bookings(date);
create index if not exists bookings_staff_date_idx on bookings(staff_id,date);
create unique index if not exists bookings_booking_ref_idx on bookings(booking_ref) where booking_ref is not null;
