// Memory of article links we already delivered, so the same story is not sent again
// when a later edition re-features it. Lives next to the bookmark in state/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { normalizeUrl } from "./filter.js";

const SEEN_PATH = "state/seen.json";
const RETAIN_DAYS = 30; // forget links older than this, so the file stays small

type SeenFile = { delivered: Record<string, string> }; // normalized link -> day delivered (YYYY-MM-DD)

async function read(): Promise<SeenFile> {
  try {
    const raw = JSON.parse(await readFile(SEEN_PATH, "utf8"));
    return { delivered: raw.delivered ?? {} };
  } catch {
    return { delivered: {} }; // no file yet = nothing delivered so far
  }
}

export async function loadDelivered(): Promise<Set<string>> {
  return new Set(Object.keys((await read()).delivered));
}

// `today` is a YYYY-MM-DD string.
export async function markDelivered(urls: string[], today: string): Promise<void> {
  const file = await read();
  for (const u of urls) file.delivered[normalizeUrl(u)] = today;

  const cutoff = new Date(Date.parse(today) - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const [link, day] of Object.entries(file.delivered)) if (day < cutoff) delete file.delivered[link];

  await mkdir("state", { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify(file, null, 2) + "\n");
}
