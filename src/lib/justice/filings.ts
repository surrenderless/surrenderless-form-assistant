export type JusticeCaseFilingRow = {
  id: string;
  user_id: string;
  case_id: string;
  destination: string;
  filed_at: string | null;
  confirmation_number: string | null;
  filing_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
