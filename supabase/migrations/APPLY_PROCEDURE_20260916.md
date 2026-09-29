# Apply-and-verify procedure — 2 remaining migrations (#5, #6); #1–#4 already applied to Production

This procedure is for the person merging/deploying this branch to run manually against the
**Production** Supabase project, in this exact order, **before** the corresponding application
code reaches Production. Nothing in this repository applies migrations automatically (no CI step,
no Vercel build hook) — this document exists because that automation does not exist, not to
document a step someone else will run for you.

**Already applied to Production — confirmed committed with exact history rows. Do not rerun:**

1. `20260916120000_justice_case_payments_intended_action.sql` — history row `20260916120000 / justice_case_payments_intended_action`
2. `20260916130000_justice_case_tasks_dedupe_key.sql` — history row `20260916130000 / justice_case_tasks_dedupe_key`
3. `20260916140000_justice_cases_orphan_recovery_confirmed_at.sql` — history row `20260916140000 / justice_cases_orphan_recovery_confirmed_at`
4. `20260917110000_justice_cases_case_version.sql` — history row `20260917110000 / justice_cases_case_version`

**Remaining, in required order:**

5. `20260917120000_justice_case_audit_events.sql`
6. `20260928000000_justice_case_audit_events_grants_hardening.sql`

Migrations #1–#5 are additive only (new nullable/defaulted columns, new indexes, one backfill
`UPDATE` scoped by a precise `WHERE`, one `DO $$ ... $$` pre-flight check, #4's new trigger, and
#5's new table + function). None of them drop or rename a column, alter a type, or change any
existing constraint. #6 is a pure, idempotent `REVOKE ALL` / `GRANT` re-application — it creates
nothing and drops nothing, only narrows privileges on objects #5 already created. #4 had to exist
before #5 (whose RPC takes `p_expected_case_version` and reads/writes `justice_cases.case_version`)
— already satisfied, since both are committed. #5's RPC must exist before the repair-intake
application code (which calls it exclusively — it no longer writes justice_cases directly for that
flow) reaches Production, and #6 must run **after** #5 specifically — it revokes/re-grants
privileges on `justice_case_audit_events` and `repair_orphaned_paid_case_approval_intake`, both
created by #5, and fails loudly ("relation/function does not exist") if run against a project
where #5 hasn't landed yet.

**#6 exists because a release audit caught something #5's own `grant select, insert ...` never
accounted for: this Supabase project pre-configures schema-wide `ALTER DEFAULT PRIVILEGES`, set up
once by the provisioning roles `postgres` and `supabase_admin` before any of this repo's own
migrations ever run, that grant `service_role` — and, on this project, even `anon`/`authenticated`
— full privileges (including `UPDATE`, `DELETE`, `TRUNCATE`) on every newly created table in schema
`public`. A bare `GRANT` only ADDS a privilege; it can never narrow one a default grant already
conferred, so #5's original content left the supposedly-immutable audit table fully
mutable/erasable. Unlike #1's payment-webhook break, skipping #6 fails SILENTLY — nothing in the
application errors, logs, or otherwise announces that the audit table isn't actually
append-only — so its own verification below must be run and read carefully, not skipped as "just
another idempotent grant."** #6 is also the correct place to fix this even if #5 was already
applied somewhere under its original content: Supabase's migration tooling
(`supabase migration up` / `db push`) tracks "applied" by version number alone in
`supabase_migrations.schema_migrations`, never by re-diffing file content, so an environment that
already recorded #5's version would silently skip a content-only edit to that file forever — #6,
as its own new version, is what actually reaches that environment.

**Important — raw `psql -f <file>` does not record migration history.** Running a migration file
with a bare `psql "$PGURL" -f <file>.sql` executes that file's own SQL and nothing else — it does
**not** insert a row into `supabase_migrations.schema_migrations`. Every apply step below therefore
wraps the file's content in an explicit transaction that also inserts and verifies the exact
history row, and commits only once every required assertion passes — never a bare `-f` invocation
on its own.

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
code is live in Production. (#1 is already applied — this reasoning is preserved here because it's
still why schema-first mattered, and it applies identically to why #5/#6 must land before any
application code depending on them.)

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

