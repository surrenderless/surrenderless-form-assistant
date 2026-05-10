-- Soft-archive: hide cases from default lists without deleting rows.

alter table public.justice_cases
  add column if not exists archived_at timestamptz null;

comment on column public.justice_cases.archived_at is 'When set, case is hidden from default GET /api/justice/cases list; row retained for audit/recovery.';
