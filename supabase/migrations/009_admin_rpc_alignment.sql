-- TIDYLINE ADMIN V4: align RPC return types with the current database.
-- Run this AFTER previous migrations. Safe for existing installs.

drop function if exists public.clear_audit_history();
drop function if exists public.delete_audit_log(bigint);
drop function if exists public.delete_audit_log(text);
drop function if exists public.delete_booking(text);
drop function if exists public.reset_tidyline_system(text);

create function public.clear_audit_history()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.activity_log;
  return true;
end;
$$;
grant execute on function public.clear_audit_history() to authenticated;

create function public.delete_audit_log(p_log_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.activity_log where id = p_log_id;
  return found;
end;
$$;
grant execute on function public.delete_audit_log(bigint) to authenticated;

create function public.delete_booking(p_booking_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.bookings
  where id::text = p_booking_id or booking_ref = p_booking_id;
  return found;
end;
$$;
grant execute on function public.delete_booking(text) to authenticated;

create function public.reset_tidyline_system(p_confirmation text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_confirmation <> 'RESET TIDYLINE' then
    raise exception 'Invalid reset confirmation';
  end if;
  if to_regclass('public.activity_log') is not null then truncate table public.activity_log restart identity cascade; end if;
  if to_regclass('public.staff_availability') is not null then truncate table public.staff_availability restart identity cascade; end if;
  if to_regclass('public.invoices') is not null then truncate table public.invoices restart identity cascade; end if;
  if to_regclass('public.bookings') is not null then truncate table public.bookings restart identity cascade; end if;
  if to_regclass('public.customers') is not null then truncate table public.customers restart identity cascade; end if;
  if to_regclass('public.staff') is not null then truncate table public.staff restart identity cascade; end if;
  if to_regclass('public.settings') is not null then
    update public.settings set company_name='Tidyline', price_standard=45, price_deep=65, price_moveinout=55, price_office=50, currency='USD', updated_at=now() where id=1;
  end if;
  return true;
end;
$$;
grant execute on function public.reset_tidyline_system(text) to authenticated;
