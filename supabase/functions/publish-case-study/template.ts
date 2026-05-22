// Renders a case_studies row into the full static HTML file that gets
// committed to /blog/<slug>.html. Output mirrors the existing Lytham case
// study HTML structure verbatim so the round-trip (DB → template → live)
// is byte-equivalent for the seeded Lytham row (modulo whitespace).
//
// Public exports:
//   renderCaseStudyHtml(row) — full HTML page
//   renderBlogIndexCard(row) — one <li class="post-card"> for /blog/ index
//   CaseStudyRow                — TypeScript shape mirroring the table row

export interface FaqItem { q: string; a: string }
export interface GalleryImage { url: string; alt: string; caption?: string; storage_path?: string; width?: number; height?: number }

export interface CaseStudyRow {
  slug: string;
  status: "draft" | "published" | "archived";
  title: string;
  meta_description: string;
  keywords: string[];
  about_topics: string[];
  hero_image_url: string | null;
  hero_image_alt: string | null;
  hero_image_caption: string | null;
  gallery_images: GalleryImage[];
  breadcrumb_label: string;
  author_name: string;
  published_date: string; // ISO yyyy-mm-dd
  read_time_minutes: number;
  location: string;
  opening_paragraph_1: string | null;
  opening_paragraph_2: string | null;
  why_matters_heading: string | null;
  why_matters_prose: string | null;          // HTML
  body_html: string | null;                  // When set, replaces structured prose
  equipment_list_html: string | null;        // HTML
  installation_days: number | null;
  installation_timeline_prose: string | null;
  methodology_prose: string | null;          // HTML
  co2_equivalence_prose: string | null;      // HTML
  cost_narrative_prose: string | null;       // HTML
  winter_performance_html: string | null;    // HTML
  methodology_footnote: string | null;
  property_spec: Record<string, string>;
  performance_data: Record<string, string>;
  cost_data: Record<string, string>;
  faq_items: FaqItem[];
  cta_heading: string;
  cta_body: string | null;
  last_published_at?: string | null;
}

// ─────────────────────────── helpers ───────────────────────────
const SITE = "https://thermova.uk";
const SUPABASE_PUBLIC = "https://cyjbzemzjmfjsloogixw.supabase.co";

function escAttr(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rawHtml(s: string | null | undefined): string {
  // Prose fields allow authored HTML (img embeds, links, lists) — pass through
  return s ?? "";
}

function fmtDateUK(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function canonical(slug: string): string {
  return `${SITE}/blog/${slug}`;
}

// ─────────────────────────── JSON-LD blocks ───────────────────────────
function articleJsonLd(row: CaseStudyRow): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${canonical(row.slug)}#article`,
    "headline": row.title,
    "description": row.meta_description,
    "image": row.hero_image_url ?? undefined,
    "datePublished": row.published_date,
    "dateModified": row.published_date,
    "author": { "@id": `${SITE}/about#graham` },
    "publisher": { "@id": `${SITE}/#business` },
    "mainEntityOfPage": canonical(row.slug),
    "isPartOf": { "@id": `${SITE}/#website` },
    "inLanguage": "en-GB",
    "articleSection": "Case studies",
    "keywords": row.keywords,
    "about": row.about_topics.map((name) => ({ "@type": "Thing", name })),
  };
  return JSON.stringify(obj, null, 2);
}

function breadcrumbJsonLd(row: CaseStudyRow): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home",         "item": `${SITE}/` },
      { "@type": "ListItem", "position": 2, "name": "Case studies", "item": `${SITE}/blog/` },
      { "@type": "ListItem", "position": 3, "name": row.breadcrumb_label, "item": canonical(row.slug) },
    ],
  };
  return JSON.stringify(obj, null, 2);
}

function faqJsonLd(row: CaseStudyRow): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${canonical(row.slug)}#faq`,
    "mainEntity": row.faq_items.map((f) => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a },
    })),
  };
  return JSON.stringify(obj, null, 2);
}

// ─────────────────────────── body section renders ───────────────────────────
function renderDataTable(caption: string, rows: Record<string, string>, keyOrder: string[], keyLabels: Record<string,string>): string {
  const lines = keyOrder
    .filter((k) => rows[k] !== undefined && rows[k] !== "")
    .map((k) => `            <tr><th scope="row">${escText(keyLabels[k] ?? k)}</th><td>${escText(rows[k])}</td></tr>`);
  return `        <table class="data-table">
          <caption>${escText(caption)}</caption>
          <tbody>
${lines.join("\n")}
          </tbody>
        </table>`;
}

