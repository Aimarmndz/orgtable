import { describe, it, expect } from "vitest";
import { mailConfig } from "@/app/lib/mail/config";
import { escapeHtml, renderRetroEmail } from "@/app/lib/mail/templates";

// Email configuration and the retro template (docs/email.md).

const ok = {
  ORGTABLE_SMTP_URL: "smtps://user:secret@smtp.example.org:465",
  ORGTABLE_MAIL_FROM: "orgtable <no-reply@example.org>",
  ORGTABLE_PUBLIC_URL: "https://orgtable.example.org/some/path",
} as unknown as NodeJS.ProcessEnv;

describe("mailConfig", () => {
  it("is off without ORGTABLE_SMTP_URL", () => {
    expect(mailConfig({} as NodeJS.ProcessEnv)).toEqual({ enabled: false });
  });

  it("reads the three variables; the public URL keeps only its origin", () => {
    expect(mailConfig(ok)).toEqual({
      enabled: true,
      transportUrl: ok.ORGTABLE_SMTP_URL,
      from: ok.ORGTABLE_MAIL_FROM,
      publicUrl: "https://orgtable.example.org",
    });
  });

  it("fails with the reason instead of silently disabling email", () => {
    expect(() => mailConfig({ ...ok, ORGTABLE_SMTP_URL: "http://x" })).toThrow(/smtp/);
    expect(() => mailConfig({ ...ok, ORGTABLE_MAIL_FROM: "" })).toThrow(/ORGTABLE_MAIL_FROM/);
    expect(() => mailConfig({ ...ok, ORGTABLE_PUBLIC_URL: "" })).toThrow(/ORGTABLE_PUBLIC_URL/);
    expect(() => mailConfig({ ...ok, ORGTABLE_PUBLIC_URL: "javascript:alert(1)" })).toThrow(
      /ORGTABLE_PUBLIC_URL/,
    );
  });

  it("memory:// works only outside production", () => {
    expect(mailConfig({ ...ok, ORGTABLE_SMTP_URL: "memory://" }).enabled).toBe(true);
    expect(() =>
      mailConfig({ ...ok, ORGTABLE_SMTP_URL: "memory://", NODE_ENV: "production" }),
    ).toThrow(/production/);
  });
});

describe("the retro email", () => {
  const email = renderRetroEmail({
    lang: "en",
    subject: "Subject",
    preheader: "Preheader",
    kicker: "KICKER",
    windowTitle: "PASSWORD.EXE",
    title: "Title <b>",
    paragraphs: ["Hello & welcome"],
    button: { label: "Go", url: "https://orgtable.test/reset-password?token=a&b" },
    terminal: ["line one"],
    note: "Note",
    footer: "Footer",
    legal: { privacy: "Privacy", terms: "Terms", baseUrl: "https://orgtable.test" },
  });

  it("escapes every value and keeps the link usable", () => {
    expect(email.html).toContain("Title &lt;b&gt;");
    expect(email.html).toContain("Hello &amp; welcome");
    expect(email.html).toContain('href="https://orgtable.test/reset-password?token=a&amp;b"');
  });

  it("has a plain-text version with the link", () => {
    expect(email.text).toContain("Go: https://orgtable.test/reset-password?token=a&b");
    expect(email.text).not.toContain("<table");
  });

  it("escapeHtml covers quotes", () => {
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
