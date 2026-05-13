-- Add body_html column so writers can paste a full case study into one
-- big field. When body_html is set, the publish template renders it as
-- the article body. When NULL, the template falls back to the
-- structured prose fields (so the existing Lytham row keeps working).

alter table public.case_studies
  add column if not exists body_html text;
