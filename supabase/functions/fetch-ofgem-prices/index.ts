import { createClient } from "jsr:@supabase/supabase-js@2";

async function sendSmsAlert(message: string): Promise<void> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  const to = Deno.env.get("TWILIO_ALERT_RECIPIENT");

  if (!sid || !token || !from || !to) {
    console.error("Twilio credentials missing — cannot send SMS alert");
    return;
  }

  const body = new URLSearchParams({ From: from, To: to, Body: message });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

Deno.serve(async (req: Request) => {
  // Verify cron secret — only cron-job.org should trigger this
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("THERMOVA_SERVICE_ROLE_KEY")!,
  );

  try {
    const res = await fetch(
      "https://www.ofgem.gov.uk/check-if-energy-price-cap-affects-you",
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; Thermova-PriceBot/1.0)" } },
    );

    if (!res.ok) throw new Error(`Ofgem fetch failed: HTTP ${res.status}`);

    const html = await res.text();

    // Parse gas unit rate e.g. "5.74 pence per kWh" (gas section comes before electricity)
    const gasMatch = html.match(/(\d+\.\d+)\s*pence per kWh[\s\S]{0,200}?gas/i) ??
      html.match(/gas[\s\S]{0,200}?(\d+\.\d+)\s*pence per kWh/i);

    // Parse electricity unit rate
    const elecMatch = html.match(/(\d+\.\d+)\s*pence per kWh[\s\S]{0,200}?electricity/i) ??
      html.match(/electricity[\s\S]{0,200}?(\d+\.\d+)\s*pence per kWh/i);

    // Parse quarter label e.g. "1 April to 30 June 2026" or "April to June 2026"
    const quarterMatch = html.match(
      /(\d{1,2}\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:to\s+\d{1,2}\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    );

    if (!gasMatch || !elecMatch) {
      throw new Error("Could not parse gas or electricity unit rates from Ofgem page");
    }

    const newGas = parseFloat(gasMatch[1]);
    const newElec = parseFloat(elecMatch[1]);
    const quarter = quarterMatch
      ? `${quarterMatch[2]}–${quarterMatch[3]} ${quarterMatch[4]}`
      : "Current quarter";

    if (isNaN(newGas) || isNaN(newElec)) {
      throw new Error(`Parsed invalid values: gas=${gasMatch[1]} elec=${elecMatch[1]}`);
    }

    // Fetch current stored values to check for changes
    const { data: current } = await supabase
      .from("fuel_prices")
      .select("gas_pence_per_kwh, electricity_pence_per_kwh")
      .eq("id", 1)
      .single();

    const gasChanged = !current || current.gas_pence_per_kwh !== newGas;
    const elecChanged = !current || current.electricity_pence_per_kwh !== newElec;

    if (gasChanged || elecChanged) {
      const source = `Ofgem price cap ${quarter}`;
      await supabase.from("fuel_prices").update({
        gas_pence_per_kwh: newGas,
        electricity_pence_per_kwh: newElec,
        gas_source: source,
        gas_quarter: quarter,
        electricity_source: source,
        electricity_quarter: quarter,
        gas_last_updated: new Date().toISOString(),
        electricity_last_updated: new Date().toISOString(),
      }).eq("id", 1);

      console.log(`Ofgem prices updated: gas=${newGas}p, electricity=${newElec}p (${quarter})`);
    } else {
      console.log(`Ofgem prices unchanged: gas=${newGas}p, electricity=${newElec}p`);
    }

    return new Response(JSON.stringify({ ok: true, gas: newGas, electricity: newElec, quarter }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Ofgem scrape error:", message);
    await sendSmsAlert(`Thermova: Ofgem price scrape failed — ${message}. Last stored values retained.`);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
