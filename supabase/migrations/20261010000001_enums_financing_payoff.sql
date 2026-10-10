-- =====================================================================
-- Enum values for the financing round: payoff ("lösen") and the two new
-- document types a dealer or a bank can attach to a financing.
--
-- Enum values must be added in their own migration: `alter type ... add value`
-- cannot be used in the same transaction that later statements read it in
-- (PostgreSQL restriction), and `supabase db push` runs one file per transaction.
-- =====================================================================

-- "Bankbeställning" (the order a bank sends a dealer) and "lösenbesked"
-- (the payoff statement a bank issues for a specific machine).
alter type public.document_type add value if not exists 'bank_order';
alter type public.document_type add value if not exists 'payoff_statement';

-- Lifecycle of a payoff request (SPEC §6.7 step 5, §6.6 step 5).
--   requested            – the owner/dealer has asked the holder to settle
--   quoted               – the holder has answered with a payoff statement
--   settlement_submitted – the requester has uploaded proof the credit is settled
--   settled              – the holder has approved and the encumbrance is released
--   declined             – the holder refuses
--   expired              – the quote passed its validity date
create type public.payoff_status as enum
  ('requested', 'quoted', 'settlement_submitted', 'settled', 'declined', 'expired');
