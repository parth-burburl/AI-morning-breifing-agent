// Debug tool: gather stories and save them ALL (full text) into one .md file,
// so you can check by eye that gather works.
//
//   npm run export                          -> the newest edition
//   npm run export -- 2026-10-28 2026-10-30 -> exactly those editions
//
// It only READS. It never touches the bookmark, so it is safe to run any time.

import { writeFile } from "node:fs/promises";
import { feedEditions, type Edition } from "./trigger.js";
import { gather } from "./gather.js";
import { renderMarkdown } from "./render.js";

const OUT_FILE = "gathered.md";

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
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  await writeFile(OUT_FILE, renderMarkdown(stories, stamp));
  console.log(`Wrote ${stories.length} stories from ${editions.length} edition(s) to ${OUT_FILE}`);
}

await main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