function renderPropertyTable(spec: Record<string, string>): string {
  const order = ["property_type","year_built","floor_area","walls","loft_insulation","floors","glazing","previous_heating","epc_rating_before","occupants"];
  const labels = {
    property_type: "Property type",
    year_built: "Year built",
    floor_area: "Floor area",
    walls: "Walls",
    loft_insulation: "Loft insulation",
    floors: "Floors",
    glazing: "Glazing",
    previous_heating: "Previous heating",
    epc_rating_before: "EPC rating before",
    occupants: "Occupants",
  };
  return renderDataTable("Property specification — pre-install", spec, order, labels);
}

function renderPerformanceTable(perf: Record<string, string>): string {
  const order = ["heat_delivered_kwh","electricity_consumed_kwh","measured_scop","gas_usage_removed_kwh","co2_before","co2_after","co2_reduction"];
  const labels = {
    heat_delivered_kwh: "Heat delivered to property",
    electricity_consumed_kwh: "Electricity consumed by heat pump",
    measured_scop: "Measured SCOP (heat ÷ electricity)",
    gas_usage_removed_kwh: "Gas usage removed",
    co2_before: "CO₂ emissions before (gas)",
    co2_after: "CO₂ emissions after (heat pump)",
    co2_reduction: "CO₂ reduction",
  };
  return renderDataTable("Measured year-one performance (12 months post-commissioning)", perf, order, labels);
}

function renderCostTable(cost: Record<string, string>): string {
  const order = ["system_cost","grant_amount","net_cost"];
  const labels = {
    system_cost: "Full system installed",
    grant_amount: "Boiler Upgrade Scheme grant",
    net_cost: "Net to homeowner",
  };
  const caption = cost.caption ?? "Installation cost";
  return renderDataTable(caption, cost, order, labels);
}

function renderFaqAccordion(items: FaqItem[]): string {
  if (!items.length) return "";
  const rows = items
    .map((f) => `          <details>
            <summary>${escText(f.q)}</summary>
            <div class="faq-body">${escText(f.a)}</div>
          </details>`)
    .join("\n");
  return `        <h2>Frequently asked questions</h2>

        <div class="article-faq">
${rows}
        </div>`;
}

function renderHeroFigure(row: CaseStudyRow): string {
  if (!row.hero_image_url) return "";
  const alt = escAttr(row.hero_image_alt ?? row.title);
  const caption = row.hero_image_caption ? `<figcaption>${escText(row.hero_image_caption)}</figcaption>` : "";
  return `        <figure class="article-hero-figure">
          <img src="${escAttr(row.hero_image_url)}"
               alt="${alt}"
               width="1920"
               height="1280"
               loading="eager"
               decoding="async"
               fetchpriority="high"
               sizes="(min-width: 1200px) 1200px, 100vw">
          ${caption}
        </figure>`;
}

function renderGallery(row: CaseStudyRow): string {
  if (!row.gallery_images?.length) return "";
  const items = row.gallery_images
    .map((g) => `          <figure class="article-hero-figure">
            <img src="${escAttr(g.url)}" alt="${escAttr(g.alt)}" loading="lazy" decoding="async">
            ${g.caption ? `<figcaption>${escText(g.caption)}</figcaption>` : ""}
          </figure>`)
    .join("\n");
  return `        <h2>Gallery</h2>
${items}`;
}

// ─────────────────────────── shared chrome ───────────────────────────
// The CSS, nav, mobile nav, footer and JS are the same on every case study.
// They live as constants so the template stays in one file.

const HEAD_BOILERPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TNLKVD3LQV"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-TNLKVD3LQV');
</script>
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '819341551233788');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=819341551233788&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;

