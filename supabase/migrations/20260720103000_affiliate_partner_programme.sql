-- Partner/Affiliate Referral Programme
-- Additive migration. Existing users/payment tables are integer-keyed in this project,
-- so affiliate rows use UUID primary keys and reference users(id) / payment_transactions(id).

create extension if not exists pgcrypto;

create table if not exists public.affiliate_settings (
  id boolean primary key default true check (id = true),
  default_partner_commission_percent numeric(5,2) not null default 10 check (default_partner_commission_percent between 0 and 100),
  first_purchase_discount_percent numeric(5,2) not null default 5 check (first_purchase_discount_percent between 0 and 100),
  commission_scope text not null default 'first_successful_purchase' check (commission_scope in ('first_successful_purchase')),
  commission_hold_days integer not null default 14 check (commission_hold_days >= 0),
  minimum_withdrawal_amount numeric(12,2) not null default 10000 check (minimum_withdrawal_amount >= 0),
  default_currency text not null default 'XAF',
  attribution_cookie_days integer not null default 30 check (attribution_cookie_days > 0),
  programme_enabled boolean not null default true,
  updated_by integer references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.affiliate_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.affiliate_partners (
  id uuid primary key default gen_random_uuid(),
  user_id integer not null unique references public.users(id) on delete cascade,
  public_name text not null,
  status text not null default 'pending_review' check (status in ('active', 'suspended', 'pending_review')),
  commission_rate numeric(5,2) not null default 10 check (commission_rate between 0 and 100),
  payout_method text check (payout_method in ('mtn', 'orange')),
  payout_destination text,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_codes (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.affiliate_partners(id) on delete cascade,
  code text not null,
  discount_percent numeric(5,2) not null default 5 check (discount_percent between 0 and 100),
  commission_percent numeric(5,2) check (commission_percent is null or commission_percent between 0 and 100),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists affiliate_codes_code_lower_unique on public.affiliate_codes (lower(code));
create index if not exists affiliate_codes_partner_idx on public.affiliate_codes(partner_id, is_active);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.affiliate_partners(id) on delete restrict,
  affiliate_code_id uuid not null references public.affiliate_codes(id) on delete restrict,
  referred_user_id integer not null unique references public.users(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'converted', 'disqualified')),
  attributed_at timestamptz not null default now(),
  converted_at timestamptz,
  disqualification_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_referrals_partner_status_idx on public.affiliate_referrals(partner_id, status, attributed_at desc);

create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.affiliate_partners(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'XAF',
  payout_method text not null check (payout_method in ('mtn', 'orange')),
  payout_destination text not null,
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'rejected')),
  transaction_reference text,
  rejection_reason text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_payouts_partner_status_idx on public.affiliate_payouts(partner_id, status, requested_at desc);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.affiliate_partners(id) on delete restrict,
  referral_id uuid not null references public.affiliate_referrals(id) on delete restrict,
  payment_id integer not null references public.payment_transactions(id) on delete restrict,
  base_amount numeric(12,2) not null check (base_amount >= 0),
  commission_rate numeric(5,2) not null check (commission_rate between 0 and 100),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  currency text not null default 'XAF',
  status text not null default 'pending' check (status in ('pending', 'available', 'paid', 'cancelled')),
  available_at timestamptz not null,
  cancellation_reason text,
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id)
);

create index if not exists affiliate_commissions_partner_status_idx on public.affiliate_commissions(partner_id, status, available_at desc);

create table if not exists public.affiliate_events (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.affiliate_partners(id) on delete set null,
  affiliate_code_id uuid references public.affiliate_codes(id) on delete set null,
  user_id integer references public.users(id) on delete set null,
  event_type text not null,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_events_code_created_idx on public.affiliate_events(affiliate_code_id, created_at desc);

create table if not exists public.affiliate_admin_events (
  id serial primary key,
  admin_id integer references public.users(id) on delete set null,
  partner_id uuid references public.affiliate_partners(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.affiliate_settings enable row level security;
alter table public.affiliate_partners enable row level security;
alter table public.affiliate_codes enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_events enable row level security;
alter table public.affiliate_admin_events enable row level security;

create or replace function public.current_app_user_id()
returns integer language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::integer
$$;

create policy affiliate_settings_read on public.affiliate_settings for select using (true);
create policy affiliate_partners_read_own on public.affiliate_partners for select using (user_id = public.current_app_user_id());
create policy affiliate_codes_read_own on public.affiliate_codes for select using (
  exists (select 1 from public.affiliate_partners p where p.id = partner_id and p.user_id = public.current_app_user_id())
);
create policy affiliate_referrals_read_partner on public.affiliate_referrals for select using (
  exists (select 1 from public.affiliate_partners p where p.id = partner_id and p.user_id = public.current_app_user_id())
);
create policy affiliate_commissions_read_partner on public.affiliate_commissions for select using (
  exists (select 1 from public.affiliate_partners p where p.id = partner_id and p.user_id = public.current_app_user_id())
);
create policy affiliate_payouts_read_partner on public.affiliate_payouts for select using (
  exists (select 1 from public.affiliate_partners p where p.id = partner_id and p.user_id = public.current_app_user_id())
);

create or replace function public.validate_affiliate_code(input_code text)
returns table(valid boolean, code text, partner_name text, discount_percent numeric)
language sql stable as $$
  select
    coalesce(s.programme_enabled, true) and ac.is_active and ap.status = 'active' and (ac.expires_at is null or ac.expires_at > now()),
    ac.code,
    ap.public_name,
    ac.discount_percent
  from public.affiliate_codes ac
  join public.affiliate_partners ap on ap.id = ac.partner_id
  cross join public.affiliate_settings s
  where lower(ac.code) = lower(trim(input_code))
  limit 1
$$;

create or replace function public.calculate_partner_available_balance(input_partner_id uuid)
returns numeric language sql stable as $$
  select coalesce(sum(commission_amount), 0)
  from public.affiliate_commissions
  where partner_id = input_partner_id
    and status = 'available'
    and payout_id is null
$$;

-- Financial mutation RPC names are reserved here; the Express server performs
-- the transaction with service credentials and the same constraints.
create or replace function public.claim_affiliate_referral() returns void language sql as $$ select null::void $$;
create or replace function public.create_affiliate_commission_for_payment() returns void language sql as $$ select null::void $$;
create or replace function public.request_affiliate_payout() returns void language sql as $$ select null::void $$;
