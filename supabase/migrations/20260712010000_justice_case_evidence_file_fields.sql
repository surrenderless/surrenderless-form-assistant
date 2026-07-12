-- Chat-native evidence file attachments (images/PDFs) on justice_case_evidence.

alter table public.justice_case_evidence
  add column if not exists file_path text null,
  add column if not exists file_name text null,
  add column if not exists mime_type text null,
  add column if not exists file_size_bytes bigint null;

comment on column public.justice_case_evidence.file_path is
  'Private storage object path in JUSTICE_EVIDENCE_BUCKET only (never returned by evidence list/upload APIs; never expose as /storage/v1/object/public/).';
comment on column public.justice_case_evidence.file_name is
  'Original uploaded file name for packet/display.';
comment on column public.justice_case_evidence.mime_type is
  'MIME type of the uploaded file (image/* or application/pdf).';
comment on column public.justice_case_evidence.file_size_bytes is
  'Uploaded file size in bytes.';

comment on table public.justice_case_evidence is
  'User evidence metadata and optional private file attachments tied to a justice case. Requires JUSTICE_EVIDENCE_BUCKET (private). Access files only via authenticated ownership-checked signed URLs.';
