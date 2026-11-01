// Filter layer: from every gathered story, pick the ~10 most relevant to the user's goal.
// No LLM here. Plain code only:
//   1. dedupe (same article link twice? keep the first)
//   2. drop links we already delivered on an earlier day
//   3. drop anything whose TITLE contains an "avoid" word
//   4. score every story against each "lens" of the goal with BM25 (keywords)
//   5. pick the best few per lens (quota), then fill the remaining slots with the best of the rest

import { readFile } from "node:fs/promises";
import type { Story } from "./gather.js";
import { bm25, countTerm, tokenize } from "./bm25.js";

export type Lens = { name: string; keywords: string[] };

export type Profile = {
  goal: string;
  about: string; // who the reader is; only the synthesise step uses it
  settings: { totalStories: number; perLensQuota: number };
  fieldWeights: { title: number; whyRead: number; body: number };
  lenses: Lens[];
  avoid: string[];
};

export type Scored = {
  story: Story;
  lens: string;        // the lens this story matched best
  score: number;       // raw BM25 score in that lens
  norm: number;        // that score divided by the best score any story got in the lens (0..1)
  matched: string[];   // which of the lens's keywords were found
};

export type FilterResult = {
  selected: Scored[];  // the final picks, best first
  rest: Scored[];      // matched at least one keyword but did not make the cut, best first
  noMatch: Story[];    // matched no keyword at all
  stats: {
    gathered: number;
    duplicatesRemoved: number;
    alreadyDelivered: number;
    avoided: number;
  };
};

// ---------- profile ----------

export async function loadProfile(path = "profile.json"): Promise<Profile> {
  let raw: any;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }

  const lenses: Lens[] = raw.lenses;
  if (!Array.isArray(lenses) || lenses.length === 0) throw new Error(`${path}: "lenses" must be a non-empty list`);
  const names = new Set<string>();
  for (const l of lenses) {
    if (!l?.name || !Array.isArray(l.keywords) || l.keywords.length === 0)
      throw new Error(`${path}: every lens needs a "name" and a non-empty "keywords" list`);
    if (names.has(l.name)) throw new Error(`${path}: lens name "${l.name}" is used twice`);
    names.add(l.name);
  }

  const total = raw.settings?.totalStories ?? 10;
  const quota = raw.settings?.perLensQuota ?? 2;
  if (!(total > 0) || !(quota >= 0)) throw new Error(`${path}: settings.totalStories must be > 0 and perLensQuota >= 0`);

  return {
    goal: String(raw.goal ?? ""),
    about: String(raw.about ?? ""),
    settings: { totalStories: total, perLensQuota: quota },
    fieldWeights: {
      title: raw.fieldWeights?.title ?? 3,
      whyRead: raw.fieldWeights?.whyRead ?? 2,
      body: raw.fieldWeights?.body ?? 1,
    },
    lenses,
    avoid: Array.isArray(raw.avoid) ? raw.avoid : [],
  };
}

// ---------- links ----------

// The same article can show up as "https://www.x.com/a/" and "https://x.com/a?utm_source=foo".
// Normalising makes those equal, so we can tell it is one story.
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/.test(key) || key === "ref" || key === "fbclid") url.searchParams.delete(key);
    }
    return (url.host.replace(/^www\./, "") + url.pathname.replace(/\/+$/, "") + url.search).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

// ---------- the filter ----------

export function filterStories(stories: Story[], profile: Profile, delivered: Set<string>): FilterResult {
  const stats = { gathered: stories.length, duplicatesRemoved: 0, alreadyDelivered: 0, avoided: 0 };
  const avoidTerms = profile.avoid.map(tokenize);

  // Steps 1-3: dedupe, skip delivered, avoid list. Stories arrive oldest edition first,
  // so "keep the first" means "keep the earliest appearance".
  const seenNow = new Set<string>();
  const pool: Story[] = [];
  for (const s of stories) {
    const key = normalizeUrl(s.url);
    if (seenNow.has(key)) { stats.duplicatesRemoved++; continue; }
    seenNow.add(key);
    if (delivered.has(key)) { stats.alreadyDelivered++; continue; }
    const titleTokens = tokenize(s.title);
    if (avoidTerms.some((t) => countTerm(titleTokens, t) > 0)) { stats.avoided++; continue; }
    pool.push(s);
  }

  // Step 4: BM25 per lens. Title, why-read and body are scored separately and combined with weights.
  const fields = {
    title: pool.map((s) => tokenize(s.title)),
    whyRead: pool.map((s) => tokenize(s.whyRead)),
    body: pool.map((s) => tokenize(s.content)),
  };
  const W = profile.fieldWeights;

  const raw: number[][] = [];          // raw[lens][story]
  const matched: string[][][] = [];    // matched[lens][story] -> keywords found
  for (const lens of profile.lenses) {
    const terms = lens.keywords.map(tokenize);
    const t = bm25(fields.title, terms);
    const w = bm25(fields.whyRead, terms);
    const b = bm25(fields.body, terms);
    raw.push(pool.map((_, si) => W.title * t[si].score + W.whyRead * w[si].score + W.body * b[si].score));
    matched.push(
      pool.map((_, si) => lens.keywords.filter((_, ti) => t[si].tf[ti] > 0 || w[si].tf[ti] > 0 || b[si].tf[ti] > 0)),
    );
  }

  // Scores from different lenses are not directly comparable (different keyword lists),
  // so each lens is scaled by its best story that day. A story belongs to the lens where it shines most.
  const maxRaw = raw.map((row) => Math.max(0, ...row));
  const scored: Scored[] = [];
  const noMatch: Story[] = [];
  pool.forEach((story, si) => {
    let bestLens = -1;
    let bestNorm = 0;
    profile.lenses.forEach((_, li) => {
      const norm = maxRaw[li] > 0 ? raw[li][si] / maxRaw[li] : 0;
      if (norm > bestNorm) { bestNorm = norm; bestLens = li; }
    });
    if (bestLens < 0) { noMatch.push(story); return; }
    scored.push({
      story,
      lens: profile.lenses[bestLens].name,
      score: raw[bestLens][si],
      norm: bestNorm,
      matched: matched[bestLens][si],
    });
  });
  scored.sort((a, b) => b.norm - a.norm);

  // Step 5: quota first (so one hot topic cannot take every slot), then fill with the best of the rest.
  const total = profile.settings.totalStories;
  const chosen = new Set<Scored>();
  for (const lens of profile.lenses) {
    for (const c of scored.filter((s) => s.lens === lens.name).slice(0, profile.settings.perLensQuota)) {
      if (chosen.size < total) chosen.add(c);
    }
  }
  for (const c of scored) {
    if (chosen.size >= total) break;
    chosen.add(c);
  }

  return {
    selected: scored.filter((c) => chosen.has(c)),
    rest: scored.filter((c) => !chosen.has(c)),
    noMatch,
    stats,
  };
}
