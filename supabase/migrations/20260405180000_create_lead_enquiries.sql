create extension if not exists pgcrypto;

create table if not exists public.lead_enquiries (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,
  postcode text not null,
  property_type text not null,
  interest text not null,
  heating text not null,
  source_page text not null default 'thermova-homepage',
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists lead_enquiries_created_at_idx
  on public.lead_enquiries (created_at desc);

alter table public.lead_enquiries enable row level security;

revoke all on public.lead_enquiries from anon, authenticated;
