# Admin — Case Study CMS

Login-gated UI at `/admin/case-studies/` for adding, editing, publishing
and deleting case studies. Backed by Supabase (`case_studies` table +
`Website` storage bucket) and a Deno edge function that commits static
HTML to the GitHub repo so the live site stays SEO-clean.

## How publishing works

1. Editor opens `/admin/case-studies/edit.html?id=<uuid>` and fills the form.
2. **Save draft** → `INSERT` / `UPDATE` on `public.case_studies`. Live site unaffected.
3. **Publish** → calls the `publish-case-study` Supabase Edge Function, which:
   - Renders the row to HTML via `supabase/functions/publish-case-study/template.ts`.
   - Regenerates `blog/index.html` card list between the `<!-- CASE_STUDIES_LIST_START -->` and `<!-- CASE_STUDIES_LIST_END -->` marker comments.
   - Commits both files in one atomic GitHub commit (Git Data API).
   - Updates the row with `last_published_at` + `last_published_commit_sha`.
4. Netlify auto-deploys the new commit → live URL reflects the change in ~1–2 min.

## What's where

| Path | Purpose |
|---|---|
| `admin/case-studies/index.html` | List view (auth-gated) |
| `admin/case-studies/edit.html` | Create + edit form with image upload |
| `supabase/migrations/<ts>_create_case_studies.sql` | Schema + RLS + storage policies |
| `supabase/migrations/<ts>_seed_lytham_case_study.sql` | One-time Lytham backfill |
| `supabase/functions/publish-case-study/index.ts` | HTTP handler (POST publish/unpublish/delete) |
| `supabase/functions/publish-case-study/template.ts` | DB row → full case-study HTML |
| `supabase/functions/publish-case-study/regenerate-index.ts` | Rebuilds `blog/index.html` card list |
| `blog/index.html` | Public listing — contains the marker comments that the edge function rewrites |

## One-time setup after merging this PR

```bash
cd thermova-website

# 1. Apply migrations
supabase db push

# 2. Set edge-function secrets (Supabase CLI must be logged in to the cyjbzemzjmfjsloogixw project)
supabase secrets set GITHUB_PAT=$(cat ~/clawd/config/github_pat_2.txt)
supabase secrets set GITHUB_OWNER=RenewEnergies25
supabase secrets set GITHUB_REPO=thermova-website
supabase secrets set GITHUB_DEFAULT_BRANCH=main
supabase secrets set COMMIT_AUTHOR_NAME='Thermova Publisher'
supabase secrets set COMMIT_AUTHOR_EMAIL='noreply@thermova.uk'

# 3. Deploy the function
supabase functions deploy publish-case-study
```

## How to add a new case study

1. Log in at `/auth-login`, click "Case studies →" in the dashboard nav.
2. Click "+ New case study". Set the slug first (e.g. `air-source-heat-pump-case-study-preston-victorian-terrace`) — image upload paths depend on it.
3. Upload the hero image (jpg/png/webp, ≤5MB). The public URL auto-fills.
4. Optional: upload gallery images. Use "Copy URL" on each thumbnail and paste `<img src="..." alt="...">` snippets into prose fields where you want them.
5. Fill the structured tables (property spec, performance, cost) and the FAQs.
6. Click **Save draft** to stash, or **Publish** to push live.
7. Live URL: `https://thermova.uk/blog/<slug>` — visible in ~1–2 min after publish.

## How to roll back a bad publish

The publish action is one git commit. To revert:

```bash
git revert <commit-sha>
git push origin main
```

Netlify will redeploy the previous state. The DB row stays at
`status='published'` — toggle it to `draft` via the admin UI if you don't
want it visible after re-fixing.

## PAT rotation

The `GITHUB_PAT` Supabase secret is a fine-grained PAT for the
`RenewEnergies25/thermova-website` repository with `Contents: Read + Write`.
Fine-grained PATs have a maximum lifetime of one year. When it expires
or is rotated, refresh the secret:

```bash
supabase secrets set GITHUB_PAT=<new-token>
```

## Risks and limitations

- **Any authenticated Supabase user can publish.** Today that's Graham + Dean.
  If/when EPC dashboard access expands to non-Thermova users, tighten with a
  `case_study_editors` allowlist table (RLS check on `case_studies` rows).
- **Concurrent publishes can race** on `blog/index.html`. Realistic concurrency
  is near zero; if it becomes an issue add a Postgres advisory lock around publish.
- **Marker comments are load-bearing.** Don't remove
  `<!-- CASE_STUDIES_LIST_START --> … <!-- CASE_STUDIES_LIST_END -->`
  from `blog/index.html` — the regenerator scopes its rewrite to that block.
