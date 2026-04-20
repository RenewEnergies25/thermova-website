import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EpcRow {
  "address": string;
  "current-energy-rating": string;
  "current-energy-efficiency": string;
  "mainheat-description": string;
  "inspection-date": string;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractPostcode(address: string): string | null {
  const m = address.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].replace(/\s+/, " ").toUpperCase() : null;
}

const UK_ABBREVS: Record<string, string> = {
  rd: "road", st: "street", ave: "avenue", ln: "lane",
  dr: "drive", cl: "close", cres: "crescent", ct: "court",
  pl: "place", sq: "square", gdns: "gardens", grn: "green",
  gro: "grove", pk: "park", ter: "terrace", wk: "walk",
  wy: "way", blvd: "boulevard", hse: "house", bldg: "building",
  mws: "mews", pde: "parade",
};

function expandAbbreviations(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, "")
    .split(/\s+/)
    .map((t) => UK_ABBREVS[t] ?? t)
    .join(" ");
}

function normalise(s: string): Set<string> {
  return new Set(expandAbbreviations(s).split(/\s+/).filter(Boolean));
}

function stripPostcode(address: string, postcode: string): string {
  return address.replace(new RegExp(postcode.replace(/\s+/g, "\\s*"), "i"), "").trim();
}

const FLAT_PREFIXES = new Set(["flat", "apartment", "apt", "unit", "room"]);

function buildAddressHint(inputAddress: string, postcode: string | null): string {
  const stripped = postcode ? stripPostcode(inputAddress, postcode) : inputAddress;
  const expanded = expandAbbreviations(stripped);
  const tokens = expanded.split(/\s+/).filter(Boolean);

  // Skip past a flat/apartment prefix ("flat 6", "unit 2") to reach the house number
  let start = 0;
  if (tokens[0] && FLAT_PREFIXES.has(tokens[0])) {
    start = 2;
  }

  // Find the first house number (digits, optionally followed by one letter: 12, 12A)
  let houseIdx = -1;
  for (let i = start; i < tokens.length; i++) {
    if (/^\d+[-]?\d*[a-z]?$/.test(tokens[i])) {
      houseIdx = i;
      break;
    }
  }

  // Return house number + next 2 tokens (street name) — city/county are intentionally excluded
  // as the EPC API returns empty when town names are included
  if (houseIdx !== -1) {
    return tokens.slice(houseIdx, houseIdx + 3).join(" ");
  }
  return tokens.slice(0, 3).join(" ");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function classify(score: number): "matched" | "low_confidence" | "not_found" {
  if (score >= 0.5) return "matched";
  if (score >= 0.3) return "low_confidence";
  return "not_found";
}

function selectBest(
  rows: EpcRow[],
  inputAddress: string
): { row: EpcRow; score: number } | null {
  if (rows.length === 0) return null;
  const inputTokens = normalise(inputAddress);
  let best: { row: EpcRow; score: number } | null = null;
  for (const row of rows) {
    const score = jaccard(inputTokens, normalise(row.address));
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        row["inspection-date"] > best.row["inspection-date"])
    ) {
      best = { row, score };
    }
  }
  return best;
}

function deduplicateByLatestInspectionDate(rows: EpcRow[]): EpcRow[] {
  const map = new Map<string, EpcRow>();
  for (const row of rows) {
    const key = normalise(row.address).size > 0
      ? [...normalise(row.address)].sort().join(" ")
      : row.address.toLowerCase();
    const existing = map.get(key);
    if (!existing || row["inspection-date"] > existing["inspection-date"]) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  );
  return results;
}

function inferPostcodeFromSiblings(inputAddress: string, allRows: string[]): string | null {
  const inputHint = buildAddressHint(inputAddress, null);
  for (const row of allRows) {
    if (row === inputAddress) continue;
    const pc = extractPostcode(row);
    if (!pc) continue;
    if (buildAddressHint(row, pc) === inputHint) return pc;
  }
  return null;
}

