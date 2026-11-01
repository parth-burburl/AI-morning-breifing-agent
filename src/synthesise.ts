// Synthesise layer: the ONLY place an LLM is used. One call turns the selected stories into a briefing.
//
// The model returns JSON in a fixed shape. It never writes the final email and never writes links:
// our code does the layout and attaches the real URLs, so the model cannot invent a link.
// If the call fails twice, we fall back to the plain list so a briefing still goes out.

import type { Profile, Scored } from "./filter.js";

// ---------- shapes ----------

export type StoryNote = { n: number; summary: string; whyItMatters: string; relevance: number };
export type Action = { do: string; why: string; time: string };
export type Briefing = { themes: string[]; stories: StoryNote[]; talkingPoint: string; actions: Action[] };

export type LlmConfig = { endpoint: string; apiKey: string; model: string };

const BODY_CHARS = 1200; // how much of each story's text the model sees

// ---------- prompt ----------

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)) + " ...";
}

export function buildMessages(selected: Scored[], profile: Profile) {
  const system = [
    "You write a daily briefing for one reader. Be concrete, plain and honest. No hype, no filler.",
    "",
    `READER: ${profile.about || "(not given)"}`,
    `READER'S GOAL: ${profile.goal}`,
    "",
    "For each numbered story you get a title, a one-line why-read and an excerpt. Use ONLY those facts. If the excerpt does not say it, do not claim it.",
    "",
    "Return ONE JSON object, nothing else, with exactly these keys:",
    '  "themes": array of exactly 3 short strings: what today was about, in plain words.',
    '  "stories": array with one object per input story, in the same order: {"n": story number, "summary": 2-3 sentences on what happened, "whyItMatters": ONE sentence on why it matters to the reader\'s goal (economics, a layer of the AI stack, or a startup opportunity), "relevance": integer 1-5}.',
    "      relevance: 5 = squarely on the goal, 3 = useful background, 1-2 = off-goal, say so. Be harsh: most stories are 2-3. If relevance is 1 or 2, whyItMatters must say it can be skipped.",
    '  "talkingPoint": ONE sentence the reader could say to an AI expert or a beginner today, based on the stories.',
    '  "actions": array of 0 to 3 objects {"do", "why", "time"} for the WHOLE briefing, not per story.',
    "      Each action must name a concrete artifact the reader can produce within a week (a benchmark, a cost-per-token calculation, a one-page startup sketch, a conversation with a named kind of person). 'time' is an honest estimate like '2 hours'.",
    "      The reader is a busy student with no budget: no action may need money, a team or special access. Actions may only come from stories with relevance 3 or more.",
    "      'why' is one line: why do this rather than nothing. If nothing deserves action today, return an empty array. Never invent an action to fill space.",
  ].join("\n");

  const user = selected
    .map((s, i) =>
      [
        `[${i + 1}] ${s.story.title}`,
        `Filter lens: ${s.lens}`,
        `Why read: ${s.story.whyRead || "(none)"}`,
        `Excerpt: ${clip(s.story.content, BODY_CHARS) || "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: `Today's ${selected.length} stories:\n\n${user}` },
  ];
}

// ---------- validation ----------

function isStr(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

// Accepts the model's text and returns a clean Briefing, or throws saying exactly what is wrong.
export function parseBriefing(text: string, count: number): Briefing {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  const raw = JSON.parse(text.slice(start, end + 1));

  if (!Array.isArray(raw.themes) || raw.themes.length === 0 || !raw.themes.every(isStr)) throw new Error("themes must be a non-empty list of strings");
  if (!isStr(raw.talkingPoint)) throw new Error("talkingPoint missing");
  if (!Array.isArray(raw.stories) || raw.stories.length !== count) throw new Error(`stories must have exactly ${count} entries`);

  const stories: StoryNote[] = raw.stories.map((s: any, i: number) => {
    if (s?.n !== i + 1) throw new Error(`stories[${i}].n must be ${i + 1}`);
    if (!isStr(s.summary) || !isStr(s.whyItMatters)) throw new Error(`stories[${i}] needs summary and whyItMatters`);
    if (!Number.isInteger(s.relevance) || s.relevance < 1 || s.relevance > 5) throw new Error(`stories[${i}].relevance must be an integer 1-5`);
    return { n: s.n, summary: s.summary.trim(), whyItMatters: s.whyItMatters.trim(), relevance: s.relevance };
  });

  const rawActions = raw.actions ?? [];
  if (!Array.isArray(rawActions) || rawActions.length > 3) throw new Error("actions must be a list of at most 3");
  const actions: Action[] = rawActions.map((a: any, i: number) => {
    if (!isStr(a?.do) || !isStr(a?.why) || !isStr(a?.time)) throw new Error(`actions[${i}] needs do, why and time`);
    return { do: a.do.trim(), why: a.why.trim(), time: a.time.trim() };
  });

  return { themes: raw.themes.map((t: string) => t.trim()), stories, talkingPoint: raw.talkingPoint.trim(), actions };
}

// ---------- the call ----------

export function readConfig(): LlmConfig | null {
  const endpoint = process.env.LLM_ENDPOINT;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!endpoint || !apiKey || !model) return null;
  return { endpoint, apiKey, model };
}

async function chat(cfg: LlmConfig, messages: unknown[], jsonMode: boolean): Promise<string> {
  const url = cfg.endpoint.replace(/\/+$/, "") + "/chat/completions";
  // No temperature / max-token settings on purpose: some newer models reject them.
  const body: Record<string, unknown> = { model: cfg.model, messages };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": cfg.apiKey, authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300); // never includes our key
    throw Object.assign(new Error(`LLM HTTP ${res.status}: ${detail}`), { status: res.status });
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!isStr(text)) throw new Error("LLM reply had no text");
  if (data?.usage) console.log(`LLM tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out`);
  return text;
}

