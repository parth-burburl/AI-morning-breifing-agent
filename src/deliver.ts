// Deliver layer: turn the briefing into an email and send it through Gmail SMTP.
//
// If sending fails, this throws. index.ts then exits before moving the bookmark or recording
// delivered links, so the next trigger simply tries again. A failed send never skips a day.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Scored } from "./filter.js";
import type { Briefing } from "./synthesise.js";

// ---------- config ----------

export type MailConfig = { user: string; pass: string; to: string };

export function readMailConfig(): MailConfig | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.MAIL_TO;
  if (!user || !pass || !to) return null;
  return { user, pass: pass.replace(/\s+/g, ""), to }; // Google shows app passwords with spaces: strip them
}

// ---------- HTML ----------

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : "#");
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function page(dateLabel: string, inner: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Morning Briefing</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;font-family:${FONT};color:#18181b;">
<tr><td style="padding:28px 28px 8px 28px;">
<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#71717a;">Morning Briefing</div>
<div style="font-size:22px;font-weight:700;margin-top:4px;">${esc(dateLabel)}</div>
</td></tr>
${inner}
<tr><td style="padding:20px 28px 28px 28px;font-size:12px;color:#a1a1aa;">Built by your own pipeline: tdd.cat &rarr; BM25 filter &rarr; one LLM call.</td></tr>
</table></td></tr></table></body></html>`;
}

const section = (title: string, body: string) =>
  `<tr><td style="padding:18px 28px 0 28px;"><div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#71717a;font-weight:600;margin-bottom:8px;">${title}</div>${body}</td></tr>`;

export function renderHtml(b: Briefing, selected: Scored[], dateLabel: string): string {
  const themes = `<ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.55;">${b.themes.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

  const say = `<div style="background:#f4f4f5;border-left:4px solid #18181b;padding:12px 14px;font-size:15px;line-height:1.5;border-radius:4px;">${esc(b.talkingPoint)}</div>`;

  const order = b.stories.map((n, i) => ({ n, s: selected[i] })).sort((a, z) => z.n.relevance - a.n.relevance);
  const stories = order
    .map(({ n, s }) => {
      const low = n.relevance <= 2;
      const titleColor = low ? "#71717a" : "#18181b";
      return `<div style="margin:0 0 20px 0;${low ? "opacity:.8;" : ""}">
<div style="font-size:12px;color:${low ? "#a1a1aa" : "#b45309"};letter-spacing:2px;">${stars(n.relevance)}${low ? ' <span style="letter-spacing:0;">skippable</span>' : ""}</div>
<div style="font-size:16px;font-weight:600;line-height:1.35;margin:2px 0 6px 0;"><a href="${safeUrl(s.story.url)}" style="color:${titleColor};text-decoration:none;">${esc(s.story.title)}</a></div>
<div style="font-size:14px;line-height:1.55;">${esc(n.summary)}</div>
<div style="font-size:14px;line-height:1.55;color:#52525b;margin-top:6px;"><b>Why it matters:</b> ${esc(n.whyItMatters)}</div>
<div style="font-size:12px;margin-top:6px;"><a href="${safeUrl(s.story.url)}" style="color:#2563eb;">Read the story &rarr;</a></div>
</div>`;
    })
    .join("");

  const actions =
    b.actions.length === 0
      ? `<div style="font-size:14px;color:#52525b;">Nothing today deserves action. Read, don't build.</div>`
      : b.actions
          .map(
            (a) => `<div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px 14px;margin:0 0 10px 0;">
<div style="font-size:15px;font-weight:600;line-height:1.4;">${esc(a.do)}</div>
<div style="font-size:13px;color:#52525b;margin-top:4px;"><b>${esc(a.time)}</b> &middot; ${esc(a.why)}</div></div>`,
          )
          .join("");

  return page(
    dateLabel,
    section("Today in three lines", themes) +
      section("Say this today", say) +
      section("What to do", actions) +
      section("Stories, best first", stories),
  );
}

// Used when the LLM step did not produce a briefing: still readable, just unsummarised.
export function renderPlainHtml(selected: Scored[], dateLabel: string): string {
  const items = selected
    .map(
      (s) => `<div style="margin:0 0 14px 0;"><div style="font-size:12px;color:#71717a;">${esc(s.lens)} &middot; ${esc(s.story.edition)}</div>
<a href="${safeUrl(s.story.url)}" style="font-size:16px;font-weight:600;color:#18181b;text-decoration:none;">${esc(s.story.title)}</a>
<div style="font-size:13px;color:#52525b;margin-top:2px;">${esc(s.story.whyRead)}</div></div>`,
    )
    .join("");
  const note = `<div style="font-size:13px;color:#b45309;margin-bottom:12px;">Today's AI summary was unavailable, so this is the unsummarised list.</div>`;
  return page(dateLabel, section("Selected stories", note + items));
}

export function renderEmptyHtml(dateLabel: string, gathered: number): string {
  return page(dateLabel, section("Nothing relevant today", `<div style="font-size:15px;line-height:1.55;">${gathered} stories were checked and none matched your goal well enough. This is the filter working, not the pipeline breaking.</div>`));
}

// ---------- sending ----------

export type Mail = { subject: string; text: string; html: string };

export async function sendEmail(cfg: MailConfig, mail: Mail, transport?: Transporter): Promise<void> {
  const t =
    transport ??
    nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: cfg.user, pass: cfg.pass } });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await t.sendMail({ from: `Morning Briefing <${cfg.user}>`, to: cfg.to, subject: mail.subject, text: mail.text, html: mail.html });
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`Send attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw new Error(`Email could not be sent: ${(lastErr as Error).message}`);
}
