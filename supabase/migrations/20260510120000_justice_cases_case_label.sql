-- Optional user-facing label for saved cases list.

alter table public.justice_cases
  add column if not exists case_label text null;

comment on column public.justice_cases.case_label is 'Optional short label for the case list; intake company_name remains the default title when unset.';