const FONTS_AND_STYLE = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --color-brand: #FF6A1A;
    --color-brand-hover: #FF7F3A;
    --color-brand-glow: rgba(255, 106, 26, 0.25);
    --color-glow-soft: rgba(255, 106, 26, 0.06);
    --color-bg: #050B14;
    --color-surface: #0A1420;
    --color-surface-2: #0F1C2A;
    --color-surface-3: #121F2E;
    --color-text-primary: #FFFFFF;
    --color-text-secondary: #B8C4D2;
    --color-text-muted: #7A8A99;
    --color-border: rgba(184, 196, 210, 0.14);
    --color-divider: rgba(184, 196, 210, 0.18);
    --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px;
    --space-5: 32px; --space-6: 48px; --space-7: 64px; --space-8: 80px; --space-9: 96px;
    --radius-sm: 12px; --radius-md: 20px; --radius-lg: 28px;
    --shadow-sm: 0 18px 40px rgba(0, 0, 0, 0.22);
    --shadow-md: 0 28px 70px rgba(0, 0, 0, 0.34);
    --font-display: "Sora", system-ui, sans-serif;
    --font-body: "DM Sans", system-ui, sans-serif;
    --max-width: 1200px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background:
      radial-gradient(circle at 30% 20%, rgba(255, 106, 26, 0.15), transparent 60%),
      linear-gradient(180deg, #07111d 0%, var(--color-bg) 32%, #06101a 100%);
    color: var(--color-text-secondary);
    font: 400 16px/1.6 var(--font-body);
    -webkit-font-smoothing: antialiased;
  }
  body.menu-open { overflow: hidden; }
  a { color: inherit; }
  img { max-width: 100%; display: block; }
  button, input, select { font: inherit; }
  :focus-visible { outline: 2px solid rgba(255, 106, 26, 0.72); outline-offset: 3px; }
  .shell { width: min(calc(100% - 40px), var(--max-width)); margin: 0 auto; }
  .section { position: relative; isolation: isolate; padding: var(--space-8) 0; }
  .section::before {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(circle at 20% 10%, rgba(255, 106, 26, 0.08), transparent 60%);
    opacity: 0.72; pointer-events: none; z-index: -1;
  }
  .section-dark { background: transparent; }
  .section-label {
    margin: 0 0 12px; color: var(--color-brand);
    font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em;
    opacity: 0.85; text-transform: uppercase;
  }
  h1, h2, h3, h4 { margin: 0; color: var(--color-text-primary); font-family: var(--font-display); line-height: 1.06; }
  h1 { max-width: 880px; font-size: clamp(36px, 4.5vw, 56px); letter-spacing: -0.04em; line-height: 1.08; }
  h2 { max-width: 760px; font-size: clamp(28px, 3.4vw, 36px); letter-spacing: -0.03em; line-height: 1.12; }
  h3 { font-size: 1.22rem; letter-spacing: -0.02em; }
  p { margin: 0; }
  .button, .button-secondary {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 52px; padding: 0 28px; border-radius: 999px;
    text-decoration: none; font-weight: 700; white-space: nowrap;
    transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }
  .button { background: var(--color-brand); color: #fff; box-shadow: 0 16px 38px rgba(255, 106, 26, 0.2); }
  .button:hover { background: var(--color-brand-hover); box-shadow: 0 18px 44px var(--color-brand-glow); transform: translateY(-2px); }
  .button-secondary { border: 1px solid var(--color-divider); color: var(--color-text-primary); background: transparent; }
  .button-secondary:hover { border-color: rgba(255, 106, 26, 0.45); transform: translateY(-2px); }
  .site-nav { position: sticky; top: 0; z-index: 100; background: rgba(5, 11, 20, 0.82); backdrop-filter: blur(18px); border-bottom: 1px solid rgba(184, 196, 210, 0.09); }
  .site-nav-inner { width: min(calc(100% - 40px), var(--max-width)); margin: 0 auto; height: 78px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .brand { display: inline-flex; align-items: center; text-decoration: none; }
  .brand-logo { width: 244px; height: auto; }
  .brand-logo.mobile { width: 220px; }
  .brand-logo.footer { width: 264px; }
  .nav-links, .mobile-links, .footer-list { list-style: none; margin: 0; padding: 0; }
  .nav-links { display: flex; align-items: center; gap: 24px; }
  .nav-links a, .mobile-links a, .menu-toggle, .close-menu { color: var(--color-text-secondary); text-decoration: none; background: none; border: 0; cursor: pointer; }
  .nav-links a:hover, .mobile-links a:hover { color: var(--color-text-primary); }
  .nav-links a[aria-current="page"], .mobile-links a[aria-current="page"] { color: var(--color-text-primary); }
  .nav-links .nav-cta { display: flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; border-radius: 999px; background: var(--color-brand); color: #fff; font-weight: 700; white-space: nowrap; }
  .menu-toggle { display: none; width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid var(--color-divider); font-size: 1.25rem; }
  .social-icons { display: inline-flex; align-items: center; gap: 12px; }
  .social-icons a { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 999px; color: var(--color-text-secondary); border: 1px solid var(--color-divider); text-decoration: none; transition: color 0.18s ease, border-color 0.18s ease, transform 0.18s ease; }
  .social-icons a:hover { color: var(--color-brand); border-color: var(--color-brand); transform: translateY(-1px); }
  .social-icons svg { width: 18px; height: 18px; }
  .social-icons.in-footer { margin-top: 18px; }
  .social-icons.in-mobile-nav { margin-top: 16px; justify-content: flex-start; }
  @media (max-width: 960px) { .social-icons.in-header { display: none; } }
  .mobile-nav { position: fixed; inset: 0; z-index: 140; pointer-events: none; }
  .mobile-nav[aria-hidden="false"] { pointer-events: auto; }
  .mobile-nav-backdrop { position: absolute; inset: 0; background: rgba(3, 7, 13, 0.72); opacity: 0; transition: opacity 0.2s ease; }
  .mobile-nav-panel { position: absolute; inset: 0 0 0 auto; width: min(92vw, 360px); padding: 24px; background: linear-gradient(180deg, #0C1520 0%, #08111B 100%); transform: translateX(100%); transition: transform 0.22s ease; display: flex; flex-direction: column; gap: 24px; }
  .mobile-nav[aria-hidden="false"] .mobile-nav-backdrop { opacity: 1; }
  .mobile-nav[aria-hidden="false"] .mobile-nav-panel { transform: translateX(0); }
  .mobile-nav-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .close-menu { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--color-divider); font-size: 1.5rem; }
  .mobile-links { display: grid; gap: 14px; }
  .mobile-links a { display: block; padding: 15px 0; border-bottom: 1px solid rgba(184, 196, 210, 0.14); }
  .article-header { padding: 72px 0 32px; }
  .article-breadcrumb { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; color: var(--color-text-muted); font-size: 0.86rem; }
  .article-breadcrumb li { display: inline-flex; align-items: center; gap: 6px; }
  .article-breadcrumb li + li::before { content: "›"; margin-right: 6px; color: var(--color-text-muted); }
  .article-breadcrumb a { color: var(--color-text-secondary); text-decoration: none; }
  .article-breadcrumb a:hover { color: var(--color-text-primary); }
  .article-meta { margin-top: 16px; color: var(--color-text-muted); font-size: 0.94rem; }
  .article-meta strong { color: var(--color-text-secondary); font-weight: 600; }
  .article-body { max-width: 820px; margin: 0 auto; padding: 24px 0 var(--space-7); }
  .article-body > * + * { margin-top: 22px; }
  .article-hero-figure { margin: 8px 0 var(--space-4); }
  .article-hero-figure img { width: 100%; height: auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border); box-shadow: var(--shadow-md); }
  .article-hero-figure figcaption { margin-top: 10px; color: var(--color-text-muted); font-size: 0.86rem; line-height: 1.5; }
  .article-body p, .article-body li { color: var(--color-text-secondary); font-size: 1.04rem; line-height: 1.7; }
  .article-body h2 { margin-top: var(--space-7); margin-bottom: 4px; font-size: clamp(26px, 3vw, 32px); }
  .article-body h3 { margin-top: var(--space-5); margin-bottom: 4px; font-size: 1.18rem; color: var(--color-text-primary); }
  .article-body ul { padding-left: 1.2em; margin: 0; }
  .article-body ul li { margin-bottom: 8px; }
  .article-body strong { color: var(--color-text-primary); }
  .data-table { width: 100%; border-collapse: collapse; background: rgba(15, 28, 42, 0.55); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; font-size: 0.96rem; }
  .data-table caption { caption-side: top; text-align: left; margin-bottom: 10px; color: var(--color-text-primary); font-weight: 600; }
  .data-table th, .data-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .data-table tr:last-child th, .data-table tr:last-child td { border-bottom: 0; }
  .data-table th { color: var(--color-text-primary); font-weight: 600; width: 42%; background: rgba(255, 255, 255, 0.03); }
  .data-table td { color: var(--color-text-secondary); }
  .article-cta { margin-top: var(--space-7); padding: 32px; border-radius: var(--radius-lg); background: radial-gradient(circle at top center, rgba(255, 106, 26, 0.18), transparent 50%), linear-gradient(180deg, rgba(18, 31, 46, 0.96), rgba(10, 20, 32, 0.96)); border: 1px solid var(--color-border); box-shadow: var(--shadow-md); display: grid; gap: 18px; }
  .article-cta h2 { margin: 0; font-size: clamp(24px, 3vw, 30px); }
  .article-cta-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
  .article-footnote { margin-top: var(--space-6); padding: 20px 24px; border-radius: var(--radius-md); background: rgba(15, 28, 42, 0.55); border: 1px solid var(--color-border); color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.6; }
  .article-footnote strong { color: var(--color-text-secondary); }
  .article-faq { display: grid; gap: 0; margin-top: 8px; }
  .article-faq details { border-top: 1px solid var(--color-divider); }
  .article-faq details:last-child { border-bottom: 1px solid var(--color-divider); }
  .article-faq summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 68px; padding: 20px 0; color: var(--color-text-primary); font-weight: 700; cursor: pointer; list-style: none; }
  .article-faq summary::-webkit-details-marker { display: none; }
  .article-faq summary::after { content: "+"; color: var(--color-brand); font-size: 1.4rem; line-height: 1; transition: transform 0.2s ease; }
  .article-faq details[open] summary::after { content: "−"; }
  .article-faq .faq-body { padding-right: 36px; padding-bottom: 20px; color: var(--color-text-secondary); }
  .footer { padding: 64px 0 32px; background: rgba(5, 11, 20, 0.9); border-top: 1px solid rgba(184, 196, 210, 0.1); }
  .footer-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 24px; padding-bottom: 28px; border-bottom: 1px solid rgba(184, 196, 210, 0.12); }
  .footer h4 { margin-bottom: 14px; font-size: 0.82rem; letter-spacing: 0.12em; text-transform: uppercase; }
  .footer-list { display: grid; gap: 10px; }
  .footer-list a { color: var(--color-text-secondary); text-decoration: none; }
  .footer-list a:hover { color: var(--color-text-primary); }
  .footer-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; padding-top: 20px; color: var(--color-text-muted); font-size: 0.82rem; }
  @media (max-width: 1120px) { .footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 940px) { .nav-links { display: none; } .menu-toggle { display: flex; } }
  @media (max-width: 700px) {
    .shell, .site-nav-inner { width: min(calc(100% - 28px), var(--max-width)); }
    .section { padding: 32px 0; }
    .article-header { padding: 48px 0 16px; }
    .article-body { padding: 16px 0 32px; }
    .article-body p, .article-body li { font-size: 1rem; }
    .data-table { font-size: 0.92rem; }
    .data-table th, .data-table td { padding: 10px 12px; }
    .data-table th { width: 50%; }
    .footer-grid { grid-template-columns: 1fr; }
    .brand-logo { width: 204px; }
    .brand-logo.mobile { width: 188px; }
    .article-cta { padding: 24px; }
  }
