// Trigger layer's brain: "which editions haven't I briefed you on yet?"
// No LLM, no scraping: just the RSS feed (a tiny XML file) and a bookmark file.

import { mkdir, readFile, writeFile } from "node:fs/promises";

const FEED_URL = "https://tdd.cat/rss.xml";
const STATE_PATH = "state/last-edition.json";

export type Edition = { date: string; url: string }; // date looks like "2026-10-27"

export type TriggerResult = {
  editions: Edition[];   // every edition newer than the bookmark, OLDEST first
  since: string | null;  // the bookmark (null on the very first run)
};

// The bookmark = date of the newest edition we delivered. Null on the very first run.
async function readBookmark(): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(STATE_PATH, "utf8"));
    return raw.lastEdition ?? null;
  } catch {
    return null; // file missing = first run
  }
}

export async function saveBookmark(date: string): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify({ lastEdition: date }, null, 2) + "\n");
}

// Every edition date listed in the feed, sorted oldest -> newest.
export async function feedEditions(): Promise<Edition[]> {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`Feed request failed: HTTP ${res.status}`);
  const xml = await res.text();

  // Each item links to https://tdd.cat/YYYY-MM-DD/ , so pull out those dates.
  const dates = [...xml.matchAll(/<link>https:\/\/tdd\.cat\/(\d{4}-\d{2}-\d{2})\/<\/link>/g)].map(
    (m) => m[1],
  );
  if (dates.length === 0) throw new Error("No editions found in feed (did the format change?)");

  // ISO dates sort correctly as plain strings, so no Date maths needed.
  return [...new Set(dates)].sort().map((date) => ({ date, url: `https://tdd.cat/${date}/` }));
}

// Returns null when there is nothing new (the caller should exit quietly).
export async function checkForNewEditions(): Promise<TriggerResult | null> {
  const [since, all] = await Promise.all([readBookmark(), feedEditions()]);
  const newest = all.at(-1)!;
  console.log(`Bookmark: ${since ?? "none"} | Newest on site: ${newest.date}`);

  // First run: don't dump history on me, just take the newest edition.
  if (since === null) return { editions: [newest], since };

  const fresh = all.filter((e) => e.date > since);
  if (fresh.length === 0) return null;
  return { editions: fresh, since };
}
