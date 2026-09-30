-- Idempotent, forward-corrective hardening for justice_case_audit_events and
-- repair_orphaned_paid_case_approval_intake's grants.
--
-- This exists ALONGSIDE the in-place fix already applied directly to
-- 20260917120000_justice_case_audit_events.sql (which corrects the source-of-truth migration for
-- any environment — including this project's own Production, confirmed to have never applied
-- version 20260917120000 in any form — that has not yet run it at all). This file specifically
-- covers an environment that MAY have already applied the ORIGINAL, unfixed content of that
-- migration before this fix landed: Supabase's migration tooling (`supabase migration up` /
-- `db push`) tracks applied migrations by VERSION NUMBER alone in
-- supabase_migrations.schema_migrations, never by re-diffing file content against what was
-- previously run. An environment that already recorded version 20260917120000 would silently SKIP
-- re-running it even after the in-place edit, with no error and no indication anything was
-- missed — this repository cannot prove that never happened on the (currently paused) Staging
-- project, since "paused now" says nothing about its migration history before it was paused, and
-- that history lives in the database, not in git.
--
-- REVOKE/GRANT are fully idempotent: running this on an environment that already has the correct,
-- narrow grants (whether from a fresh apply of the now-fixed 20260917120000, or from this file
-- running there first) is a pure no-op; running it on one that still has the original, overly-
-- broad grants is a real, complete fix. Safe to run in any order relative to
-- 20260917120000_justice_case_audit_events.sql, any number of times.
--
-- Root cause (see 20260917120000_justice_case_audit_events.sql's own updated comments for the
-- full account): Supabase provisions this project with schema-wide ALTER DEFAULT PRIVILEGES —
-- set up once by the provisioning roles postgres and supabase_admin, independent of and applied
-- BEFORE any of this repo's own migrations run — confirmed empirically to grant service_role,
-- anon, AND authenticated full privileges (including UPDATE, DELETE, TRUNCATE on tables and
-- EXECUTE on functions) on everything newly created in schema public. A bare GRANT only ADDS a
-- privilege; it can never narrow one a default grant already conferred, so the original
-- `grant select, insert ... to service_role` (with no REVOKE first) left this supposedly-immutable
-- audit table fully mutable/erasable, and its RPC callable, by roles that were never meant to have
-- that access.
revoke all on public.justice_case_audit_events from public, anon, authenticated, service_role;
grant select, insert on public.justice_case_audit_events to service_role;

revoke all on function public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text) to service_role;
