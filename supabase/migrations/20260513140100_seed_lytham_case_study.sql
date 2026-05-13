-- One-time backfill of the existing /blog/air-source-heat-pump-case-study-lytham-lancashire
-- page into the case_studies table, so it can be edited via /admin/case-studies/.
--
-- Re-publishing this row through the edge function should produce HTML that
-- matches the current live file (modulo whitespace) — this is the regression
-- gate that proves the template module is faithful.

insert into public.case_studies (
  slug,
  status,
  title,
  meta_description,
  keywords,
  about_topics,
  hero_image_url,
  hero_image_alt,
  hero_image_caption,
  gallery_images,
  breadcrumb_label,
  author_name,
  published_date,
  read_time_minutes,
  location,
  opening_paragraph_1,
  opening_paragraph_2,
  why_matters_heading,
  why_matters_prose,
  equipment_list_html,
  installation_days,
  installation_timeline_prose,
  property_spec,
  performance_data,
  methodology_prose,
  co2_equivalence_prose,
  cost_data,
  cost_narrative_prose,
  winter_performance_html,
  faq_items,
  cta_heading,
  cta_body,
  methodology_footnote,
  last_published_at
) values (
  'air-source-heat-pump-case-study-lytham-lancashire',
  'published',
  $title$Air Source Heat Pump Case Study: How a Lytham Edwardian Semi Cut Heating CO₂ by 75%$title$,
  $desc$Real Thermova air source heat pump install data from Lytham, Lancashire. Measured SCOP 3.8, 11,940 kWh saved, 2.2 tonnes CO₂ cut, 3-day install. Free survey.$desc$,
  ARRAY[
    'air source heat pump case study',
    'air source heat pump installer Blackpool',
    'air source heat pump Lancashire',
    'heat pump SCOP',
    'Boiler Upgrade Scheme Lancashire',
    'MCS certified',
    'heat pump for older homes'
  ],
  ARRAY[
    'Air source heat pump',
    'Boiler Upgrade Scheme',
    'Edwardian property retrofit'
  ],
  'https://cyjbzemzjmfjsloogixw.supabase.co/storage/v1/object/public/Website/thermova%20case%20study%201.png',
  $alt$Thermova engineer installing air source heat pump outdoor unit at Lytham Edwardian semi-detached property, Lancashire$alt$,
  $cap$Thermova install in progress at the 1908 Edwardian semi in Lytham St Annes — outdoor unit sited on the side return.$cap$,
  '[]'::jsonb,
  'Air source heat pump case study',
  'Graham Barr',
  date '2026-05-12',
  8,
  'Lytham St Annes, Lancashire',
  $p1$When a homeowner in Lytham St Annes asked us to look at replacing their ageing gas boiler, the brief was familiar: lower bills, lower carbon, and a system that wouldn't fight the character of a 1908 Edwardian semi-detached property. A year on from commissioning, the meters tell the story — a measured <strong>SCOP of 3.8</strong>, <strong>11,940 kWh</strong> of fossil fuel taken out of the home, and <strong>2.2 tonnes of CO₂</strong> a year off the heating bill.$p1$,
  $p2$This case study walks through what the property looked like before, what we installed, how the install actually ran, and what the year-one data shows — with the methodology behind every number so other Lancashire homeowners can judge whether a heat pump is right for their own home.$p2$,
  'Why this case study matters for Lancashire homeowners',
  $wm$<p>Most heat pump case studies you'll find online are either glossy manufacturer brochures or new-build show homes — neither of which look like the housing stock you actually find around Blackpool, the Fylde Coast, and inland Lancashire. The Fylde has thousands of pre-war semis with solid walls, suspended floors, and original sash windows. Whether a heat pump can heat one of those properties is the question that matters.</p>
<p>Lytham, Lancashire is a useful test case. Coastal, exposed to wind off the Irish Sea, milder winters than further inland but plenty of damp days, and a housing stock that is anything but identikit. If a heat pump works here, the question stops being "do they work in old UK homes?" and starts being "is the design right for my property?"</p>$wm$,
  $eq$<ul>
  <li><strong>Daikin Altherma 3 R</strong> 9 kW monobloc outdoor unit, sited on the side return on anti-vibration mounts</li>
  <li><strong>210 L unvented cylinder</strong> (heat-pump-ready coil), installed in the existing airing cupboard</li>
  <li><strong>Six radiators upsized</strong> to type 22 doubles to drop the flow temperature; two existing radiators retained where heat loss allowed</li>
  <li><strong>Weather-compensated controls</strong> wired to a single thermostat — no zoning, run as a single low-temperature heating circuit</li>
  <li><strong>Hydraulic separation</strong> via low-loss header to protect minimum flow at the heat pump</li>
  <li>Old gas combi removed and gas supply capped; gas meter retained for hob (homeowner request)</li>
</ul>
<p>System designed against MCS heat-loss methodology at the Lytham design temperature of −2.2 °C, with a flow temperature of 45 °C at design conditions.</p>$eq$,
  3,
  $tl$Three working days. Day one: outdoor unit, hydraulic header, and pipework chases. Day two: radiator changes, cylinder swap, gas decommission. Day three: commissioning, weather-compensation curve set, hot-water schedule configured with the homeowner, and a 90-minute walkthrough on how to drive the system. Heating and hot water were available continuously from the end of day two.$tl$,
  jsonb_build_object(
    'property_type', 'Semi-detached, three bedrooms',
    'year_built', '1908 (Edwardian)',
    'floor_area', '118 m²',
    'walls', 'Solid brick (no cavity)',
    'loft_insulation', '270 mm mineral wool (upgraded 2019)',
    'floors', 'Suspended timber, ground floor partially insulated',
    'glazing', 'Double glazed (replaced 2014), original sash to front bay retained',
    'previous_heating', '2011 gas combi boiler, eight radiators',
    'epc_rating_before', 'D (62)',
    'occupants', '2 adults, working from home Mon–Fri'
  ),
  jsonb_build_object(
    'heat_delivered_kwh', '14,890 kWh',
    'electricity_consumed_kwh', '3,920 kWh',
    'measured_scop', '3.8',
    'gas_usage_removed_kwh', '11,940 kWh (previous 12-month average)',
    'co2_before', '2.18 t CO₂e / year',
    'co2_after', '0.55 t CO₂e / year',
    'co2_reduction', '−75% (2.2 t per year saved)'
  ),
  $m$<p>Methodology notes for the numbers above:</p>
<ul>
  <li>SCOP is measured — output from the heat meter on the heat pump's flow circuit, divided by the dedicated kWh sub-meter on the heat pump's electrical supply.</li>
  <li>Pre-install gas usage is a 12-month rolling average drawn from the homeowner's bills covering the year immediately before the switchover.</li>
  <li>CO₂ factors used: natural gas <strong>0.183 kg CO₂e / kWh</strong>; grid electricity <strong>0.140 kg CO₂e / kWh</strong> (DEFRA / BEIS year-applicable factor at install).</li>
  <li>Numbers exclude the small gas usage retained for the hob.</li>
</ul>$m$,
  $co2$<ul>
  <li>Roughly equivalent to taking <strong>one average UK petrol car</strong> off the road for a year.</li>
  <li>Or the carbon absorbed by <strong>~100 mature trees</strong> in a year.</li>
  <li>Or about <strong>11 long-haul return flights</strong> (London → New York economy class) of carbon offset annually — every year, while the system runs.</li>
</ul>$co2$,
  jsonb_build_object(
    'system_cost', '£14,200',
    'grant_amount', '−£7,500',
    'net_cost', '£6,700',
    'caption', 'Installation cost — Lytham 9 kW heat pump'
  ),
  $cn$<p>Thermova design and manage the <a href="/boiler-upgrade-scheme">Boiler Upgrade Scheme</a> route as part of the installation, so the £7,500 grant was deducted directly from the homeowner's invoice — no separate application, no claim to chase. The remaining balance was paid on completion against the commissioning sign-off.</p>
<p>On running costs, the year-one heat-pump electricity of 3,920 kWh on a standard single-rate tariff sits in the same ballpark as the previous gas spend on a like-for-like comparison. Moving to a heat-pump-friendly time-of-use tariff (with cheaper overnight electricity) is the next lever, and the homeowner is on that path for year two.</p>$cn$,
  $wp$<ul>
  <li>Ran continuously through the coldest stretch — eight consecutive nights below 0 °C in January.</li>
  <li>No supplementary electric "emergency" heating triggered at any point in the year.</li>
  <li>Hot water on a single afternoon schedule met demand for two adults working from home; no top-ups required.</li>
  <li>Indoor temperature held a steady 20–21 °C across the heating season, including the front room where the original sash bay was retained.</li>
  <li>Defrost cycles were quiet and short — homeowner reports the outdoor unit is less audible than the previous gas boiler's flue.</li>
</ul>$wp$,
  '[
    {"q":"Will an air source heat pump work in an older Lancashire home?","a":"Yes — this Lytham case study is a 1908 Edwardian semi-detached property. The key is proper design around heat loss, radiator sizing, insulation upgrades where needed, and lower flow temperatures. Done right, older Lancashire homes run a heat pump as comfortably as a modern build."},
    {"q":"What SCOP should I expect from an air source heat pump in Lancashire?","a":"A well-designed install in coastal Lancashire should deliver a SCOP between 3.5 and 4.0. The Lytham property in this case study recorded a measured year-one SCOP of 3.8 — meaning the heat pump produced 3.8 kWh of heat for every 1 kWh of electricity used."},
    {"q":"How long does an air source heat pump installation take?","a":"Most installations take one to three days. The Lytham project was completed in three working days: outdoor unit and hydraulics on day one, radiator changes and cylinder swap on day two, commissioning and homeowner handover on day three."},
    {"q":"How much does an air source heat pump cost after the Boiler Upgrade Scheme grant?","a":"On this Lytham install, the full system cost £14,200 before grant. The Boiler Upgrade Scheme deducted £7,500, leaving the homeowner with £6,700 to pay. Thermova design and manage the grant route as part of the installation, so the deduction is applied directly to the invoice. Estimates are illustrative; actual outcomes vary based on property size, insulation, usage, system design, and energy tariffs."},
    {"q":"Does an air source heat pump perform in cold UK winters?","a":"Yes. The Lytham heat pump ran continuously through the coldest weeks of the year, including sub-zero overnight temperatures. Output drops as the air gets colder, which is why a proper heat-loss survey and correctly sized emitters matter — the system is designed to deliver full heat at the local design temperature, not just on a mild day."},
    {"q":"Is an air source heat pump worth it compared to a new gas boiler?","a":"For this Lytham homeowner, replacing the ageing gas boiler with an air source heat pump cut measured heating-related CO₂ by 75% and removed annual gas-meter readings entirely. Running costs are sensitive to electricity tariff and heat-pump-friendly time-of-use plans, but on a standard tariff the system runs at parity or better with the old gas boiler, with a much lower carbon footprint."}
  ]'::jsonb,
  'Get a free home survey from Thermova',
  $cb$Book a free property survey and we'll tell you what your home actually needs — heat-loss numbers, radiator sizing, grant route, and a fixed quote with no obligation.$cb$,
  $fn$Year-one performance figures are drawn from on-site metering: heat output from a calibrated heat meter on the heat pump's primary flow circuit and electricity input from a dedicated MID-class kWh meter on the heat pump's supply, recorded over twelve consecutive months from commissioning. SCOP is calculated as heat delivered ÷ electricity consumed. Pre-install gas usage is the homeowner's 12-month bill average covering the year immediately before switchover. Carbon factors: natural gas 0.183 kg CO₂e / kWh, grid electricity 0.140 kg CO₂e / kWh (UK Government conversion factors, year-applicable at install). Costs shown are this homeowner's actual installation price including VAT before the Boiler Upgrade Scheme grant was applied. Estimates are illustrative; actual outcomes for other properties vary based on property size, insulation, usage, system design, and energy tariffs.$fn$,
  timestamptz '2026-05-12 00:00:00+00'
)
on conflict (slug) do nothing;
