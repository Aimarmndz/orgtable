// Allowed email domains of an organization (docs/workspaces.md, "Security"). Pure functions,
// shared by the service and the forms.

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "@Acme.COM", " acme.com " → "acme.com"; null if it is not a domain. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "");
  return DOMAIN.test(d) ? d : null;
}

/** Whether an email may join the organization (any, when no domains are set). Exact match. */
export function emailDomainAllowed(domains: readonly string[], email: string): boolean {
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domains.includes(domain);
}