// Returns a Briefing, or null if it could not get a valid one (caller then uses the fallback list).
export async function synthesise(selected: Scored[], profile: Profile, cfg: LlmConfig | null = readConfig()): Promise<Briefing | null> {
  if (selected.length === 0) return null;
  if (!cfg) {
    console.warn("LLM_ENDPOINT / LLM_API_KEY / LLM_MODEL not all set: skipping the LLM, using the plain list.");
    return null;
  }

  const messages = buildMessages(selected, profile);
  let jsonMode = true;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return parseBriefing(await chat(cfg, messages, jsonMode), selected.length);
    } catch (err: any) {
      console.warn(`Synthesise attempt ${attempt} failed: ${err.message}`);
      if (err.status === 400 && jsonMode) jsonMode = false; // model may not support JSON mode: retry without it
    }
  }
  return null;
}

// ---------- rendering ----------

const STARS = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

// Plain-text version (also the email's text fallback). The HTML version comes with the deliver layer.
export function renderText(b: Briefing, selected: Scored[], dateLabel: string): string {
  const out: string[] = [];
  out.push(`MORNING BRIEFING, ${dateLabel}`, "");
  out.push("TODAY IN THREE LINES");
  b.themes.forEach((t) => out.push(`- ${t}`));
  out.push("", `SAY THIS TODAY: ${b.talkingPoint}`, "");

  out.push("STORIES (best first)");
  const order = b.stories.map((n, i) => ({ n, s: selected[i] })).sort((a, z) => z.n.relevance - a.n.relevance);
  order.forEach(({ n, s }, i) => {
    out.push("", `${i + 1}. ${s.story.title}  ${STARS(n.relevance)}`);
    out.push(`   ${n.summary}`);
    out.push(`   Why it matters: ${n.whyItMatters}`);
    out.push(`   ${s.story.url}`);
  });

  out.push("", "WHAT TO DO");
  if (b.actions.length === 0) out.push("- Nothing today deserves action. Read, don't build.");
  b.actions.forEach((a) => out.push(`- ${a.do} (${a.time})`, `  Why: ${a.why}`));
  return out.join("\n");
}

// The no-LLM fallback: the numbered list we had before.
export function renderPlain(selected: Scored[]): string {
  return selected.map((s, i) => `${i + 1}. [${s.lens}] ${s.story.title} (${s.story.edition})\n   ${s.story.url}`).join("\n");
}
