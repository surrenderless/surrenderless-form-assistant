# Apply-and-verify procedure — 5 pending migrations (not yet applied to Production)

This procedure is for the person merging/deploying this branch to run manually against the
**Production** Supabase project, in this exact order, **before** the corresponding application
code reaches Production. Nothing in this repository applies migrations automatically (no CI step,
no Vercel build hook) — this document exists because that automation does not exist, not to
document a step someone else will run for you.

Pending migrations, in required order:

1. `20260916120000_justice_case_payments_intended_action.sql`
2. `20260916130000_justice_case_tasks_dedupe_key.sql`
3. `20260916140000_justice_cases_orphan_recovery_confirmed_at.sql`
4. `20260917110000_justice_cases_case_version.sql`
5. `20260917120000_justice_case_audit_events.sql`

All five are additive only (new nullable/defaulted columns, new indexes, one backfill `UPDATE`
scoped by a precise `WHERE`, one `DO $$ ... $$` pre-flight check, #4's new trigger, and #5's new
table + function). None of them drop or rename a column, alter a type, or change any existing
constraint. Each is individually safe to apply on its own — the order above matters only because
#1 must exist before the checkout/webhook code paths it supports go live, #2's pre-flight check
should run before you rely on the constraint it creates, #4 must exist before #5 (whose RPC takes
`p_expected_case_version` and reads/writes `justice_cases.case_version`), and #5's RPC must exist
before the repair-intake application code (which calls it exclusively — it no longer writes
justice_cases directly for that flow) reaches Production.

**Every `justice_cases` optimistic-concurrency check in the application layer — the consumer
intake PATCH, the operator repair-intake RPC, and `updateClientStateIfUnchanged` (used by all ten
`complete*OperatorFiling.ts` files and `finalizePaidPreparedPacketApproval.ts`) — now compares
`case_version`, never `updated_at`.** A release audit proved `updated_at` (a wall-clock timestamp)
is not strictly monotonic under rapid or racing writes — two writers sharing a stale `updated_at`
token both "succeeded" (a silent lost update) in roughly a third to half of trials against real
Postgres with no sleep involved, purely from millisecond-level clock collisions. `case_version` is
a plain integer, incremented by exactly 1 on every UPDATE by a `BEFORE UPDATE` trigger evaluated
under the row lock Postgres already takes for the UPDATE itself, so it cannot repeat or go
backwards regardless of write frequency or clock behavior. `updated_at` remains on the table,
unchanged, for display/sorting only.

## Why schema-first, not code-first

`processStripeCheckoutCompletedEvent.ts` inserts `intended_action_href` /
`intended_action_label` into `justice_case_payments` on **every** successful Stripe payment
webhook, not only orphan-recovery ones. If the application code deploys before migration #1 is
applied, every payment webhook fails with a real Postgres "column does not exist" error, Stripe
retries and gets the identical failure, and **no consumer can complete a paid checkout at all**
until the migration lands. Migrations must be applied first, and confirmed present, before this
code is live in Production.

## Step 0 — capture the target database

```sh
# Set once, reused by every step below. Get this from the Supabase dashboard's connection
# string for the PRODUCTION project — never run this against a project you have not confirmed
# is Production.
export PGURL="postgresql://postgres:<password>@<production-host>:5432/postgres"
psql "$PGURL" -c "select current_database(), inet_server_addr();"
```

Confirm the output is the Production database before proceeding. If in doubt, stop and check the
Supabase project ref against `JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF` / the dashboard URL
before running anything below.

## Step 1 — pre-flight: does the schema already disagree with the code on this branch?

Run this **before** applying anything, to catch a code/schema incompatibility instead of letting
migration #2's own guard (see step 3) surface it as a mid-migration failure:

This is the **canonical remediation query** — used here, reused verbatim at step 3, and safe to
run at any time regardless of whether migration #2 has been applied yet: it derives the stable
task marker from `notes` itself (the same first-line convention every managed-task builder
writes, and the same expression the migration's own backfill uses) rather than the `dedupe_key`
column migration #2 creates, so it never depends on that column existing. It also never selects
the `notes` column itself — every managed task's notes body embeds consumer complaint/draft text,
so selecting it here would print that content to whatever terminal or log captures this session.
Only the short marker prefix (e.g. `state_ag_filing_queue:<uuid>`) and row identifiers are
selected — never PII, never complaint content.

```sql
-- Any existing duplicate OPEN managed task for the same case+destination? (the exact race
-- migration #2 closes with a unique index — if this already happened in Production, both rows
-- are real work and must be resolved by a human, never auto-merged by a migration.) Matches only
-- rows whose first line of notes ends with ":<that row's own case_id>" — the fixed convention
-- every managed-task builder writes — so an ordinary personal reminder task can never be
-- misclassified as a duplicate.
select split_part(notes, chr(10), 1) as marker, count(*) as open_count, array_agg(id) as task_ids
from justice_case_tasks
where completed_at is null
  and notes is not null
  and split_part(notes, chr(10), 1) like ('%:' || case_id::text)
group by split_part(notes, chr(10), 1)
having count(*) > 1;
-- Expect: 0 rows. If this returns anything, stop and resolve the duplicates first (see step 3).
```

## Step 2 — apply migration #1 (justice_case_payments intended-action columns)

```sh
psql "$PGURL" -f supabase/migrations/20260916120000_justice_case_payments_intended_action.sql
```

Verify:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'justice_case_payments'
  and column_name in ('intended_action_href', 'intended_action_label');
-- Expect: 2 rows, both nullable, both text.
```

## Step 3 — apply migration #2 (justice_case_tasks dedupe_key + unique index)

```sh
psql "$PGURL" -f supabase/migrations/20260916130000_justice_case_tasks_dedupe_key.sql
```

This migration contains its own pre-flight guard (a `DO $$ ... $$` block) that raises a named,
readable exception — not a raw duplicate-key error — if the backfill step finds more than one
open task sharing a dedupe_key. **If it fails with that exception:**

The whole migration file runs as a single transaction, so the failure above has already rolled
back the `ALTER TABLE ... ADD COLUMN dedupe_key` from earlier in the same file — the column does
not exist at this point. Do **not** query `dedupe_key` here; re-run the exact same query from
step 1 above (reproduced here for convenience — keep these two copies identical):

```sql
select split_part(notes, chr(10), 1) as marker, count(*) as open_count, array_agg(id) as task_ids
from justice_case_tasks
where completed_at is null
  and notes is not null
  and split_part(notes, chr(10), 1) like ('%:' || case_id::text)
group by split_part(notes, chr(10), 1)
having count(*) > 1;
```

Do not resolve duplicates by blindly completing "extra" rows via SQL — inspect each pair/group
(operator workspace, timeline) to confirm which (if any) already represents completed real work,
then complete the redundant one(s) through the normal application flow (or a deliberate, reviewed
`update justice_case_tasks set completed_at = now() where id = '<id>'` for a row confirmed to be a
true duplicate with no independent progress). Re-run this migration only after the query above
returns zero rows.

Verify after a successful apply:

```sql
select column_name from information_schema.columns
where table_name = 'justice_case_tasks' and column_name = 'dedupe_key';
-- Expect: 1 row.

select indexname from pg_indexes
where tablename = 'justice_case_tasks' and indexname = 'idx_justice_case_tasks_open_dedupe_key';
-- Expect: 1 row.

-- Sanity: the index actually rejects a real duplicate.
begin;
insert into justice_case_tasks (user_id, case_id, title, notes, dedupe_key)
values ('smoke_test', (select id from justice_cases limit 1), 'smoke', 'smoke', '__apply_procedure_smoke_test__');
insert into justice_case_tasks (user_id, case_id, title, notes, dedupe_key)
values ('smoke_test', (select id from justice_cases limit 1), 'smoke', 'smoke', '__apply_procedure_smoke_test__');
-- Expect: the second insert fails with a unique_violation on idx_justice_case_tasks_open_dedupe_key.
rollback;
```

## Step 4 — apply migration #3 (justice_cases orphan_recovery_confirmed_at)

```sh
psql "$PGURL" -f supabase/migrations/20260916140000_justice_cases_orphan_recovery_confirmed_at.sql
```

Verify:

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'justice_cases' and column_name = 'orphan_recovery_confirmed_at';
-- Expect: 1 row, nullable.

select indexname from pg_indexes
where tablename = 'justice_cases' and indexname = 'idx_justice_cases_orphan_recovery_confirmed_at';
-- Expect: 1 row.
```

## Step 5 — apply migration #4 (justice_cases.case_version + bump_justice_cases_case_version trigger)

```sh
psql "$PGURL" -f supabase/migrations/20260917110000_justice_cases_case_version.sql
```

Verify:

```sql
select column_name, is_nullable, data_type, column_default
from information_schema.columns
where table_name = 'justice_cases' and column_name = 'case_version';
-- Expect: 1 row, not nullable, bigint, default 1.

select trigger_name from information_schema.triggers
where event_object_table = 'justice_cases' and trigger_name = 'bump_justice_cases_case_version';
-- Expect: 1 row.

-- Sanity: the trigger actually increments by exactly 1 on a real UPDATE, and does so even when
-- updated_at does not change (proves this is not secretly timestamp-based).
begin;
insert into justice_cases (id, user_id, intake) values (gen_random_uuid(), 'apply_procedure_smoke_test', '{"smoke": true}'::jsonb);
select case_version from justice_cases where user_id = 'apply_procedure_smoke_test';
-- Expect: 1.
update justice_cases set intake = '{"smoke": true, "edited": true}'::jsonb where user_id = 'apply_procedure_smoke_test';
select case_version from justice_cases where user_id = 'apply_procedure_smoke_test';
-- Expect: 2.
rollback;
```

## Step 6 — apply migration #5 (justice_case_audit_events table + repair_orphaned_paid_case_approval_intake RPC)

```sh
psql "$PGURL" -f supabase/migrations/20260917120000_justice_case_audit_events.sql
```

This adds an immutable, append-only audit table and the atomic RPC the operator repair-intake
endpoint now calls exclusively (it no longer writes `justice_cases.intake` or `.timeline`
directly). Verify both the table's existence AND its restricted grants — the whole point of this
table is that no role can alter or erase a row once inserted, so confirm that structurally, not
just that it exists:

```sql
select column_name from information_schema.columns
where table_name = 'justice_case_audit_events' and column_name = 'idempotency_key';
-- Expect: 1 row.

select indexname from pg_indexes
where tablename = 'justice_case_audit_events' and indexname = 'idx_justice_case_audit_events_idempotency_key';
-- Expect: 1 row (this is what makes an exact retry dedupe instead of duplicating).

select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'justice_case_audit_events'
order by grantee, privilege_type;
-- Expect: exactly service_role / SELECT and service_role / INSERT — no UPDATE, no DELETE, for
-- any role. If either appears, immutability is not actually enforced — stop and investigate
-- before proceeding; do not rely on this procedure's own re-application to fix a manual grant
-- someone added directly in the dashboard.

select routine_name from information_schema.routines
where routine_name = 'repair_orphaned_paid_case_approval_intake';
-- Expect: 1 row.

-- Sanity: the atomic RPC works end to end against a real (non-production-data) row, and an exact
-- retry does not duplicate the audit event. Never run this against a real case_id.
begin;
insert into justice_cases (id, user_id, intake) values (gen_random_uuid(), 'apply_procedure_smoke_test', '{"smoke": true}'::jsonb);
insert into justice_case_tasks (user_id, case_id, title, notes)
select 'apply_procedure_smoke_test', id, 'smoke', 'orphaned_paid_case_approval_queue:' || id::text
from justice_cases where user_id = 'apply_procedure_smoke_test';
select repair_orphaned_paid_case_approval_intake(
  (select id from justice_cases where user_id = 'apply_procedure_smoke_test'),
  (select id from justice_case_tasks where user_id = 'apply_procedure_smoke_test'),
  'apply_procedure_smoke_test',
  (select case_version from justice_cases where user_id = 'apply_procedure_smoke_test'),
  '{"smoke": true, "corrected": true}'::jsonb,
  'apply_procedure_smoke_test_operator'
);
-- Expect: a jsonb row with status = "applied".
select count(*) from justice_case_audit_events where actor = 'apply_procedure_smoke_test_operator';
-- Expect: 1.
rollback;
```

## Step 7 — final code/schema agreement check

Confirm the application code's expectations match what is now live, using the service-role
credentials the app itself uses (catches an RLS/grant gap a raw `psql` superuser session would
never surface):

```sh
NEXT_PUBLIC_SUPABASE_URL=<production-url> \
SUPABASE_SERVICE_ROLE_KEY=<production-service-role-key> \
node -e '
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error: e1 } = await supabase.from("justice_case_payments").select("intended_action_href, intended_action_label").limit(1);
  const { error: e2 } = await supabase.from("justice_case_tasks").select("dedupe_key").limit(1);
  const { error: e3 } = await supabase.from("justice_cases").select("orphan_recovery_confirmed_at").limit(1);
  const { error: e4 } = await supabase.from("justice_cases").select("case_version").limit(1);
  const { error: e5 } = await supabase.from("justice_case_audit_events").select("idempotency_key").limit(1);
  const { error: e6 } = await supabase.rpc("repair_orphaned_paid_case_approval_intake", {
    p_case_id: "00000000-0000-4000-8000-000000000000",
    p_task_id: "00000000-0000-4000-8000-000000000000",
    p_user_id: "schema_check_nonexistent_user",
    p_expected_case_version: 0,
    p_new_intake: {},
    p_actor: "schema_check",
  });
  console.log({
    payments: e1?.message ?? "ok",
    tasks: e2?.message ?? "ok",
    cases: e3?.message ?? "ok",
    case_version: e4?.message ?? "ok",
    audit_events: e5?.message ?? "ok",
    // A real "function does not exist" / grant error here means Step 6 was skipped, the grant is
    // missing, or the function still has the old (uuid, uuid, text, timestamptz, jsonb, text)
    // signature. A clean call returning task_conflict (no such task) is expected and fine — it
    // proves the function is callable end to end with the new signature, not that this fake id
    // resolved to anything.
    repair_rpc: e6?.message ?? "ok",
  });
})();
'
```

Expect every field to print `"ok"`. Any error here means the code/schema incompatibility this
procedure exists to catch is still present — do not deploy the application code until this prints
clean.

## Step 8 — only now, deploy the application code

Merge/deploy as normal. Do not run this procedure again for the same migrations — re-running
steps 3/4/5/6 is safe (all four migrations use `if not exists` / `create or replace` guards
throughout) but unnecessary once step 7 passes.
