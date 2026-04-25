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
  n: "north", s: "south", e: "east", w: "west",
  gt: "great", lt: "little", mt: "mount", hts: "heights",
  redbank: "red bank", snowhill: "snow hill",
};

function expandAbbreviations(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, "")
    .split(/\s+/)
    .map((t) => UK_ABBREVS[t] ?? t)
    .join(" ");
}

function normalise(s: string): Set<string> {
  const tokens = expandAbbreviations(s).split(/\s+/).filter(Boolean);
  const result: string[] = [];
  for (const t of tokens) {
    result.push(t);
    // Expand number ranges: "43-47" → also add "43" and "47"
    const m = t.match(/^(\d+)-(\d+)$/);
    if (m) { result.push(m[1], m[2]); }
  }
  return new Set(result);
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
    // For range numbers like "2-7", use only the first number as the API hint
    const houseToken = tokens[houseIdx].replace(/^(\d+)-\d+$/, "$1");
    return [houseToken, ...tokens.slice(houseIdx + 1, houseIdx + 3)].join(" ");
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

// Words that look like a flat label after "flat" but actually describe a vertical position
// (e.g. "flat top", "flat GF", "flat ground"). These are handled by extractFloorQualifier
// so we filter them out here to keep the two extractors mutually exclusive.
const FLOOR_WORDS = new Set([
  "top", "ground", "basement", "first", "second", "third", "fourth", "fifth",
  "upper", "lower", "mid", "middle", "mezzanine", "rear", "front",
  "gf", "tf", "lg",
]);

function extractFlatNumber(address: string): string | null {
  // Returns the flat identifier ("2", "2a", "c") or null for non-numeric flat labels
  const m = address.match(/\bflat\s+([a-z\d]+)/i);
  if (!m) return null;
  const val = m[1].toLowerCase();
  return FLOOR_WORDS.has(val) ? null : val;
}

// Returns a normalised floor-position token (ground / first / second / third / fourth /
// middle / mezzanine / top / basement / lower_ground) or null. Distinct from extractFlatNumber:
// "Top Floor Flat" and "Ground Floor Flat" describe vertical position, not unit identity.
function extractFloorQualifier(address: string): string | null {
  const norm = " " + address.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  // Order: specific ordinals first so "second floor" doesn't get caught by a looser "top floor" match.
  if (/\bbasement\s+(?:floor\s+)?(?:flat|apartment|apt|unit)\b/.test(norm)) return "basement";
  if (/\b(?:flat|apartment|apt|unit)\s+basement\b/.test(norm)) return "basement";
  if (/\blower\s+ground\b/.test(norm)) return "lower_ground";
  if (/\b(?:flat|apartment|apt|unit)\s+lg\b/.test(norm)) return "lower_ground";
  if (/\bground\s+(?:floor\s+)?(?:flat|apartment|apt|unit)\b/.test(norm)) return "ground";
  if (/\b(?:flat|apartment|apt|unit)\s+ground(?:\s+floor)?\b/.test(norm)) return "ground";
  // "GF" / "G/F" abbreviations — common in user-supplied data ("flat GF", "GF flat")
  if (/\b(?:flat|apartment|apt|unit)\s+gf\b/.test(norm)) return "ground";
  if (/\bgf\s+(?:flat|apartment|apt|unit)\b/.test(norm)) return "ground";
  if (/\bground\s+floor\b/.test(norm)) return "ground";
  if (/\b(?:first|1st)\s+floor\b/.test(norm) || /\b(?:flat|apartment|apt|unit)\s+(?:first|1st)(?:\s+floor)?\b/.test(norm)) return "first";
  if (/\b(?:second|2nd)\s+floor\b/.test(norm) || /\b(?:flat|apartment|apt|unit)\s+(?:second|2nd)(?:\s+floor)?\b/.test(norm)) return "second";
  if (/\b(?:third|3rd)\s+floor\b/.test(norm) || /\b(?:flat|apartment|apt|unit)\s+(?:third|3rd)(?:\s+floor)?\b/.test(norm)) return "third";
  if (/\b(?:fourth|4th)\s+floor\b/.test(norm) || /\b(?:flat|apartment|apt|unit)\s+(?:fourth|4th)(?:\s+floor)?\b/.test(norm)) return "fourth";
  if (/\bmiddle\s+floor\b/.test(norm) || /\b(?:flat|apartment|apt|unit)\s+middle(?:\s+floor)?\b/.test(norm)) return "middle";
  if (/\bmezzanine\b/.test(norm)) return "mezzanine";
  if (/\b(?:top|upper)\s+(?:floor\s+)?(?:flat|apartment|apt|unit)\b/.test(norm)) return "top";
  if (/\b(?:flat|apartment|apt|unit)\s+(?:top|upper)(?:\s+floor)?\b/.test(norm)) return "top";
  // "TF" abbreviation for top-floor flat
  if (/\b(?:flat|apartment|apt|unit)\s+tf\b/.test(norm)) return "top";
  if (/\btf\s+(?:flat|apartment|apt|unit)\b/.test(norm)) return "top";
  if (/\b(?:top|upper)\s+floor\b/.test(norm)) return "top";
  return null;
}

// Two floor qualifiers conflict if they reference different vertical positions.
// "top" pairs harmlessly with any specific upper floor (first/second/etc.) — the user may not
// know the exact storey — but it does conflict with ground-level qualifiers (ground/basement).
function floorQualifiersConflict(a: string, b: string): boolean {
  if (a === b) return false;
  const groundLevel = new Set(["basement", "lower_ground", "ground"]);
  if (a === "top" || b === "top") {
    const other = a === "top" ? b : a;
    return groundLevel.has(other);
  }
  return true;
}

function selectBest(
  rows: EpcRow[],
  inputAddress: string,
  inputHouseToken: string | null,
  effectivePostcode: string | null
): { row: EpcRow; score: number } | null {
  if (rows.length === 0) return null;
  const inputTokens = normalise(inputAddress);
  const inputFlat   = extractFlatNumber(inputAddress);
  const inputFloor  = extractFloorQualifier(inputAddress);
  const inputHasUnit = inputFlat !== null || inputFloor !== null;
  let best: { row: EpcRow; score: number } | null = null;
  for (const row of rows) {
    let score = jaccard(inputTokens, normalise(row.address));
    const rowHouse = extractHouseToken(row.address);
    const rowFlat  = extractFlatNumber(row.address);
    const rowFloor = extractFloorQualifier(row.address);
    const rowHasUnit = rowFlat !== null || rowFloor !== null;
    // Exact-anchor short-circuit: rows came from a postcode-restricted query, so a matching house
    // token plus that effective postcode is enough to promote the score above the matched
    // threshold. Don't inspect the row's address for a postcode — EPC rows rarely include one.
    if (effectivePostcode && inputHouseToken && rowHouse && rowHouse === inputHouseToken) {
      score = Math.max(score, 0.55);
    }
    // Same-type unit mismatch: both have flat numbers and they disagree. Flat 1 vs Flat 2 are
    // different properties at the same address.
    if (inputFlat !== null && rowFlat !== null && rowFlat !== inputFlat) {
      const inputIsNum = /^\d/.test(inputFlat);
      const rowIsNum   = /^\d/.test(rowFlat);
      if (inputIsNum === rowIsNum) score *= 0.5;
    }
    // Same-type floor mismatch: "Top Floor Flat" vs "Ground Floor Flat" — different units.
    if (inputFloor !== null && rowFloor !== null && floorQualifiersConflict(inputFloor, rowFloor)) {
      score *= 0.3;
    }
    // Cross-type unit mismatch: input names a flat number ("flat 6") but the row uses a floor
    // position ("Basement Flat"), or vice versa. They describe different units at the same
    // address. 0.3× pushes the score under the not_found threshold (post short-circuit) so we
    // don't return the wrong sibling unit just because nothing better was found.
    if (inputFlat !== null && rowFlat === null && rowFloor !== null) score *= 0.3;
    if (inputFloor !== null && rowFloor === null && rowFlat !== null) score *= 0.3;
    // Whole-house EPC vs flat input: user asked for a specific unit, EPC is for the building
    // before/instead of being split into flats. Treat as different property.
    if (inputHasUnit && !rowHasUnit) score *= 0.3;
    // Inverse: input has no unit qualifier but row is flat-specific. Could be the user just
    // didn't specify, or the building has only flat-level EPCs. Mild penalty so an exact whole-
    // house match elsewhere still wins, but a flat-only result still surfaces as low_confidence.
    if (!inputHasUnit && rowHasUnit) score *= 0.6;
    // House-number mismatch within the same postcode (e.g., "Flat 2 at #4" vs row "Flat 2 at #18"
    // sharing postcode FY1 6EF). 0.5× pushes a same-flat-number false-positive below 0.3 even when
    // jaccard alone is high due to shared "flat 2" + "blackpool" tokens.
    if (inputHouseToken && rowHouse && rowHouse !== inputHouseToken) score *= 0.5;
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
    // Order-preserving key: lowercased + abbreviation-expanded + punctuation-stripped tokens.
    // Set-based keys collide: "Flat 6, 2 Lonsdale Road" and "Flat 2, 6 Lonsdale Road" share
    // the same token set but are different properties.
    const key = expandAbbreviations(row.address).split(/\s+/).filter(Boolean).join(" ")
                || row.address.toLowerCase();
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

function extractHouseToken(address: string): string | null {
  const expanded = expandAbbreviations(address);
  const tokens = expanded.split(/\s+/).filter(Boolean);
  let start = 0;
  if (tokens[0] && FLAT_PREFIXES.has(tokens[0])) start = 2;
  for (let i = start; i < tokens.length; i++) {
    if (/^\d+[-]?\d*[a-z]?$/.test(tokens[i])) {
      // For ranges, return first number only
      return tokens[i].replace(/^(\d+)-\d+$/, "$1");
    }
  }
  return null;
}

// Build a Nominatim-friendly query: drop the (possibly-wrong) postcode, remove
// "United Kingdom" trailers, and dedup repeated comma-separated parts. Inputs like
// "13 Threlfall Road, 13 Threlfall Road FY1 6DF Blackpool United Kingdom" otherwise
// confuse the geocoder and return zero results.
function buildNominatimQuery(address: string): string {
  let s = address;
  const pc = extractPostcode(s);
  if (pc) s = s.replace(new RegExp(pc.replace(/\s+/g, "\\s*"), "i"), " ");
  s = s.replace(/\b(?:united\s+kingdom|uk|england|scotland|wales)\b/gi, " ");
  // Dedup comma-separated parts: drop any part that is a prefix of another part.
  // Inputs like "13 Threlfall Road, 13 Threlfall Road Blackpool" otherwise keep both
  // (the first is a prefix of the second) and Nominatim returns no results.
  const parts = s.split(",").map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    const subsumed = parts.some((other) => other !== p &&
      other.toLowerCase().startsWith(lower) && other.length > p.length);
    if (subsumed) continue;
    if (!kept.some((k) => k.toLowerCase() === lower)) kept.push(p);
  }
  return kept.join(", ").trim();
}

async function lookupPostcodeFromNominatim(address: string): Promise<string | null> {
  const cleaned = buildNominatimQuery(address);
  if (!cleaned) return null;
  const q = encodeURIComponent(cleaned);
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
  addressHint: string | null,
  epcApiKey: string
): Promise<EpcRow[]> {
  // Postcode-restricted: fetch all properties at the postcode (size=100) without an address
  // filter, so misspelled street names ("Hemmingway" vs "Hemingway", "Snowhill" vs "Snow Hill")
  // don't make us miss the right row. The matcher selects the best candidate.
  // Address-only fallback (no postcode): need an address hint and a wider net.
  const params: Record<string, string> = { size: "100" };
  if (postcode) params.postcode = postcode;
  else if (addressHint) params.address = addressHint;
  else return [];
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
      const inputHouseToken = extractHouseToken(
        postcode ? stripPostcode(inputAddress, postcode) : inputAddress
      );

      // Primary fetch: postcode-restricted (size=100), no address filter. Catches
      // street-name typos and compound-word mismatches in one shot.
      let rawRows = await callEpcApi(postcode, addressHint, epcApiKey);
      let effectivePostcode = postcode;

      // Nominatim fallback: trigger when the supplied postcode either returned no rows or
      // returned rows that don't include our house number. The latter catches wrong-postcode
      // cases like "13 Threlfall Road FY1 6DF" where FY1 6DF returns Threlfall Mews entries
      // but the actual #13 lives in FY1 6NW.
      const houseFoundInRows = inputHouseToken !== null &&
        rawRows.some((r) => extractHouseToken(r.address) === inputHouseToken);
      if (!houseFoundInRows) {
        const nominatimPostcode = await lookupPostcodeFromNominatim(inputAddress);
        if (nominatimPostcode && nominatimPostcode !== postcode) {
          const altRows = await callEpcApi(nominatimPostcode, addressHint, epcApiKey);
          // Only swap in if the alt postcode contains our house number (so we don't replace
          // a useful nearby-postcode row set with an unrelated one)
          const altHasHouse = inputHouseToken !== null &&
            altRows.some((r) => extractHouseToken(r.address) === inputHouseToken);
          if (altHasHouse || (rawRows.length === 0 && altRows.length > 0)) {
            rawRows = altRows;
            effectivePostcode = nominatimPostcode;
          }
        }
      }

      // Last-resort: address-only search if we still have nothing
      if (rawRows.length === 0 && !postcode && addressHint) {
        rawRows = await callEpcApi(null, addressHint, epcApiKey);
      }

      const deduplicated = deduplicateByLatestInspectionDate(rawRows);
      const best = selectBest(deduplicated, inputAddress, inputHouseToken, effectivePostcode);

      const confidence = (!best || best.score === 0) ? "not_found" : classify(best.score);

      if (confidence === "not_found") {
        await supabase
          .from("epc_results")
          .update({ status: "complete", match_confidence: "not_found" })
          .eq("upload_id", uploadId)
          .eq("row_index", rowIndex);
      } else {
        const sapRaw = best!.row["current-energy-efficiency"];
        const sapScore = sapRaw ? parseInt(sapRaw) || null : null;
        const inspDateRaw = best!.row["inspection-date"];
        const inspDate = inspDateRaw && inspDateRaw.length === 10 ? inspDateRaw : null;

        await supabase
          .from("epc_results")
          .update({
            status: "complete",
            matched_address: best!.row["address"] ?? null,
            epc_rating: best!.row["current-energy-rating"] ?? null,
            sap_score: sapScore,
            heating_source: best!.row["mainheat-description"] ?? null,
            inspection_date: inspDate,
            match_confidence: confidence,
            jaccard_score: Math.round(best!.score * 1000) / 1000,
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
