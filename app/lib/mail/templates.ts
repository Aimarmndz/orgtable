import { fmt } from "@/app/i18n/format";
import type { Messages } from "@/app/i18n/config";

// The emails, drawn like the landing page (DESIGN.md, "Landing"): a retro window with a
// pinstriped title bar and a hard shadow, a terracotta button and a phosphor terminal
// line. Email clients understand little CSS, so it is built with tables and inline styles;
// web fonts are a bonus (Apple Mail) and every face has a safe fallback. Every message also
// has a plain-text version. Every dynamic value is HTML-escaped here.

const C = {
  page: "#e9dfd0",
  paper: "#fdf8f0",
  ink: "#2e211a",
  muted: "#6b5646",
  body: "#4d3a2e",
  accent: "#a4471f",
  accentInk: "#fff8ef",
  terminal: "#1f1611",
  phosphor: "#ffcf7a",
};

const FONT_BODY = "'Figtree', Arial, Helvetica, sans-serif";
const FONT_DISPLAY = "'Bricolage Grotesque', Arial, Helvetica, sans-serif";
const FONT_PIXEL = "'Silkscreen', 'Courier New', monospace";
const FONT_TERMINAL = "'VT323', 'Courier New', monospace";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type RetroEmail = {
  lang: string;
  subject: string;
  // Shown by inboxes next to the subject.
  preheader: string;
  kicker: string;
  windowTitle: string;
  title: string;
  paragraphs: string[];
  button: { label: string; url: string };
  terminal: string[];
  note: string;
  footer: string;
  legal: { privacy: string; terms: string; baseUrl: string };
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderRetroEmail(e: RetroEmail): RenderedEmail {
  const p = (text: string, extra = "") =>
    `<p style="margin:14px 0 0;font-family:${FONT_BODY};font-size:16px;line-height:1.55;color:${C.body};${extra}">${escapeHtml(text)}</p>`;
  const url = escapeHtml(e.button.url);
  const html = `<!doctype html>
<html lang="${escapeHtml(e.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(e.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Figtree:wght@400;700&family=Silkscreen&family=VT323&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.page}">
<!-- Inbox preview text; the invisible padding keeps clients from appending the body. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(e.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:576px">
<tr><td align="center" style="padding:0 0 14px;font-family:${FONT_PIXEL};font-size:12px;letter-spacing:1px;color:#7a6656">${escapeHtml(e.kicker)}</td></tr>
<tr><td style="background:${C.paper};border:2px solid ${C.ink};border-radius:4px;box-shadow:6px 6px 0 ${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:28px;border-bottom:2px solid ${C.ink};background:${C.paper};background-image:repeating-linear-gradient(180deg,${C.paper} 0 2px,${C.ink} 2px 3px);text-align:center">
<span style="display:inline-block;padding:0 10px;background:${C.paper};font-family:${FONT_PIXEL};font-size:12px;line-height:28px;color:${C.ink}">${escapeHtml(e.windowTitle)}</span>
</td></tr>
<tr><td style="padding:28px 28px 26px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:30px;height:30px;background:${C.accent};border:2px solid ${C.ink};border-radius:3px;text-align:center;font-family:${FONT_DISPLAY};font-weight:800;font-size:16px;color:${C.accentInk}">o</td>
<td style="padding-left:10px;font-family:${FONT_DISPLAY};font-weight:800;font-size:22px;color:${C.ink}">orgtable</td>
</tr></table>
<h1 style="margin:22px 0 0;font-family:${FONT_DISPLAY};font-weight:800;font-size:28px;line-height:1.15;color:${C.ink}">${escapeHtml(e.title)}</h1>
${e.paragraphs.map((t) => p(t)).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="background:${C.accent};border:2px solid ${C.ink};border-radius:4px;box-shadow:4px 4px 0 ${C.ink}">
<a href="${url}" style="display:inline-block;padding:13px 24px;font-family:${FONT_BODY};font-weight:700;font-size:16px;color:${C.accentInk};text-decoration:none">${escapeHtml(e.button.label)} &rarr;</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="padding:12px 14px;background:${C.terminal};border-radius:3px;font-family:${FONT_TERMINAL};font-size:18px;line-height:1.35;color:${C.phosphor}">
${e.terminal.map((line) => `&gt; ${escapeHtml(line)}`).join("<br>")}
</td></tr></table>
${p(e.note, `font-size:14px;color:${C.muted}`)}
<p style="margin:16px 0 0;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:#8a7563;word-break:break-all">${escapeHtml(e.button.url)}</p>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:20px 8px 0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${C.muted}">
orgtable &middot; <a href="${escapeHtml(e.legal.baseUrl)}/legal/privacy" style="color:${C.muted}">${escapeHtml(e.legal.privacy)}</a> &middot; <a href="${escapeHtml(e.legal.baseUrl)}/legal/terms" style="color:${C.muted}">${escapeHtml(e.legal.terms)}</a><br>${escapeHtml(e.footer)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    e.title,
    "",
    ...e.paragraphs.flatMap((t) => [t, ""]),
    `${e.button.label}: ${e.button.url}`,
    "",
    ...e.terminal.map((line) => `> ${line}`),
    "",
    e.note,
    "",
    "--",
    `orgtable · ${e.legal.baseUrl}`,
    e.footer,
  ].join("\n");

  return { subject: e.subject, html, text };
}

type Common = { m: Messages; lang: string; baseUrl: string };

function legal(c: Common) {
  return {
    privacy: c.m.emails.privacy,
    terms: c.m.emails.terms,
    baseUrl: c.baseUrl,
  };
}

/** "Forgot your password": a link to choose a new one. */
export function passwordResetEmail(
  c: Common & { name: string; url: string; minutes: number },
): RenderedEmail {
  const t = c.m.emails.reset;
  return renderRetroEmail({
    lang: c.lang,
    subject: t.subject,
    preheader: t.preheader,
    kicker: c.m.emails.kickerAccount,
    windowTitle: "PASSWORD.EXE",
    title: t.title,
    paragraphs: [fmt(t.body, { name: c.name })],
    button: { label: t.button, url: c.url },
    terminal: [fmt(t.expires, { minutes: c.minutes }), t.once],
    note: t.notYou,
    footer: fmt(c.m.emails.footerAccount, { host: new URL(c.baseUrl).host }),
    legal: legal(c),
  });
}

/** An organization created an account: choose your password to get in. */
export function inviteEmail(
  c: Common & {
    name: string;
    email: string;
    url: string;
    days: number;
    organization: string;
    organizationSlug: string;
    inviter: string;
    role: string;
  },
): RenderedEmail {
  const t = c.m.emails.invite;
  const host = new URL(c.baseUrl).host;
  return renderRetroEmail({
    lang: c.lang,
    subject: fmt(t.subject, { organization: c.organization }),
    preheader: fmt(t.preheader, { organization: c.organization }),
    kicker: `ORGTABLE · ${c.organization.toUpperCase()}`,
    windowTitle: "WELCOME.TXT",
    title: fmt(t.title, { organization: c.organization }),
    paragraphs: [
      fmt(t.body, {
        name: c.name,
        inviter: c.inviter,
        organization: c.organization,
        role: c.role,
      }),
      fmt(t.address, { address: `${host}/${c.organizationSlug}` }),
    ],
    button: { label: t.button, url: c.url },
    terminal: [
      fmt(t.expires, { days: c.days }),
      fmt(t.yourEmail, { email: c.email }),
    ],
    note: fmt(t.ownership, { organization: c.organization }),
    footer: fmt(t.footer, { organization: c.organization }),
    legal: legal(c),
  });
}

/** After the password changed through a link: so the owner notices if it was not them. */
export function passwordChangedEmail(
  c: Common & { name: string; resetUrl: string },
): RenderedEmail {
  const t = c.m.emails.changed;
  return renderRetroEmail({
    lang: c.lang,
    subject: t.subject,
    preheader: t.preheader,
    kicker: c.m.emails.kickerAccount,
    windowTitle: "SECURITY.LOG",
    title: t.title,
    paragraphs: [fmt(t.body, { name: c.name })],
    button: { label: t.button, url: c.resetUrl },
    terminal: [t.sessions, t.tokens],
    note: t.notYou,
    footer: fmt(c.m.emails.footerAccount, { host: new URL(c.baseUrl).host }),
    legal: legal(c),
  });
}
