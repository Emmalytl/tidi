-- Tidyline final public-site additions.
-- Run after the existing Tidyline migrations.

alter table settings add column if not exists whatsapp_number text not null default '';

create or replace function public.lookup_public_booking(p_booking_ref text, p_email text)
returns table(
  booking_ref text,
  customer_name text,
  service_date date,
  start_time text,
  end_time text,
  service_type text,
  status text,
  staff_name text,
  price numeric,
  currency text,
  payment_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    b.booking_ref,
    b.name,
    b.date,
    b.start_time,
    b.end_time,
    b.type,
    b.status,
    coalesce(s.name, 'Pending assignment'),
    b.price,
    coalesce(b.currency, 'USD'),
    coalesce(b.payment_status, 'unpaid')
  from public.bookings b
  left join public.staff s on s.id = b.staff_id
  where upper(trim(b.booking_ref)) = upper(trim(p_booking_ref))
    and lower(trim(b.email)) = lower(trim(p_email))
  limit 1;
end;
$$;

revoke all on function public.lookup_public_booking(text,text) from public;
grant execute on function public.lookup_public_booking(text,text) to anon, authenticated;

-- Public booking status should not expose private booking fields.