</style>
</head>`;

const BODY_OPEN_AND_NAV = `<body>
<svg aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute; width:0; height:0; overflow:hidden">
  <defs>
    <symbol id="icon-instagram" viewBox="0 0 24 24">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="12" cy="12" r="3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="17" cy="7" r="0.9" fill="currentColor"/>
    </symbol>
    <symbol id="icon-linkedin" viewBox="0 0 24 24">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M8 10.5V16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="8" cy="7.8" r="0.9" fill="currentColor"/>
      <path d="M12 16.5V10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 13C12 11.6 13 10.5 14.5 10.5C16 10.5 16.5 11.6 16.5 13V16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </symbol>
    <symbol id="icon-facebook" viewBox="0 0 24 24">
      <path d="M19.5 4.5H15.5C13.567 4.5 12 6.067 12 8V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M9 11.5H15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
  </defs>
</svg>
<nav class="site-nav" aria-label="Primary">
  <div class="site-nav-inner">
    <a class="brand" href="/" aria-label="Thermova home">
      <img class="brand-logo" src="/assets/thermova-logo.svg" alt="Thermova">
    </a>
    <ul class="nav-links" role="list">
      <li><a href="/air-source-heat-pumps">Heat pumps</a></li>
      <li><a href="/solar-panels">Solar &amp; battery</a></li>
      <li><a href="/landlord-services">Landlords</a></li>
      <li><a href="/boiler-upgrade-scheme">£7,500 grant</a></li>
      <li><a href="/epc-compliance">EPC C compliance</a></li>
      <li><a href="/blog/" aria-current="page">Case studies</a></li>
      <li><a class="nav-cta" href="/#assessment">Book assessment</a></li>
    </ul>
    <div class="social-icons in-header">
      <a href="https://www.instagram.com/thermovauk/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Instagram"><svg aria-hidden="true" focusable="false"><use href="#icon-instagram"/></svg></a>
      <a href="https://www.linkedin.com/company/113232935" target="_blank" rel="noopener noreferrer" aria-label="Thermova on LinkedIn"><svg aria-hidden="true" focusable="false"><use href="#icon-linkedin"/></svg></a>
      <a href="https://www.facebook.com/share/17UE6euCC2/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Facebook"><svg aria-hidden="true" focusable="false"><use href="#icon-facebook"/></svg></a>
    </div>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-nav-panel" aria-label="Open menu">☰</button>
  </div>
