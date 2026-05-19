#!/usr/bin/env node
//
// generate-sitemap.mjs — regenerates sitemap.xml + refreshes per-page lastmod
// in supabase/functions/publish-case-study/sitemap-static-pages.json.
//
// Run this when you've added or significantly changed a static page (service
// page, town page, legal page, blog index). Case-study publishes regenerate
// sitemap.xml automatically via the publish-case-study Edge Function — you
// don't need to run this script for those.
//
// Usage:
//   cd thermova-website
//   node scripts/generate-sitemap.mjs
//   git add sitemap.xml supabase/functions/publish-case-study/sitemap-static-pages.json
//   git commit -m "chore(sitemap): refresh static-page lastmod"
//
// Optional env:
//   SUPABASE_URL           - default https://cyjbzemzjmfjsloogixw.supabase.co
//   SUPABASE_ANON_KEY      - skip dynamic case-study URLs if missing (warns)
//
// Implementation notes:
// - lastmod for static pages = `git log -1 --format=%cI -- <file>` per page.
// - lastmod for case studies = case_studies.last_published_at (or
//   published_date midnight UTC fallback).
// - Static-page list + priorities live in the JSON file (source of truth
//   shared with the Edge Function).

import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const jsonPath = resolve(repoRoot, "supabase/functions/publish-case-study/sitemap-static-pages.json");
const sitemapPath = resolve(repoRoot, "sitemap.xml");

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://cyjbzemzjmfjsloogixw.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

function xmlEscape(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function gitLastmod(file) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${file}"`, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function fetchPublishedCaseStudies() {
  if (!SUPABASE_ANON_KEY) {
    console.warn("⚠  SUPABASE_ANON_KEY not set — skipping dynamic case-study URLs. Sitemap will be static-only.");
    return [];
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/case_studies?select=slug,published_date,last_published_at&status=eq.published`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

function urlBlock(loc, lastmod, priority) {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${xmlEscape(lastmod)}</lastmod>
    <priority>${priority.toFixed(1)}</priority>
  </url>`;
}

async function main() {
  const cfg = JSON.parse(await readFile(jsonPath, "utf-8"));

  // Refresh lastmod for each static page from git.
  let refreshed = 0;
  for (const p of cfg.pages) {
    const fresh = gitLastmod(p.file);
    if (fresh && fresh !== p.lastmod) {
      p.lastmod = fresh;
      refreshed += 1;
    }
  }
  if (refreshed > 0) {
    await writeFile(jsonPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
    console.log(`✓ refreshed lastmod for ${refreshed} static page(s) in sitemap-static-pages.json`);
  } else {
    console.log("· no static-page lastmod changes detected");
  }

  // Static URL blocks.
  const staticEntries = cfg.pages.map((p) =>
    urlBlock(`${cfg.base_url}${p.url}`, p.lastmod, p.priority),
  );

  // Dynamic case-study URL blocks.
  const caseRows = await fetchPublishedCaseStudies();
  caseRows.sort((a, b) => {
    const da = a.last_published_at ?? a.published_date ?? "";
    const db = b.last_published_at ?? b.published_date ?? "";
    return da < db ? 1 : da > db ? -1 : 0;
  });
  const caseEntries = caseRows.map((r) => {
    const loc = `${cfg.base_url}/blog/${r.slug}`;
    const lastmod = r.last_published_at ?? `${r.published_date}T00:00:00+00:00`;
    return urlBlock(loc, lastmod, cfg.case_study_priority);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated. Static URLs: supabase/functions/publish-case-study/sitemap-static-pages.json. Case studies: case_studies table where status='published'. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...caseEntries].join("\n")}
</urlset>
`;
  await writeFile(sitemapPath, xml, "utf-8");
  console.log(`✓ wrote ${sitemapPath} (${cfg.pages.length} static + ${caseRows.length} case study URL(s))`);
}

main().catch((e) => {
  console.error("✗ generate-sitemap failed:", e.message);
  process.exit(1);
});
