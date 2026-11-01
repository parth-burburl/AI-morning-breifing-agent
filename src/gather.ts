// Gather layer: ONLY fetches. For each edition, download the markdown version
// (tdd.cat/YYYY-MM-DD.md) and split it into stories: title + content + a bit of metadata.
// No judging, no filtering: that's the next layer's job.

import type { Edition, TriggerResult } from "./trigger.js";

export type Story = {
  edition: string;        // edition date, e.g. "2026-10-27"
  title: string;
  url: string;            // link to the original article
  authors: string;
  whyRead: string;        // curator's one-line "why read this"
  discussion: string | null; // Hacker News thread, if any
  content: string;        // the full body text
};

// Pure function (no network): markdown text in, stories out. Easy to test.
export function parseEdition(markdown: string, edition: string): Story[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const stories: Story[] = [];
  let current: Story | null = null;
  let inBody = false;
  const body: string[] = [];

  const finish = () => {
    if (current) {
      current.content = body.join("\n").trim();
      stories.push(current);
    }
    current = null;
    inBody = false;
    body.length = 0;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // A story starts at "## [Title](https://link)"
    const heading = line.match(/^## \[(.+)\]\((\S+)\)$/);
    if (heading) {
      finish();
      current = {
        edition,
        title: heading[1],
        url: heading[2],
        authors: "",
        whyRead: "",
        discussion: null,
        content: "",
      };
      continue;
    }
    if (!current) continue; // masthead / front matter before the first story

    // A line of 3+ dashes ends the story (also drops any footer after the last one).
    if (/^-{3,}$/.test(line)) {
      finish();
      continue;
    }

    if (!inBody) {
      const by = line.match(/^\*\*By:\*\*\s*(.*)$/);
      if (by) { current.authors = by[1].trim(); continue; }
      const why = line.match(/^\*\*Why read:\*\*\s*(.*)$/);
      if (why) { current.whyRead = why[1].trim(); continue; }
      const disc = line.match(/^\*\*Discussion:\*\*\s*\[[^\]]*\]\((\S+)\)/);
      if (disc) { current.discussion = disc[1]; continue; }
      if (line.trim() === "") continue;
      inBody = true; // first non-metadata line = start of the article text
    }
    body.push(line);
  }
  finish(); // in case the file ends without a closing "---"

  return stories;
}

async function fetchEdition(e: Edition): Promise<Story[]> {
  const url = `https://tdd.cat/${e.date}.md`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);

  const stories = parseEdition(await res.text(), e.date);
  // Zero stories almost certainly means the format changed. Fail loudly.
  if (stories.length === 0) throw new Error(`No stories parsed from ${url} (did the format change?)`);
  return stories;
}

// Fetch every edition the trigger handed us, oldest first.
export async function gather(trigger: TriggerResult): Promise<Story[]> {
  const all: Story[] = [];
  for (const e of trigger.editions) {
    const stories = await fetchEdition(e);
    console.log(`Gathered ${stories.length} stories from ${e.date}`);
    all.push(...stories);
  }
  return all;
}
