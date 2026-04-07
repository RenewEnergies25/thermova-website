-- Create fuel_prices table (single-row design, always upsert id = 1)
create table if not exists public.fuel_prices (
  id                          integer primary key default 1,
  gas_pence_per_kwh           numeric(6,2) not null default 5.74,
  electricity_pence_per_kwh   numeric(6,2) not null default 24.67,
  oil_pence_per_litre         numeric(6,2) not null default 140.43,
  oil_pence_per_kwh           numeric(6,2) generated always as (oil_pence_per_litre / 10.35) stored,
  lpg_pence_per_kwh           numeric(6,2) not null default 34.50,
  lpg_calor_refill_price_gbp  numeric(6,2) not null default 23.25,
  gas_source                  text not null default 'Ofgem price cap Apr–Jun 2026',
  gas_quarter                 text not null default 'April–June 2026',
  electricity_source          text not null default 'Ofgem price cap Apr–Jun 2026',
  electricity_quarter         text not null default 'April–June 2026',
  oil_source                  text not null default 'BoilerJuice daily average',
  lpg_source                  text not null default 'Calor 5kg propane refill',
  oil_last_updated            timestamptz not null default now(),
  lpg_last_updated            timestamptz not null default now(),
  gas_last_updated            timestamptz not null default now(),
  electricity_last_updated    timestamptz not null default now()
);

-- Seed the single row
insert into public.fuel_prices (id) values (1) on conflict do nothing;

-- RLS: public read, service-role write only
alter table public.fuel_prices enable row level security;

create policy "Public read fuel prices"
  on public.fuel_prices
  for select
  using (true);
