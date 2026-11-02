alter table public.orders
  add column if not exists customer_email text not null default '';

alter table public.orders
  add column if not exists payment_reference text unique;

alter table public.orders
  add column if not exists payment_status text not null default 'pending'
  check (payment_status in ('pending', 'paid', 'failed'));
