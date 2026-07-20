alter table public.affiliate_partners
  alter column status set default 'pending_review';

update public.affiliate_partners ap
   set status = 'pending_review',
       updated_at = now()
 where ap.status = 'active'
   and not exists (
     select 1
       from public.affiliate_codes ac
      where ac.partner_id = ap.id
   );
