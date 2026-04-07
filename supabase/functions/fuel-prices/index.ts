import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("THERMOVA_SERVICE_ROLE_KEY")!,
  );

  // GET — public, return current fuel prices
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("fuel_prices")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to load fuel prices." }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // POST — admin only, manual override of any field
  if (req.method === "POST") {
    const adminSecret = Deno.env.get("THERMOVA_ADMIN_SECRET");
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!adminSecret || token !== adminSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON body." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Only allow known writable fields
    const allowed = new Set([
      "gas_pence_per_kwh",
      "electricity_pence_per_kwh",
      "oil_pence_per_litre",
      "lpg_pence_per_kwh",
      "lpg_calor_refill_price_gbp",
      "gas_source",
      "gas_quarter",
      "electricity_source",
      "electricity_quarter",
      "oil_source",
      "lpg_source",
      "oil_last_updated",
      "lpg_last_updated",
      "gas_last_updated",
      "electricity_last_updated",
    ]);

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed.has(key)) update[key] = value;
    }

    if (Object.keys(update).length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "No valid fields provided." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { error } = await supabase
      .from("fuel_prices")
      .update(update)
      .eq("id", 1);

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, updated: Object.keys(update) }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: false, error: "Method not allowed." }),
    { status: 405, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