## Step 1 — pre-flight duplicate-task check (historical — already satisfied)

This check protected migration #2's own pre-flight guard (a `DO $$ ... $$` block inside that
migration that raises a named exception if the backfill finds more than one open task sharing a
dedupe_key). Migration #2 is now committed — it could not have committed if this condition were
true, since its own guard would have raised and rolled back the whole file. **No longer actionable
for the migrations remaining below** (#5/#6 have nothing to do with `justice_case_tasks` dedupe
keys); kept here only so a future reader understands what #2's own internal guard was checking
against, without needing to dig through this file's git history:

```sql
select split_part(notes, chr(10), 1) as marker, count(*) as open_count, array_agg(id) as task_ids
from justice_case_tasks
where completed_at is null
  and notes is not null
  and split_part(notes, chr(10), 1) like ('%:' || case_id::text)
group by split_part(notes, chr(10), 1)
having count(*) > 1;
-- Expect (still, on an ongoing basis, now enforced by #2's own unique index rather than by this
-- manual check): 0 rows.
```

## Step 2 — migration #1 (justice_case_payments intended-action columns) — ✅ COMPLETED

Confirmed committed with history row `20260916120000 / justice_case_payments_intended_action`.
**Do not rerun.** Read-only, safe to re-run any time purely to reconfirm current state:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'justice_case_payments'
  and column_name in ('intended_action_href', 'intended_action_label');
-- Expect: 2 rows, both nullable, both text.
```

## Step 3 — migration #2 (justice_case_tasks dedupe_key + unique index) — ✅ COMPLETED on this Production project

Confirmed committed with history row `20260916130000 / justice_case_tasks_dedupe_key`. **Do not
rerun against this Production project.** Read-only, safe to re-run any time purely to reconfirm
current state:

```sql
select column_name from information_schema.columns
where table_name = 'justice_case_tasks' and column_name = 'dedupe_key';
-- Expect: 1 row.

select indexname from pg_indexes
where tablename = 'justice_case_tasks' and indexname = 'idx_justice_case_tasks_open_dedupe_key';
-- Expect: 1 row.
```

**Reference only — for a fresh/different environment that has not yet applied this migration**
(this repository's own migration set is reused as-is for local dev, CI, and any future project;
this section is not actionable for the Production project this document otherwise tracks): this
migration contains its own pre-flight guard (a `DO $$ ... $$` block) that raises a named, readable
exception — not a raw duplicate-key error — if the backfill step finds more than one open task
sharing a dedupe_key. **If it fails with that exception:**

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

## Step 4 — migration #3 (justice_cases orphan_recovery_confirmed_at) — ✅ COMPLETED

Confirmed committed with history row `20260916140000 / justice_cases_orphan_recovery_confirmed_at`.
**Do not rerun.** Read-only, safe to re-run any time purely to reconfirm current state:

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'justice_cases' and column_name = 'orphan_recovery_confirmed_at';
-- Expect: 1 row, nullable.

select indexname from pg_indexes
where tablename = 'justice_cases' and indexname = 'idx_justice_cases_orphan_recovery_confirmed_at';
-- Expect: 1 row.
```

## Step 5 — migration #4 (justice_cases.case_version + bump_justice_cases_case_version trigger) — ✅ COMPLETED

Confirmed committed with history row `20260917110000 / justice_cases_case_version`. **Do not
rerun.** Read-only, safe to re-run any time purely to reconfirm current state:

```sql
select column_name, is_nullable, data_type, column_default
from information_schema.columns
where table_name = 'justice_cases' and column_name = 'case_version';
-- Expect: 1 row, not nullable, bigint, default 1.

select trigger_name from information_schema.triggers
where event_object_table = 'justice_cases' and trigger_name = 'bump_justice_cases_case_version';
-- Expect: 1 row.
```

