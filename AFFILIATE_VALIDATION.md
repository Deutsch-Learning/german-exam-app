# Partner Programme Validation

Run these checks after applying `supabase/migrations/20260720103000_affiliate_partner_programme.sql` and deploying the server.

1. Register without a partner code. Confirm registration and email verification work normally.
2. Open `/register?ref=VALIDCODE`. Confirm the code is stored for 30 days and prefilled.
3. Register with an invalid, expired, or inactive code. Confirm registration is rejected only when the field is non-empty.
4. Verify email, log in, and confirm `/api/affiliate/claim` creates one immutable referral.
5. Try to claim a second code. Confirm the original referral remains unchanged.
6. Activate a partner account from Profile. Confirm a unique uppercase code and share link are created.
7. Try self-referral with the partner's own code. Confirm it is rejected.
8. Complete a verified Notch Pay payment. Confirm one pending commission is created after `activateSubscriptionFromTransaction`.
9. Replay the webhook/status check. Confirm the unique `payment_id` constraint prevents a duplicate commission.
10. Mark a payment failed/cancelled/refunded through a provider event. Confirm unpaid commissions are cancelled with a reason.
11. Confirm manual admin access grants do not create commissions.
12. Confirm a suspended partner cannot generate new eligible commissions.
13. Wait or adjust `available_at` beyond the hold period. Confirm pending commissions become available.
14. Request withdrawal below the minimum. Confirm it is rejected.
15. Request withdrawal above available balance. Confirm it is rejected.
16. Request a valid withdrawal. Confirm a payout is created and commissions are reserved.
17. Process payout as paid in Admin. Confirm linked commissions become paid.
18. Reject a payout in Admin. Confirm linked commissions are released back to available.
19. Attempt partner-table reads as a different partner through Supabase Data API. Confirm RLS blocks cross-partner rows.
20. Check desktop, tablet, and mobile layouts for Profile partner dashboard, Register form, and Admin Partner Programme.
