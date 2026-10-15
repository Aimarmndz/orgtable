import { describe, it, expect } from "vitest";
import { emailDomainAllowed, normalizeDomain } from "@/app/lib/email-domains";

// Allowed email domains of an organization (docs/workspaces.md, "Security").
describe("email domains", () => {
  it("normalises what people type and refuses what is not a domain", () => {
    expect(normalizeDomain(" @Acme.COM ")).toBe("acme.com");
    expect(normalizeDomain("mail.acme.co.uk")).toBe("mail.acme.co.uk");
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("acme..com")).toBeNull();
    expect(normalizeDomain("http://acme.com")).toBeNull();
  });

  it("allows any email without domains, and only exact domains with them", () => {
    expect(emailDomainAllowed([], "a@anything.org")).toBe(true);
    expect(emailDomainAllowed(["acme.com"], "Ana@ACME.com")).toBe(true);
    expect(emailDomainAllowed(["acme.com"], "ana@evil-acme.com")).toBe(false);
    expect(emailDomainAllowed(["acme.com"], "ana@acme.com.evil.org")).toBe(false);
    expect(emailDomainAllowed(["acme.com"], "ana@sub.acme.com")).toBe(false);
  });
});