## Step 6 — apply migration #5 (justice_case_audit_events table + repair_orphaned_paid_case_approval_intake RPC)

**Pending.** As noted above, raw `psql -f <file>` never records migration history on its own. The
block below applies the migration file verbatim, records the exact history row, runs every
required assertion (structural, ACL, and an end-to-end RPC smoke test scoped to a `SAVEPOINT`), and
commits only if every one of them passes — all inside **one transaction**:

```sh
psql "$PGURL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

\i supabase/migrations/20260917120000_justice_case_audit_events.sql

insert into supabase_migrations.schema_migrations (version, name)
values ('20260917120000', 'justice_case_audit_events')
on conflict (version) do nothing;

-- Structural + history assertions
DO $outer$
DECLARE
  col_count int;
  idx_count int;
  hist_name text;
BEGIN
  SELECT count(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'justice_case_audit_events' AND column_name = 'idempotency_key';
  IF col_count <> 1 THEN
    RAISE EXCEPTION 'Verification failed: expected 1 public.justice_case_audit_events.idempotency_key column, found %', col_count;
  END IF;

  SELECT count(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'justice_case_audit_events'
    AND indexname = 'idx_justice_case_audit_events_idempotency_key';
  IF idx_count <> 1 THEN
    RAISE EXCEPTION 'Verification failed: expected 1 idx_justice_case_audit_events_idempotency_key index, found %', idx_count;
  END IF;

  SELECT name INTO hist_name FROM supabase_migrations.schema_migrations WHERE version = '20260917120000';
  IF hist_name IS DISTINCT FROM 'justice_case_audit_events' THEN
    RAISE EXCEPTION 'Verification failed: expected history row version=20260917120000 name=justice_case_audit_events, found name=%', hist_name;
  END IF;
END $outer$;

-- Table ACL: exactly service_role/INSERT and service_role/SELECT, nothing for anon/authenticated/
-- PUBLIC. NOT information_schema.role_table_grants — a real release audit proved that view can
-- silently omit PUBLIC-related grants; aclexplode(pg_class.relacl) is the real, complete ACL.
DO $acl_table$
DECLARE
  service_role_privs text[];
BEGIN
  SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) INTO service_role_privs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a(grantor, grantee, privilege_type, is_grantable)
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE c.relname = 'justice_case_audit_events' AND n.nspname = 'public'
    AND coalesce(r.rolname, 'PUBLIC') = 'service_role';
  IF service_role_privs IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'IMMUTABILITY CHECK FAILED: expected service_role={INSERT,SELECT} on justice_case_audit_events, found %', service_role_privs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relname = 'justice_case_audit_events' AND n.nspname = 'public'
      AND coalesce(r.rolname, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'IMMUTABILITY CHECK FAILED: anon, authenticated, or PUBLIC has some direct grant on justice_case_audit_events';
  END IF;
END $acl_table$;

-- Function ACL: exactly service_role/EXECUTE, nothing for anon/authenticated/PUBLIC.
DO $acl_func$
DECLARE
  service_role_privs text[];
BEGIN
  SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) INTO service_role_privs
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(p.proacl) AS a(grantor, grantee, privilege_type, is_grantable)
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE p.oid = 'public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text)'::regprocedure
    AND coalesce(r.rolname, 'PUBLIC') = 'service_role';
  IF service_role_privs IS DISTINCT FROM ARRAY['EXECUTE'] THEN
    RAISE EXCEPTION 'Verification failed: expected service_role={EXECUTE} on repair_orphaned_paid_case_approval_intake, found %', service_role_privs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS a(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid = 'public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text)'::regprocedure
      AND coalesce(r.rolname, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'Verification failed: anon, authenticated, or PUBLIC has EXECUTE on repair_orphaned_paid_case_approval_intake';
  END IF;
END $acl_func$;

-- End-to-end RPC smoke test, scoped to a SAVEPOINT — this is already inside the one outer
-- transaction that must COMMIT at the end, so a nested "begin;...rollback;" here would NOT behave
-- as an independent transaction the way it would in its own standalone psql session; a SAVEPOINT
-- is the correct way to run a test that must not persist without disturbing the outer commit.
-- Never run this against a real case_id.
DO $precheck$
BEGIN
  IF EXISTS (SELECT 1 FROM justice_cases WHERE user_id = 'apply_procedure_smoke_test')
     OR EXISTS (SELECT 1 FROM justice_case_audit_events WHERE actor = 'apply_procedure_smoke_test_operator') THEN
    RAISE EXCEPTION 'PRECHECK FAILED: smoke-test markers already in use before the test started';
  END IF;
END $precheck$;

SAVEPOINT smoke_test;

insert into justice_cases (id, user_id, intake) values (gen_random_uuid(), 'apply_procedure_smoke_test', '{"smoke": true}'::jsonb);
insert into justice_case_tasks (user_id, case_id, title, notes)
select 'apply_procedure_smoke_test', id, 'smoke', 'orphaned_paid_case_approval_queue:' || id::text
from justice_cases where user_id = 'apply_procedure_smoke_test';

DO $invariant$
DECLARE
  v_case_id uuid;
  v_task_id uuid;
  v_case_version bigint;
  v_result jsonb;
  v_audit_count int;
BEGIN
  SELECT id, case_version INTO v_case_id, v_case_version FROM justice_cases WHERE user_id = 'apply_procedure_smoke_test';
  SELECT id INTO v_task_id FROM justice_case_tasks WHERE user_id = 'apply_procedure_smoke_test';

  SELECT repair_orphaned_paid_case_approval_intake(
    v_case_id, v_task_id, 'apply_procedure_smoke_test', v_case_version,
    '{"smoke": true, "corrected": true}'::jsonb, 'apply_procedure_smoke_test_operator'
  ) INTO v_result;

  IF (v_result ->> 'status') IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'INVARIANT CHECK FAILED: expected RPC status=applied, got % (full result: %)', v_result ->> 'status', v_result;
  END IF;

  SELECT count(*) INTO v_audit_count FROM justice_case_audit_events WHERE actor = 'apply_procedure_smoke_test_operator';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'INVARIANT CHECK FAILED: expected exactly 1 audit event for the smoke-test actor, found %', v_audit_count;
  END IF;
END $invariant$;

ROLLBACK TO SAVEPOINT smoke_test;

DO $cleanup_check$
BEGIN
  IF EXISTS (SELECT 1 FROM justice_cases WHERE user_id = 'apply_procedure_smoke_test')
     OR EXISTS (SELECT 1 FROM justice_case_audit_events WHERE actor = 'apply_procedure_smoke_test_operator') THEN
    RAISE EXCEPTION 'CLEANUP CHECK FAILED: smoke-test rows still present after ROLLBACK TO SAVEPOINT';
  END IF;
END $cleanup_check$;

COMMIT;
SQL
```

