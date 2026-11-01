// Debug tool: gather stories, run the filter, and save what it kept, nearly kept and missed
// into filtered.md, so you can tune profile.json by eye.
//
//   npm run preview                          -> the newest edition
//   npm run preview -- 2026-10-28 2026-10-30 -> exactly those editions
//
// It only READS. It never touches the bookmark or the delivered-links list.

import { writeFile } from "node:fs/promises";
import { feedEditions, type Edition } from "./trigger.js";
import { gather } from "./gather.js";
import { filterStories, loadProfile } from "./filter.js";
import { renderFiltered } from "./render.js";

const OUT_FILE = "filtered.md";

async function main() {
  const args = process.argv.slice(2);

  let editions: Edition[];
  if (args.length > 0) {
    const bad = args.filter((a) => !/^\d{4}-\d{2}-\d{2}$/.test(a));
    if (bad.length) throw new Error(`Dates must look like 2026-10-30. Got: ${bad.join(", ")}`);
    editions = [...new Set(args)].sort().map((date) => ({ date, url: `https://tdd.cat/${date}/` }));
  } else {
    editions = [(await feedEditions()).at(-1)!];
  }

  const stories = await gather({ editions, since: null });
  const profile = await loadProfile();
  const result = filterStories(stories, profile, new Set()); // new Set() = ignore the delivered list

  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  await writeFile(OUT_FILE, renderFiltered(result, profile, editions.map((e) => e.date), stamp));
  console.log(
    `Wrote ${OUT_FILE}: ${result.selected.length} selected, ${result.rest.length} near misses, ` +
      `${result.noMatch.length} with no keyword match (from ${stories.length} gathered)`,
  );
}

await main().catch((err) => {
  console.error("Preview failed:", err);
  process.exit(1);
});
