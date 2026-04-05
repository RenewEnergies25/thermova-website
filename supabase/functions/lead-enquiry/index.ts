import { createClient } from "jsr:@supabase/supabase-js@2";

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
      submittedAt: payload.submittedAt || new Date().toISOString()
    }
  });

  if (error) {
    return json({ ok: false, error: "We could not store your enquiry. Please try again." }, 500);
  }

  return json({
    ok: true,
    message: "Thanks — we've received your enquiry. We'll call shortly. No obligation."
  });
});