</nav>
<div class="mobile-nav" id="mobile-nav" aria-hidden="true">
  <button class="mobile-nav-backdrop" type="button" aria-label="Close menu"></button>
  <aside class="mobile-nav-panel" id="mobile-nav-panel" tabindex="-1">
    <div class="mobile-nav-head">
      <img class="brand-logo mobile" src="/assets/thermova-logo.svg" alt="Thermova">
      <button class="close-menu" type="button" aria-label="Close menu">×</button>
    </div>
    <ul class="mobile-links" role="list">
      <li><a href="/air-source-heat-pumps">Air source heat pumps</a></li>
      <li><a href="/solar-panels">Solar panels</a></li>
      <li><a href="/battery-storage">Battery storage</a></li>
      <li><a href="/boiler-upgrade-scheme">£7,500 Boiler Upgrade Scheme</a></li>
      <li><a href="/landlord-services">Landlord services</a></li>
      <li><a href="/epc-compliance">EPC C compliance</a></li>
      <li><a href="/blog/" aria-current="page">Case studies</a></li>
      <li><a href="/about">About Graham</a></li>
      <li><a href="https://thermova.heatio.app/" target="_blank" rel="noopener noreferrer">Calculate my savings</a></li>
    </ul>
    <a class="button mobile-nav-cta" href="/#assessment">Book assessment</a>
    <div class="social-icons in-mobile-nav">
      <a href="https://www.instagram.com/thermovauk/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Instagram"><svg aria-hidden="true" focusable="false"><use href="#icon-instagram"/></svg></a>
      <a href="https://www.linkedin.com/company/113232935" target="_blank" rel="noopener noreferrer" aria-label="Thermova on LinkedIn"><svg aria-hidden="true" focusable="false"><use href="#icon-linkedin"/></svg></a>
      <a href="https://www.facebook.com/share/17UE6euCC2/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Facebook"><svg aria-hidden="true" focusable="false"><use href="#icon-facebook"/></svg></a>
    </div>
  </aside>
