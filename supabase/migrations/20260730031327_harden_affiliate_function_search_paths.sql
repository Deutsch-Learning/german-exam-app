begin;

alter function public.current_app_user_id() set search_path = '';
alter function public.validate_affiliate_code(text) set search_path = '';

create or replace function public.calculate_partner_available_balance(input_partner_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(commission_amount), 0)
  from public.affiliate_commissions
  where partner_id = input_partner_id
    and status = 'available'
    and payout_id is null
$$;

alter function public.claim_affiliate_referral() set search_path = '';
alter function public.create_affiliate_commission_for_payment() set search_path = '';
alter function public.request_affiliate_payout() set search_path = '';

-- These names are reserved placeholders. Financial writes are implemented by
-- the authenticated Express transaction and must not be callable from clients.
revoke execute on function public.claim_affiliate_referral() from public;
revoke execute on function public.create_affiliate_commission_for_payment() from public;
revoke execute on function public.request_affiliate_payout() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_affiliate_referral() from anon;
    revoke execute on function public.create_affiliate_commission_for_payment() from anon;
    revoke execute on function public.request_affiliate_payout() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_affiliate_referral() from authenticated;
    revoke execute on function public.create_affiliate_commission_for_payment() from authenticated;
    revoke execute on function public.request_affiliate_payout() from authenticated;
  end if;
end
$$;

commit;
