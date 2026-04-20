-- Upload sessions
create table if not exists public.epc_uploads (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  filename       text not null,
  total_rows     integer not null default 0,
  processed_rows integer not null default 0,
  status         text not null default 'pending',
  error_message  text,
  created_at     timestamptz not null default timezone('utc', now()),
  completed_at   timestamptz
);

-- Per-address results
create table if not exists public.epc_results (
  id               uuid primary key default gen_random_uuid(),
  upload_id        uuid not null references public.epc_uploads(id) on delete cascade,
  row_index        integer not null,
  input_address    text not null,
  matched_address  text,
  epc_rating       text,
  sap_score        integer,
  heating_source   text,
  inspection_date  date,
  match_confidence text not null default 'not_found',
  jaccard_score    numeric(4,3),
  status           text not null default 'pending',
  error_message    text,
  created_at       timestamptz not null default timezone('utc', now())
);

create index if not exists epc_results_upload_id_idx
  on public.epc_results (upload_id, row_index);

-- RLS
alter table public.epc_uploads enable row level security;
alter table public.epc_results  enable row level security;

create policy "Owner reads own uploads" on public.epc_uploads
  for select using (auth.uid() = user_id);

create policy "Owner reads own results" on public.epc_results
  for select using (
    exists (select 1 from public.epc_uploads u
            where u.id = epc_results.upload_id and u.user_id = auth.uid())
  );

-- Atomic counter increment to avoid race conditions in promise pool
create or replace function public.increment_processed_rows(p_upload_id uuid)
returns void language sql security definer as $$
  update public.epc_uploads
  set processed_rows = processed_rows + 1
  where id = p_upload_id;
$$;