If any assertion raises, `ON_ERROR_STOP=1` aborts the script before `COMMIT` is ever reached, and
Postgres rolls back the entire open transaction automatically — the migration DDL, the history
row, and any smoke-test data all disappear together. Fix the underlying issue and re-run the whole
block; it is safe to re-run (the migration file's own `if not exists`/`create or replace` guards,
the history insert's `on conflict do nothing`, and the savepoint-scoped smoke test are all
idempotent).

## Step 7 — apply migration #6 (justice_case_audit_events / repair_orphaned_paid_case_approval_intake grants hardening)

**Pending.** Must run **after** Step 6. Same pattern as Step 6 — apply verbatim, record the exact
history row, verify, commit only if everything passes, all in one transaction:

```sh
psql "$PGURL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

\i supabase/migrations/20260928000000_justice_case_audit_events_grants_hardening.sql

insert into supabase_migrations.schema_migrations (version, name)
values ('20260928000000', 'justice_case_audit_events_grants_hardening')
on conflict (version) do nothing;

DO $hist$
DECLARE
  hist_name text;
BEGIN
  SELECT name INTO hist_name FROM supabase_migrations.schema_migrations WHERE version = '20260928000000';
  IF hist_name IS DISTINCT FROM 'justice_case_audit_events_grants_hardening' THEN
    RAISE EXCEPTION 'Verification failed: expected history row version=20260928000000 name=justice_case_audit_events_grants_hardening, found name=%', hist_name;
  END IF;
END $hist$;

-- Identical ACL assertions as Step 6 above — #6 is idempotent, so these must show the exact same
-- result whether #5 already had the fix (this is then a no-op) or #6 is what actually applies it.
DO $acl_table$
DECLARE
  service_role_privs text[];
BEGIN
  SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) INTO service_role_privs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a(grantor, grantee, privilege_type, is_grantable)
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE c.relname = 'justice_case_audit_events' AND n.nspname = 'public'
    AND coalesce(r.rolname, 'PUBLIC') = 'service_role';
  IF service_role_privs IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'IMMUTABILITY CHECK FAILED: expected service_role={INSERT,SELECT} on justice_case_audit_events, found %', service_role_privs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE c.relname = 'justice_case_audit_events' AND n.nspname = 'public'
      AND coalesce(r.rolname, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'IMMUTABILITY CHECK FAILED: anon, authenticated, or PUBLIC has some direct grant on justice_case_audit_events';
  END IF;
END $acl_table$;

DO $acl_func$
DECLARE
  service_role_privs text[];
BEGIN
  SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) INTO service_role_privs
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(p.proacl) AS a(grantor, grantee, privilege_type, is_grantable)
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE p.oid = 'public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text)'::regprocedure
    AND coalesce(r.rolname, 'PUBLIC') = 'service_role';
  IF service_role_privs IS DISTINCT FROM ARRAY['EXECUTE'] THEN
    RAISE EXCEPTION 'Verification failed: expected service_role={EXECUTE} on repair_orphaned_paid_case_approval_intake, found %', service_role_privs;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS a(grantor, grantee, privilege_type, is_grantable)
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid = 'public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, bigint, jsonb, text)'::regprocedure
      AND coalesce(r.rolname, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'Verification failed: anon, authenticated, or PUBLIC has EXECUTE on repair_orphaned_paid_case_approval_intake';
  END IF;
END $acl_func$;

COMMIT;
SQL
```

