alter table public.epc_results
  add column if not exists total_floor_area numeric(7,2),
  add column if not exists property_type    text,
  add column if not exists built_form       text;
