// Rewrites the case study card list in /blog/index.html between the
// CASE_STUDIES_LIST_START and CASE_STUDIES_LIST_END marker comments.

import { CaseStudyRow, renderBlogIndexCard } from "./template.ts";

const START = "<!-- CASE_STUDIES_LIST_START -->";
const END = "<!-- CASE_STUDIES_LIST_END -->";

export function regenerateBlogIndex(
  currentHtml: string,
  publishedRows: CaseStudyRow[],
): string {
  const startIdx = currentHtml.indexOf(START);
  const endIdx = currentHtml.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Missing or malformed marker comments in blog/index.html. ` +
      `Expected ${START} and ${END} in order.`,
    );
  }
  // sort newest first by published_date
  const rows = [...publishedRows].sort((a, b) =>
    a.published_date < b.published_date ? 1 : a.published_date > b.published_date ? -1 : 0
  );
  const cards = rows.map(renderBlogIndexCard).join("\n");
  const before = currentHtml.slice(0, startIdx + START.length);
  const after = currentHtml.slice(endIdx);
  return `${before}\n${cards}\n${after}`;
}
