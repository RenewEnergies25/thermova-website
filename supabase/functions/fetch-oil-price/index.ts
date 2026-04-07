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
    const res = await fetch("https://www.boilerjuice.com/kerosene-prices/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Thermova-PriceBot/1.0)" },
    });

    if (!res.ok) throw new Error(`BoilerJuice fetch failed: HTTP ${res.status}`);

    const html = await res.text();

    // Match today's average price in pence per litre
    // Example: "140.43 pence per litre" or "140.43p per litre"
    const match = html.match(/(\d{2,3}\.\d{1,2})\s*p(?:ence)?\s*(?:per|\/)\s*litre/i) ??
      html.match(/average[^<]{0,100}?(\d{2,3}\.\d{1,2})/i);

    if (!match) throw new Error("Could not parse kerosene price from BoilerJuice page");

    const price = parseFloat(match[1]);
    if (isNaN(price) || price < 50 || price > 300) {
      throw new Error(`Parsed implausible oil price: ${match[1]}p/litre`);
    }

    await supabase.from("fuel_prices").update({
      oil_pence_per_litre: price,
      oil_source: "BoilerJuice daily average",
      oil_last_updated: new Date().toISOString(),
    }).eq("id", 1);

    console.log(`Oil price updated: ${price}p/litre`);

    return new Response(JSON.stringify({ ok: true, oil_pence_per_litre: price }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("BoilerJuice scrape error:", message);
    await sendSmsAlert(`Thermova: Oil price fetch failed — ${message}. Last stored value retained.`);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
