create type order_status as enum (
  'pending',
  'accepted',
  'fulfilled',
  'cancelled'
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  slug text not null unique,
  name text not null,
  email text not null unique,
  location text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  order_text text not null,
  tracking_token text not null,
  status order_status not null default 'pending',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  fulfilled_at timestamptz
);

create index orders_by_business_status_created
on orders (business_id, status, created_at desc);

create index orders_by_tracking_token
on orders (tracking_token);

alter table businesses enable row level security;
alter table orders enable row level security;

create policy "Anyone can view active businesses"
on businesses
for select
to anon, authenticated
using (is_active = true);

create policy "Business owners can view their business"
on businesses
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Business owners can view their orders"
on orders
for select
to authenticated
using (
  business_id in (
    select id from businesses
    where owner_id = (select auth.uid())
  )
);

create policy "Business owners can update their orders"
on orders
for update
to authenticated
using (
  business_id in (
    select id from businesses
    where owner_id = (select auth.uid())
  )
);

-- After creating owner@beanandbloom.lk in Supabase Auth, copy that user's UUID
-- from Authentication > Users and replace the placeholder below.
insert into businesses (owner_id, slug, name, email, location)
values (
  '3484db7d-a99e-4a2d-a9d9-52f68d9792b5',
  'bean-bloom',
  'Bean & Bloom',
  'owner@beanandbloom.lk',
  'Colombo 07'
);
