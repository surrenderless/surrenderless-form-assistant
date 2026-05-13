-- Optional where-proof-lives metadata (no file blobs).

alter table public.justice_case_evidence
  add column if not exists source_url text null;

alter table public.justice_case_evidence
  add column if not exists storage_note text null;

comment on column public.justice_case_evidence.source_url is 'Optional URL where the proof can be viewed (e.g. cloud link).';
comment on column public.justice_case_evidence.storage_note is 'Optional human note on where the file lives (e.g. Gmail, Drive).';
