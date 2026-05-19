// publish-case-study — orchestrates publishing/unpublishing/deletion of a
// case study row. Renders HTML, regenerates the blog index card list, and
// commits both files to GitHub atomically via the Git Data API. Netlify
// auto-deploys on push.
//
// Request: POST { case_study_id: uuid, action: "publish" | "unpublish" | "delete" }
// Auth:    Caller's JWT in the Authorization header is required.
//
// Secrets (via `supabase secrets set …`):
//   GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO, GITHUB_DEFAULT_BRANCH,
//   COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CaseStudyRow, renderCaseStudyHtml } from "./template.ts";
import { regenerateBlogIndex } from "./regenerate-index.ts";
import { regenerateSitemap } from "./regenerate-sitemap.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;
const GITHUB_OWNER = Deno.env.get("GITHUB_OWNER") ?? "RenewEnergies25";
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "thermova-website";
const GITHUB_BRANCH = Deno.env.get("GITHUB_DEFAULT_BRANCH") ?? "main";
const COMMIT_AUTHOR_NAME = Deno.env.get("COMMIT_AUTHOR_NAME") ?? "Thermova Publisher";
const COMMIT_AUTHOR_EMAIL = Deno.env.get("COMMIT_AUTHOR_EMAIL") ?? "noreply@thermova.uk";

