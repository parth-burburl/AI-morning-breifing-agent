// Trigger layer's brain: "is there an edition I haven't briefed you on yet?"
// No LLM, no scraping: just the RSS feed (a tiny XML file) and a bookmark file.

import { mkdir, readFile, writeFile } from "node:fs/promises";

const FEED_URL = "https://tdd.cat/rss.xml";
const STATE_PATH = "state/last-edition.json";

export type Edition = { date: string; url: string }; // date looks like "2026-10-27"

export type TriggerResult = {
  edition: Edition;        // the newest edition on the site
  since: string | null;    // the bookmark; gather will fetch everything after this date
};

// The bookmark = date of the last edition we delivered. Null on the very first run.
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

async function newestEdition(): Promise<Edition> {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`Feed request failed: HTTP ${res.status}`);
  const xml = await res.text();

  // Each item links to https://tdd.cat/YYYY-MM-DD/ , so pull out those dates.
  const dates = [...xml.matchAll(/<link>https:\/\/tdd\.cat\/(\d{4}-\d{2}-\d{2})\/<\/link>/g)].map(
    (m) => m[1],
  );
  if (dates.length === 0) throw new Error("No editions found in feed (did the format change?)");

  // ISO dates sort correctly as plain strings, so no Date maths needed.
  const date = dates.sort().at(-1)!;
  return { date, url: `https://tdd.cat/${date}/` };
}

// Returns null when there is nothing new (the caller should exit quietly).
export async function checkForNewEdition(): Promise<TriggerResult | null> {
  const [since, edition] = await Promise.all([readBookmark(), newestEdition()]);
  console.log(`Bookmark: ${since ?? "none"} | Newest on site: ${edition.date}`);

  if (since !== null && edition.date <= since) return null;
  return { edition, since };
}