</div>`;

const FOOTER_AND_JS = `<footer class="footer">
  <div class="shell">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/" aria-label="Thermova home">
          <img class="brand-logo footer" src="/assets/thermova-logo.svg" alt="Thermova">
        </a>
        <p style="margin-top: 18px; max-width: 30ch;">Heat pumps, solar and battery systems for homeowners and landlords who are ready to move on from gas.</p>
        <div class="social-icons in-footer">
          <a href="https://www.instagram.com/thermovauk/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Instagram"><svg aria-hidden="true" focusable="false"><use href="#icon-instagram"/></svg></a>
          <a href="https://www.linkedin.com/company/113232935" target="_blank" rel="noopener noreferrer" aria-label="Thermova on LinkedIn"><svg aria-hidden="true" focusable="false"><use href="#icon-linkedin"/></svg></a>
          <a href="https://www.facebook.com/share/17UE6euCC2/" target="_blank" rel="noopener noreferrer" aria-label="Thermova on Facebook"><svg aria-hidden="true" focusable="false"><use href="#icon-facebook"/></svg></a>
        </div>
      </div>
      <div>
        <h4>Services</h4>
        <ul class="footer-list">
          <li><a href="/air-source-heat-pumps">Air source heat pumps</a></li>
          <li><a href="/solar-panels">Solar panels</a></li>
          <li><a href="/battery-storage">Battery storage</a></li>
          <li><a href="/landlord-services">Landlord upgrades</a></li>
          <li><a href="/epc-compliance">EPC C compliance</a></li>
        </ul>
      </div>
      <div>
        <h4>Information</h4>
        <ul class="footer-list">
          <li><a href="/about">About Graham</a></li>
          <li><a href="/blog/">Case studies</a></li>
          <li><a href="/boiler-upgrade-scheme">£7,500 Boiler Upgrade Scheme</a></li>
          <li><a href="/air-source-heat-pumps">Heat pumps</a></li>
          <li><a href="/#faq">FAQ</a></li>
          <li><a href="https://www.gov.uk/apply-boiler-upgrade-scheme" target="_blank" rel="noopener">GOV.UK Boiler Upgrade Scheme guidance</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul class="footer-list">
          <li><a href="/#assessment">Book an assessment</a></li>
          <li><a href="tel:+447976015890">+44 7976 015890</a></li>
          <li><a href="mailto:info@thermova.uk">info@thermova.uk</a></li>
          <li>Harbury, 33 Derby Road, Poulton-le-Fylde, FY6 7AF</li>
        </ul>
      </div>
    </div>
    <div class="footer-meta">
      <span>© 2026 Thermova Ltd. Company number 17135215. Grant amounts per GOV.UK. Eligible properties in England and Wales only.</span>
      <span><a href="/privacy">Privacy policy</a> • <a href="/terms">Terms</a> • <a href="/cookies">Cookies</a></span>
    </div>
  </div>
