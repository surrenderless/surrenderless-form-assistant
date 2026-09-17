-- Bounds the 5-minute orphan-recovery scan (reconcileOrphanedPaidCaseApprovals.ts) so it stops
-- re-verifying cases that are already fully confirmed, instead of rescanning every paid case
-- forever. orphan_recovery_confirmed_at is set exactly once, by finalizePaidPreparedPacketApproval,
-- the FIRST time it confirms (creates or finds) the fulfillment task for a case's approval — the
-- one specific job this reconciler exists to guarantee. Once set, finalizePaidPreparedPacketApproval
-- short-circuits immediately on every later call for that case (webhook redelivery or reconciler
-- pass alike) before touching ensureOwnedFilingTaskAfterClientStateWrite or any email-provider
-- call, and the reconciler's own scan query excludes confirmed cases outright.
--
-- This deliberately does NOT track subsequent escalation-ladder advancement (a case moving from
-- one owned-filing destination to the next after the first is completed) — that path is already
-- synchronous and reliable via the existing PATCH /api/justice/cases/[id] route, which calls
-- ensureOwnedFilingTaskAfterClientStateWrite itself in the same request that advances the ladder,
-- and is unrelated to (and unaffected by) the paid-but-never-approved gap this reconciler exists
-- to close. Any residual task-creation failure at a LATER ladder step remains covered by the
-- existing daily reconcile-owned-filing-tasks cron, which scans every non-archived case
-- regardless of this flag.

alter table public.justice_cases
  add column if not exists orphan_recovery_confirmed_at timestamptz null;

comment on column public.justice_cases.orphan_recovery_confirmed_at is 'Set once finalizePaidPreparedPacketApproval has confirmed (created or found) the fulfillment task for this case''s first approval. Once set, both the Stripe webhook and the 5-minute orphan-recovery reconciler skip all further work for this case (no ensure*FilingTask call, no email-provider call) and the reconciler''s own scan query excludes it entirely. Null for cases never yet confirmed and for all pre-existing rows as of this migration, which get exactly one more confirmation pass before permanently dropping out of the scan.';

create index if not exists idx_justice_cases_orphan_recovery_confirmed_at
  on public.justice_cases (orphan_recovery_confirmed_at)
  where orphan_recovery_confirmed_at is null;
