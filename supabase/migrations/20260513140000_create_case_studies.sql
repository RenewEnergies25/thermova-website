-- Case studies CMS table backing the /admin/case-studies/ UI and the
-- publish-case-study edge function. Authenticated users (any user with a
-- Supabase login) can CRUD; the edge function then renders rows into static
-- HTML files committed to the GitHub repo.

create table if not exists public.case_studies (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  status                      text not null default 'draft' check (status in ('draft','published','archived')),

  -- Meta & SEO
  title                       text not null,
  meta_description            text not null,
  keywords                    text[] not null default '{}',
  about_topics                text[] not null default '{}',

  -- Hero
  hero_image_url              text,
  hero_image_alt              text,
  hero_image_caption          text,

  -- Inline gallery (additional images referenced from prose)
  -- Shape: [{url, alt, caption, storage_path, width, height}, ...]
  gallery_images              jsonb not null default '[]'::jsonb,

  -- Article header
  breadcrumb_label            text not null,
  author_name                 text not null default 'Graham Barr',
  published_date              date not null,
  read_time_minutes           integer not null default 6,
  location                    text not null,

  -- Body prose (HTML allowed; users paste inline <img> snippets from gallery)
  opening_paragraph_1         text not null,
  opening_paragraph_2         text,
  why_matters_heading         text,
  why_matters_prose           text,
  equipment_list_html         text,
  installation_days           integer,
  installation_timeline_prose text,
  methodology_prose           text,
  co2_equivalence_prose       text,
  cost_narrative_prose        text,
  winter_performance_html     text,
  methodology_footnote        text,

  -- Structured tables (JSONB so admin form can evolve without schema churn)
  -- property_spec keys: property_type, year_built, floor_area_sqm, walls, loft_insulation,
  --                     floors, glazing, previous_heating, epc_rating_before, occupants
  property_spec               jsonb not null default '{}'::jsonb,
  -- performance_data keys: heat_delivered_kwh, electricity_consumed_kwh, measured_scop,
  --                        gas_usage_removed_kwh, co2_before_tonnes, co2_after_tonnes,
  --                        co2_reduction_tonnes, co2_reduction_pct, co2_gas_factor_per_kwh,
  --                        co2_electricity_factor_per_kwh
  performance_data            jsonb not null default '{}'::jsonb,
  -- cost_data keys: system_cost_gbp, grant_amount_gbp, net_cost_gbp, system_size_kw
  cost_data                   jsonb not null default '{}'::jsonb,

  -- FAQ: [{q: "...", a: "..."}, ...]
  faq_items                   jsonb not null default '[]'::jsonb,

  -- CTA
  cta_heading                 text not null default 'Get a free home survey from Thermova',
  cta_body                    text,

  -- Audit
  last_published_at           timestamptz,
  last_published_commit_sha   text,
  published_by_user_id        uuid references auth.users(id) on delete set null,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default timezone('utc', now()),
  updated_at                  timestamptz not null default timezone('utc', now())
);

create index if not exists case_studies_status_idx on public.case_studies (status);
create index if not exists case_studies_published_date_idx on public.case_studies (published_date desc);

-- updated_at trigger
create or replace function public.set_case_studies_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_case_studies_updated_at on public.case_studies;
create trigger trg_case_studies_updated_at
  before update on public.case_studies
  for each row execute function public.set_case_studies_updated_at();

-- RLS: any authenticated user has full CRUD; anonymous has none.
alter table public.case_studies enable row level security;

create policy "case_studies_authenticated_select" on public.case_studies
  for select to authenticated using (true);

create policy "case_studies_authenticated_insert" on public.case_studies
  for insert to authenticated with check (true);

create policy "case_studies_authenticated_update" on public.case_studies
  for update to authenticated using (true) with check (true);

create policy "case_studies_authenticated_delete" on public.case_studies
  for delete to authenticated using (true);

-- Storage policies on the existing public Website bucket so authenticated
-- users can upload + delete case study images from the admin UI.
-- (Public read on the bucket is already configured; we just add write paths.)
do $$
begin
  -- Skip if policies already exist (idempotent re-run)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'case_studies_authenticated_upload'
  ) then
    create policy "case_studies_authenticated_upload" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'Website' and (storage.foldername(name))[1] = 'case-studies');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'case_studies_authenticated_update'
  ) then
    create policy "case_studies_authenticated_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'Website' and (storage.foldername(name))[1] = 'case-studies');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'case_studies_authenticated_delete'
  ) then
    create policy "case_studies_authenticated_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'Website' and (storage.foldername(name))[1] = 'case-studies');
  end if;
end $$;