</footer>

<script>
  const menuToggle = document.querySelector(".menu-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  const mobilePanel = document.getElementById("mobile-nav-panel");
  const closeButtons = document.querySelectorAll(".close-menu, .mobile-nav-backdrop");
  const mobileLinks = document.querySelectorAll(".mobile-links a");
  let lastFocusedElement = null;

  function openMenu() {
    lastFocusedElement = document.activeElement;
    mobileNav.setAttribute("aria-hidden", "false");
    menuToggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-open");
    mobilePanel.focus();
  }
  function closeMenu() {
    mobileNav.setAttribute("aria-hidden", "true");
    menuToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
    if (lastFocusedElement) lastFocusedElement.focus();
  }
  menuToggle.addEventListener("click", () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    if (expanded) closeMenu(); else openMenu();
  });
  closeButtons.forEach((button) => button.addEventListener("click", closeMenu));
  mobileLinks.forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileNav.getAttribute("aria-hidden") === "false") closeMenu();
  });
</script>
</body>
</html>
`;

// ─────────────────────────── full page render ───────────────────────────
export function renderCaseStudyHtml(row: CaseStudyRow): string {
  const head = `${HEAD_BOILERPLATE}
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escText(row.title)} | Thermova</title>
<meta name="description" content="${escAttr(row.meta_description)}">
<link rel="canonical" href="${canonical(row.slug)}">
<meta property="og:title" content="${escAttr(row.title)} | Thermova">
<meta property="og:description" content="${escAttr(row.meta_description)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="en_GB">
<meta property="og:url" content="${canonical(row.slug)}">
<script type="application/ld+json">
${articleJsonLd(row)}
</script>
<script type="application/ld+json">
${breadcrumbJsonLd(row)}
</script>
<script type="application/ld+json">
${faqJsonLd(row)}
</script>
${FONTS_AND_STYLE}`;

  // Two render paths:
  //  (a) body_html is set → render it directly (paste-and-go mode)
  //  (b) body_html is null → render the structured prose + tables (legacy Lytham mode)
  let articleInner: string;
  if (row.body_html && row.body_html.trim()) {
    articleInner = `${renderHeroFigure(row)}

        ${rawHtml(row.body_html)}

${renderGallery(row)}`;
  } else {
    const propertyTable = renderPropertyTable(row.property_spec);
    const performanceTable = renderPerformanceTable(row.performance_data);
    const costTable = renderCostTable(row.cost_data);
    articleInner = `${renderHeroFigure(row)}