const GH_API = "https://api.github.com";
const GH_HEADERS = {
  "Authorization": `Bearer ${GITHUB_PAT}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "thermova-publisher",
  "Content-Type": "application/json",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestPayload {
  case_study_id: string;
  action: "publish" | "unpublish" | "delete";
}

interface FileChange {
  path: string;
  content: string | null; // null = delete
}

// ─────────────────────────── GitHub Git Data API ───────────────────────────

interface BlobInfo { path: string; sha: string; mode: "100644"; type: "blob" }

async function commitFiles(changes: FileChange[], commitMessage: string): Promise<string> {
  // 1. Get current HEAD commit + tree
  const refRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`, {
    headers: GH_HEADERS,
  });
  if (!refRes.ok) throw new Error(`GET ref failed: ${refRes.status} ${await refRes.text()}`);
  const ref = await refRes.json();
  const baseCommitSha = ref.object.sha;

  const baseCommitRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${baseCommitSha}`, {
    headers: GH_HEADERS,
  });
  if (!baseCommitRes.ok) throw new Error(`GET commit failed: ${baseCommitRes.status}`);
  const baseCommit = await baseCommitRes.json();
  const baseTreeSha = baseCommit.tree.sha;

  // 2. Create blob for each non-deleted change (need SHAs to build tree)
  const treeEntries: any[] = [];
  for (const c of changes) {
    if (c.content === null) {
      // Mark as deleted in the tree
      treeEntries.push({ path: c.path, mode: "100644", type: "blob", sha: null });
    } else {
      const blobRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
        method: "POST",
        headers: GH_HEADERS,
        body: JSON.stringify({ content: c.content, encoding: "utf-8" }),
      });
      if (!blobRes.ok) throw new Error(`POST blob (${c.path}) failed: ${blobRes.status} ${await blobRes.text()}`);
      const blob = await blobRes.json();
      treeEntries.push({ path: c.path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }

  // 3. Create new tree
  const treeRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`, {
    method: "POST",
    headers: GH_HEADERS,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`POST tree failed: ${treeRes.status} ${await treeRes.text()}`);
  const tree = await treeRes.json();

  // 4. Create new commit
  const commitRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`, {
    method: "POST",
    headers: GH_HEADERS,
    body: JSON.stringify({
      message: commitMessage,
      tree: tree.sha,
      parents: [baseCommitSha],
      author: { name: COMMIT_AUTHOR_NAME, email: COMMIT_AUTHOR_EMAIL },
      committer: { name: COMMIT_AUTHOR_NAME, email: COMMIT_AUTHOR_EMAIL },
    }),
  });
  if (!commitRes.ok) throw new Error(`POST commit failed: ${commitRes.status} ${await commitRes.text()}`);
  const commit = await commitRes.json();

  // 5. Update ref
  const updateRefRes = await fetch(`${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`, {
    method: "PATCH",
    headers: GH_HEADERS,
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (!updateRefRes.ok) throw new Error(`PATCH ref failed: ${updateRefRes.status} ${await updateRefRes.text()}`);

  return commit.sha;
}

async function fetchCurrentFile(path: string): Promise<string> {
  // Fetch the raw file at the current HEAD via the contents API.
  const res = await fetch(
    `${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH}`,
    { headers: { ...GH_HEADERS, "Accept": "application/vnd.github.raw" } },
  );
  if (!res.ok) throw new Error(`GET contents (${path}) failed: ${res.status} ${await res.text()}`);
  return await res.text();
}

// ─────────────────────────── main handler ───────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Caller JWT — used to authenticate them against Supabase
  const authHeader = req.headers.get("Authorization") ?? "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!userJwt) return json({ ok: false, error: "Missing Authorization Bearer token" }, 401);

  // Auth client (caller's JWT) — used to verify the user
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, error: `Auth failed: ${userErr?.message ?? "no user"}` }, 401);
  }
  const userId = userData.user.id;

  // Service-role client — used to read/update case_studies regardless of RLS
  // (the RLS policy already allows authenticated users; service role just lets
  //  us bypass JWT-passing complexity and write the audit columns reliably)
  const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let body: RequestPayload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.case_study_id || !["publish", "unpublish", "delete"].includes(body.action)) {
    return json({ ok: false, error: "Missing case_study_id or invalid action" }, 400);
  }

  // Load the row
  const { data: row, error: loadErr } = await sb
    .from("case_studies")
    .select("*")
    .eq("id", body.case_study_id)
    .single();
  if (loadErr || !row) {
    return json({ ok: false, error: `Case study not found: ${loadErr?.message ?? body.case_study_id}` }, 404);
  }

  try {
    let commitSha = "";

    if (body.action === "publish") {
      // Render HTML
      const pagePath = `blog/${row.slug}.html`;
      const pageHtml = renderCaseStudyHtml(row as CaseStudyRow);

      // Read current blog/index.html and load all published rows (after this one)
      const currentIndex = await fetchCurrentFile("blog/index.html");

      // For the index, fetch all *currently or about-to-be* published rows.
      // We'll union the current row (as published) with all other published rows.
      const { data: others } = await sb
        .from("case_studies")
        .select("*")
        .eq("status", "published")
        .neq("id", row.id);
      const publishedRows = [...(others ?? []), { ...row, status: "published", last_published_at: new Date().toISOString() }] as CaseStudyRow[];
      const newIndex = regenerateBlogIndex(currentIndex, publishedRows);
      const newSitemap = regenerateSitemap(publishedRows);

      const changes: FileChange[] = [
        { path: pagePath, content: pageHtml },
        { path: "blog/index.html", content: newIndex },
        { path: "sitemap.xml", content: newSitemap },
      ];
      commitSha = await commitFiles(
        changes,
        `Case study: publish "${row.title}" (${row.slug})`,
      );

      // Update row
      await sb.from("case_studies").update({
        status: "published",
        last_published_at: new Date().toISOString(),
        last_published_commit_sha: commitSha,
        published_by_user_id: userId,
      }).eq("id", row.id);

      return json({ ok: true, action: "publish", commit_sha: commitSha, blog_url: `https://thermova.uk/blog/${row.slug}` });
    }

    if (body.action === "unpublish" || body.action === "delete") {
      // Remove the HTML file and regenerate index without this row
      const currentIndex = await fetchCurrentFile("blog/index.html");
      const { data: others } = await sb
        .from("case_studies")
        .select("*")
        .eq("status", "published")
        .neq("id", row.id);
      const remainingRows = (others ?? []) as CaseStudyRow[];
      const newIndex = regenerateBlogIndex(currentIndex, remainingRows);
      const newSitemap = regenerateSitemap(remainingRows);

      const changes: FileChange[] = [
        { path: `blog/${row.slug}.html`, content: null }, // delete
        { path: "blog/index.html", content: newIndex },
        { path: "sitemap.xml", content: newSitemap },
      ];
      commitSha = await commitFiles(
        changes,
        `Case study: ${body.action} "${row.title}" (${row.slug})`,
      );

      if (body.action === "unpublish") {
        await sb.from("case_studies").update({
          status: "archived",
          last_published_commit_sha: commitSha,
        }).eq("id", row.id);
      } else {
        await sb.from("case_studies").delete().eq("id", row.id);
      }

      return json({ ok: true, action: body.action, commit_sha: commitSha });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: `${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(handleRequest);
