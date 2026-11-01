// Turns data into readable markdown files, for checking the pipeline by eye.
// Pure functions (no network, no files), so they are easy to test.

import type { Story } from "./gather.js";
import type { FilterResult, Profile } from "./filter.js";

// ---------- gathered.md: every story, in full ----------

export function renderMarkdown(stories: Story[], generatedAt: string): string {
  // Group by edition, keeping the order stories arrived in (oldest edition first).
  const byEdition = new Map<string, Story[]>();
  for (const s of stories) {
    if (!byEdition.has(s.edition)) byEdition.set(s.edition, []);
    byEdition.get(s.edition)!.push(s);
  }

  // How many article links show up in more than one edition?
  const seen = new Map<string, number>();
  for (const s of stories) seen.set(s.url, (seen.get(s.url) ?? 0) + 1);
  const repeatedLinks = [...seen.values()].filter((n) => n > 1).length;

  const out: string[] = [];
  out.push(`# Gather check: tdd.cat`);
  out.push(`Generated ${generatedAt} IST. ${stories.length} stories from ${byEdition.size} edition(s).`);
  out.push("");

  out.push(`## Summary`);
  out.push(`| Edition | Stories |`);
  out.push(`|---|---|`);
  for (const [date, list] of byEdition) out.push(`| ${date} | ${list.length} |`);
  out.push("");

  // If any of these is not 0, the parser missed something. Look at those stories first.
  out.push(`## Parse checks (0 is good)`);
  out.push(`- Stories with an empty body: ${stories.filter((s) => !s.content).length}`);
  out.push(`- Stories with no authors line: ${stories.filter((s) => !s.authors).length}`);
  out.push(`- Stories with no "why read" line: ${stories.filter((s) => !s.whyRead).length}`);
  out.push(`- Stories with no discussion link: ${stories.filter((s) => !s.discussion).length} (can be normal)`);
  out.push(`- Article links that appear in more than one edition: ${repeatedLinks} (the filter layer will dedupe these)`);
  out.push("");

  for (const [date, list] of byEdition) {
    out.push(`---`);
    out.push(`# Edition ${date} (${list.length} stories)`);
    out.push("");
    list.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.title}`);
      out.push(`- Link: ${s.url}`);
      out.push(`- Authors: ${s.authors || "(none)"}`);
      out.push(`- Why read: ${s.whyRead || "(none)"}`);
      out.push(`- Discussion: ${s.discussion ?? "(none)"}`);
      out.push("");
      out.push(s.content || "(empty body)");
      out.push("");
    });
  }

  return out.join("\n") + "\n";
}

// ---------- filtered.md: what the filter kept, nearly kept, and missed ----------

export function renderFiltered(r: FilterResult, profile: Profile, editions: string[], generatedAt: string): string {
  const out: string[] = [];
  out.push(`# Filter preview`);
  out.push(`Generated ${generatedAt} IST. Editions: ${editions.join(", ")}. This preview ignores the "already delivered" list.`);
  out.push("");
  out.push(`**Goal:** ${profile.goal}`);
  out.push("");

  out.push(`## What happened to the stories`);
  out.push(`| Step | Stories |`);
  out.push(`|---|---|`);
  out.push(`| Gathered | ${r.stats.gathered} |`);
  out.push(`| Removed as duplicates (same article link) | ${r.stats.duplicatesRemoved} |`);
  if (r.stats.alreadyDelivered > 0) out.push(`| Already delivered earlier | ${r.stats.alreadyDelivered} |`);
  out.push(`| Dropped by the avoid list | ${r.stats.avoided} |`);
  out.push(`| Matched no keyword | ${r.noMatch.length} |`);
  out.push(`| Matched, but not selected | ${r.rest.length} |`);
  out.push(`| **Selected** | **${r.selected.length}** |`);
  out.push("");

  out.push(`## Selected per lens`);
  out.push(`| Lens | Selected |`);
  out.push(`|---|---|`);
  for (const lens of profile.lenses) {
    out.push(`| ${lens.name} | ${r.selected.filter((s) => s.lens === lens.name).length} |`);
  }
  out.push("");

  out.push(`## Selected (best first)`);
  out.push("");
  r.selected.forEach((c, i) => {
    out.push(`### ${i + 1}. ${c.story.title}`);
    out.push(`- Lens: ${c.lens} | score ${c.score.toFixed(2)} (${(c.norm * 100).toFixed(0)}% of the lens's best)`);
    out.push(`- Matched keywords: ${c.matched.join(", ") || "(none)"}`);
    out.push(`- Edition: ${c.story.edition}`);
    out.push(`- Link: ${c.story.url}`);
    if (c.story.whyRead) out.push(`- Why read: ${c.story.whyRead}`);
    out.push("");
  });

  out.push(`## Near misses (next 15)`);
  out.push("");
  for (const c of r.rest.slice(0, 15)) {
    out.push(`- [${c.lens}] ${c.story.title} (score ${c.score.toFixed(2)}, matched: ${c.matched.join(", ")})`);
  }
  out.push("");

  out.push(`## Matched no keyword (what your keywords missed, or true noise)`);
  out.push("");
  for (const s of r.noMatch.slice(0, 150)) out.push(`- ${s.title}`);
  out.push("");

  return out.join("\n");
}