async function lookupPostcodeFromNominatim(address: string): Promise<string | null> {
  const q = encodeURIComponent(address + " UK");
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&addressdetails=1&countrycodes=gb&limit=3`;
  const res = await fetch(url, {
    headers: { "User-Agent": "thermova-epc-enrichment/1.0 (deangriff19@gmail.com)" },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const items = await res.json().catch(() => []);
  for (const item of items) {
    const pc = (item as Record<string, Record<string, string>>).address?.postcode;
    if (pc) return pc.replace(/\s+/, " ").toUpperCase();
  }
  return null;
}

async function callEpcApi(
  postcode: string | null,
  addressHint: string,
  epcApiKey: string
): Promise<EpcRow[]> {
  // Use size=100 for address-only searches (no postcode) — results span the whole country
  const params: Record<string, string> = { address: addressHint, size: postcode ? "25" : "100" };
  if (postcode) params.postcode = postcode;
  const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${epcApiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`EPC API returned ${res.status}`);
  }
  // API returns empty body (content-length: 0) when no results found
  const text = await res.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text);
  return (data.rows ?? []) as EpcRow[];
}

async function enrichRow(
  supabase: SupabaseClient,
  uploadId: string,
  rowIndex: number,
  inputAddress: string,
  allRows: string[],
  epcApiKey: string
): Promise<void> {
  try {
    let postcode: string | null = extractPostcode(inputAddress);

    if (!postcode) {
      postcode = inferPostcodeFromSiblings(inputAddress, allRows);
    }

    // postcode may still be null — callEpcApi handles address-only search
    {
      const addressHint = buildAddressHint(inputAddress, postcode);
      let rawRows = await callEpcApi(postcode, addressHint, epcApiKey);

      // Last resort: if no results and no postcode, try Nominatim geocoding then retry EPC
      if (rawRows.length === 0 && !postcode) {
        const nominatimPostcode = await lookupPostcodeFromNominatim(inputAddress);
        if (nominatimPostcode) {
          rawRows = await callEpcApi(nominatimPostcode, addressHint, epcApiKey);
        }
      }
      const deduplicated = deduplicateByLatestInspectionDate(rawRows);
      const best = selectBest(deduplicated, inputAddress);

      if (!best || best.score === 0) {
        await supabase
          .from("epc_results")
          .update({ status: "complete", match_confidence: "not_found" })
          .eq("upload_id", uploadId)
          .eq("row_index", rowIndex);
      } else {
        const confidence = classify(best.score);
        const sapRaw = best.row["current-energy-efficiency"];
        const sapScore = sapRaw ? parseInt(sapRaw) || null : null;
        const inspDateRaw = best.row["inspection-date"];
        const inspDate = inspDateRaw && inspDateRaw.length === 10
          ? inspDateRaw
          : null;

        await supabase
          .from("epc_results")
          .update({
            status: "complete",
            matched_address: best.row["address"] ?? null,
            epc_rating: best.row["current-energy-rating"] ?? null,
            sap_score: sapScore,
            heating_source: best.row["mainheat-description"] ?? null,
            inspection_date: inspDate,
            match_confidence: confidence,
            jaccard_score: Math.round(best.score * 1000) / 1000,
          })
          .eq("upload_id", uploadId)
          .eq("row_index", rowIndex);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("epc_results")
      .update({ status: "error", error_message: msg })
      .eq("upload_id", uploadId)
      .eq("row_index", rowIndex);
  }

  // Always increment — even on error — so progress bar advances
  await supabase.rpc("increment_processed_rows", { p_upload_id: uploadId });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("THERMOVA_SERVICE_ROLE_KEY");
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY");
  const epcApiKey   = Deno.env.get("EPC_API_KEY");

  if (!supabaseUrl || !serviceKey || !anonKey || !epcApiKey) {
    return json({ ok: false, error: "Function secrets are not configured" }, 500);
  }

  // Authenticate the requesting user — call Auth REST API directly to avoid
  // local JWT decode issues with ES256-signed tokens
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "Missing authorization token" }, 401);

  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": anonKey,
    },
  }).catch(() => null);

  if (!authRes || !authRes.ok) {
    return json({ ok: false, error: "Invalid or expired token" }, 401);
  }
  const authUser = await authRes.json().catch(() => null);
  if (!authUser?.id) {
    return json({ ok: false, error: "Invalid or expired token" }, 401);
  }
  const userId: string = authUser.id;

  // Parse body
  const body = await request.json().catch(() => null) as {
    filename?: string;
    rows?: string[];
  } | null;

  if (!body?.rows?.length || !body?.filename) {
    return json({ ok: false, error: "Invalid payload: filename and rows required" }, 400);
  }
  if (body.rows.length > 2000) {
    return json({ ok: false, error: "Maximum 2000 rows per upload" }, 400);
  }

  const rows: string[] = body.rows;
  const filename: string = body.filename;

  // Service-role client for all DB writes
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Create upload record
  const { data: upload, error: uploadErr } = await supabase
    .from("epc_uploads")
    .insert({ user_id: userId, filename, total_rows: rows.length, status: "processing" })
    .select("id")
    .single();

  if (uploadErr || !upload) {
    return json({ ok: false, error: "Failed to create upload record" }, 500);
  }

  const uploadId: string = upload.id;

  // Insert placeholder result rows upfront so client can poll progress
  const placeholders = rows.map((addr, i) => ({
    upload_id: uploadId,
    row_index: i,
    input_address: addr,
    status: "pending",
  }));

  const { error: placeholderErr } = await supabase
    .from("epc_results")
    .insert(placeholders);

  if (placeholderErr) {
    await supabase
      .from("epc_uploads")
      .update({ status: "error", error_message: "Failed to insert placeholder rows" })
      .eq("id", uploadId);
    return json({ ok: false, error: "Failed to initialise result rows" }, 500);
  }

  // Background processing
  const processingPromise = (async () => {
    const tasks = rows.map((addr, i) => () =>
      enrichRow(supabase, uploadId, i, addr, rows, epcApiKey)
    );
    await promisePool(tasks, 5);
    await supabase
      .from("epc_uploads")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", uploadId);
  })();

  // Keep Deno isolate alive while background processing runs
  // @ts-ignore: EdgeRuntime available in Supabase Deno runtime
  if (typeof EdgeRuntime !== "undefined") {
    // deno-lint-ignore no-explicit-any
    (EdgeRuntime as any).waitUntil(processingPromise);
  }

  return new Response(
    JSON.stringify({ ok: true, upload_id: uploadId }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
