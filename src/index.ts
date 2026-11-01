// Entry point. Both daily triggers start this same file.
// trigger -> gather -> filter -> synthesise -> deliver
// Step 1 asks "anything new?". If not, exit quietly.

import { checkForNewEditions, saveBookmark } from "./trigger.js";
import { gather } from "./gather.js";
import { filterStories, loadProfile, type Scored } from "./filter.js";
import { loadDelivered, markDelivered } from "./seen.js";
import { loadDotEnv } from "./env.js";
import { synthesise, renderText, renderPlain } from "./synthesise.js";

loadDotEnv(); // local runs read .env; the cloud uses repo Secrets

// --- Layer stub: delivery comes next -----------------------------------------

async function deliver(briefing: string): Promise<void> {
  // For now, just print. Later: email.
  console.log(briefing || "(nothing relevant in these editions)");
}

// --- Pipeline ---------------------------------------------------------------

async function main() {
  const source = process.env.TRIGGER_SOURCE ?? "local"; // "schedule" | "workflow_dispatch" | "local"
  const nowIst = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`Started via "${source}" at ${nowIst} IST`);

  const trigger = await checkForNewEditions();
  if (!trigger) {
    console.log("Nothing new since last briefing. Exiting quietly.");
    return;
  }

  const stories = await gather(trigger);

  const profile = await loadProfile();
  const result = filterStories(stories, profile, await loadDelivered());
  const s = result.stats;
  console.log(
    `Filter: ${s.gathered} gathered, ${s.duplicatesRemoved} duplicates, ${s.alreadyDelivered} already delivered, ` +
      `${s.avoided} avoided, ${result.noMatch.length} no keyword match -> ${result.selected.length} selected`,
  );

  const note = await synthesise(result.selected, profile);
  const dateLabel = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const briefing = note ? renderText(note, result.selected, dateLabel) : renderPlain(result.selected);
  await deliver(briefing);

  // Only AFTER delivery succeeded: move the bookmark and remember what we sent.
  // If anything above throws, nothing is saved and the next trigger retries.
  const newest = trigger.editions.at(-1)!.date;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  await markDelivered(result.selected.map((x) => x.story.url), today);
  await saveBookmark(newest);
  console.log(`Bookmark moved to ${newest}. Done.`);
}

main().catch((err) => {
  console.error("Briefing failed:", err);
  process.exit(1); // non-zero exit makes the GitHub Action show as failed
});