If any assertion raises, `ON_ERROR_STOP=1` aborts the script before `COMMIT`, and Postgres rolls
back the entire transaction — nothing is applied or recorded. Fix the underlying issue and re-run;
safe to re-run (idempotent `REVOKE`/`GRANT`, `on conflict do nothing` history insert).

**If either ACL check still fails after Step 7 completes and commits:** stop entirely — do not
proceed to Step 8, and do not deploy application code that relies on this table's immutability.
That would mean something other than `ALTER DEFAULT PRIVILEGES` is granting these roles access
(e.g. a manual grant added directly in the dashboard after #6 ran), which this procedure cannot
diagnose on its own.

## Step 8 — final code/schema agreement check

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
    // A real "function does not exist" / permission-denied error here means Step 6 (migration #5,
    // which creates the function) was skipped, Step 7 (migration #6, which grants EXECUTE) was
    // skipped or didn't take effect, or the function still has the old
    // (uuid, uuid, text, timestamptz, jsonb, text) signature. A clean call returning task_conflict
    // (no such task) is expected and fine — it proves the function is callable end to end with the
    // new signature and correct grants, not that this fake id resolved to anything.
    repair_rpc: e6?.message ?? "ok",
  });
})();
'
```

Expect every field to print `"ok"`. Any error here means the code/schema incompatibility this
procedure exists to catch is still present — do not deploy the application code until this prints
clean.

## Step 9 — only now, deploy the application code

Merge/deploy as normal. Do not run this procedure again for the same migrations — re-running
Step 6 or Step 7 is safe (both are idempotent, as noted above) but unnecessary once Step 8 passes.