${row.opening_paragraph_1 ? `        <p>${rawHtml(row.opening_paragraph_1)}</p>\n` : ""}
${row.opening_paragraph_2 ? `\n        <p>${rawHtml(row.opening_paragraph_2)}</p>\n` : ""}
${row.why_matters_heading ? `        <h2>${escText(row.why_matters_heading)}</h2>\n` : ""}
${row.why_matters_prose ? `        ${rawHtml(row.why_matters_prose)}\n` : ""}

        <h2>The property</h2>

${propertyTable}

${row.equipment_list_html ? `        <h2>What Thermova installed</h2>\n\n        ${rawHtml(row.equipment_list_html)}\n` : ""}

${row.installation_timeline_prose ? `        <h3>How long did the installation take?</h3>\n\n        <p>${rawHtml(row.installation_timeline_prose)}</p>\n` : ""}

        <h2>Year-one performance data</h2>

${performanceTable}

${row.methodology_prose ? `        ${rawHtml(row.methodology_prose)}\n` : ""}

${row.co2_equivalence_prose ? `        <h2>What does this CO₂ reduction actually look like?</h2>\n\n        ${rawHtml(row.co2_equivalence_prose)}\n` : ""}

        <h2>What it cost the homeowner</h2>

${costTable}

${row.cost_narrative_prose ? `        ${rawHtml(row.cost_narrative_prose)}\n` : ""}

${row.winter_performance_html ? `        <h2>How the heat pump performed in the Lancashire winter</h2>\n\n        ${rawHtml(row.winter_performance_html)}\n` : ""}

${renderGallery(row)}`;
  }

  const body = `${BODY_OPEN_AND_NAV}

<main id="top">
  <header class="article-header">
    <div class="shell">
      <ol class="article-breadcrumb" aria-label="Breadcrumb">
        <li><a href="/">Home</a></li>
        <li><a href="/blog/">Case studies</a></li>
        <li aria-current="page">${escText(row.breadcrumb_label)}</li>
      </ol>
      <p class="section-label">Case study</p>
      <h1>${escText(row.title)}</h1>
      <p class="article-meta">By <strong>${escText(row.author_name)}</strong> · ${escText(fmtDateUK(row.published_date))} · ${row.read_time_minutes} min read · ${escText(row.location)}</p>
    </div>
  </header>

  <article class="section section-dark">
    <div class="shell">
      <div class="article-body">

${articleInner}

${renderFaqAccordion(row.faq_items)}

        <div class="article-cta">
          <p class="section-label">Next step</p>
          <h2>${escText(row.cta_heading)}</h2>
${row.cta_body ? `          <p>${rawHtml(row.cta_body)}</p>\n` : ""}
          <div class="article-cta-actions">
            <a class="button" href="/#assessment" onclick="fbq('track', 'Lead');">Book a free survey</a>
            <a class="button-secondary" href="/about">Read more about Graham</a>
          </div>
        </div>

${row.methodology_footnote ? `        <aside class="article-footnote" aria-label="Methodology footnote">\n          <p><strong>Methodology and disclosures.</strong> ${rawHtml(row.methodology_footnote)}</p>\n        </aside>\n` : ""}

      </div>
    </div>
  </article>
</main>

${FOOTER_AND_JS}`;

  return head + "\n" + body;
}

// ─────────────────────────── blog index card ───────────────────────────
export function renderBlogIndexCard(row: CaseStudyRow): string {
  const summary = row.meta_description.length > 200
    ? row.meta_description.slice(0, 197) + "…"
    : row.meta_description;
  const heroAlt = row.hero_image_alt ?? row.title;
  return `<li class="post-card">
  <div class="post-card-thumb">
    <img src="${escAttr(row.hero_image_url ?? "")}" alt="${escAttr(heroAlt)}" loading="lazy" decoding="async">
  </div>
  <div class="post-card-body">
    <span class="post-card-tag">Case study</span>
    <h2>${escText(row.title)}</h2>
    <p class="post-card-meta">By ${escText(row.author_name)} · ${escText(fmtDateUK(row.published_date))} · ${row.read_time_minutes} min read</p>
    <p class="post-card-summary">${escText(summary)}</p>
  </div>
  <a class="post-card-link" href="${canonical(row.slug)}" aria-label="Read ${escAttr(row.title)}"></a>
</li>`;
}
