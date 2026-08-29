-- Explicit service_role table grants for every justice_* table.
--
-- Every prior justice migration relied on Supabase's "Automatically expose new tables" project
-- setting to grant service_role its table-level privileges as a side effect of table creation.
-- A staging project created with that setting disabled never receives those grants, so the
-- service-role client (which still must pass ordinary GRANT checks even though it also bypasses
-- RLS) fails with "permission denied for table ..." despite RLS being configured correctly. This
-- migration grants exactly what the server-side service-role client uses on each table today —
-- see the audit below — and nothing to anon or authenticated, and does not alter any RLS policy.
-- GRANT is idempotent: re-running this file is always a safe no-op.
--
-- Privilege audit (grep for .from("<table>") server-side call sites):
--   justice_cases:               select, insert, update, delete (delete: smoke-test cleanup via
--                                 the same service-role client used in production)
--   justice_case_evidence:       select, insert, update, delete
--   justice_case_filings:        select, insert, update
--   justice_case_tasks:          select, insert, update, delete
--   justice_case_chat_messages:  select, insert, update (upsert on case_id/client_turn_id)
--   justice_case_payments:       select, insert
--
-- The public.cancel_operator_fulfillment_task() RPC already grants execute to service_role
-- explicitly in 20260728010000_cancel_operator_fulfillment_task_rpc.sql; nothing further needed
-- there. public.set_updated_at() runs only as a trigger, which executes with the table owner's
-- privileges regardless of the invoking role, so it needs no grant either.

grant select, insert, update, delete on public.justice_cases to service_role;
grant select, insert, update, delete on public.justice_case_evidence to service_role;
grant select, insert, update on public.justice_case_filings to service_role;
grant select, insert, update, delete on public.justice_case_tasks to service_role;
grant select, insert, update on public.justice_case_chat_messages to service_role;
grant select, insert on public.justice_case_payments to service_role;
