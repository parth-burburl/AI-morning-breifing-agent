// Entry point. Both daily triggers start this same file.
// Step 1 asks "anything new?". If not, exit quietly. If so, run the pipeline.

import { checkForNewEdition, saveBookmark, type TriggerResult } from "./trigger.js";

type Item = { title: string; url: string; source: string };

// --- Layer stubs: we'll fill these in one by one ---------------------------

async function gather(_t: TriggerResult): Promise<Item[]> {
  // Next up: fetch every edition after `_t.since` up to `_t.edition.date`.
  return [];
}

function filter(items: Item[]): Item[] {
  // Plain code, no LLM: dedupe, keyword rules.
  return items;
}

async function synthesise(items: Item[]): Promise<string> {
  // The only place an LLM may be used, to keep token cost low.
  return items.map((i) => `- ${i.title} (${i.source})\n  ${i.url}`).join("\n");
}

async function deliver(briefing: string): Promise<void> {
  // For now, just print. Later: email.
  console.log(briefing || "(no items yet)");
}

// --- Pipeline ---------------------------------------------------------------

async function main() {
  const source = process.env.TRIGGER_SOURCE ?? "local"; // "schedule" | "workflow_dispatch" | "local"
  const nowIst = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`Started via "${source}" at ${nowIst} IST`);

  const trigger = await checkForNewEdition();
  if (!trigger) {
    console.log("Nothing new since last briefing. Exiting quietly.");
    return;
  }

  const items = await gather(trigger);
  const briefing = await synthesise(filter(items));
  await deliver(briefing);

  // Only move the bookmark AFTER delivery succeeded. If anything above throws,
  // the bookmark stays put and the next trigger retries the same edition.
  await saveBookmark(trigger.edition.date);
  console.log(`Bookmark moved to ${trigger.edition.date}. Done.`);
}

main().catch((err) => {
  console.error("Briefing failed:", err);
  process.exit(1); // non-zero exit makes the GitHub Action show as failed
});
