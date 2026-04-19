import { createClient } from "jsr:@supabase/supabase-js@2";

async function sendSmsAlert(message: string): Promise<void> {
  const sid   = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from  = Deno.env.get("TWILIO_PHONE_NUMBER");
  const to    = Deno.env.get("TWILIO_ALERT_RECIPIENT");

  if (!sid || !token || !from || !to) {
    console.error("Twilio credentials missing — cannot send SMS alert");
    return;
  }

  const body = new URLSearchParams({ From: from, To: to, Body: message });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Twilio SMS failed (${res.status}): ${text}`);
    } else {
      console.log("Twilio SMS sent OK");
    }
  } catch (err) {
    console.error("Twilio fetch error:", err);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type LeadPayload = {
  firstName: string;
  lastName: string;
  phone: string;
  postcode: string;
  propertyType: string;
  interest: string;
  heating: string;
  sourcePage?: string;
  submittedAt?: string;
  callbackDate?: string;
  callbackTime?: string;
  doorNumber?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function validate(payload: Partial<LeadPayload>) {
  if (!payload.firstName?.trim()) return { field: "firstName", error: "First name is required." };
  if (!payload.lastName?.trim()) return { field: "lastName", error: "Last name is required." };
  if (!payload.phone?.trim()) return { field: "phone", error: "Phone number is required." };
  if (payload.phone.replace(/[^0-9+]/g, "").length < 10) return { field: "phone", error: "Enter a valid phone number." };
  if (!payload.postcode?.trim()) return { field: "postcode", error: "Postcode is required." };
  if (!payload.propertyType?.trim()) return { field: "propertyType", error: "Property type is required." };
  if (!payload.interest?.trim()) return { field: "interest", error: "Main interest is required." };
  if (!payload.heating?.trim()) return { field: "heating", error: "Heating type is required." };
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("THERMOVA_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "Function secrets are not configured." }, 500);
  }

  const payload = await request.json().catch(() => null) as Partial<LeadPayload> | null;

  if (!payload) {
    return json({ ok: false, error: "Invalid JSON payload." }, 400);
  }

  const validationError = validate(payload);
  if (validationError) {
    return json({ ok: false, error: validationError.error, field: validationError.field }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { error } = await supabase.from("lead_enquiries").insert({
    first_name: payload.firstName.trim(),
    last_name: payload.lastName.trim(),
    phone: payload.phone.trim(),
    postcode: payload.postcode.trim().toUpperCase(),
    property_type: payload.propertyType.trim(),
    interest: payload.interest.trim(),
    heating: payload.heating.trim(),
    source_page: payload.sourcePage?.trim() || "thermova-homepage",
    user_agent: request.headers.get("user-agent"),
    metadata: {
      submittedAt: payload.submittedAt || new Date().toISOString(),
      doorNumber: payload.doorNumber?.trim() || null,
      callbackDate: payload.callbackDate || null,
      callbackTime: payload.callbackTime || null,
    }
  });

  if (error) {
    return json({ ok: false, error: "We could not store your enquiry. Please try again." }, 500);
  }

  const addressStr = payload.doorNumber?.trim()
    ? `${payload.doorNumber.trim()}, ${payload.postcode.trim().toUpperCase()}`
    : payload.postcode.trim().toUpperCase();

  const callbackStr = payload.callbackDate
    ? ` — Callback: ${payload.callbackDate} at ${payload.callbackTime || "TBC"}`
    : "";

  await sendSmsAlert(
    `New Thermova lead: ${payload.firstName.trim()} ${payload.lastName.trim()} — ${payload.phone.trim()} — ${addressStr} — ${payload.interest.trim()}${callbackStr}`
  );

  return json({
    ok: true,
    message: "Thanks — we've received your enquiry. We'll call shortly. No obligation."
  });
});
