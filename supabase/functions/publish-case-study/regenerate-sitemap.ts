// Builds the full sitemap.xml string. Static URLs come from
// sitemap-static-pages.json; dynamic case-study URLs come from the
// `publishedRows` argument (caller passes the post-mutation list).
//
// The format mirrors sitemaps.org/schemas/sitemap/0.9 and is what Google
// Search Console reads. Keep `<lastmod>` as ISO 8601 with timezone.

import { CaseStudyRow } from "./template.ts";
import staticPages from "./sitemap-static-pages.json" with { type: "json" };

interface StaticPage {
  url: string;
  file: string;
  priority: number;
  lastmod: string;
}

interface SitemapConfig {
  base_url: string;
  case_study_priority: number;
  pages: StaticPage[];
}

const cfg = staticPages as SitemapConfig;

function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function priorityStr(p: number): string {
  return p.toFixed(1);
}

function urlBlock(loc: string, lastmod: string, priority: number): string {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${xmlEscape(lastmod)}</lastmod>
    <priority>${priorityStr(priority)}</priority>
  </url>`;
}

export function regenerateSitemap(publishedRows: CaseStudyRow[]): string {
  const staticEntries = cfg.pages.map((p) =>
    urlBlock(`${cfg.base_url}${p.url}`, p.lastmod, p.priority)
  );

  // Dynamic case studies: sort newest first to match blog/index.html
  const caseRows = [...publishedRows].sort((a, b) => {
    const da = a.last_published_at ?? a.published_date ?? "";
    const db = b.last_published_at ?? b.published_date ?? "";
    return da < db ? 1 : da > db ? -1 : 0;
  });

  const caseEntries = caseRows.map((r) => {
    const loc = `${cfg.base_url}/blog/${r.slug}`;
    const lastmod = r.last_published_at ?? `${r.published_date}T00:00:00+00:00`;
    return urlBlock(loc, lastmod, cfg.case_study_priority);
  });

  const body = [...staticEntries, ...caseEntries].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated. Static URLs: supabase/functions/publish-case-study/sitemap-static-pages.json. Case studies: case_studies table where status='published'. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}
