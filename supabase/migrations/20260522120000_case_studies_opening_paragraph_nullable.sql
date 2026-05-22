-- opening_paragraph_1 was NOT NULL in the original case_studies schema, back
-- when every case study had to use the structured prose layout. The follow-up
-- 20260513150000_case_studies_body_html migration added a body_html column
-- and a publish template branch that renders body_html directly without
-- touching opening_paragraph_1 — but the NOT NULL constraint on
-- opening_paragraph_1 was left in place, so admin saves in "paste-and-go"
-- mode fail with a constraint violation. Drop the constraint to match the
-- documented dual-mode behaviour.

alter table public.case_studies
  alter column opening_paragraph_1 drop not null;
