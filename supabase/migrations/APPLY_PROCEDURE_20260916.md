# Apply-and-verify procedure — 3 pending migrations (not yet applied to Production)

This procedure is for the person merging/deploying this branch to run manually against the
**Production** Supabase project, in this exact order, **before** the corresponding application
code reaches Production. Nothing in this repository applies migrations automatically (no CI step,
no Vercel build hook) — this document exists because that automation does not exist, not to
document a step someone else will run for you.

Pending migrations, in required order:

1. `20260916120000_justice_case_payments_intended_action.sql`
2. `20260916130000_justice_case_tasks_dedupe_key.sql`
3. `20260916140000_justice_cases_orphan_recovery_confirmed_at.sql`

All three are additive only (new nullable columns, new indexes, one backfill `UPDATE` scoped by a
precise `WHERE`, one `DO $$ ... $$` pre-flight check). None of them drop or rename a column, alter
a type, or change any existing constraint. Each is individually safe to apply on its own — the
order above matters only because #1 must exist before the checkout/webhook code paths it supports
go live, and #2's pre-flight check should run before you rely on the constraint it creates.

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

## Step 5 — final code/schema agreement check

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
  console.log({ payments: e1?.message ?? "ok", tasks: e2?.message ?? "ok", cases: e3?.message ?? "ok" });
})();
'
```

Expect `{ payments: "ok", tasks: "ok", cases: "ok" }`. Any error here means the code/schema
incompatibility this procedure exists to catch is still present — do not deploy the application
code until this prints clean.

## Step 6 — only now, deploy the application code

Merge/deploy as normal. Do not run this procedure again for the same migrations — re-running
step 3/4 is safe (both migrations use `if not exists` guards throughout) but unnecessary once
step 5 passes.
