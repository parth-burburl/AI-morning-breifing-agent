// Sends one SAMPLE briefing to yourself, so you can check the email login and the design
// without running the whole pipeline. It touches no state. Also writes email-preview.html.
//   npm run mailtest

import { writeFile } from "node:fs/promises";
import { loadDotEnv } from "./env.js";
import { readMailConfig, renderHtml, sendEmail } from "./deliver.js";
import { renderText } from "./synthesise.js";

loadDotEnv();

const sel = [
  ["Stage-adaptive KV-cache transitions optimize long-context LLM inference", "https://arxiv.org/abs/2610.34731"],
  ["Memory latency stalls processors despite showing full cpu utilization", "https://example.com/memory"],
  ["Maclet isolates lightweight Linux containers on Apple Silicon", "https://example.com/maclet"],
].map(([title, url]) => ({ lens: "Sample", score: 1, norm: 1, matched: [], story: { edition: "sample", title, url, authors: "", whyRead: "", discussion: null, content: "" } })) as any;

const b = {
  themes: ["Long-context serving is a memory and network problem.", "CPUs and GPUs both stall on memory.", "Developer tooling noise today."],
  talkingPoint: "Serving long-context models is mostly about moving less data, not adding more compute.",
  stories: [
    { n: 1, summary: "A framework keeps KV-cache shards in place and routes queries to them.", whyItMatters: "Less data movement lowers the serving cost.", relevance: 5 },
    { n: 2, summary: "A CPU can report 100% use while waiting on RAM.", whyItMatters: "The same bottleneck limits AI hardware.", relevance: 3 },
    { n: 3, summary: "A small container runtime for macOS.", whyItMatters: "Off-goal: can be skipped.", relevance: 2 },
  ],
  actions: [{ do: "Build a spreadsheet comparing the cost of moving KV-cache state against routing queries to it.", why: "Turns the idea into a number you can defend.", time: "2 hours" }],
};

const label = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const html = renderHtml(b, sel, label);
await writeFile("email-preview.html", html);
console.log("Wrote email-preview.html (open it in a browser)");

const cfg = readMailConfig();
if (!cfg) {
  console.log("SMTP_USER / SMTP_PASS / MAIL_TO not set in .env, so nothing was sent.");
} else {
  await sendEmail(cfg, { subject: `[TEST] Morning Briefing · ${label}`, text: renderText(b, sel, label), html });
  console.log(`Test email sent to ${cfg.to}`);
}
