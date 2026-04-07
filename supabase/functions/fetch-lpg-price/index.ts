import { createClient } from "jsr:@supabase/supabase-js@2";

// 5kg propane: 5 × 13.47 kWh/kg = 67.35 kWh per bottle
const LPG_KWH_PER_BOTTLE = 67.35;

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
  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("THERMOVA_SERVICE_ROLE_KEY")!,
  );

  try {
    const res = await fetch("https://www.calor.co.uk/lpg-prices", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Thermova-PriceBot/1.0)" },
    });

    if (!res.ok) throw new Error(`Calor fetch failed: HTTP ${res.status}`);

    const html = await res.text();

    // Parse 5kg propane refill price
    // Calor HTML contains patterns like "£23.25" near "5kg" and "refill" or "Refill price"
    // Try several patterns in order of specificity
    const refillMatch =
      html.match(/5\s*kg[^<]{0,300}?[Rr]efill[^£]{0,50}?£\s*(\d+\.\d{2})/s) ??
      html.match(/[Rr]efill[^£]{0,200}?5\s*kg[^£]{0,50}?£\s*(\d+\.\d{2})/s) ??
      html.match(/[Rr]efill\s+price[^£*]{0,50}\*{0,2}[^£]{0,20}£\s*(\d+\.\d{2})/);

    if (!refillMatch) throw new Error("Could not parse 5kg propane refill price from Calor page");

    const refillPriceGbp = parseFloat(refillMatch[1]);
    if (isNaN(refillPriceGbp) || refillPriceGbp < 10 || refillPriceGbp > 150) {
      throw new Error(`Parsed implausible Calor refill price: £${refillMatch[1]}`);
    }

    const refillPricePence = refillPriceGbp * 100;
    const lpgPencePerKwh = parseFloat((refillPricePence / LPG_KWH_PER_BOTTLE).toFixed(2));

    await supabase.from("fuel_prices").update({
      lpg_pence_per_kwh: lpgPencePerKwh,
      lpg_calor_refill_price_gbp: refillPriceGbp,
      lpg_source: "Calor 5kg propane refill",
      lpg_last_updated: new Date().toISOString(),
    }).eq("id", 1);

    console.log(`LPG price updated: £${refillPriceGbp} refill → ${lpgPencePerKwh}p/kWh`);

    return new Response(
      JSON.stringify({ ok: true, lpg_calor_refill_price_gbp: refillPriceGbp, lpg_pence_per_kwh: lpgPencePerKwh }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Calor scrape error:", message);
    await sendSmsAlert(`Thermova: LPG price fetch failed — ${message}. Last stored value retained.`);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
